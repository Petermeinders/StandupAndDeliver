using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class CursedVaultGame(IHubContext<GameHub, IGameClient> hubContext, GameRoomService gameRoomService, ILogger<CursedVaultGame> logger) : ICardGame
{
    private readonly ConcurrentDictionary<string, CursedVaultGameState> _states = new();

    public string GameType => "cursed-vault";

    private const string BotName = "🤖 Vault Bot";

    public async Task StartGame(GameRoom room, string connectionId)
    {
        var existingBot = room.Players.FirstOrDefault(p => p.IsBot);
        if (existingBot is not null)
            existingBot.Name = BotName;
        else if (room.Players.Count(p => !p.IsBot) == 1)
            room.Players.Add(new Player { Name = BotName, ConnectionId = $"bot-{room.RoomCode}", IsBot = true, IsConnected = false });

        var state = new CursedVaultGameState
        {
            PlayerOrder = room.Players.Select(p => p.Name).ToList(),
            CurrentPlayerIndex = 0,
            Round = 1
        };

        foreach (var player in room.Players)
            state.PlayerHands[player.Name] = new CursedVaultHand { Gold = 5, HasSkull = true };

        _states[room.RoomCode] = state;
        await BroadcastState(room, state);
        MaybeScheduleBotTurn(room, state);
    }

    public async Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state))
            return new HubResult(false, "Game state not found.");

        return action switch
        {
            "PlayCard"           => await PlayCard(room, state, connectionId, payloadJson),
            "StartGamble"        => await StartGamble(room, state, connectionId, payloadJson),
            "FlipCard"           => await FlipCard(room, state, connectionId),
            "PlayCardAfterGamble" => await PlayCardAfterGamble(room, state, connectionId, payloadJson),
            _ => new HubResult(false, $"Unknown action: {action}")
        };
    }

    public Task OnPlayerDisconnected(GameRoom room, string connectionId) => Task.CompletedTask;

    public async Task OnPlayerRejoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        await BroadcastState(room, state);
    }

    public async Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        EliminatePlayer(state, playerName);
        if (CheckSingleWinner(state, room)) { }
        await BroadcastState(room, state);
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private async Task<HubResult> PlayCard(GameRoom room, CursedVaultGameState state, string connectionId, string? payloadJson)
    {
        var player = GetCurrentPlayer(room, state);
        if (player?.ConnectionId != connectionId) return new HubResult(false, "Not your turn.");
        if (state.ActiveGamble is { AwaitingCardPlay: false }) return new HubResult(false, "A gamble is in progress.");

        string cardType;
        try { cardType = JsonDocument.Parse(payloadJson ?? "{}").RootElement.GetProperty("type").GetString() ?? ""; }
        catch { return new HubResult(false, "Invalid payload."); }

        var hand = state.PlayerHands[player.Name];
        if (cardType == "Skull")
        {
            if (!hand.HasSkull) return new HubResult(false, "You don't have a skull.");
            hand.HasSkull = false;
            state.Pile.Add(CursedVaultCardType.Skull);
        }
        else
        {
            if (hand.Gold <= 0) return new HubResult(false, "You don't have any gold.");
            hand.Gold--;
            state.Pile.Add(CursedVaultCardType.Gold);
        }

        Log(room.RoomCode, player.Name, $"PlayCard:{cardType}", $"hand gold={state.PlayerHands[player.Name].Gold} skull={state.PlayerHands[player.Name].HasSkull} pile={state.Pile.Count}");
        state.LastTurnSummary = new CursedVaultLastTurnDto(player.Name, $"Played{cardType}", 0, false, false);
        AdvanceTurn(state, room);
        await BroadcastState(room, state);
        MaybeScheduleBotTurn(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> StartGamble(GameRoom room, CursedVaultGameState state, string connectionId, string? payloadJson)
    {
        var player = GetCurrentPlayer(room, state);
        if (player?.ConnectionId != connectionId) return new HubResult(false, "Not your turn.");
        if (state.Round == 1) return new HubResult(false, "No gambling in round 1.");
        if (state.ActiveGamble is not null) return new HubResult(false, "A gamble is already in progress.");
        if (state.Pile.Count == 0) return new HubResult(false, "The pile is empty.");

        int count;
        try { count = JsonDocument.Parse(payloadJson ?? "{}").RootElement.GetProperty("count").GetInt32(); }
        catch { return new HubResult(false, "Invalid payload."); }

        if (count < 1 || count > state.Pile.Count)
            return new HubResult(false, $"Count must be between 1 and {state.Pile.Count}.");

        state.ActiveGamble = new CursedVaultActiveGamble { Declared = count };
        Log(room.RoomCode, player.Name, $"StartGamble:{count}", $"pile={state.Pile.Count} gold={state.PlayerHands[player.Name].Gold}");
        await BroadcastState(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> FlipCard(GameRoom room, CursedVaultGameState state, string connectionId)
    {
        var player = GetCurrentPlayer(room, state);
        if (player?.ConnectionId != connectionId) return new HubResult(false, "Not your turn.");
        if (state.ActiveGamble is null || state.ActiveGamble.AwaitingCardPlay)
            return new HubResult(false, "No active gamble.");
        if (state.Pile.Count == 0) return new HubResult(false, "Pile is empty.");

        // Draw random card from pile
        var idx = Random.Shared.Next(state.Pile.Count);
        var drawn = state.Pile[idx];
        state.Pile.RemoveAt(idx);
        state.ActiveGamble.FlippedCards.Add(drawn);
        state.ActiveGamble.LastFlippedCard = drawn.ToString();

        if (drawn == CursedVaultCardType.Skull)
        {
            // Skull hit — reshuffle flipped cards back into pile, lose skull
            foreach (var card in state.ActiveGamble.FlippedCards)
                state.Pile.Add(card);
            Shuffle(state.Pile);

            var hand = state.PlayerHands[player.Name];
            bool eliminated = false;
            if (!hand.HasSkull)
            {
                EliminatePlayer(state, player.Name);
                eliminated = true;
            }
            else
            {
                hand.HasSkull = false;
            }

            Log(room.RoomCode, player.Name, "FlipCard:SKULL",
                $"eliminated={eliminated} gold={hand.Gold} flips={state.ActiveGamble.FlippedCards.Count} pile={state.Pile.Count}");
            state.LastTurnSummary = new CursedVaultLastTurnDto(player.Name, "GambledSkullHit", 0, !eliminated, eliminated);
            state.ActiveGamble = null;

            if (!eliminated)
                AdvanceTurn(state, room);

            CheckSingleWinner(state, room);
            await BroadcastState(room, state);
            if (room.Phase == GamePhase.Playing)
                MaybeScheduleBotTurn(room, state);
            return new HubResult(true);
        }

        // Gold drawn
        var goldCollected = state.ActiveGamble.GoldCollectedSoFar;
        var hand2 = state.PlayerHands[player.Name];
        hand2.Gold += 1; // tentatively add — check win immediately

        if (hand2.Gold >= 10)
        {
            Log(room.RoomCode, player.Name, "FlipCard:GOLD→WIN", $"gold={hand2.Gold} pile={state.Pile.Count}");
            state.WinnerName = player.Name;
            room.Phase = GamePhase.GameOver;
            state.ActiveGamble = null;
            state.LastTurnSummary = new CursedVaultLastTurnDto(player.Name, "GambledSuccess", goldCollected + 1, false, false);
            await BroadcastState(room, state);
            ScheduleLobbyReset(room, state);
            return new HubResult(true);
        }

        if (state.ActiveGamble.FlippedCards.Count(c => c == CursedVaultCardType.Gold) >= state.ActiveGamble.Declared)
        {
            Log(room.RoomCode, player.Name, "FlipCard:GOLD→DONE", $"gold={hand2.Gold} declared={state.ActiveGamble.Declared} pile={state.Pile.Count}");
            state.ActiveGamble.AwaitingCardPlay = true;
            state.LastTurnSummary = new CursedVaultLastTurnDto(player.Name, "GambledSuccess", goldCollected + 1, false, false);
        }
        else
        {
            Log(room.RoomCode, player.Name, "FlipCard:GOLD", $"gold={hand2.Gold} flips={state.ActiveGamble.FlippedCards.Count}/{state.ActiveGamble.Declared} pile={state.Pile.Count}");
        }

        await BroadcastState(room, state);
        // Schedule next bot flip or post-gamble card play
        if (player.IsBot) MaybeScheduleBotTurn(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> PlayCardAfterGamble(GameRoom room, CursedVaultGameState state, string connectionId, string? payloadJson)
    {
        var player = GetCurrentPlayer(room, state);
        if (player?.ConnectionId != connectionId) return new HubResult(false, "Not your turn.");
        if (state.ActiveGamble is not { AwaitingCardPlay: true }) return new HubResult(false, "Not awaiting card play.");

        string cardType;
        try { cardType = JsonDocument.Parse(payloadJson ?? "{}").RootElement.GetProperty("type").GetString() ?? ""; }
        catch { return new HubResult(false, "Invalid payload."); }

        var hand = state.PlayerHands[player.Name];
        if (cardType == "Skull")
        {
            if (!hand.HasSkull) return new HubResult(false, "You don't have a skull.");
            hand.HasSkull = false;
            state.Pile.Add(CursedVaultCardType.Skull);
        }
        else
        {
            if (hand.Gold <= 0) return new HubResult(false, "You don't have any gold.");
            hand.Gold--;
            state.Pile.Add(CursedVaultCardType.Gold);
        }

        state.ActiveGamble = null;
        AdvanceTurn(state, room);
        await BroadcastState(room, state);
        MaybeScheduleBotTurn(room, state);
        return new HubResult(true);
    }

    // ── Bot logic ─────────────────────────────────────────────────────────────

    private void MaybeScheduleBotTurn(GameRoom room, CursedVaultGameState state)
    {
        if (room.Phase != GamePhase.Playing) return;
        if (state.PlayerOrder.Count == 0) return;
        var current = room.Players.FirstOrDefault(p => p.Name == state.PlayerOrder[state.CurrentPlayerIndex]);
        if (current is not { IsBot: true }) return;

        // Only schedule if NOT mid-gamble awaiting a flip from someone else
        // (mid-gamble bot scheduling is handled directly by FlipCard after gold)
        if (state.ActiveGamble is { AwaitingCardPlay: false }) return;

        _ = RunBotTurn(room, current.ConnectionId);
    }

    private async Task RunBotTurn(GameRoom room, string botConnectionId)
    {
        await Task.Delay(1000 + Random.Shared.Next(1000));

        await room.Lock.WaitAsync();
        try
        {
            if (!_states.TryGetValue(room.RoomCode, out var state)) return;
            if (room.Phase != GamePhase.Playing) return;

            var bot = room.Players.FirstOrDefault(p => p.ConnectionId == botConnectionId);
            if (bot is null || !bot.IsBot) return;

            var currentName = state.PlayerOrder.Count > 0 ? state.PlayerOrder[state.CurrentPlayerIndex] : null;
            if (currentName != bot.Name && state.ActiveGamble is null) return; // not bot's turn

            var hand = state.PlayerHands[bot.Name];

            // ── Post-gamble: must play a card ──
            if (state.ActiveGamble is { AwaitingCardPlay: true })
            {
                // Bot always plays gold after gambling (never reveals skull voluntarily)
                var cardType = hand.Gold > 0 ? "Gold" : (hand.HasSkull ? "Skull" : "Gold");
                await PlayCardAfterGamble(room, state, botConnectionId, $"{{\"type\":\"{cardType}\"}}");
                return;
            }

            // ── Bot is current player: decide action ──
            if (currentName != bot.Name) return;

            bool isRound1 = state.Round == 1;
            int pileCount = state.Pile.Count;

            // Round 1: always play gold to seed the pile
            if (isRound1 || pileCount == 0 || hand.IsEmpty)
            {
                var cardType = hand.Gold > 0 ? "Gold" : "Skull";
                await PlayCard(room, state, botConnectionId, $"{{\"type\":\"{cardType}\"}}");
                return;
            }

            // Later rounds: decide whether to gamble
            int gambleCount = ChooseBotGambleCount(state, hand, pileCount);

            if (gambleCount > 0)
            {
                await StartGamble(room, state, botConnectionId, $"{{\"count\":{gambleCount}}}");
                // First flip will be scheduled by MaybeScheduleBotTurn after StartGamble broadcasts
                // But StartGamble doesn't call MaybeScheduleBotTurn, so schedule next flip here:
                _ = RunBotFlip(room, botConnectionId);
            }
            else
            {
                var cardType = hand.Gold > 0 ? "Gold" : "Skull";
                await PlayCard(room, state, botConnectionId, $"{{\"type\":\"{cardType}\"}}");
            }
        }
        finally
        {
            room.Lock.Release();
        }
    }

    private async Task RunBotFlip(GameRoom room, string botConnectionId)
    {
        await Task.Delay(800 + Random.Shared.Next(600));

        await room.Lock.WaitAsync();
        try
        {
            if (!_states.TryGetValue(room.RoomCode, out var state)) return;
            if (room.Phase != GamePhase.Playing) return;
            if (state.ActiveGamble is null || state.ActiveGamble.AwaitingCardPlay) return;

            await FlipCard(room, state, botConnectionId);

            // If still mid-gamble (no skull, not done), schedule next flip
            if (state.ActiveGamble is { AwaitingCardPlay: false })
                _ = RunBotFlip(room, botConnectionId);
        }
        finally
        {
            room.Lock.Release();
        }
    }

    private static int ChooseBotGambleCount(CursedVaultGameState state, CursedVaultHand hand, int pileCount)
    {
        // Known skulls in pile: skulls that were played by anyone (we track this from pile contents)
        // Bot doesn't know exact pile composition, so estimate dangerousness
        int estimatedSkulls = state.EliminatedPlayers.Count; // each elimination adds a skull to history
        // Actually bot plays realistically — it doesn't know pile contents
        // Base risk assessment on pile size and own gold position
        int myGold = hand.Gold;

        // Desperate (low gold): gamble more
        // Leading (high gold): can afford to be riskier
        // Safe (medium): moderate gamble

        if (pileCount <= 2) return 0; // too small, not worth risking

        // Calculate a gamble count based on pile size and risk appetite
        float riskAppetite = myGold switch
        {
            <= 2 => 0.7f,  // desperate, take risks
            <= 5 => 0.4f,  // moderate
            >= 8 => 0.6f,  // aggressive push to win
            _    => 0.45f
        };

        // More cards in pile = more gold potential but also more skulls
        int maxGamble = myGold >= 8
            ? Math.Min(pileCount, 5)      // near win, go big
            : Math.Min(pileCount, 3);     // conservative max

        // Random roll against risk appetite
        if (Random.Shared.NextDouble() > riskAppetite) return 0; // play safe this turn

        // Choose how many: weighted toward lower end (realistic caution)
        int gamble = 1 + (int)(Random.Shared.NextDouble() * Random.Shared.NextDouble() * maxGamble);
        return Math.Clamp(gamble, 1, pileCount);
    }

    // ── Debug logging ─────────────────────────────────────────────────────────

    private void Log(string room, string player, string action, string detail = "")
    {
        logger.LogDebug("[CursedVault] {Room} | {Player} | {Action}{Detail}",
            room, player, action, string.IsNullOrEmpty(detail) ? "" : $" | {detail}");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static Player? GetCurrentPlayer(GameRoom room, CursedVaultGameState state)
    {
        if (state.PlayerOrder.Count == 0) return null;
        var name = state.PlayerOrder[state.CurrentPlayerIndex];
        return room.Players.FirstOrDefault(p => p.Name == name);
    }

    private void AdvanceTurn(CursedVaultGameState state, GameRoom room)
    {
        var total = state.PlayerOrder.Count;
        var startIndex = state.CurrentPlayerIndex;

        for (int i = 1; i <= total; i++)
        {
            var nextIndex = (startIndex + i) % total;
            var name = state.PlayerOrder[nextIndex];

            if (state.EliminatedPlayers.Contains(name)) continue;

            var hand = state.PlayerHands[name];
            var pileEmpty = state.Pile.Count == 0;

            // Skip if both hand and pile are empty
            if (hand.IsEmpty && pileEmpty) continue;

            // Track round increment
            if (nextIndex <= startIndex)
                state.Round++;

            state.CurrentPlayerIndex = nextIndex;
            return;
        }
    }

    private void EliminatePlayer(CursedVaultGameState state, string playerName)
    {
        if (!state.EliminatedPlayers.Contains(playerName))
            state.EliminatedPlayers.Add(playerName);
        // Trash hand — do not add to pile
        if (state.PlayerHands.TryGetValue(playerName, out var hand))
        {
            hand.Gold = 0;
            hand.HasSkull = false;
        }
    }

    private bool CheckSingleWinner(CursedVaultGameState state, GameRoom room)
    {
        var activePlayers = state.PlayerOrder
            .Where(n => !state.EliminatedPlayers.Contains(n))
            .ToList();

        if (activePlayers.Count == 1)
        {
            state.WinnerName = activePlayers[0];
            room.Phase = GamePhase.GameOver;
            ScheduleLobbyReset(room, state);
            return true;
        }
        return false;
    }

    private void ScheduleLobbyReset(GameRoom room, CursedVaultGameState state)
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(8000); // show game-over screen for 8 seconds
            await room.Lock.WaitAsync();
            try
            {
                _states.TryRemove(room.RoomCode, out _);
                gameRoomService.ResetToLobby(room);
                await BroadcastLobbyReset(room);
            }
            finally { room.Lock.Release(); }
        });
    }

    private async Task BroadcastLobbyReset(GameRoom room)
    {
        var lean = new GameStateDto(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(lean);
    }

    private static void Shuffle(List<CursedVaultCardType> list)
    {
        for (int i = list.Count - 1; i > 0; i--)
        {
            int j = Random.Shared.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    // ── Broadcast ─────────────────────────────────────────────────────────────

    private async Task BroadcastState(GameRoom room, CursedVaultGameState state)
    {
        var lean = new GameStateDto(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(lean);

        var currentPlayerName = state.PlayerOrder.Count > 0
            ? state.PlayerOrder[state.CurrentPlayerIndex] : "";

        var players = state.PlayerOrder.Select(name => new CursedVaultPlayerDto(
            Name: name,
            Gold: state.PlayerHands.TryGetValue(name, out var h) ? h.Gold : 0,
            IsEliminated: state.EliminatedPlayers.Contains(name),
            IsConnected: room.Players.FirstOrDefault(p => p.Name == name)?.IsConnected ?? false,
            IsCurrentPlayer: name == currentPlayerName
        )).ToList();

        foreach (var player in room.Players.Where(p => p.IsConnected))
        {
            var hand = state.PlayerHands.TryGetValue(player.Name, out var h) ? h : new CursedVaultHand { Gold = 0, HasSkull = false };
            var isCurrentPlayer = player.Name == currentPlayerName;

            ActiveGambleDto? activeGambleDto = null;
            if (state.ActiveGamble is { } g)
            {
                activeGambleDto = new ActiveGambleDto(
                    PlayerName: currentPlayerName,
                    Declared: g.Declared,
                    FlipsSoFar: g.FlippedCards.Count,
                    GoldCollectedSoFar: g.GoldCollectedSoFar,
                    LastFlippedCard: g.LastFlippedCard
                );
            }

            var dto = new CursedVaultGameStateDto(
                Phase: room.Phase == GamePhase.GameOver ? "GameOver" : "Playing",
                Round: state.Round,
                CurrentPlayerName: currentPlayerName,
                MyGold: hand.Gold,
                MyHasSkull: hand.HasSkull,
                PileCount: state.Pile.Count,
                IsMyTurn: isCurrentPlayer,
                IsRoundOne: state.Round == 1,
                AwaitingMyCardPlay: isCurrentPlayer && state.ActiveGamble?.AwaitingCardPlay == true,
                ActiveGamble: activeGambleDto,
                Players: players,
                LastTurnSummary: state.LastTurnSummary,
                WinnerName: state.WinnerName
            );

            await hubContext.Clients.Client(player.ConnectionId)
                .ReceiveGameSpecificState("cursed-vault", JsonSerializer.Serialize(dto));
        }
    }
}
