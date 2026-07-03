using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class DefendFortressGame(IHubContext<GameHub, IGameClient> hubContext) : ICardGame
{
    private static readonly string[] CastleUpgradeIds = ["archer", "wall", "repair", "soldier", "ballista"];

    /// <summary>Phase 3 (experimental) artillery upgrade tree — epic §9/§14, separate gold economy.</summary>
    private static readonly string[] ArtilleryUpgradeIds = ["sling_power", "sling_reload", "sling_splash", "sling_multi", "sling_mark"];

    private readonly ConcurrentDictionary<string, DefendFortressGameState> _states = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _tickLoops = new();

    public string GameType => "defend-fortress";

    public async Task StartGame(GameRoom room, string connectionId, string? settingsJson = null)
    {
        room.Players.RemoveAll(p => p.IsBot);

        var gameMode = ParseGameMode(settingsJson);
        var state = new DefendFortressGameState { GameMode = gameMode };

        foreach (var player in room.Players.Where(p => !p.IsBot))
            state.Players[player.Name] = new DefendFortressPlayerState();

        // Lobby-time seat pre-pick (epic §14/Q18): first player who marked themselves "artillery"
        // in the lobby starts the run holding that seat — no need to wait for the first shop.
        state.ArtilleryPlayerName = room.Players
            .FirstOrDefault(p => !p.IsBot && p.PreferredRole == "artillery")?.Name;

        BeginWave(state, wave: 1);

        _states[room.RoomCode] = state;
        StartTickLoop(room);
        await BroadcastState(room, state);
    }

    public async Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state))
            return new HubResult(false, "Game state not found.");

        if (state.Phase == DefendFortressPhase.GameOver)
            return new HubResult(false, "Game is over.");

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId && !p.IsBot);
        if (player is null)
            return new HubResult(false, "Player not found.");

        await room.Lock.WaitAsync();
        try
        {
            return action switch
            {
                "GrabEnemy" => await GrabEnemy(room, state, player.Name, payloadJson),
                "MoveHeld" => await MoveHeld(room, state, player.Name, payloadJson),
                "ReleaseEnemy" => await ReleaseEnemy(room, state, player.Name, payloadJson),
                "PurchaseUpgrade" => await PurchaseUpgrade(room, state, player.Name, payloadJson),
                "ReadyForWave" => await ReadyForWave(room, state, player.Name, payloadJson),
                "ImportSave" => await ImportSave(room, state, player, payloadJson),
                "StartNextWave" => await StartNextWaveAction(room, state, player),
                "VolunteerArtillery" => await VolunteerArtillery(room, state, player.Name),
                "FireSlingshot" => await FireSlingshot(room, state, player.Name, payloadJson),
                "TogglePause" => await TogglePause(room, state, player),
                "Ping" => new HubResult(true),
                _ => new HubResult(false, $"Unknown action: {action}")
            };
        }
        finally
        {
            room.Lock.Release();
        }
    }

    public Task OnPlayerDisconnected(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return Task.CompletedTask;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId && !p.IsBot);
        if (player is null) return Task.CompletedTask;

        foreach (var enemy in state.Enemies.Where(e => e.HeldBy == player.Name))
            ReleaseHold(enemy);

        return Task.CompletedTask;
    }

    public async Task OnPlayerJoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId && !p.IsBot);
        if (player is null || state.Players.ContainsKey(player.Name)) return;

        // Mid-wave joiners spectate until the next shop (epic §12); joining during
        // Shop/WaveComplete/Countdown drops them straight into the active roster.
        state.Players[player.Name] = new DefendFortressPlayerState
        {
            IsSpectator = state.Phase == DefendFortressPhase.WavePlaying
        };
        await BroadcastState(room, state);
    }

    public async Task OnPlayerRejoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        await BroadcastState(room, state);
    }

    /// <summary>"Leave Game" reuses the mid-wave-spectator machinery (PTF-1.7): release anything
    /// they're holding and flip them to spectator so gold splits/rosters skip them until they come
    /// back — same as a fresh mid-wave joiner, just without losing their run progress (Kills, Gold,
    /// Upgrades on <see cref="DefendFortressPlayerState"/> are untouched).</summary>
    public async Task OnPlayerLeftGame(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId && !p.IsBot);
        if (player is null) return;

        await MoveToSpectator(room, state, player.Name);
    }

    /// <summary>Host-triggered Drop — same "gone" treatment as a self-initiated Leave Game (release
    /// anything they're holding, fold into the existing spectator/bench machinery). Looked up by
    /// name rather than connection ID since a dropped player may already be disconnected.</summary>
    public async Task OnPlayerDropped(GameRoom room, string playerName)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        await MoveToSpectator(room, state, playerName);
    }

    private async Task MoveToSpectator(GameRoom room, DefendFortressGameState state, string playerName)
    {
        foreach (var enemy in state.Enemies.Where(e => e.HeldBy == playerName))
            ReleaseHold(enemy);

        if (state.Players.TryGetValue(playerName, out var ps))
            ps.IsSpectator = true;

        await BroadcastState(room, state);
    }

    public Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost) => Task.CompletedTask;

    // ---- Phase-gated combat actions ----

    private static bool CombatInputBlocked(DefendFortressGameState state) =>
        state.Phase != DefendFortressPhase.WavePlaying || state.IsPaused;

    private async Task<HubResult> TogglePause(GameRoom room, DefendFortressGameState state, Player player)
    {
        if (state.Phase != DefendFortressPhase.WavePlaying)
            return new HubResult(false, "Can only pause during combat.");
        if (state.Players.GetValueOrDefault(player.Name)?.IsSpectator == true)
            return new HubResult(false, "Spectators can't pause.");

        state.IsPaused = !state.IsPaused;
        state.PausedBy = state.IsPaused ? player.Name : null;
        await BroadcastState(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> GrabEnemy(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (CombatInputBlocked(state)) return new HubResult(false, state.IsPaused ? "Game is paused." : "Not in combat.");
        if (state.Players.GetValueOrDefault(playerName)?.IsSpectator == true) return new HubResult(false, "Spectators can't play until the next shop.");
        if (!TryParseId(payloadJson, out var id)) return new HubResult(false, "Invalid payload.");
        var enemy = state.Enemies.FirstOrDefault(e => e.Id == id);
        if (enemy is null) return new HubResult(false, "Enemy not found.");
        if (enemy.State != "march" && enemy.State != "attacking") return new HubResult(false, "Enemy not available.");
        if (enemy.HeldBy is not null) return new HubResult(false, "Already held.");

        foreach (var other in state.Enemies.Where(e => e.HeldBy == playerName && e.Id != id))
            ReleaseHold(other);

        enemy.State = "held";
        enemy.HeldBy = playerName;
        enemy.LastTouchedBy = playerName;
        enemy.Vx = 0;
        enemy.Vy = 0;
        enemy.HeldAge = 0;
        await BroadcastState(room, state, includePlatform: false);
        return new HubResult(true);
    }

    private async Task<HubResult> MoveHeld(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (CombatInputBlocked(state)) return new HubResult(false, state.IsPaused ? "Game is paused." : "Not in combat.");
        if (!TryParseMove(payloadJson, out var id, out var x, out var y))
            return new HubResult(false, "Invalid payload.");

        var enemy = state.Enemies.FirstOrDefault(e => e.Id == id);
        if (enemy is null) return new HubResult(false, "Enemy not found.");
        if (enemy.HeldBy != playerName) return new HubResult(false, "Not holding this enemy.");

        enemy.X = Clamp(x, 0, DefendFortressGameState.WorldWidth);
        enemy.Y = Clamp(y, 0, GroundY() - 4);
        enemy.HeldAge = 0;
        await BroadcastState(room, state, includePlatform: false);
        return new HubResult(true);
    }

    private async Task<HubResult> ReleaseEnemy(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (CombatInputBlocked(state)) return new HubResult(false, state.IsPaused ? "Game is paused." : "Not in combat.");
        if (!TryParseRelease(payloadJson, out var id, out var vx, out var vy))
            return new HubResult(false, "Invalid payload.");

        var enemy = state.Enemies.FirstOrDefault(e => e.Id == id);
        if (enemy is null) return new HubResult(false, "Enemy not found.");
        if (enemy.HeldBy != playerName) return new HubResult(false, "Not holding this enemy.");

        enemy.HeldBy = null;
        enemy.LastTouchedBy = playerName;
        enemy.HeldAge = 0;

        var speed = MathF.Sqrt(vx * vx + vy * vy);
        if (speed < 80)
        {
            enemy.State = "march";
            enemy.MarchSpeed = 40 + Random.Shared.NextSingle() * 25;
            enemy.Vx = 0;
            enemy.Vy = 0;
        }
        else
        {
            enemy.State = "airborne";
            enemy.Vx = vx;
            enemy.Vy = vy;
            enemy.Spin = vx * 0.004f;
            if (state.Players.TryGetValue(playerName, out var ps))
                ps.Flings++;
        }

        await BroadcastState(room, state, includePlatform: false);
        return new HubResult(true);
    }

    private static void ReleaseHold(DefendFortressEnemy enemy)
    {
        enemy.HeldBy = null;
        enemy.HeldAge = 0;
        enemy.State = "march";
        enemy.MarchSpeed = 40 + Random.Shared.NextSingle() * 25;
        enemy.Vx = 0;
        enemy.Vy = 0;
        enemy.Rotation = 0;
        enemy.Spin = 0;
    }

    // ---- Shop actions ----

    private async Task<HubResult> PurchaseUpgrade(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (state.Phase != DefendFortressPhase.Shop) return new HubResult(false, "Shop is not open.");
        if (!TryParseUpgradeId(payloadJson, out var upgradeId)) return new HubResult(false, "Invalid payload.");
        if (!state.Players.TryGetValue(playerName, out var ps)) return new HubResult(false, "Player not found.");

        var isArtillery = ArtilleryUpgradeIds.Contains(upgradeId);
        if (!isArtillery && !CastleUpgradeIds.Contains(upgradeId)) return new HubResult(false, "Unknown upgrade.");

        var tier = ps.Upgrades.GetValueOrDefault(upgradeId);
        var cost = UpgradeCost(upgradeId, tier);

        if (isArtillery)
        {
            if (ps.ArtilleryGold < cost) return new HubResult(false, "Not enough artillery gold.");
            ps.ArtilleryGold -= cost;
        }
        else
        {
            if (ps.Gold < cost) return new HubResult(false, "Not enough gold.");
            ps.Gold -= cost;

            if (upgradeId == "wall")
                state.FortressMaxHp += 15;
            else if (upgradeId == "repair")
                state.FortressHp = Math.Min(state.FortressMaxHp, state.FortressHp + 15);
        }

        ps.Upgrades[upgradeId] = tier + 1;

        await BroadcastState(room, state);
        return new HubResult(true);
    }

    private static int UpgradeCost(string upgradeId, int currentTier)
    {
        var baseCost = upgradeId switch
        {
            "archer" => 100,
            "wall" => 200,
            "repair" => 75,
            "soldier" => 150,
            "ballista" => 300,
            "sling_power" => 80,
            "sling_reload" => 100,
            "sling_splash" => 150,
            "sling_multi" => 250,
            "sling_mark" => 120,
            _ => 100
        };
        return (int)MathF.Ceiling(baseCost * (1 + 0.5f * currentTier));
    }

    /// <summary>Host-only override (Q13): force-starts the countdown even if not everyone is ready.</summary>
    private async Task<HubResult> StartNextWaveAction(GameRoom room, DefendFortressGameState state, Player player)
    {
        if (state.Phase != DefendFortressPhase.Shop) return new HubResult(false, "Not in shop.");
        if (!player.IsHost) return new HubResult(false, "Only the host can force-start the next wave.");

        BeginCountdown(state);
        await BroadcastState(room, state);
        return new HubResult(true);
    }

    /// <summary>Q13: normally requires every active player ready before auto-advancing.</summary>
    private async Task<HubResult> ReadyForWave(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (state.Phase != DefendFortressPhase.Shop) return new HubResult(false, "Not in shop.");
        if (!state.Players.TryGetValue(playerName, out var ps)) return new HubResult(false, "Player not found.");

        ps.Ready = TryParseReady(payloadJson, out var ready) ? ready : !ps.Ready;

        var active = state.ActivePlayerNames().ToList();
        if (active.Count > 0 && active.All(n => state.Players[n].Ready))
            BeginCountdown(state);

        await BroadcastState(room, state);
        return new HubResult(true);
    }

    private static void BeginCountdown(DefendFortressGameState state)
    {
        state.Phase = DefendFortressPhase.Countdown;
        state.CountdownRemaining = DefendFortressGameState.CountdownSeconds;
    }

    // ---- Phase 3 (experimental) — Artillery view, epic §14 ----

    /// <summary>Q18: first click claims the single Artillery seat for the next wave; clicking again
    /// while already holding it releases the seat back to "flinger".</summary>
    private async Task<HubResult> VolunteerArtillery(GameRoom room, DefendFortressGameState state, string playerName)
    {
        if (state.Phase != DefendFortressPhase.Shop) return new HubResult(false, "Can only volunteer in the shop.");
        if (!state.Players.ContainsKey(playerName)) return new HubResult(false, "Player not found.");

        state.ArtilleryPlayerName = state.ArtilleryPlayerName == playerName ? null : playerName;
        await BroadcastState(room, state);
        return new HubResult(true);
    }

    /// <summary>Fires a slingshot disc for the current Artillery player. Cooldown and shot velocity
    /// scale with that player's sling_reload/sling_power upgrade tiers.</summary>
    private async Task<HubResult> FireSlingshot(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (CombatInputBlocked(state)) return new HubResult(false, state.IsPaused ? "Game is paused." : "Not in combat.");
        if (state.ArtilleryPlayerName != playerName) return new HubResult(false, "You don't hold the artillery seat.");
        if (state.ArtilleryCooldownRemaining > 0) return new HubResult(false, "Slingshot is still reloading.");
        if (!TryParseFire(payloadJson, out var angle, out var power)) return new HubResult(false, "Invalid payload.");

        var ps = state.Players[playerName];
        var powerTier = ps.Upgrades.GetValueOrDefault("sling_power");
        var reloadTier = ps.Upgrades.GetValueOrDefault("sling_reload");

        var speed = (400f + powerTier * 60f) * Clamp(power, 0.2f, 1f);
        state.Discs.Add(new DefendFortressDisc
        {
            Id = state.NextDiscId++,
            X = DefendFortressGameState.WorldWidth - DefendFortressGameState.CastleOffset,
            Y = DefendFortressGameState.WorldHeight - DefendFortressGameState.GroundOffset,
            Vx = MathF.Cos(angle) * speed,
            Vy = MathF.Sin(angle) * speed,
            FiredBy = playerName
        });

        state.ArtilleryCooldownRemaining = MathF.Max(0.25f, DefendFortressGameState.SlingshotBaseCooldown - reloadTier * 0.08f);

        await BroadcastState(room, state, includePlatform: false);
        return new HubResult(true);
    }

    /// <summary>Discs bounce off world edges, despawn after their bounce/life budget runs out, and
    /// on hitting an enemy: airborne enemies combo (ground-slam + AoE per epic §14), marching
    /// enemies just take direct damage.</summary>
    private static void SimulateDiscs(DefendFortressGameState state, float dt)
    {
        if (state.ArtilleryCooldownRemaining > 0)
            state.ArtilleryCooldownRemaining = MathF.Max(0, state.ArtilleryCooldownRemaining - dt);

        foreach (var disc in state.Discs.ToList())
        {
            disc.Life -= dt;
            disc.X += disc.Vx * dt;
            disc.Y += disc.Vy * dt;

            if (disc.Life <= 0 || disc.BouncesLeft <= 0)
            {
                state.Discs.Remove(disc);
                continue;
            }

            if (disc.X < 0 || disc.X > DefendFortressGameState.WorldWidth)
            {
                disc.Vx = -disc.Vx;
                disc.X = Clamp(disc.X, 0, DefendFortressGameState.WorldWidth);
                disc.BouncesLeft--;
            }
            if (disc.Y < 0 || disc.Y > DefendFortressGameState.WorldHeight)
            {
                disc.Vy = -disc.Vy;
                disc.Y = Clamp(disc.Y, 0, DefendFortressGameState.WorldHeight);
                disc.BouncesLeft--;
            }

            var hit = state.Enemies.FirstOrDefault(e =>
                (e.State == "march" || e.State == "airborne" || e.State == "attacking") &&
                MathF.Sqrt((e.X - disc.X) * (e.X - disc.X) + (e.Y - disc.Y) * (e.Y - disc.Y)) < 20);
            if (hit is null) continue;

            var shooter = disc.FiredBy;
            var powerTier = shooter is not null && state.Players.TryGetValue(shooter, out var sp) ? sp.Upgrades.GetValueOrDefault("sling_power") : 0;
            var damage = 3 + powerTier * 2;

            if (hit.State == "airborne")
                ResolveArtilleryCombo(state, hit, shooter);
            else
                DamageEnemy(state, hit, damage, creditedTo: shooter);

            if (shooter is not null && state.Players.TryGetValue(shooter, out var ps))
                ps.ArtilleryGold += hit.Hp <= 0 ? DefendFortressGameState.GoldPerArtilleryKill : 0;

            state.Discs.Remove(disc);
        }
    }

    /// <summary>Epic §14 flinger⇄artillery combo: a disc hitting an airborne (player-flung) enemy
    /// slams it dead and detonates an AoE that kills nearby marching enemies. Splash radius scales
    /// with the shooter's sling_splash tier.</summary>
    private static void ResolveArtilleryCombo(DefendFortressGameState state, DefendFortressEnemy hit, string? shooter)
    {
        var splashTier = shooter is not null && state.Players.TryGetValue(shooter, out var sp) ? sp.Upgrades.GetValueOrDefault("sling_splash") : 0;
        var radius = 30 + splashTier * 15;
        var comboX = hit.X;
        var comboY = hit.Y;

        EliminateEnemy(state, hit, breach: false, creditedTo: shooter);

        foreach (var nearby in state.Enemies.Where(e => e.State == "march" || e.State == "attacking").ToList())
        {
            var d = MathF.Sqrt((nearby.X - comboX) * (nearby.X - comboX) + (nearby.Y - comboY) * (nearby.Y - comboY));
            if (d < radius)
                EliminateEnemy(state, nearby, breach: false, creditedTo: shooter);
        }

        if (shooter is not null && state.Players.TryGetValue(shooter, out var ps))
            ps.ArtilleryGold += DefendFortressGameState.GoldPerArtilleryCombo;
    }

    // ---- Save import (PTF-2.1) ----

    /// <summary>Host-only, Shop-only. Validates the epic §13 save schema, then overwrites run-level
    /// state. Gold/upgrades from the save land on the importing host's wallet — see
    /// docs/games/Protect Thy Fortress/stories/PTF-2.1-save-export-import.md for why.</summary>
    private async Task<HubResult> ImportSave(GameRoom room, DefendFortressGameState state, Player player, string? payloadJson)
    {
        if (state.Phase != DefendFortressPhase.Shop) return new HubResult(false, "Import is only allowed in the shop.");
        if (!player.IsHost) return new HubResult(false, "Only the host can import a save.");
        if (payloadJson is null) return new HubResult(false, "Missing save payload.");

        JsonElement root;
        try
        {
            var el = JsonDocument.Parse(payloadJson).RootElement;
            if (!el.TryGetProperty("saveJson", out var inner))
                return new HubResult(false, "Missing saveJson field.");
            root = JsonDocument.Parse(inner.GetString() ?? "").RootElement;
        }
        catch (JsonException)
        {
            return new HubResult(false, "Save file is not valid JSON.");
        }

        if (!TryGetInt(root, "schemaVersion", out var schemaVersion) || schemaVersion != 1)
            return new HubResult(false, "Unsupported save schema version.");
        if (!root.TryGetProperty("gameType", out var gameTypeEl) || gameTypeEl.GetString() != GameType)
            return new HubResult(false, "Save file is for a different game.");
        if (!TryGetInt(root, "wave", out var wave) || wave < 1)
            return new HubResult(false, "Invalid wave number in save.");
        if (!TryGetInt(root, "fortressMaxHp", out var fortressMaxHp) || fortressMaxHp < 1)
            return new HubResult(false, "Invalid fortressMaxHp in save.");
        if (!TryGetInt(root, "fortressHp", out var fortressHp) || fortressHp < 0 || fortressHp > fortressMaxHp)
            return new HubResult(false, "Invalid fortressHp in save.");

        var gameMode = root.TryGetProperty("gameMode", out var gm) && gm.GetString() is "10" or "50" or "100" or "endless"
            ? gm.GetString()!
            : state.GameMode;

        var upgrades = new Dictionary<string, int>();
        if (root.TryGetProperty("castleUpgrades", out var upgradesEl) && upgradesEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in upgradesEl.EnumerateObject())
            {
                if (!CastleUpgradeIds.Contains(prop.Name)) continue;
                if (!prop.Value.TryGetInt32(out var tier) || tier < 0)
                    return new HubResult(false, $"Invalid tier for upgrade '{prop.Name}' in save.");
                upgrades[prop.Name] = tier;
            }
        }

        var gold = TryGetInt(root, "gold", out var g) && g >= 0 ? g : 0;

        state.Wave = wave;
        state.FortressMaxHp = fortressMaxHp;
        state.FortressHp = fortressHp;
        state.GameMode = gameMode;

        var host = state.Players[player.Name];
        host.Gold = gold;
        host.Upgrades = upgrades;

        await BroadcastState(room, state);
        return new HubResult(true);
    }

    private static bool TryGetInt(JsonElement root, string propertyName, out int value)
    {
        value = 0;
        return root.TryGetProperty(propertyName, out var el) && el.TryGetInt32(out value);
    }

    // ---- Simulation ----

    private static string ParseGameMode(string? settingsJson)
    {
        if (settingsJson is null) return "10";
        try
        {
            var el = JsonDocument.Parse(settingsJson).RootElement;
            if (el.TryGetProperty("gameMode", out var m))
            {
                var mode = m.GetString();
                if (mode is "10" or "50" or "100" or "endless") return mode;
            }
        }
        catch { /* fall through to default */ }
        return "10";
    }

    private static void BeginWave(DefendFortressGameState state, int wave)
    {
        state.Wave = wave;
        var cfg = DefendFortressWaveConfig.For(wave);
        var activePlayers = Math.Max(1, state.ActivePlayerNames().Count());
        state.EnemiesToSpawn = cfg.QueuePerPlayer * activePlayers;
        state.SpawnTimer = 0;
        state.Phase = DefendFortressPhase.WavePlaying;
        state.ResultMessage = null;
        state.IsPaused = false;
        state.PausedBy = null;
        state.Discs.Clear();
        state.ArtilleryCooldownRemaining = 0;
    }

    private void Simulate(DefendFortressGameState state)
    {
        var dt = DefendFortressGameState.TickSeconds;
        var cfg = DefendFortressWaveConfig.For(state.Wave);

        state.SpawnTimer += dt;
        if (state.EnemiesToSpawn > 0
            && state.Enemies.Count < cfg.OnFieldCap
            && state.SpawnTimer >= cfg.SpawnInterval)
        {
            state.SpawnTimer = 0;
            SpawnEnemy(state, cfg);
        }

        var castleX = DefendFortressGameState.WorldWidth - DefendFortressGameState.CastleOffset;
        var gy = GroundY();

        foreach (var enemy in state.Enemies.ToList())
        {
            if (enemy.State == "held")
            {
                enemy.HeldAge += dt;
                if (enemy.HeldAge >= DefendFortressGameState.HeldStaleSeconds)
                    ReleaseHold(enemy);
                continue;
            }

            if (enemy.State == "march")
                SimulateMarch(state, enemy, dt, castleX, cfg);
            else if (enemy.State == "airborne")
                SimulateAirborne(state, enemy, dt, gy, castleX);
            else if (enemy.State == "attacking")
                SimulateAttacking(state, enemy, dt);
        }

        SimulateAutoUnits(state, dt, castleX);
        SimulateDiscs(state, dt);
    }

    /// <summary>Runner intro wave per Q20 (grunt + runner only for MVP; tank/bomber/splitter are Phase-2+ per epic §7).</summary>
    private const int RunnerIntroWave = 4;

    private static void SpawnEnemy(DefendFortressGameState state, DefendFortressWaveConfig cfg)
    {
        var (grassTop, grassBottom) = GrassBand();
        var y = grassTop + Random.Shared.NextSingle() * (grassBottom - grassTop);
        var isRunner = state.Wave >= RunnerIntroWave && Random.Shared.NextSingle() < 0.25f;
        var enemyType = isRunner ? "runner" : "grunt";
        var speedMult = (isRunner ? 1.6f : 1.0f) * cfg.SpeedMultiplier;
        var hp = isRunner ? Math.Max(1, cfg.EnemyHp - 1) : cfg.EnemyHp;

        state.Enemies.Add(new DefendFortressEnemy
        {
            Id = state.NextEnemyId++,
            X = -20,
            Y = y,
            State = "march",
            MarchSpeed = (55 + Random.Shared.NextSingle() * 35) * speedMult,
            Wobble = Random.Shared.NextSingle() * MathF.PI * 2,
            Hp = hp,
            MaxHp = hp,
            EnemyType = enemyType
        });
        state.EnemiesToSpawn--;
    }

    private static void SimulateMarch(DefendFortressGameState state, DefendFortressEnemy enemy, float dt, float castleX, DefendFortressWaveConfig cfg)
    {
        enemy.X += enemy.MarchSpeed * dt;
        enemy.Wobble += dt * 4;
        enemy.Y += MathF.Sin(enemy.Wobble) * 0.4f;

        var (grassTop, grassBottom) = GrassBand();
        enemy.Y = Clamp(enemy.Y, grassTop, grassBottom);

        if (enemy.X >= castleX)
        {
            enemy.X = castleX;
            enemy.State = "attacking";
        }
    }

    /// <summary>Vertical strip marchers are confined to — bottom quarter of the world, ending just
    /// above the ground line, so they walk on the grass in the landscape art instead of the sky.</summary>
    private static (float top, float bottom) GrassBand()
    {
        var bottom = GroundY() - 8f;
        var top = bottom - DefendFortressGameState.GrassBandHeight;
        return (top, bottom);
    }

    /// <summary>Enemy stands at the gate banging on it (real attack sprite) instead of the old instant
    /// breach-on-contact — still killable via fling/artillery/auto-units while attacking, so players
    /// can interrupt it before it grinds the fortress down.</summary>
    private static void SimulateAttacking(DefendFortressGameState state, DefendFortressEnemy enemy, float dt)
    {
        enemy.AttackAccumulator += DefendFortressGameState.WallAttackDps * dt;
        while (enemy.AttackAccumulator >= 1f && state.FortressHp > 0)
        {
            enemy.AttackAccumulator -= 1f;
            state.FortressHp = Math.Max(0, state.FortressHp - 1);
        }
    }

    private static void SimulateAirborne(DefendFortressGameState state, DefendFortressEnemy enemy, float dt, float gy, float castleX)
    {
        enemy.Vy += DefendFortressGameState.Gravity * dt;
        enemy.X += enemy.Vx * dt;
        enemy.Y += enemy.Vy * dt;
        enemy.Rotation += enemy.Spin;

        foreach (var other in state.Enemies)
        {
            if (other.Id == enemy.Id || (other.State != "march" && other.State != "attacking")) continue;
            var d = MathF.Sqrt((other.X - enemy.X) * (other.X - enemy.X) + (other.Y - enemy.Y) * (other.Y - enemy.Y));
            var impact = MathF.Sqrt(enemy.Vx * enemy.Vx + enemy.Vy * enemy.Vy);
            if (d < 28 && impact > 180)
            {
                EliminateEnemy(state, other, breach: false, creditedTo: enemy.LastTouchedBy);
                enemy.Vx *= 0.55f;
                enemy.Vy *= 0.55f;
                break;
            }
        }

        var feetY = enemy.Y + 18;
        if (enemy.X < -40 || enemy.X > DefendFortressGameState.WorldWidth + 40 || enemy.Y < -60)
        {
            EliminateEnemy(state, enemy, breach: false, creditedTo: enemy.LastTouchedBy);
            return;
        }

        if (feetY >= gy && enemy.Vy > 0)
        {
            var impact = MathF.Sqrt(enemy.Vx * enemy.Vx + enemy.Vy * enemy.Vy);
            if (impact > 220)
            {
                EliminateEnemy(state, enemy, breach: false, creditedTo: enemy.LastTouchedBy);
            }
            else
            {
                enemy.Y = gy - 18;
                enemy.Vy = -impact * 0.35f;
                enemy.Vx *= 0.6f;
                if (MathF.Abs(enemy.Vy) < 60)
                {
                    enemy.State = "march";
                    enemy.MarchSpeed = MathF.Max(30, MathF.Abs(enemy.Vx) * 0.5f);
                    enemy.Vx = 0;
                    enemy.Vy = 0;
                    enemy.Rotation = 0;
                    enemy.Spin = 0;
                }
            }
        }

        if (enemy.X >= castleX)
            EliminateEnemy(state, enemy, breach: true, creditedTo: enemy.LastTouchedBy);
    }

    /// <summary>Per-castle-upgrade auto-unit tuning: how many shots/sec per aggregate tier, and how much
    /// damage each shot deals. Archer = fast/weak, ballista = slow/heavy (epic §9), soldier = continuous
    /// melee DPS at the gate rather than discrete "shots" (still expressed as high-frequency low-damage
    /// hits here so it shares the same accumulator mechanism).</summary>
    private static readonly Dictionary<string, (float ShotsPerSecondPerTier, int Damage)> AutoUnitTuning = new()
    {
        ["archer"] = (0.15f, 1),
        ["soldier"] = (0.4f, 1),
        ["ballista"] = (0.05f, 5),
    };

    private static void SimulateAutoUnits(DefendFortressGameState state, float dt, float castleX)
    {
        state.ArcherFireAccumulator = FireAutoUnit(state, dt, "archer", state.ArcherFireAccumulator);
        state.SoldierFireAccumulator = FireAutoUnit(state, dt, "soldier", state.SoldierFireAccumulator);
        state.BallistaFireAccumulator = FireAutoUnit(state, dt, "ballista", state.BallistaFireAccumulator);
    }

    private static float FireAutoUnit(DefendFortressGameState state, float dt, string upgradeId, float accumulator)
    {
        var count = state.AggregateUpgrade(upgradeId);
        if (count <= 0) return accumulator;

        var (shotsPerSecondPerTier, damage) = AutoUnitTuning[upgradeId];
        accumulator += count * shotsPerSecondPerTier * dt;

        while (accumulator >= 1f)
        {
            accumulator -= 1f;
            var target = state.Enemies
                .Where(e => e.State == "march" || e.State == "attacking")
                .OrderByDescending(e => e.State == "attacking")
                .ThenByDescending(e => e.X)
                .FirstOrDefault();
            if (target is null) break;

            DamageEnemy(state, target, damage, creditedTo: $"castle:{upgradeId}");
        }

        return accumulator;
    }

    /// <summary>Applies damage to an enemy's Hp; eliminates + credits the kill once Hp reaches 0.</summary>
    private static void DamageEnemy(DefendFortressGameState state, DefendFortressEnemy enemy, int damage, string? creditedTo)
    {
        enemy.Hp -= damage;
        if (enemy.Hp <= 0)
            EliminateEnemy(state, enemy, breach: false, creditedTo: creditedTo);
    }

    private static void EliminateEnemy(DefendFortressGameState state, DefendFortressEnemy enemy, bool breach, string? creditedTo = null)
    {
        state.Enemies.Remove(enemy);

        if (breach)
        {
            state.FortressHp = Math.Max(0, state.FortressHp - DefendFortressGameState.BreachDamage);
            if (creditedTo is not null && state.Players.TryGetValue(creditedTo, out var ps))
                ps.Breaches++;
            return;
        }

        if (creditedTo is null) return;

        if (creditedTo.StartsWith("castle:"))
        {
            AwardGoldSplit(state, DefendFortressGameState.GoldPerAutoKill);
        }
        else if (state.Players.TryGetValue(creditedTo, out var killer))
        {
            killer.Kills++;
            killer.Gold += DefendFortressGameState.GoldPerFlingKill;
        }
    }

    private static void AwardGoldSplit(DefendFortressGameState state, int totalGold)
    {
        var active = state.ActivePlayerNames().ToList();
        if (active.Count == 0) return;

        var share = totalGold / active.Count;
        var remainder = totalGold % active.Count;
        for (var i = 0; i < active.Count; i++)
        {
            var bonus = i < remainder ? 1 : 0;
            state.Players[active[i]].Gold += share + bonus;
        }
    }

    private async Task CheckEndGame(GameRoom room, DefendFortressGameState state)
    {
        if (state.FortressHp <= 0)
        {
            state.ResultMessage = "The fortress has fallen!";
            state.Phase = DefendFortressPhase.GameOver;
            room.Phase = GamePhase.GameOver;
            StopTickLoop(room.RoomCode);
            await BroadcastState(room, state);
            return;
        }

        var totalRemaining = state.EnemiesToSpawn + state.Enemies.Count;
        if (totalRemaining > 0) return;

        var victoryWave = DefendFortressGameState.VictoryWave(state.GameMode);
        if (victoryWave > 0 && state.Wave >= victoryWave)
        {
            state.ResultMessage = $"Victory! The fortress held for {state.Wave} waves.";
            state.Phase = DefendFortressPhase.GameOver;
            room.Phase = GamePhase.GameOver;
            StopTickLoop(room.RoomCode);
            await BroadcastState(room, state);
            return;
        }

        state.Phase = DefendFortressPhase.WaveComplete;
        state.ResultMessage = $"Wave {state.Wave} repelled!";
        // Auto-advance recap -> shop; recap content stays visible in the shop DTO (Q12).
        state.Phase = DefendFortressPhase.Shop;
        foreach (var p in state.Players.Values)
        {
            p.Ready = false;
            p.IsSpectator = false; // promote mid-wave spectators to the active roster (epic §12)
        }
        await BroadcastState(room, state);
    }

    private void StartTickLoop(GameRoom room)
    {
        StopTickLoop(room.RoomCode);
        var cts = new CancellationTokenSource();
        _tickLoops[room.RoomCode] = cts;

        _ = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(50));
            try
            {
                while (await timer.WaitForNextTickAsync(cts.Token))
                {
                    if (!_states.TryGetValue(room.RoomCode, out var state)) break;
                    if (state.Phase == DefendFortressPhase.GameOver) break;

                    await room.Lock.WaitAsync(cts.Token);
                    try
                    {
                        if (state.Phase == DefendFortressPhase.Countdown)
                        {
                            state.CountdownRemaining -= DefendFortressGameState.TickSeconds;
                            if (state.CountdownRemaining <= 0)
                                BeginWave(state, state.Wave + 1);
                        }
                        else if (state.Phase == DefendFortressPhase.WavePlaying)
                        {
                            if (!state.IsPaused)
                            {
                                Simulate(state);
                                state.ServerTick++;
                                await CheckEndGame(room, state);
                            }
                        }
                    }
                    finally
                    {
                        room.Lock.Release();
                    }

                    if (state.Phase == DefendFortressPhase.GameOver) break;
                    var shouldBroadcast = state.Phase != DefendFortressPhase.WavePlaying || !state.IsPaused;
                    if (shouldBroadcast)
                        await BroadcastState(room, state, includePlatform: false);
                }
            }
            catch (OperationCanceledException) { }
        });
    }

    private void StopTickLoop(string roomCode)
    {
        if (_tickLoops.TryRemove(roomCode, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    private async Task BroadcastState(GameRoom room, DefendFortressGameState state, bool includePlatform = true)
    {
        if (includePlatform)
        {
            var lean = BuildLeanDto(room);
            await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(lean);
        }

        foreach (var player in room.Players.Where(p => p.IsConnected && !p.IsBot))
        {
            var dto = BuildDto(room, state);
            await hubContext.Clients.Client(player.ConnectionId)
                .ReceiveGameSpecificState(GameType, JsonSerializer.Serialize(dto));
        }
    }

    private static DefendFortressGameStateDto BuildDto(GameRoom room, DefendFortressGameState state)
    {
        var players = room.Players
            .Where(p => !p.IsBot)
            .Select(p =>
            {
                var ps = state.Players.GetValueOrDefault(p.Name) ?? new DefendFortressPlayerState();
                var role = p.Name == state.ArtilleryPlayerName ? "artillery" : ps.IsSpectator ? "spectator" : "flinger";
                return new DefendFortressPlayerDto(p.Name, ps.Kills, ps.Breaches, ps.Flings, ps.Gold, ps.ArtilleryGold, p.IsConnected, ps.IsSpectator, ps.Ready, role, ps.Upgrades);
            })
            .ToList();

        var enemies = state.Enemies
            .Select(e => new DefendFortressEnemyDto(e.Id, e.X, e.Y, e.Vx, e.Vy, e.State, e.HeldBy, e.Rotation, e.Hp, e.MaxHp, e.EnemyType))
            .ToList();

        var discs = state.Discs
            .Select(d => new DefendFortressDiscDto(d.Id, d.X, d.Y, d.Vx, d.Vy, d.FiredBy))
            .ToList();

        var airborneIds = state.Enemies.Where(e => e.State == "airborne").Select(e => e.Id).ToList();

        var castleUpgrades = CastleUpgradeIds.ToDictionary(id => id, state.AggregateUpgrade);
        var cfg = DefendFortressWaveConfig.For(state.Wave);
        var waveConfigDto = new DefendFortressWaveConfigDto(
            state.Wave, state.EnemiesToSpawn + state.Enemies.Count, cfg.OnFieldCap, cfg.SpawnInterval, cfg.SpeedMultiplier, cfg.GoldPool);

        return new DefendFortressGameStateDto(
            Phase: state.Phase.ToString(),
            GameMode: state.GameMode,
            FortressHp: state.FortressHp,
            FortressMaxHp: state.FortressMaxHp,
            MaxFortressHp: DefendFortressGameState.MaxFortressHp,
            TotalEnemiesRemaining: state.EnemiesToSpawn + state.Enemies.Count,
            ActiveEnemyCount: state.Enemies.Count,
            Wave: state.Wave,
            VictoryWave: DefendFortressGameState.VictoryWave(state.GameMode),
            ServerTick: state.ServerTick,
            ServerTimeMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            WorldWidth: DefendFortressGameState.WorldWidth,
            WorldHeight: DefendFortressGameState.WorldHeight,
            CountdownRemaining: state.CountdownRemaining,
            Enemies: enemies,
            Players: players,
            CastleUpgrades: castleUpgrades,
            WaveConfig: waveConfigDto,
            SaveExportAllowed: state.Phase is DefendFortressPhase.Shop,
            SaveImportAllowed: state.Phase is DefendFortressPhase.Shop,
            ArtilleryPlayerName: state.ArtilleryPlayerName,
            ArtilleryCooldownRemaining: state.ArtilleryCooldownRemaining,
            Discs: discs,
            AirborneHighlightIds: airborneIds,
            IsPaused: state.IsPaused,
            PausedBy: state.PausedBy,
            ResultMessage: state.ResultMessage);
    }

    private static GameStateDto BuildLeanDto(GameRoom room) =>
        new(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, 0, p.IsHost, p.IsConnected, p.IsBot, p.PreferredRole)).ToList(),
            room.GameType);

    private static float GroundY() => DefendFortressGameState.WorldHeight - DefendFortressGameState.GroundOffset;

    private static float Clamp(float v, float min, float max) => v < min ? min : v > max ? max : v;

    private static bool TryParseId(string? json, out int id)
    {
        id = 0;
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            return el.TryGetProperty("id", out var p) && p.TryGetInt32(out id);
        }
        catch { return false; }
    }

    private static bool TryParseUpgradeId(string? json, out string upgradeId)
    {
        upgradeId = "";
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            if (el.TryGetProperty("upgradeId", out var p) && p.GetString() is { } s)
            {
                upgradeId = s;
                return true;
            }
            return false;
        }
        catch { return false; }
    }

    private static bool TryParseReady(string? json, out bool ready)
    {
        ready = false;
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            if (!el.TryGetProperty("ready", out var p)) return false;
            if (p.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                ready = p.GetBoolean();
                return true;
            }
            return false;
        }
        catch { return false; }
    }

    private static bool TryParseFire(string? json, out float angle, out float power)
    {
        angle = 0; power = 1f;
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            return el.TryGetProperty("angle", out var angleP) && angleP.TryGetSingle(out angle)
                && el.TryGetProperty("power", out var powerP) && powerP.TryGetSingle(out power);
        }
        catch { return false; }
    }

    private static bool TryParseMove(string? json, out int id, out float x, out float y)
    {
        id = 0; x = 0; y = 0;
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            return el.TryGetProperty("id", out var idP) && idP.TryGetInt32(out id)
                && el.TryGetProperty("x", out var xP) && xP.TryGetSingle(out x)
                && el.TryGetProperty("y", out var yP) && yP.TryGetSingle(out y);
        }
        catch { return false; }
    }

    private static bool TryParseRelease(string? json, out int id, out float vx, out float vy)
    {
        id = 0; vx = 0; vy = 0;
        if (json is null) return false;
        try
        {
            var el = JsonDocument.Parse(json).RootElement;
            return el.TryGetProperty("id", out var idP) && idP.TryGetInt32(out id)
                && el.TryGetProperty("vx", out var vxP) && vxP.TryGetSingle(out vx)
                && el.TryGetProperty("vy", out var vyP) && vyP.TryGetSingle(out vy);
        }
        catch { return false; }
    }
}
