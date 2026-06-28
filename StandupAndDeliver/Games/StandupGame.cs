using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class StandupGame(GameTimerService gameTimerService, IHubContext<GameHub, IGameClient> hubContext) : ICardGame
{
    private readonly ConcurrentDictionary<string, StandupRoomState> _states = new();

    public string GameType => "standup";

    public async Task StartGame(GameRoom room, string connectionId)
    {
        var state = new StandupRoomState();
        _states[room.RoomCode] = state;
        await gameTimerService.StartTurnAsync(room, state);
    }

    public async Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state))
            return new HubResult(false, "Game state not found.");

        return action switch
        {
            "EndTurn"              => await EndTurn(room, state, connectionId),
            "SkipTurn"             => await SkipTurn(room, state, connectionId),
            "FlipCard"             => await FlipCard(room, state, connectionId),
            "PauseTurn"            => await PauseTurn(room, state, connectionId),
            "ResumeTurn"           => await ResumeTurn(room, state, connectionId),
            "SubmitImpressiveness" => await SubmitImpressiveness(room, state, connectionId, payloadJson),
            "AdvanceTurn"          => await AdvanceTurn(room, state, connectionId),
            "SendTranscript"       => await SendTranscript(room, state, connectionId, payloadJson),
            "SendReaction"         => await SendReaction(room, state, connectionId, payloadJson),
            _ => new HubResult(false, $"Unknown action: {action}")
        };
    }

    public async Task OnPlayerDisconnected(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;

        var activeSpeaker = state.SubPhase == StandupSubPhase.SpeakerTurn
            ? room.Players[state.CurrentSpeakerIndex] : null;

        if (activeSpeaker is not null && activeSpeaker.IsConnected)
            await gameTimerService.BroadcastStandupPerClient(room, state, activeSpeaker.ConnectionId);
        else
            await gameTimerService.BroadcastStandupPerClient(room, state, activeSpeaker?.ConnectionId ?? "");
    }

    public async Task OnPlayerRejoined(GameRoom room, string connectionId)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;

        var activeSpeaker = state.SubPhase == StandupSubPhase.SpeakerTurn
            ? room.Players[state.CurrentSpeakerIndex] : null;
        var isActiveSpeaker = activeSpeaker?.ConnectionId == connectionId;
        var cardText = isActiveSpeaker || state.SubPhase == StandupSubPhase.Results
            ? await gameTimerService.GetActiveCardTextAsync(room.RoomCode) : null;

        var eligible = room.Players.Count(p => p.IsConnected) - 1;
        var includeTranscript = state.SubPhase is StandupSubPhase.Voting or StandupSubPhase.Results;
        var dto = new StandupGameStateDto(
            SubPhase: state.SubPhase,
            ActivePlayerName: activeSpeaker?.Name,
            SecondsRemaining: null,
            PromptCardText: cardText,
            VotesSubmitted: state.CurrentTurnImpressiveness.Count,
            VotesTotal: eligible,
            LastTurnResult: null,
            CardFlipped: state.CardFlipped,
            LastTranscript: includeTranscript ? state.CurrentTranscript : null
        );
        await hubContext.Clients.Client(connectionId)
            .ReceiveGameSpecificState("standup", JsonSerializer.Serialize(dto));

        // Also update everyone else's player list (reconnected player is now IsConnected = true)
        await gameTimerService.BroadcastStandupPerClient(room, state, activeSpeaker?.ConnectionId ?? "");
    }

    public async Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost)
    {
        if (!_states.TryGetValue(room.RoomCode, out var state)) return;

        var isActiveSpeaker = state.SubPhase == StandupSubPhase.SpeakerTurn
            && room.Players[state.CurrentSpeakerIndex].Name == playerName;

        if (isActiveSpeaker)
            await gameTimerService.EndTurnAsync(room, state);
        else if (wasHost && state.SubPhase == StandupSubPhase.Results)
            await gameTimerService.AdvanceToNextTurnAsync(room, state);
    }

    // ── Action handlers ───────────────────────────────────────────────────────

    private async Task<HubResult> FlipCard(GameRoom room, StandupRoomState state, string connectionId)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can flip the card.");
        await gameTimerService.FlipCardAsync(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> EndTurn(GameRoom room, StandupRoomState state, string connectionId)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can end their turn.");
        await gameTimerService.EndTurnAsync(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> SkipTurn(GameRoom room, StandupRoomState state, string connectionId)
    {
        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can skip a turn.");
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(false, "No active speaker turn to skip.");
        await gameTimerService.EndTurnAsync(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> PauseTurn(GameRoom room, StandupRoomState state, string connectionId)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can pause.");
        var paused = await gameTimerService.PauseTurnAsync(room, state);
        return paused ? new HubResult(true) : new HubResult(false, "Already paused.");
    }

    private async Task<HubResult> ResumeTurn(GameRoom room, StandupRoomState state, string connectionId)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can resume.");
        var resumed = await gameTimerService.ResumeTurnAsync(room, state);
        return resumed ? new HubResult(true) : new HubResult(false, "Not paused.");
    }

    private async Task<HubResult> SubmitImpressiveness(GameRoom room, StandupRoomState state, string connectionId, string? payloadJson)
    {
        if (state.SubPhase != StandupSubPhase.Voting) return new HubResult(false, "Not in voting phase.");
        if (string.IsNullOrEmpty(payloadJson)) return new HubResult(false, "Rating required.");

        int rating;
        try
        {
            var doc = JsonDocument.Parse(payloadJson);
            rating = doc.RootElement.GetProperty("rating").GetInt32();
        }
        catch { return new HubResult(false, "Invalid payload."); }

        if (rating < 1 || rating > 5) return new HubResult(false, "Rating must be between 1 and 5.");

        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId == connectionId) return new HubResult(false, "The active speaker cannot rate their own performance.");

        await room.Lock.WaitAsync();
        try
        {
            if (state.CurrentTurnImpressiveness.ContainsKey(connectionId)) return new HubResult(false, "You have already submitted your rating.");
            state.CurrentTurnImpressiveness[connectionId] = rating;
        }
        finally { room.Lock.Release(); }

        await gameTimerService.OnImpressivenessSubmittedAsync(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> AdvanceTurn(GameRoom room, StandupRoomState state, string connectionId)
    {
        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can advance the turn.");
        if (state.SubPhase != StandupSubPhase.Results) return new HubResult(false, "Game is not in Results phase.");
        await gameTimerService.AdvanceToNextTurnAsync(room, state);
        return new HubResult(true);
    }

    private async Task<HubResult> SendTranscript(GameRoom room, StandupRoomState state, string connectionId, string? payloadJson)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(true);
        var speaker = room.Players[state.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(true);

        string text = "";
        if (!string.IsNullOrEmpty(payloadJson))
        {
            try { text = JsonDocument.Parse(payloadJson).RootElement.GetProperty("text").GetString() ?? ""; }
            catch { return new HubResult(true); }
        }
        if (string.IsNullOrEmpty(text) || text.Length > 2000) return new HubResult(true);

        state.CurrentTranscript = text;
        await hubContext.Clients.GroupExcept(room.RoomCode, connectionId).ReceiveTranscript(text);
        return new HubResult(true);
    }

    private async Task<HubResult> SendReaction(GameRoom room, StandupRoomState state, string connectionId, string? payloadJson)
    {
        if (state.SubPhase != StandupSubPhase.SpeakerTurn) return new HubResult(true);
        if (room.Players[state.CurrentSpeakerIndex].ConnectionId == connectionId) return new HubResult(true);

        string emoji = "";
        if (!string.IsNullOrEmpty(payloadJson))
        {
            try { emoji = JsonDocument.Parse(payloadJson).RootElement.GetProperty("emoji").GetString() ?? ""; }
            catch { return new HubResult(true); }
        }

        string[] allowed = ["👏", "😂", "🔥", "🤔", "💀"];
        if (!allowed.Contains(emoji)) return new HubResult(true);

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (caller is null) return new HubResult(true);

        await hubContext.Clients.Group(room.RoomCode).ReceiveReaction(caller.Name, emoji);
        return new HubResult(true);
    }
}
