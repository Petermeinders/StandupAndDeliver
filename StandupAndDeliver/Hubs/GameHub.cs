using System.Net;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;


namespace StandupAndDeliver.Hubs;

public class GameHub(GameRoomService gameRoomService, GameTimerService gameTimerService) : Hub<IGameClient>
{
    public async Task<HubResult> CreateRoom(string playerName)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var safeName = WebUtility.HtmlEncode(playerName.Trim());
        var (room, code) = gameRoomService.CreateRoom(safeName, Context.ConnectionId);

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

    public async Task<HubResult> StartGame()
    {
        // Find the room this connection hosts
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");

        var (updatedRoom, result) = gameRoomService.StartGame(room.RoomCode, Context.ConnectionId);
        if (!result.Success) return result;

        await gameTimerService.StartTurnAsync(updatedRoom!);
        return new HubResult(true);
    }

    public async Task<HubResult> SkipTurn()
    {
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can skip a turn.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active speaker turn to skip.");

        await gameTimerService.SkipTurnAsync(room);
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

        // Cancel any grace-period timer for this player
        gameRoomService.CancelGracePeriod(roomCode, player.Name);

        await Groups.AddToGroupAsync(Context.ConnectionId, room.RoomCode);

        // Sync full state to rejoining player (speaker sees their card if SpeakerTurn)
        var activeSpeaker = room.Phase == GamePhase.SpeakerTurn
            ? room.Players[room.CurrentSpeakerIndex] : null;
        var isActiveSpeaker = activeSpeaker?.ConnectionId == Context.ConnectionId;
        var cardText = isActiveSpeaker
            ? await gameTimerService.GetActiveCardTextAsync(room.RoomCode) : null;

        await Clients.Caller.ReceiveGameState(
            BuildStateDto(room, activeSpeaker?.ConnectionId, cardText));

        // Notify others
        await Clients.GroupExcept(room.RoomCode, Context.ConnectionId)
            .ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId));

        return new HubResult(true);
    }

    public async Task<HubResult> SubmitVote(bool lied, int impressiveness)
    {
        if (impressiveness < 1 || impressiveness > 5)
            return new HubResult(false, "Impressiveness rating must be between 1 and 5.");

        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.Voting) return new HubResult(false, "Not currently in voting phase.");

        var activeSpeaker = room.Players[room.CurrentSpeakerIndex];
        if (activeSpeaker.ConnectionId == Context.ConnectionId)
            return new HubResult(false, "The active speaker cannot vote on their own turn.");

        await room.Lock.WaitAsync();
        try
        {
            if (room.CurrentTurnVotes.ContainsKey(Context.ConnectionId))
                return new HubResult(false, "You have already submitted your vote.");

            room.CurrentTurnVotes[Context.ConnectionId] = (lied, impressiveness);
        }
        finally
        {
            room.Lock.Release();
        }

        await gameTimerService.OnVoteSubmittedAsync(room);
        return new HubResult(true);
    }

    public async Task<HubResult> AdvanceTurn()
    {
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can advance the turn.");
        if (room.Phase != GamePhase.Reveal) return new HubResult(false, "Game is not in Reveal phase.");

        await gameTimerService.AdvanceToNextTurnAsync(room);
        return new HubResult(true);
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

                var activeSpeaker = room.Phase == GamePhase.SpeakerTurn
                    ? room.Players[room.CurrentSpeakerIndex] : null;
                await Clients.Group(room.RoomCode)
                    .ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId));

                // Start grace period — auto-skip active speaker or continue after 30s
                var roomCode = room.RoomCode;
                var playerName = player.Name;
                var wasActiveSpeaker = activeSpeaker?.Name == playerName;

                gameRoomService.StartGracePeriod(roomCode, playerName, async () =>
                {
                    var r = gameRoomService.GetRoom(roomCode);
                    if (r is null) return;
                    if (wasActiveSpeaker && r.Phase == GamePhase.SpeakerTurn)
                        await gameTimerService.SkipTurnAsync(r);
                    // For non-speaker disconnects the session already continues unaffected
                });

                break;
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    // ── State DTO builder ─────────────────────────────────────────────────────

    internal static GameStateDto BuildStateDto(
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

        return new GameStateDto(
            Phase: room.Phase,
            RoomCode: room.RoomCode,
            Players: players,
            ActivePlayerName: activeSpeaker?.Name,
            SecondsRemaining: null,
            PromptCardText: promptCardText,
            VotesSubmitted: room.CurrentTurnVotes.Count,
            VotesTotal: room.Players.Count(p => p.IsConnected) - 1,
            LastTurnResult: lastTurnResult
        );
    }
}
