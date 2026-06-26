using System.Net;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Games;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Hubs;

public class GameHub(
    GameRoomService gameRoomService,
    GameTimerService gameTimerService,
    IEnumerable<ICardGame> cardGames) : Hub<IGameClient>
{
    private ICardGame GetGame(string gameType) =>
        cardGames.First(g => g.GameType == gameType);

    public async Task<HubResult> CreateRoom(string playerName, string gameType = "standup")
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var validTypes = new[] { "standup", "OneO" };
        if (!validTypes.Contains(gameType)) gameType = "standup";

        var safeName = WebUtility.HtmlEncode(playerName.Trim());
        var (room, code) = gameRoomService.CreateRoom(safeName, Context.ConnectionId, gameType);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Caller.ReceiveGameState(BuildStateDto(room));
        return new HubResult(true);
    }

    public async Task<HubResult> JoinRoom(string roomCode, string playerName)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var safeName = WebUtility.HtmlEncode(playerName.Trim());
        var (room, result) = gameRoomService.JoinRoom(roomCode.ToUpperInvariant(), safeName, Context.ConnectionId);
        if (!result.Success) return result;

        await Groups.AddToGroupAsync(Context.ConnectionId, room!.RoomCode);
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildStateDto(room));
        return new HubResult(true);
    }

    public async Task<HubResult> RejoinRoom(string roomCode, string playerName)
    {
        var room = gameRoomService.GetRoom(roomCode);
        if (room is null) return new HubResult(false, "Room not found or has expired.");

        var player = room.Players.FirstOrDefault(p =>
            string.Equals(p.Name, WebUtility.HtmlEncode(playerName.Trim()), StringComparison.OrdinalIgnoreCase));
        if (player is null) return new HubResult(false, "No player with that name in this room.");

        player.ConnectionId = Context.ConnectionId;
        player.IsConnected = true;
        room.LastActivity = DateTime.UtcNow;
        gameRoomService.CancelGracePeriod(roomCode, player.Name);

        await Groups.AddToGroupAsync(Context.ConnectionId, room.RoomCode);

        if (room.GameType == "OneO")
        {
            await Clients.Caller.ReceiveGameState(BuildStateDto(room));
        }
        else
        {
            var activeSpeaker = room.Phase == GamePhase.SpeakerTurn
                ? room.Players[room.CurrentSpeakerIndex] : null;
            var isActiveSpeaker = activeSpeaker?.ConnectionId == Context.ConnectionId;
            var cardText = isActiveSpeaker
                ? await gameTimerService.GetActiveCardTextAsync(room.RoomCode) : null;

            if (room.Phase is GamePhase.Results)
                cardText = await gameTimerService.GetActiveCardTextAsync(room.RoomCode);

            await Clients.Caller.ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId, cardText));
            await Clients.GroupExcept(room.RoomCode, Context.ConnectionId)
                .ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId));
        }

        return new HubResult(true);
    }

    public async Task<HubResult> StartGame()
    {
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");

        var (updatedRoom, result) = gameRoomService.StartGame(room.RoomCode, Context.ConnectionId);
        if (!result.Success)
        {
            // Sync the caller so their UI reflects the actual game phase instead of staying on lobby.
            await Clients.Caller.ReceiveGameState(BuildStateDto(room));
            return result;
        }

        var game = GetGame(updatedRoom!.GameType);
        await game.StartGame(updatedRoom, Context.ConnectionId);
        return new HubResult(true);
    }

    public async Task<HubResult> GameAction(string action, string? payloadJson)
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var game = GetGame(room.GameType);
        return await game.HandleAction(action, payloadJson, room, Context.ConnectionId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var room in gameRoomService.GetAllRooms())
        {
            var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (player is not null)
            {
                player.IsConnected = false;
                room.LastActivity = DateTime.UtcNow;

                var game = GetGame(room.GameType);
                await game.OnPlayerDisconnected(room, Context.ConnectionId);

                var roomCode = room.RoomCode;
                var playerName = player.Name;
                var wasActiveSpeaker = room.GameType == "standup"
                    && room.Phase == GamePhase.SpeakerTurn
                    && room.Players[room.CurrentSpeakerIndex].Name == playerName;
                var wasHost = player.IsHost;

                gameRoomService.StartGracePeriod(roomCode, playerName, async () =>
                {
                    var r = gameRoomService.GetRoom(roomCode);
                    if (r is null) return;
                    if (wasActiveSpeaker && r.Phase == GamePhase.SpeakerTurn)
                        await gameTimerService.EndTurnAsync(r);
                    else if (wasHost && r.Phase == GamePhase.Results)
                        await gameTimerService.AdvanceToNextTurnAsync(r);
                });

                break;
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private GameRoom? GetRoomForCaller() =>
        gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));

    public static GameStateDto BuildStateDto(
        GameRoom room,
        string? activeSpeakerConnectionId = null,
        string? promptCardText = null,
        TurnResultDto? lastTurnResult = null)
    {
        var players = room.Players
            .Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected))
            .ToList();

        var activeSpeaker = activeSpeakerConnectionId is not null
            ? room.Players.FirstOrDefault(p => p.ConnectionId == activeSpeakerConnectionId)
            : null;

        var includeTranscript = room.Phase is GamePhase.Voting or GamePhase.Results;

        return new GameStateDto(
            Phase: room.Phase,
            RoomCode: room.RoomCode,
            Players: players,
            ActivePlayerName: activeSpeaker?.Name,
            SecondsRemaining: null,
            PromptCardText: promptCardText,
            VotesSubmitted: room.CurrentTurnImpressiveness.Count,
            VotesTotal: room.Players.Count(p => p.IsConnected) - 1,
            LastTurnResult: lastTurnResult,
            CardFlipped: room.CardFlipped,
            LastTranscript: includeTranscript ? room.CurrentTranscript : null,
            GameType: room.GameType
        );
    }
}

