using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class OneOGame(IHubContext<GameHub, IGameClient> hubContext) : ICardGame
{
    private readonly ConcurrentDictionary<string, OneOGameState> _states = new();

    public string GameType => "OneO";

    public async Task StartGame(GameRoom room, string connectionId)
    {
        var state = new OneOGameState();
        var deck = GenerateDeck();
        Shuffle(deck);

        foreach (var player in room.Players)
        {
            state.PlayerHands[player.Name] = deck.Take(7).ToList();
            deck.RemoveRange(0, 7);
        }

        state.DrawPile = deck;

        // Flip top card; re-flip if WildDrawFour
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
        room.Phase = GamePhase.Playing;

        await BroadcastState(room, state);
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
            await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(GameHub.BuildStateDto(room));
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
        return new HubResult(true);
    }

    private async Task BroadcastState(GameRoom room, OneOGameState state)
    {
        // Keep GameState.State.Phase in sync so GameRoom.razor switches away from LobbyView.
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(GameHub.BuildStateDto(room));

        var players = room.Players
            .Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected))
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

        foreach (var player in room.Players.Where(p => p.IsConnected))
        {
            var myHand = state.PlayerHands.TryGetValue(player.Name, out var hand)
                ? (IReadOnlyList<OneOCardDto>)hand.Select(ToDto).ToList()
                : Array.Empty<OneOCardDto>();

            var dto = new OneOGameStateDto(
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

            await hubContext.Clients.Client(player.ConnectionId).ReceiveOneOGameState(dto);
        }
    }

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
