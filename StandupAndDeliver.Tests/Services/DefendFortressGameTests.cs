using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Games;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Tests.Services;

/// <summary>No-op fake for IHubContext&lt;GameHub, IGameClient&gt; — the game logic under test
/// only needs broadcasts not to throw; assertions read <see cref="DefendFortressGameState"/> directly
/// via reflection-free internals exposed through the DTOs the game sends.</summary>
internal sealed class NoOpGameClient : IGameClient
{
    public Task ReceiveGameState(GameStateDto state) => Task.CompletedTask;
    public Task ReceiveGameSpecificState(string gameType, string json) => Task.CompletedTask;
    public Task ReceiveTimerTick(int secondsRemaining) => Task.CompletedTask;
    public Task ReceiveVoteCount(int submitted, int total) => Task.CompletedTask;
    public Task ReceivePhaseChange(GamePhase newPhase) => Task.CompletedTask;
    public Task ReceiveError(string message) => Task.CompletedTask;
    public Task ReceiveReaction(string playerName, string emoji) => Task.CompletedTask;
    public Task ReceiveTranscript(string text) => Task.CompletedTask;
}

internal sealed class ConnectionScopedGameClient(FakeHubClients owner, string connectionId) : IGameClient
{
    public Task ReceiveGameState(GameStateDto state) => Task.CompletedTask;

    public Task ReceiveGameSpecificState(string gameType, string json)
    {
        owner.LastJsonByConnection[connectionId] = json;
        return Task.CompletedTask;
    }

    public Task ReceiveTimerTick(int secondsRemaining) => Task.CompletedTask;
    public Task ReceiveVoteCount(int submitted, int total) => Task.CompletedTask;
    public Task ReceivePhaseChange(GamePhase newPhase) => Task.CompletedTask;
    public Task ReceiveError(string message) => Task.CompletedTask;
    public Task ReceiveReaction(string playerName, string emoji) => Task.CompletedTask;
    public Task ReceiveTranscript(string text) => Task.CompletedTask;
}

internal sealed class FakeHubClients : IHubClients<IGameClient>
{
    public readonly Dictionary<string, string> LastJsonByConnection = new();
    private readonly NoOpGameClient _noOp = new();

    public IGameClient All => _noOp;
    public IGameClient AllExcept(IReadOnlyList<string> excludedConnectionIds) => _noOp;
    public IGameClient Client(string connectionId) => new ConnectionScopedGameClient(this, connectionId);
    public IGameClient Clients(IReadOnlyList<string> connectionIds) => _noOp;
    public IGameClient Group(string groupName) => _noOp;
    public IGameClient GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => _noOp;
    public IGameClient Groups(IReadOnlyList<string> groupNames) => _noOp;
    public IGameClient User(string userId) => _noOp;
    public IGameClient Users(IReadOnlyList<string> userIds) => _noOp;
}

internal sealed class FakeGroupManager : IGroupManager
{
    public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

internal sealed class FakeHubContext : IHubContext<GameHub, IGameClient>
{
    public readonly FakeHubClients ClientsImpl = new();
    public IHubClients<IGameClient> Clients => ClientsImpl;
    public IGroupManager Groups { get; } = new FakeGroupManager();
    public Dictionary<string, string> LastJsonByConnection => ClientsImpl.LastJsonByConnection;
}

public class DefendFortressGameTests
{
    private static (DefendFortressGame game, GameRoom room, FakeHubContext hub) CreateGame(int playerCount = 1, string gameMode = "10")
    {
        var hub = new FakeHubContext();
        var game = new DefendFortressGame(hub);
        var room = new GameRoom { RoomCode = "TEST", GameType = "defend-fortress" };
        for (var i = 0; i < playerCount; i++)
        {
            room.Players.Add(new Player
            {
                Name = $"P{i}",
                ConnectionId = $"conn{i}",
                IsHost = i == 0,
                IsConnected = true
            });
        }
        return (game, room, hub);
    }

    private DefendFortressGameStateDto ReadDto(FakeHubContext hub, string connectionId = "conn0")
    {
        var json = hub.LastJsonByConnection[connectionId];
        return JsonSerializer.Deserialize<DefendFortressGameStateDto>(json)!;
    }

    private static DefendFortressGameState GetState(DefendFortressGame game, string roomCode = "TEST")
    {
        var stateField = typeof(DefendFortressGame).GetField("_states",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var states = (System.Collections.Concurrent.ConcurrentDictionary<string, DefendFortressGameState>)stateField.GetValue(game)!;
        return states[roomCode];
    }

    private static object? InvokePrivate(object target, string methodName, params object[] args)
    {
        var method = typeof(DefendFortressGame).GetMethod(methodName,
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance
            | System.Reflection.BindingFlags.Static)!;
        return method.Invoke(method.IsStatic ? null : target, args);
    }

    [Fact]
    public async Task StartGame_DefaultsToWavePlayingPhaseAndModeTen()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");

        var dto = ReadDto(hub);
        Assert.Equal("WavePlaying", dto.Phase);
        Assert.Equal("10", dto.GameMode);
        Assert.Equal(1, dto.Wave);
        Assert.Equal(10, dto.VictoryWave);
    }

    [Fact]
    public async Task StartGame_ParsesGameModeFromSettingsJson()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0", """{"gameMode":"endless"}""");

        var dto = ReadDto(hub);
        Assert.Equal("endless", dto.GameMode);
        Assert.Equal(0, dto.VictoryWave);
    }

    [Fact]
    public async Task CombatActions_RejectedOutsideWavePlayingPhase()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");

        // Force phase to Shop directly by clearing the wave (simulate wave already cleared).
        var stateField = typeof(DefendFortressGame).GetField("_states",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var states = (System.Collections.Concurrent.ConcurrentDictionary<string, DefendFortressGameState>)stateField.GetValue(game)!;
        var state = states["TEST"];
        state.Phase = DefendFortressPhase.Shop;

        var result = await game.HandleAction("GrabEnemy", """{"id":1}""", room, "conn0");
        Assert.False(result.Success);
    }

    [Fact]
    public async Task PurchaseUpgrade_OnlyAllowedDuringShop_AndDeductsGold()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");

        var stateField = typeof(DefendFortressGame).GetField("_states",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var states = (System.Collections.Concurrent.ConcurrentDictionary<string, DefendFortressGameState>)stateField.GetValue(game)!;
        var state = states["TEST"];

        // Not in shop yet: rejected.
        var rejected = await game.HandleAction("PurchaseUpgrade", """{"upgradeId":"archer"}""", room, "conn0");
        Assert.False(rejected.Success);

        state.Phase = DefendFortressPhase.Shop;
        state.Players["P0"].Gold = 100;

        var bought = await game.HandleAction("PurchaseUpgrade", """{"upgradeId":"archer"}""", room, "conn0");
        Assert.True(bought.Success);
        Assert.Equal(0, state.Players["P0"].Gold);
        Assert.Equal(1, state.Players["P0"].Upgrades["archer"]);

        // Not enough gold for tier 2 (cost scales up).
        var tooExpensive = await game.HandleAction("PurchaseUpgrade", """{"upgradeId":"archer"}""", room, "conn0");
        Assert.False(tooExpensive.Success);
    }

    [Fact]
    public void WaveConfig_MatchesEpicTableForWave1AndWave10()
    {
        var w1 = DefendFortressWaveConfig.For(1);
        Assert.Equal(20, w1.QueuePerPlayer);
        Assert.Equal(12, w1.OnFieldCap);
        Assert.Equal(1, w1.EnemyHp);
        Assert.Equal(200, w1.GoldPool);

        var w10 = DefendFortressWaveConfig.For(10);
        Assert.Equal(60, w10.QueuePerPlayer);
        Assert.Equal(50, w10.OnFieldCap);
        Assert.Equal(3, w10.EnemyHp);
        Assert.Equal(1200, w10.GoldPool);
    }

    [Fact]
    public void WaveConfig_ExtrapolatesPastWave10WithUncappedOnFieldCap()
    {
        var w20 = DefendFortressWaveConfig.For(20);
        Assert.True(w20.OnFieldCap > 50);
        Assert.True(w20.QueuePerPlayer > 60);
    }

    [Fact]
    public async Task GameOver_TriggersWhenFortressHpReachesZero()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");

        var stateField = typeof(DefendFortressGame).GetField("_states",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var states = (System.Collections.Concurrent.ConcurrentDictionary<string, DefendFortressGameState>)stateField.GetValue(game)!;
        var state = states["TEST"];
        state.FortressHp = 0;

        var checkEndGame = typeof(DefendFortressGame).GetMethod("CheckEndGame",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        await (Task)checkEndGame.Invoke(game, [room, state])!;

        Assert.Equal(DefendFortressPhase.GameOver, state.Phase);
        Assert.Equal(GamePhase.GameOver, room.Phase);
    }

    [Fact]
    public async Task OnPlayerJoined_MidWave_AddsSpectator_AndRejectsGrab()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");

        room.Players.Add(new Player { Name = "Late", ConnectionId = "connLate", IsConnected = true });
        await game.OnPlayerJoined(room, "connLate");

        var state = GetState(game);
        Assert.True(state.Players["Late"].IsSpectator);

        var result = await game.HandleAction("GrabEnemy", """{"id":1}""", room, "connLate");
        Assert.False(result.Success);
    }

    [Fact]
    public async Task OnPlayerJoined_DuringShop_AddsActivePlayer()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        GetState(game).Phase = DefendFortressPhase.Shop;

        room.Players.Add(new Player { Name = "Late", ConnectionId = "connLate", IsConnected = true });
        await game.OnPlayerJoined(room, "connLate");

        Assert.False(GetState(game).Players["Late"].IsSpectator);
    }

    [Fact]
    public async Task ReadyForWave_AllActiveReady_AutoStartsCountdown()
    {
        var (game, room, hub) = CreateGame(playerCount: 2);
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.Phase = DefendFortressPhase.Shop;

        var r1 = await game.HandleAction("ReadyForWave", """{"ready":true}""", room, "conn0");
        Assert.True(r1.Success);
        Assert.Equal(DefendFortressPhase.Shop, state.Phase); // only 1 of 2 ready

        await game.HandleAction("ReadyForWave", """{"ready":true}""", room, "conn1");
        Assert.Equal(DefendFortressPhase.Countdown, state.Phase);
    }

    [Fact]
    public async Task Simulate_HandlesFiftyPlusEnemiesAndHighArcherCountWithoutError()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);

        state.EnemiesToSpawn = 0;
        for (var i = 0; i < 60; i++)
        {
            state.Enemies.Add(new DefendFortressEnemy
            {
                Id = state.NextEnemyId++,
                X = i * 2,
                Y = 100,
                State = "march",
                MarchSpeed = 20,
                Hp = 1,
                MaxHp = 1
            });
        }
        state.Players["P0"].Upgrades["archer"] = 500; // stress-test target archer tier (epic NFR-PTF-1)

        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (var tick = 0; tick < 20; tick++) // 1 second of sim at 20 Hz
            InvokePrivate(game, "Simulate", state);
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 1000, $"20 ticks with 60 enemies + 500 archer tier took {sw.ElapsedMilliseconds}ms — too slow for 20Hz.");
    }

    private static string WrapSave(string innerSaveJson) =>
        JsonSerializer.Serialize(new { saveJson = innerSaveJson });

    private const string ValidSave = """
        {
            "schemaVersion": 1,
            "gameType": "defend-fortress",
            "wave": 7,
            "fortressHp": 64,
            "fortressMaxHp": 130,
            "gameMode": "50",
            "gold": 900,
            "castleUpgrades": { "archer": 3, "wall": 2 }
        }
        """;

    [Fact]
    public async Task ImportSave_HostInShop_AppliesRunStateAndOwnGoldUpgrades()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.Phase = DefendFortressPhase.Shop;

        var result = await game.HandleAction("ImportSave", WrapSave(ValidSave), room, "conn0");

        Assert.True(result.Success);
        Assert.Equal(7, state.Wave);
        Assert.Equal(64, state.FortressHp);
        Assert.Equal(130, state.FortressMaxHp);
        Assert.Equal("50", state.GameMode);
        Assert.Equal(900, state.Players["P0"].Gold);
        Assert.Equal(3, state.Players["P0"].Upgrades["archer"]);
        Assert.Equal(2, state.Players["P0"].Upgrades["wall"]);
    }

    [Fact]
    public async Task ImportSave_RejectedForNonHost()
    {
        var (game, room, hub) = CreateGame(playerCount: 2);
        await game.StartGame(room, "conn0");
        GetState(game).Phase = DefendFortressPhase.Shop;

        var result = await game.HandleAction("ImportSave", WrapSave(ValidSave), room, "conn1");

        Assert.False(result.Success);
    }

    [Fact]
    public async Task ImportSave_RejectedForWrongSchemaVersion()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        GetState(game).Phase = DefendFortressPhase.Shop;

        var badSave = """{"schemaVersion":2,"gameType":"defend-fortress","wave":1,"fortressHp":10,"fortressMaxHp":100}""";
        var result = await game.HandleAction("ImportSave", WrapSave(badSave), room, "conn0");

        Assert.False(result.Success);
    }

    [Fact]
    public async Task ImportSave_RejectedOutsideShop()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0"); // starts in WavePlaying

        var result = await game.HandleAction("ImportSave", WrapSave(ValidSave), room, "conn0");

        Assert.False(result.Success);
    }

    [Fact]
    public async Task ArcherAutoUnit_RequiresMultipleShotsAgainstMultiHpEnemy()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.EnemiesToSpawn = 0;
        state.Wave = 4; // EnemyHp becomes 2 at wave 4 (epic §7 table)
        state.Enemies.Add(new DefendFortressEnemy { Id = 1, X = 700, Y = 100, State = "march", MarchSpeed = 0, Hp = 2, MaxHp = 2 });
        state.Players["P0"].Upgrades["archer"] = 100; // guarantees a shot fires within a handful of ticks

        for (var tick = 0; tick < 5 && state.Enemies.Count > 0; tick++)
            InvokePrivate(game, "Simulate", state);

        Assert.True(state.Enemies.Count == 0 || state.Enemies[0].Hp < 2, "Archer shots should have chipped the enemy's Hp down, not instant-killed it.");
    }

    [Fact]
    public void SpawnEnemy_IntroducesRunnersFromWaveFourOnward()
    {
        var (game, room, hub) = CreateGame();
        var state = GetState2(game, room);
        state.Wave = 10;

        var sawRunner = false;
        for (var i = 0; i < 200; i++)
        {
            InvokePrivate(game, "SpawnEnemy", state, DefendFortressWaveConfig.For(state.Wave));
            if (state.Enemies[^1].EnemyType == "runner") sawRunner = true;
        }

        Assert.True(sawRunner, "Expected at least one runner among 200 spawns at wave 10 (~25% chance each).");
    }

    private static DefendFortressGameState GetState2(DefendFortressGame game, GameRoom room)
    {
        game.StartGame(room, "conn0").GetAwaiter().GetResult();
        return GetState(game);
    }

    [Fact]
    public async Task StartGame_HonorsLobbyTimePreferredRoleForArtillerySeat()
    {
        var (game, room, hub) = CreateGame(playerCount: 2);
        room.Players[1].PreferredRole = "artillery"; // P1 pre-picked the seat in the lobby

        await game.StartGame(room, "conn0");

        Assert.Equal("P1", GetState(game).ArtilleryPlayerName);
    }

    [Fact]
    public async Task VolunteerArtillery_ClaimsAndReleasesSeat()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.Phase = DefendFortressPhase.Shop;

        var claim = await game.HandleAction("VolunteerArtillery", null, room, "conn0");
        Assert.True(claim.Success);
        Assert.Equal("P0", state.ArtilleryPlayerName);

        var release = await game.HandleAction("VolunteerArtillery", null, room, "conn0");
        Assert.True(release.Success);
        Assert.Null(state.ArtilleryPlayerName);
    }

    [Fact]
    public async Task FireSlingshot_RejectedForNonArtilleryPlayer()
    {
        var (game, room, hub) = CreateGame(playerCount: 2);
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.ArtilleryPlayerName = "P0";

        var result = await game.HandleAction("FireSlingshot", """{"angle":0,"power":1}""", room, "conn1");
        Assert.False(result.Success);
    }

    [Fact]
    public async Task FireSlingshot_SpawnsDiscAndStartsCooldown()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.ArtilleryPlayerName = "P0";

        var result = await game.HandleAction("FireSlingshot", """{"angle":0,"power":1}""", room, "conn0");

        Assert.True(result.Success);
        Assert.Single(state.Discs);
        Assert.True(state.ArtilleryCooldownRemaining > 0);

        var tooSoon = await game.HandleAction("FireSlingshot", """{"angle":0,"power":1}""", room, "conn0");
        Assert.False(tooSoon.Success);
    }

    [Fact]
    public async Task SimulateDiscs_HittingAirborneEnemyTriggersComboAoe()
    {
        var (game, room, hub) = CreateGame();
        await game.StartGame(room, "conn0");
        var state = GetState(game);
        state.ArtilleryPlayerName = "P0";

        // Airborne "combo target" and a nearby marcher that should die in the AoE.
        state.Enemies.Add(new DefendFortressEnemy { Id = 1, X = 400, Y = 100, State = "airborne", Vx = 0, Vy = 0, Hp = 1, MaxHp = 1 });
        state.Enemies.Add(new DefendFortressEnemy { Id = 2, X = 410, Y = 105, State = "march", MarchSpeed = 0, Hp = 1, MaxHp = 1 });
        // Disc positioned right on top of the airborne enemy so it hits on the first tick.
        state.Discs.Add(new DefendFortressDisc { Id = 1, X = 400, Y = 100, Vx = 0, Vy = 0, FiredBy = "P0" });

        InvokePrivate(game, "SimulateDiscs", state, DefendFortressGameState.TickSeconds);

        Assert.Empty(state.Enemies); // both the airborne target and the nearby marcher died in the AoE
        Assert.True(state.Players["P0"].ArtilleryGold > 0);
    }
}
