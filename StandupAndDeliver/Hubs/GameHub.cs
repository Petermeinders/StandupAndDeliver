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

        var activeSpeaker = room.Phase == GamePhase.SpeakerTurn
            ? room.Players[room.CurrentSpeakerIndex] : null;
        var isActiveSpeaker = activeSpeaker?.ConnectionId == Context.ConnectionId;
        var cardText = isActiveSpeaker
            ? await gameTimerService.GetActiveCardTextAsync(room.RoomCode) : null;

        // On Results, everyone sees the card
        if (room.Phase is GamePhase.Results)
            cardText = await gameTimerService.GetActiveCardTextAsync(room.RoomCode);

        await Clients.Caller.ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId, cardText));
        await Clients.GroupExcept(room.RoomCode, Context.ConnectionId)
            .ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId));
        return new HubResult(true);
    }

    public async Task<HubResult> StartGame()
    {
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null) return new HubResult(false, "Room not found.");

        var (updatedRoom, result) = gameRoomService.StartGame(room.RoomCode, Context.ConnectionId);
        if (!result.Success) return result;

        await gameTimerService.StartTurnAsync(updatedRoom!);
        return new HubResult(true);
    }

    public async Task<HubResult> EndTurn()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != Context.ConnectionId)
            return new HubResult(false, "Only the active speaker can end their turn.");

        await gameTimerService.EndTurnAsync(room);
        return new HubResult(true);
    }

    public async Task<HubResult> PauseTurn()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != Context.ConnectionId)
            return new HubResult(false, "Only the active speaker can pause.");

        var paused = await gameTimerService.PauseTurnAsync(room);
        return paused ? new HubResult(true) : new HubResult(false, "Already paused.");
    }

    public async Task<HubResult> ResumeTurn()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != Context.ConnectionId)
            return new HubResult(false, "Only the active speaker can resume.");

        var resumed = await gameTimerService.ResumeTurnAsync(room);
        return resumed ? new HubResult(true) : new HubResult(false, "Not paused.");
    }

    public async Task<HubResult> SkipTurn()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can skip a turn.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active speaker turn to skip.");

        await gameTimerService.EndTurnAsync(room);
        return new HubResult(true);
    }

    public async Task<HubResult> SubmitImpressiveness(int rating)
    {
        if (rating < 1 || rating > 5)
            return new HubResult(false, "Rating must be between 1 and 5.");

        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.Voting) return new HubResult(false, "Not in voting phase.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId == Context.ConnectionId)
            return new HubResult(false, "The active speaker cannot rate their own performance.");

        await room.Lock.WaitAsync();
        try
        {
            if (room.CurrentTurnImpressiveness.ContainsKey(Context.ConnectionId))
                return new HubResult(false, "You have already submitted your rating.");
            room.CurrentTurnImpressiveness[Context.ConnectionId] = rating;
        }
        finally { room.Lock.Release(); }

        await gameTimerService.OnImpressivenessSubmittedAsync(room);
        return new HubResult(true);
    }

    public async Task<HubResult> FlipCard()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != Context.ConnectionId)
            return new HubResult(false, "Only the active speaker can flip the card.");

        await gameTimerService.FlipCardAsync(room);
        return new HubResult(true);
    }

    public async Task SendTranscript(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 2000) return;

        var room = GetRoomForCaller();
        if (room is null || room.Phase != GamePhase.SpeakerTurn) return;

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != Context.ConnectionId) return;

        room.CurrentTranscript = text;
        await Clients.GroupExcept(room.RoomCode, Context.ConnectionId).ReceiveTranscript(text);
    }

    public async Task SendReaction(string emoji)
    {
        string[] allowed = ["👏", "😂", "🔥", "🤔", "💀"];
        if (!allowed.Contains(emoji)) return;

        var room = GetRoomForCaller();
        if (room is null || room.Phase != GamePhase.SpeakerTurn) return;

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null) return;

        // Speaker cannot react to themselves
        if (room.Players[room.CurrentSpeakerIndex].ConnectionId == Context.ConnectionId) return;

        await Clients.Group(room.RoomCode).ReceiveReaction(caller.Name, emoji);
    }

    public async Task<HubResult> AdvanceTurn()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can advance the turn.");
        if (room.Phase != GamePhase.Results) return new HubResult(false, "Game is not in Results phase.");

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

                // When a non-speaker disconnects during SpeakerTurn, we must not send a state
                // update that omits the card text — that would wipe the prompt off the speaker's
                // screen. Split the broadcast exactly as StartTurnAsync / FlipCardAsync do.
                if (room.Phase == GamePhase.SpeakerTurn
                    && activeSpeaker is not null
                    && activeSpeaker.IsConnected)
                {
                    var cardText = await gameTimerService.GetActiveCardTextAsync(room.RoomCode);
                    await Clients.GroupExcept(room.RoomCode, activeSpeaker.ConnectionId)
                        .ReceiveGameState(BuildStateDto(room, activeSpeaker.ConnectionId));
                    await Clients.Client(activeSpeaker.ConnectionId)
                        .ReceiveGameState(BuildStateDto(room, activeSpeaker.ConnectionId, cardText));
                }
                else
                {
                    await Clients.Group(room.RoomCode)
                        .ReceiveGameState(BuildStateDto(room, activeSpeaker?.ConnectionId));
                }

                var roomCode = room.RoomCode;
                var playerName = player.Name;
                var wasActiveSpeaker = activeSpeaker?.Name == playerName;
                var wasHost = player.IsHost;

                gameRoomService.StartGracePeriod(roomCode, playerName, async () =>
                {
                    var r = gameRoomService.GetRoom(roomCode);
                    if (r is null) return;
                    // Active speaker gone during their turn → skip to voting
                    if (wasActiveSpeaker && r.Phase == GamePhase.SpeakerTurn)
                        await gameTimerService.EndTurnAsync(r);
                    // Host gone while others wait on Results → auto-advance so game doesn't stall
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
            LastTranscript: includeTranscript ? room.CurrentTranscript : null
        );
    }
}

