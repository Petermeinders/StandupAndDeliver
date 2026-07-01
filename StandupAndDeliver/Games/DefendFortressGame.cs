using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class DefendFortressGame(IHubContext<GameHub, IGameClient> hubContext) : ICardGame
{
    private readonly ConcurrentDictionary<string, DefendFortressGameState> _states = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _tickLoops = new();

    public string GameType => "defend-fortress";

    public async Task StartGame(GameRoom room, string connectionId, string? settingsJson = null)
    {
        room.Players.RemoveAll(p => p.IsBot);

        var humanCount = room.Players.Count(p => !p.IsBot);
        var state = new DefendFortressGameState
        {
            EnemiesToSpawn = DefendFortressGameState.EnemiesPerPlayer * Math.Max(1, humanCount)
        };

        foreach (var player in room.Players.Where(p => !p.IsBot))
            state.Players[player.Name] = new DefendFortressPlayerState();

        _states[room.RoomCode] = state;
        StartTickLoop(room);
        await BroadcastState(room, state);
    }

    public async Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state))
            return new HubResult(false, "Game state not found.");

        if (room.Phase == GamePhase.GameOver)
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

    public async Task OnPlayerRejoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        await BroadcastState(room, state);
    }

    public Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost) => Task.CompletedTask;

    private async Task<HubResult> GrabEnemy(GameRoom room, DefendFortressGameState state, string playerName, string? payloadJson)
    {
        if (!TryParseId(payloadJson, out var id)) return new HubResult(false, "Invalid payload.");
        var enemy = state.Enemies.FirstOrDefault(e => e.Id == id);
        if (enemy is null) return new HubResult(false, "Enemy not found.");
        if (enemy.State != "march") return new HubResult(false, "Enemy not available.");
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

    private void Simulate(DefendFortressGameState state)
    {
        var dt = DefendFortressGameState.TickSeconds;
        state.SpawnTimer += dt;

        if (state.EnemiesToSpawn > 0
            && state.Enemies.Count < DefendFortressGameState.MaxOnScreen
            && state.SpawnTimer >= DefendFortressGameState.SpawnInterval)
        {
            state.SpawnTimer = 0;
            SpawnEnemy(state);
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
                SimulateMarch(state, enemy, dt, castleX);
            else if (enemy.State == "airborne")
                SimulateAirborne(state, enemy, dt, gy, castleX);
        }
    }

    private static void SpawnEnemy(DefendFortressGameState state)
    {
        var y = 60 + Random.Shared.NextSingle() * (DefendFortressGameState.WorldHeight - 120);
        state.Enemies.Add(new DefendFortressEnemy
        {
            Id = state.NextEnemyId++,
            X = -20,
            Y = y,
            State = "march",
            MarchSpeed = 55 + Random.Shared.NextSingle() * 35,
            Wobble = Random.Shared.NextSingle() * MathF.PI * 2
        });
        state.EnemiesToSpawn--;
    }

    private static void SimulateMarch(DefendFortressGameState state, DefendFortressEnemy enemy, float dt, float castleX)
    {
        enemy.X += enemy.MarchSpeed * dt;
        enemy.Wobble += dt * 4;
        enemy.Y += MathF.Sin(enemy.Wobble) * 0.4f;

        if (enemy.X >= castleX)
            EliminateEnemy(state, enemy, breach: true);
    }

    private static void SimulateAirborne(DefendFortressGameState state, DefendFortressEnemy enemy, float dt, float gy, float castleX)
    {
        enemy.Vy += DefendFortressGameState.Gravity * dt;
        enemy.X += enemy.Vx * dt;
        enemy.Y += enemy.Vy * dt;
        enemy.Rotation += enemy.Spin;

        foreach (var other in state.Enemies)
        {
            if (other.Id == enemy.Id || other.State != "march") continue;
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

    private static void EliminateEnemy(DefendFortressGameState state, DefendFortressEnemy enemy, bool breach, string? creditedTo = null)
    {
        state.Enemies.Remove(enemy);

        if (breach)
        {
            state.FortressHp = Math.Max(0, state.FortressHp - DefendFortressGameState.BreachDamage);
            if (creditedTo is not null && state.Players.TryGetValue(creditedTo, out var ps))
                ps.Breaches++;
        }
        else if (creditedTo is not null && state.Players.TryGetValue(creditedTo, out var killer))
        {
            killer.Kills++;
        }
    }

    private async Task CheckEndGame(GameRoom room, DefendFortressGameState state)
    {
        var totalRemaining = state.EnemiesToSpawn + state.Enemies.Count;

        if (state.FortressHp <= 0)
        {
            state.ResultMessage = "The fortress has fallen!";
            room.Phase = GamePhase.GameOver;
            StopTickLoop(room.RoomCode);
            await BroadcastState(room, state);
            return;
        }

        if (totalRemaining <= 0)
        {
            state.ResultMessage = "Wave repelled! The fortress stands.";
            room.Phase = GamePhase.GameOver;
            StopTickLoop(room.RoomCode);
            await BroadcastState(room, state);
        }
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
                    if (room.Phase == GamePhase.GameOver) break;

                    await room.Lock.WaitAsync(cts.Token);
                    try
                    {
                        Simulate(state);
                        state.ServerTick++;
                        await CheckEndGame(room, state);
                    }
                    finally
                    {
                        room.Lock.Release();
                    }

                    if (room.Phase == GamePhase.GameOver) break;
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
                return new DefendFortressPlayerDto(p.Name, ps.Kills, ps.Breaches, p.IsConnected);
            })
            .ToList();

        var enemies = state.Enemies
            .Select(e => new DefendFortressEnemyDto(e.Id, e.X, e.Y, e.Vx, e.Vy, e.State, e.HeldBy, e.Rotation))
            .ToList();

        return new DefendFortressGameStateDto(
            Phase: room.Phase == GamePhase.GameOver ? "GameOver" : "Playing",
            FortressHp: state.FortressHp,
            MaxFortressHp: DefendFortressGameState.MaxFortressHp,
            TotalEnemiesRemaining: state.EnemiesToSpawn + state.Enemies.Count,
            ActiveEnemyCount: state.Enemies.Count,
            Wave: state.Wave,
            ServerTick: state.ServerTick,
            ServerTimeMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            WorldWidth: DefendFortressGameState.WorldWidth,
            WorldHeight: DefendFortressGameState.WorldHeight,
            Enemies: enemies,
            Players: players,
            ResultMessage: state.ResultMessage);
    }

    private static GameStateDto BuildLeanDto(GameRoom room) =>
        new(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, 0, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);

    private async Task BroadcastLean(GameRoom room) =>
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));

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
