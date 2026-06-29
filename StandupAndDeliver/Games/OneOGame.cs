using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class OneOGame(IHubContext<GameHub, IGameClient> hubContext, GameRoomService gameRoomService) : ICardGame
{
    private readonly ConcurrentDictionary<string, OneOGameState> _states = new();

    public string GameType => "OneO";

    private const string BotName = "🤖 OneO Bot";

    public async Task StartGame(GameRoom room, string connectionId)
    {
        // Rename lobby bot to game-specific name, or add one if somehow absent
        var existingBot = room.Players.FirstOrDefault(p => p.IsBot);
        if (existingBot is not null)
            existingBot.Name = BotName;
        else if (room.Players.Count(p => !p.IsBot) == 1)
            room.Players.Add(new Player { Name = BotName, ConnectionId = $"bot-{room.RoomCode}", IsBot = true, IsConnected = false });

        var state = new OneOGameState();
        var deck = GenerateDeck();
        Shuffle(deck);

        foreach (var player in room.Players)
        {
            state.PlayerHands[player.Name] = deck.Take(7).ToList();
            deck.RemoveRange(0, 7);
        }

        state.DrawPile = deck;

        OneOCard topCard;
        do
        {
            topCard = state.DrawPile[0];
            state.DrawPile.RemoveAt(0);
            if (topCard.Type == OneOCardType.WildDrawFour)
            {
                state.DrawPile.Add(topCard);
                topCard = null!;
            }
        } while (topCard is null);

        state.DiscardPile.Add(topCard);
        state.CurrentColor = topCard.Color == OneOColor.Wild ? OneOColor.Red : topCard.Color;

        if (topCard.Type == OneOCardType.Skip)
            state.CurrentPlayerIndex = 1 % room.Players.Count;
        else if (topCard.Type == OneOCardType.Reverse)
        {
            state.Clockwise = false;
            state.CurrentPlayerIndex = (room.Players.Count - 1) % room.Players.Count;
        }
        else if (topCard.Type == OneOCardType.DrawTwo)
        {
            DrawCardsToPlayer(state, room.Players[0].Name, 2);
            state.CurrentPlayerIndex = 1 % room.Players.Count;
        }
        else if (topCard.Type == OneOCardType.Wild)
            state.CurrentColor = OneOColor.Red;

        state.LastAction = $"Game started! {room.Players[state.CurrentPlayerIndex].Name} goes first.";
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
            "PlayCard" => await PlayCard(room, state, connectionId, payloadJson),
            "DrawCard" => await DrawCard(room, state, connectionId),
            _ => new HubResult(false, $"Unknown OneO action: {action}")
        };
    }

    public Task OnPlayerDisconnected(GameRoom room, string connectionId) => Task.CompletedTask;

    public async Task OnPlayerRejoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;
        var lean = new GameStateDto(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);
        await hubContext.Clients.Client(connectionId).ReceiveGameState(lean);

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (player is null) return;
        var myHand = state.PlayerHands.TryGetValue(player.Name, out var hand)
            ? (IReadOnlyList<OneOCardDto>)hand.Select(ToDto).ToList()
            : Array.Empty<OneOCardDto>();
        var dto = BuildDto(room, state, myHand);
        await hubContext.Clients.Client(connectionId)
            .ReceiveGameSpecificState("OneO", JsonSerializer.Serialize(dto));
    }

    public Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost) => Task.CompletedTask;

    // ── Game actions ──────────────────────────────────────────────────────────

    private async Task<HubResult> PlayCard(GameRoom room, OneOGameState state, string connectionId, string? payloadJson)
    {
        if (room.Phase != GamePhase.Playing) return new HubResult(false, "Game not in progress.");

        var currentPlayer = room.Players[state.CurrentPlayerIndex];
        if (currentPlayer.ConnectionId != connectionId)
            return new HubResult(false, "It is not your turn.");

        if (string.IsNullOrEmpty(payloadJson)) return new HubResult(false, "Card ID required.");

        int cardId;
        string? chosenColor = null;
        try
        {
            var doc = JsonDocument.Parse(payloadJson);
            cardId = doc.RootElement.GetProperty("cardId").GetInt32();
            if (doc.RootElement.TryGetProperty("chosenColor", out var cc))
                chosenColor = cc.GetString();
        }
        catch { return new HubResult(false, "Invalid payload."); }

        var hand = state.PlayerHands[currentPlayer.Name];
        var card = hand.FirstOrDefault(c => c.Id == cardId);
        if (card is null) return new HubResult(false, "Card not in your hand.");

        var topDiscard = state.DiscardPile.Last();
        if (!card.CanPlayOn(topDiscard, state.CurrentColor))
            return new HubResult(false, "That card cannot be played on the current discard.");

        if (card.Type is OneOCardType.Wild or OneOCardType.WildDrawFour && string.IsNullOrEmpty(chosenColor))
            return new HubResult(false, "Must choose a color for wild card.");

        hand.Remove(card);
        state.DiscardPile.Add(card);
        state.LastPlayedCard = card;

        if (card.Type is OneOCardType.Wild or OneOCardType.WildDrawFour)
            state.CurrentColor = Enum.Parse<OneOColor>(chosenColor!, ignoreCase: true);
        else
            state.CurrentColor = card.Color;

        if (hand.Count == 0)
        {
            state.WinnerName = currentPlayer.Name;
            room.Phase = GamePhase.GameOver;
            state.LastAction = $"{currentPlayer.Name} wins!";
            await BroadcastState(room, state);
            ScheduleLobbyReset(room);
            return new HubResult(true);
        }

        state.LastAction = $"{currentPlayer.Name} played {CardName(card)}";
        int nextIndex = NextPlayerIndex(state, room.Players.Count);

        if (card.Type == OneOCardType.Skip)
        {
            state.LastAction += " — next player skipped!";
            nextIndex = NextPlayerIndex(state, room.Players.Count, from: nextIndex);
        }
        else if (card.Type == OneOCardType.Reverse)
        {
            state.Clockwise = !state.Clockwise;
            nextIndex = room.Players.Count == 2
                ? state.CurrentPlayerIndex
                : NextPlayerIndex(state, room.Players.Count);
            state.LastAction += " — direction reversed!";
        }
        else if (card.Type == OneOCardType.DrawTwo)
        {
            var target = room.Players[nextIndex];
            DrawCardsToPlayer(state, target.Name, 2);
            state.LastAction += $" — {target.Name} draws 2 and is skipped!";
            nextIndex = NextPlayerIndex(state, room.Players.Count, from: nextIndex);
        }
        else if (card.Type == OneOCardType.WildDrawFour)
        {
            var target = room.Players[nextIndex];
            DrawCardsToPlayer(state, target.Name, 4);
            state.LastAction += $" — {target.Name} draws 4 and is skipped!";
            nextIndex = NextPlayerIndex(state, room.Players.Count, from: nextIndex);
        }

        state.CurrentPlayerIndex = nextIndex;
        await BroadcastState(room, state);
        MaybeScheduleBotTurn(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> DrawCard(GameRoom room, OneOGameState state, string connectionId)
    {
        if (room.Phase != GamePhase.Playing) return new HubResult(false, "Game not in progress.");

        var currentPlayer = room.Players[state.CurrentPlayerIndex];
        if (currentPlayer.ConnectionId != connectionId)
            return new HubResult(false, "It is not your turn.");

        EnsureDrawPile(state);
        if (state.DrawPile.Count == 0) return new HubResult(false, "Draw pile is empty.");

        var drawn = state.DrawPile[0];
        state.DrawPile.RemoveAt(0);
        state.PlayerHands[currentPlayer.Name].Add(drawn);

        var topDiscard = state.DiscardPile.Last();
        if (drawn.CanPlayOn(topDiscard, state.CurrentColor))
            state.LastAction = $"{currentPlayer.Name} drew — may play the drawn card.";
        else
        {
            state.LastAction = $"{currentPlayer.Name} drew — no play, turn passes.";
            state.CurrentPlayerIndex = NextPlayerIndex(state, room.Players.Count);
        }

        await BroadcastState(room, state);
        MaybeScheduleBotTurn(room, state);
        return new HubResult(true);
    }

    // ── Bot logic ──────────────────────────────────────────────────────────────

    private void MaybeScheduleBotTurn(GameRoom room, OneOGameState state)
    {
        if (room.Phase != GamePhase.Playing) return;
        var current = room.Players[state.CurrentPlayerIndex];
        if (!current.IsBot) return;
        _ = RunBotTurn(room, current.ConnectionId);
    }

    private async Task RunBotTurn(GameRoom room, string botConnectionId)
    {
        // Simulate thinking time: 1.2–2.4s
        await Task.Delay(1200 + Random.Shared.Next(1200));

        await room.Lock.WaitAsync();
        try
        {
            if (!_states.TryGetValue(room.RoomCode, out var state)) return;
            if (room.Phase != GamePhase.Playing) return;

            var bot = room.Players[state.CurrentPlayerIndex];
            if (!bot.IsBot || bot.ConnectionId != botConnectionId) return;

            var hand = state.PlayerHands[bot.Name];
            var topDiscard = state.DiscardPile.Last();

            // Find opponent hand size for aggressive play decisions
            var opponentHandSize = room.Players
                .Where(p => !p.IsBot)
                .Select(p => state.PlayerHands.TryGetValue(p.Name, out var h) ? h.Count : 99)
                .DefaultIfEmpty(99).Min();

            var chosen = ChooseBotCard(hand, topDiscard, state.CurrentColor, opponentHandSize);

            if (chosen is not null)
            {
                string? chosenColor = null;
                if (chosen.Type is OneOCardType.Wild or OneOCardType.WildDrawFour)
                    chosenColor = BotChooseColor(hand).ToString();

                var payload = JsonSerializer.Serialize(new
                {
                    cardId = chosen.Id,
                    chosenColor
                });
                await PlayCard(room, state, botConnectionId, payload);
            }
            else
            {
                // Draw a card
                await DrawCard(room, state, botConnectionId);

                // If drawn card is playable, play it immediately after a short delay
                _ = Task.Run(async () =>
                {
                    await Task.Delay(600 + Random.Shared.Next(400));
                    await room.Lock.WaitAsync();
                    try
                    {
                        if (!_states.TryGetValue(room.RoomCode, out var s2)) return;
                        if (room.Phase != GamePhase.Playing) return;
                        var nowBot = room.Players[s2.CurrentPlayerIndex];
                        if (!nowBot.IsBot) return; // turn passed after draw, no play needed

                        var h2 = s2.PlayerHands[nowBot.Name];
                        var top2 = s2.DiscardPile.Last();
                        var drawn = h2.LastOrDefault();
                        if (drawn is not null && drawn.CanPlayOn(top2, s2.CurrentColor))
                        {
                            string? cc = drawn.Type is OneOCardType.Wild or OneOCardType.WildDrawFour
                                ? BotChooseColor(h2).ToString() : null;
                            var payload = JsonSerializer.Serialize(new { cardId = drawn.Id, chosenColor = cc });
                            await PlayCard(room, s2, nowBot.ConnectionId, payload);
                        }
                    }
                    finally { room.Lock.Release(); }
                });
            }
        }
        finally
        {
            room.Lock.Release();
        }
    }

    // Heuristic: rank every playable card, return highest priority or null if none.
    private static OneOCard? ChooseBotCard(List<OneOCard> hand, OneOCard topDiscard, OneOColor currentColor, int opponentHandSize)
    {
        var playable = hand.Where(c => c.CanPlayOn(topDiscard, currentColor)).ToList();
        if (playable.Count == 0) return null;

        // Save WildDrawFour for when opponent is close to winning
        // Score each card; higher = more preferred
        return playable
            .Select(c => (card: c, score: BotCardScore(c, hand, currentColor, opponentHandSize)))
            .OrderByDescending(x => x.score)
            .First().card;
    }

    private static int BotCardScore(OneOCard card, List<OneOCard> hand, OneOColor currentColor, int opponentHandSize)
    {
        int score = 0;

        // Action cards have base priority
        score += card.Type switch
        {
            OneOCardType.WildDrawFour => opponentHandSize <= 4 ? 80 : 30, // Hold unless opponent is close
            OneOCardType.DrawTwo      => opponentHandSize <= 6 ? 60 : 25,
            OneOCardType.Skip         => 40,
            OneOCardType.Reverse      => 20,
            OneOCardType.Wild         => 15, // Save wilds when you have color cards
            OneOCardType.Number       => 0,
            _ => 0
        };

        // Prefer matching color (keeps current color in our favor)
        if (card.Color == currentColor) score += 10;

        // Prefer cards where we have more of that color (color strength)
        int colorCount = hand.Count(c => c.Color == card.Color);
        score += colorCount * 3;

        // Prefer lower-value number cards when opponent isn't close (dump hand size)
        if (card.Type == OneOCardType.Number) score += 5 - Math.Min(card.Value / 2, 5);

        // Aggressive mode when opponent has few cards
        if (opponentHandSize <= 2 && card.Type is OneOCardType.DrawTwo or OneOCardType.WildDrawFour or OneOCardType.Skip)
            score += 40;

        return score;
    }

    private static OneOColor BotChooseColor(List<OneOCard> hand)
    {
        var colors = new[] { OneOColor.Red, OneOColor.Green, OneOColor.Blue, OneOColor.Yellow };
        return colors
            .Select(c => (color: c, count: hand.Count(card => card.Color == c)))
            .OrderByDescending(x => x.count)
            .First().color;
    }

    // ── Lobby reset ───────────────────────────────────────────────────────────

    private void ScheduleLobbyReset(GameRoom room)
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(8000);
            await room.Lock.WaitAsync();
            try
            {
                _states.TryRemove(room.RoomCode, out _);
                gameRoomService.ResetToLobby(room);
                var lean = new GameStateDto(room.Phase, room.RoomCode,
                    room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
                    room.GameType);
                await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(lean);
            }
            finally { room.Lock.Release(); }
        });
    }

    // ── Broadcast ─────────────────────────────────────────────────────────────

    private async Task BroadcastState(GameRoom room, OneOGameState state)
    {
        var lean = new GameStateDto(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(lean);

        foreach (var player in room.Players.Where(p => p.IsConnected))
        {
            var myHand = state.PlayerHands.TryGetValue(player.Name, out var hand)
                ? (IReadOnlyList<OneOCardDto>)hand.Select(ToDto).ToList()
                : Array.Empty<OneOCardDto>();
            var dto = BuildDto(room, state, myHand);
            await hubContext.Clients.Client(player.ConnectionId)
                .ReceiveGameSpecificState("OneO", JsonSerializer.Serialize(dto));
        }
    }

    private static OneOGameStateDto BuildDto(GameRoom room, OneOGameState state, IReadOnlyList<OneOCardDto> myHand)
    {
        var players = room.Players
            .Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot))
            .ToList();
        var handCounts = (IReadOnlyDictionary<string, int>)room.Players
            .ToDictionary(p => p.Name, p => state.PlayerHands.TryGetValue(p.Name, out var h) ? h.Count : 0);
        var topDiscard = state.DiscardPile.Count > 0 ? ToDto(state.DiscardPile.Last()) : null;
        var currentPlayerName = room.Players.Count > 0 ? room.Players[state.CurrentPlayerIndex].Name : "";
        var phaseStr = room.Phase switch
        {
            GamePhase.Playing => "Playing",
            GamePhase.GameOver => "GameOver",
            _ => "Lobby"
        };

        return new OneOGameStateDto(
            Phase: phaseStr,
            RoomCode: room.RoomCode,
            Players: players,
            MyHand: myHand,
            TopDiscard: topDiscard,
            CurrentColor: state.CurrentColor.ToString(),
            CurrentPlayerName: currentPlayerName,
            DrawPileCount: state.DrawPile.Count,
            PlayerHandCounts: handCounts,
            Clockwise: state.Clockwise,
            LastAction: state.LastAction,
            WinnerName: state.WinnerName
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static int NextPlayerIndex(OneOGameState state, int playerCount, int? from = null)
    {
        int current = from ?? state.CurrentPlayerIndex;
        return state.Clockwise
            ? (current + 1) % playerCount
            : (current - 1 + playerCount) % playerCount;
    }

    private static void DrawCardsToPlayer(OneOGameState state, string playerName, int count)
    {
        for (int i = 0; i < count; i++)
        {
            EnsureDrawPile(state);
            if (state.DrawPile.Count == 0) break;
            var card = state.DrawPile[0];
            state.DrawPile.RemoveAt(0);
            state.PlayerHands[playerName].Add(card);
        }
    }

    private static void EnsureDrawPile(OneOGameState state)
    {
        if (state.DrawPile.Count > 0 || state.DiscardPile.Count <= 1) return;
        var top = state.DiscardPile.Last();
        var reshuffled = state.DiscardPile.Take(state.DiscardPile.Count - 1).ToList();
        state.DiscardPile.Clear();
        state.DiscardPile.Add(top);
        Shuffle(reshuffled);
        state.DrawPile.AddRange(reshuffled);
    }

    private static List<OneOCard> GenerateDeck()
    {
        var deck = new List<OneOCard>();
        int id = 0;
        var colors = new[] { OneOColor.Red, OneOColor.Green, OneOColor.Blue, OneOColor.Yellow };

        foreach (var color in colors)
        {
            deck.Add(new OneOCard { Id = id++, Color = color, Type = OneOCardType.Number, Value = 0 });
            for (int n = 0; n < 2; n++)
            {
                for (int v = 1; v <= 9; v++)
                    deck.Add(new OneOCard { Id = id++, Color = color, Type = OneOCardType.Number, Value = v });
                deck.Add(new OneOCard { Id = id++, Color = color, Type = OneOCardType.Skip, Value = 20 });
                deck.Add(new OneOCard { Id = id++, Color = color, Type = OneOCardType.Reverse, Value = 20 });
                deck.Add(new OneOCard { Id = id++, Color = color, Type = OneOCardType.DrawTwo, Value = 20 });
            }
        }

        for (int n = 0; n < 4; n++)
        {
            deck.Add(new OneOCard { Id = id++, Color = OneOColor.Wild, Type = OneOCardType.Wild, Value = 50 });
            deck.Add(new OneOCard { Id = id++, Color = OneOColor.Wild, Type = OneOCardType.WildDrawFour, Value = 50 });
        }

        return deck;
    }

    private static void Shuffle(List<OneOCard> deck)
    {
        for (int i = deck.Count - 1; i > 0; i--)
        {
            int j = Random.Shared.Next(i + 1);
            (deck[i], deck[j]) = (deck[j], deck[i]);
        }
    }

    private static OneOCardDto ToDto(OneOCard card) =>
        new(card.Id, card.Color.ToString(), card.Type.ToString(), card.Value);

    private static string CardName(OneOCard card) => card.Type switch
    {
        OneOCardType.Number => $"{card.Color} {card.Value}",
        OneOCardType.Skip => $"{card.Color} Skip",
        OneOCardType.Reverse => $"{card.Color} Reverse",
        OneOCardType.DrawTwo => $"{card.Color} Draw Two",
        OneOCardType.Wild => "Wild",
        OneOCardType.WildDrawFour => "Wild Draw Four",
        _ => card.Type.ToString()
    };
}
