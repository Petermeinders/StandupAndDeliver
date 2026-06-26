using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public class StandupGame(GameTimerService gameTimerService, IHubContext<GameHub, IGameClient> hubContext) : ICardGame
{
    public string GameType => "standup";

    public async Task StartGame(GameRoom room, string connectionId)
    {
        // Phase is already set to SpeakerTurn by GameRoomService.StartGame()
        await gameTimerService.StartTurnAsync(room);
    }

    public async Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId)
    {
        return action switch
        {
            "EndTurn" => await EndTurn(room, connectionId),
            "SkipTurn" => await SkipTurn(room, connectionId),
            "FlipCard" => await FlipCard(room, connectionId),
            "PauseTurn" => await PauseTurn(room, connectionId),
            "ResumeTurn" => await ResumeTurn(room, connectionId),
            "SubmitImpressiveness" => await SubmitImpressiveness(room, connectionId, payloadJson),
            "AdvanceTurn" => await AdvanceTurn(room, connectionId),
            "SendTranscript" => await SendTranscript(room, connectionId, payloadJson),
            "SendReaction" => await SendReaction(room, connectionId, payloadJson),
            _ => new HubResult(false, $"Unknown action: {action}")
        };
    }

    public async Task OnPlayerDisconnected(GameRoom room, string connectionId)
    {
        var activeSpeaker = room.Phase == GamePhase.SpeakerTurn
            ? room.Players[room.CurrentSpeakerIndex] : null;

        if (room.Phase == GamePhase.SpeakerTurn && activeSpeaker is not null && activeSpeaker.IsConnected)
        {
            var cardText = await gameTimerService.GetActiveCardTextAsync(room.RoomCode);
            await hubContext.Clients.GroupExcept(room.RoomCode, activeSpeaker.ConnectionId)
                .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId));
            await hubContext.Clients.Client(activeSpeaker.ConnectionId)
                .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId, cardText));
        }
        else
        {
            await hubContext.Clients.Group(room.RoomCode)
                .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker?.ConnectionId));
        }
    }

    private async Task<HubResult> FlipCard(GameRoom room, string connectionId)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can flip the card.");
        await gameTimerService.FlipCardAsync(room);
        return new HubResult(true);
    }

    private async Task<HubResult> EndTurn(GameRoom room, string connectionId)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can end their turn.");
        await gameTimerService.EndTurnAsync(room);
        return new HubResult(true);
    }

    private async Task<HubResult> SkipTurn(GameRoom room, string connectionId)
    {
        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can skip a turn.");
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active speaker turn to skip.");
        await gameTimerService.EndTurnAsync(room);
        return new HubResult(true);
    }

    private async Task<HubResult> PauseTurn(GameRoom room, string connectionId)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can pause.");
        var paused = await gameTimerService.PauseTurnAsync(room);
        return paused ? new HubResult(true) : new HubResult(false, "Already paused.");
    }

    private async Task<HubResult> ResumeTurn(GameRoom room, string connectionId)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(false, "No active turn.");
        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(false, "Only the active speaker can resume.");
        var resumed = await gameTimerService.ResumeTurnAsync(room);
        return resumed ? new HubResult(true) : new HubResult(false, "Not paused.");
    }

    private async Task<HubResult> SubmitImpressiveness(GameRoom room, string connectionId, string? payloadJson)
    {
        if (room.Phase != GamePhase.Voting) return new HubResult(false, "Not in voting phase.");
        if (string.IsNullOrEmpty(payloadJson)) return new HubResult(false, "Rating required.");

        int rating;
        try
        {
            var doc = JsonDocument.Parse(payloadJson);
            rating = doc.RootElement.GetProperty("rating").GetInt32();
        }
        catch { return new HubResult(false, "Invalid payload."); }

        if (rating < 1 || rating > 5) return new HubResult(false, "Rating must be between 1 and 5.");

        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId == connectionId) return new HubResult(false, "The active speaker cannot rate their own performance.");

        await room.Lock.WaitAsync();
        try
        {
            if (room.CurrentTurnImpressiveness.ContainsKey(connectionId)) return new HubResult(false, "You have already submitted your rating.");
            room.CurrentTurnImpressiveness[connectionId] = rating;
        }
        finally { room.Lock.Release(); }

        await gameTimerService.OnImpressivenessSubmittedAsync(room);
        return new HubResult(true);
    }

    private async Task<HubResult> AdvanceTurn(GameRoom room, string connectionId)
    {
        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (caller is null || !caller.IsHost) return new HubResult(false, "Only the host can advance the turn.");
        if (room.Phase != GamePhase.Results) return new HubResult(false, "Game is not in Results phase.");
        await gameTimerService.AdvanceToNextTurnAsync(room);
        return new HubResult(true);
    }

    private async Task<HubResult> SendTranscript(GameRoom room, string connectionId, string? payloadJson)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(true);
        var speaker = room.Players[room.CurrentSpeakerIndex];
        if (speaker.ConnectionId != connectionId) return new HubResult(true);

        string text = "";
        if (!string.IsNullOrEmpty(payloadJson))
        {
            try { text = JsonDocument.Parse(payloadJson).RootElement.GetProperty("text").GetString() ?? ""; }
            catch { return new HubResult(true); }
        }
        if (string.IsNullOrEmpty(text) || text.Length > 2000) return new HubResult(true);

        room.CurrentTranscript = text;
        await hubContext.Clients.GroupExcept(room.RoomCode, connectionId).ReceiveTranscript(text);
        return new HubResult(true);
    }

    private async Task<HubResult> SendReaction(GameRoom room, string connectionId, string? payloadJson)
    {
        if (room.Phase != GamePhase.SpeakerTurn) return new HubResult(true);
        if (room.Players[room.CurrentSpeakerIndex].ConnectionId == connectionId) return new HubResult(true);

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
