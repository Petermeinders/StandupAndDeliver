using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Services;

public class GameTimerService(
    IHubContext<GameHub, IGameClient> hubContext,
    PromptCardService promptCardService,
    ILogger<GameTimerService> logger)
{
    private const int TurnSeconds = 60;
    private const int VotingSeconds = 30;

    private readonly Dictionary<string, CancellationTokenSource> _turnTimers = new();
    private readonly Dictionary<string, CancellationTokenSource> _voteTimers = new();
    private readonly Dictionary<string, string> _activeCardText = new();
    private readonly Dictionary<string, int> _pausedSeconds = new();
    private readonly Dictionary<string, int> _currentSeconds = new();

    // ── Turn start ────────────────────────────────────────────────────────────

    public async Task StartTurnAsync(GameRoom room, StandupRoomState state)
    {
        CancelAll(room.RoomCode);
        _pausedSeconds.Remove(room.RoomCode);

        // Skip disconnected players so the game doesn't stall waiting for a flip.
        while (state.CurrentSpeakerIndex < room.Players.Count
               && !room.Players[state.CurrentSpeakerIndex].IsConnected)
        {
            logger.LogInformation("Room {RoomCode}: speaker {Name} is disconnected — skipping their turn.",
                room.RoomCode, room.Players[state.CurrentSpeakerIndex].Name);
            state.CurrentSpeakerIndex++;
        }

        if (state.CurrentSpeakerIndex >= room.Players.Count)
        {
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await BroadcastLean(room);
            return;
        }

        var card = await promptCardService.DrawCardAsync(state.UsedCardIds);
        if (card is null)
        {
            logger.LogWarning("Room {RoomCode}: no cards left — ending game.", room.RoomCode);
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await BroadcastLean(room);
            return;
        }

        state.ActiveCardId = card.Id;
        state.UsedCardIds.Add(card.Id);
        state.CurrentTurnImpressiveness.Clear();
        state.CurrentTranscript = "";
        state.CardFlipped = false;
        state.SubPhase = StandupSubPhase.SpeakerTurn;
        room.LastActivity = DateTime.UtcNow;
        _activeCardText[room.RoomCode] = card.Text;

        var speaker = room.Players[state.CurrentSpeakerIndex];
        await BroadcastLean(room);
        await BroadcastStandupPerClient(room, state, speaker.ConnectionId);
        // Timer does NOT start here — speaker must flip the card first
    }

    public async Task FlipCardAsync(GameRoom room, StandupRoomState state)
    {
        if (state.CardFlipped) return;
        state.CardFlipped = true;
        room.LastActivity = DateTime.UtcNow;

        var speaker = room.Players[state.CurrentSpeakerIndex];
        await BroadcastStandupPerClient(room, state, speaker.ConnectionId);

        StartTurnTimer(room, state, TurnSeconds);
    }

    // ── Speaker controls ──────────────────────────────────────────────────────

    public async Task EndTurnAsync(GameRoom room, StandupRoomState state)
    {
        CancelTimer(_turnTimers, room.RoomCode);
        _pausedSeconds.Remove(room.RoomCode);
        await TransitionToVotingAsync(room, state);
    }

    public async Task<bool> PauseTurnAsync(GameRoom room, StandupRoomState state)
    {
        if (_pausedSeconds.ContainsKey(room.RoomCode)) return false;
        var remaining = _currentSeconds.GetValueOrDefault(room.RoomCode, 0);
        CancelTimer(_turnTimers, room.RoomCode);
        _pausedSeconds[room.RoomCode] = remaining;
        await hubContext.Clients.Group(room.RoomCode).ReceiveTimerTick(remaining);
        return true;
    }

    public async Task<bool> ResumeTurnAsync(GameRoom room, StandupRoomState state)
    {
        if (!_pausedSeconds.TryGetValue(room.RoomCode, out var remaining)) return false;
        _pausedSeconds.Remove(room.RoomCode);
        StartTurnTimer(room, state, remaining);
        await hubContext.Clients.Group(room.RoomCode).ReceiveTimerTick(remaining);
        return true;
    }

    public bool IsPaused(string roomCode) => _pausedSeconds.ContainsKey(roomCode);

    // ── Impressiveness voting ─────────────────────────────────────────────────

    public async Task OnImpressivenessSubmittedAsync(GameRoom room, StandupRoomState state)
    {
        var eligible = room.Players.Count(p => p.IsConnected) - 1;
        var submitted = state.CurrentTurnImpressiveness.Count;

        await hubContext.Clients.Group(room.RoomCode).ReceiveVoteCount(submitted, eligible);

        if (submitted >= eligible && eligible > 0)
        {
            CancelTimer(_voteTimers, room.RoomCode);
            await TransitionToResultsAsync(room, state);
        }
    }

    // ── Results & advance ─────────────────────────────────────────────────────

    public async Task TransitionToResultsAsync(GameRoom room, StandupRoomState state)
    {
        CancelTimer(_voteTimers, room.RoomCode);
        var speaker = room.Players[state.CurrentSpeakerIndex];
        var cardText = _activeCardText.GetValueOrDefault(room.RoomCode, "");

        var impressionValues = state.CurrentTurnImpressiveness.Values.ToList();
        var impressionScore = impressionValues.Count > 0
            ? Math.Round(impressionValues.Average(), 1) : 0.0;
        var turnScore = (int)Math.Round(impressionScore * 10);

        speaker.Score += turnScore;

        var lastTurnResult = new TurnResultDto(
            ActivePlayerName: speaker.Name,
            PromptCardText: cardText,
            ImpressionScore: impressionScore,
            TurnScore: turnScore
        );

        state.SubPhase = StandupSubPhase.Results;
        room.LastActivity = DateTime.UtcNow;

        await BroadcastLean(room);
        var dto = BuildStandupDto(state, speaker.ConnectionId, cardText, lastTurnResult);
        var json = JsonSerializer.Serialize(dto);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameSpecificState("standup", json);
    }

    public async Task AdvanceToNextTurnAsync(GameRoom room, StandupRoomState state)
    {
        state.CurrentSpeakerIndex++;

        if (state.CurrentSpeakerIndex >= room.Players.Count)
        {
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await BroadcastLean(room);
            return;
        }

        await StartTurnAsync(room, state);
    }

    // ── Voting transition ─────────────────────────────────────────────────────

    public async Task TransitionToVotingAsync(GameRoom room, StandupRoomState state)
    {
        state.SubPhase = StandupSubPhase.Voting;
        room.LastActivity = DateTime.UtcNow;

        var speaker = room.Players[state.CurrentSpeakerIndex];
        await BroadcastLean(room);
        var dto = BuildStandupDto(state, speaker.ConnectionId);
        var json = JsonSerializer.Serialize(dto);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameSpecificState("standup", json);

        var cts = new CancellationTokenSource();
        _voteTimers[room.RoomCode] = cts;
        _ = RunVotingTimerAsync(room, state, VotingSeconds, cts.Token);
    }

    // ── DTO builder & broadcast helpers ──────────────────────────────────────

    public static StandupGameStateDto BuildStandupDto(
        StandupRoomState state,
        string? activeSpeakerConnectionId = null,
        string? promptCardText = null,
        TurnResultDto? lastTurnResult = null)
    {
        var includeTranscript = state.SubPhase is StandupSubPhase.Voting or StandupSubPhase.Results;
        return new StandupGameStateDto(
            SubPhase: state.SubPhase,
            ActivePlayerName: null, // resolved by caller if needed
            SecondsRemaining: null,
            PromptCardText: promptCardText,
            VotesSubmitted: state.CurrentTurnImpressiveness.Count,
            VotesTotal: 0, // caller sets this
            LastTurnResult: lastTurnResult,
            CardFlipped: state.CardFlipped,
            LastTranscript: includeTranscript ? state.CurrentTranscript : null
        );
    }

    private async Task BroadcastLean(GameRoom room)
    {
        var dto = new GameStateDto(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected)).ToList(),
            room.GameType);
        await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(dto);
    }

    /// Broadcasts standup-specific state per-client (speaker gets card text, others don't).
    public async Task BroadcastStandupPerClient(GameRoom room, StandupRoomState state, string speakerConnectionId)
    {
        var cardText = _activeCardText.GetValueOrDefault(room.RoomCode, "");
        var eligible = room.Players.Count(p => p.IsConnected) - 1;
        var includeTranscript = state.SubPhase is StandupSubPhase.Voting or StandupSubPhase.Results;

        foreach (var player in room.Players.Where(p => p.IsConnected))
        {
            var isSpeaker = player.ConnectionId == speakerConnectionId;
            var dto = new StandupGameStateDto(
                SubPhase: state.SubPhase,
                ActivePlayerName: room.Players.FirstOrDefault(p => p.ConnectionId == speakerConnectionId)?.Name,
                SecondsRemaining: null,
                PromptCardText: isSpeaker ? cardText : null,
                VotesSubmitted: state.CurrentTurnImpressiveness.Count,
                VotesTotal: eligible,
                LastTurnResult: null,
                CardFlipped: state.CardFlipped,
                LastTranscript: includeTranscript ? state.CurrentTranscript : null
            );
            await hubContext.Clients.Client(player.ConnectionId)
                .ReceiveGameSpecificState("standup", JsonSerializer.Serialize(dto));
        }
    }

    // ── Timer helpers ─────────────────────────────────────────────────────────

    public Task<string?> GetActiveCardTextAsync(string roomCode) =>
        Task.FromResult(_activeCardText.GetValueOrDefault(roomCode));

    public void CancelAll(string roomCode)
    {
        CancelTimer(_turnTimers, roomCode);
        CancelTimer(_voteTimers, roomCode);
    }

    private void StartTurnTimer(GameRoom room, StandupRoomState state, int seconds)
    {
        var cts = new CancellationTokenSource();
        _turnTimers[room.RoomCode] = cts;
        _ = RunTurnTimerAsync(room, state, seconds, cts.Token);
    }

    private static void CancelTimer(Dictionary<string, CancellationTokenSource> dict, string key)
    {
        if (dict.TryGetValue(key, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
            dict.Remove(key);
        }
    }

    private async Task RunTurnTimerAsync(GameRoom room, StandupRoomState state, int seconds, CancellationToken ct)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            var remaining = seconds;
            _currentSeconds[room.RoomCode] = remaining;
            while (remaining > 0 && await timer.WaitForNextTickAsync(ct))
            {
                remaining--;
                _currentSeconds[room.RoomCode] = remaining;
                await hubContext.Clients.Group(room.RoomCode).ReceiveTimerTick(remaining);
            }
            if (!ct.IsCancellationRequested)
                await TransitionToVotingAsync(room, state);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { logger.LogError(ex, "Room {RoomCode}: turn timer error.", room.RoomCode); }
    }

    private async Task RunVotingTimerAsync(GameRoom room, StandupRoomState state, int seconds, CancellationToken ct)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
            if (!ct.IsCancellationRequested)
            {
                logger.LogInformation("Room {RoomCode}: impressiveness voting window expired.", room.RoomCode);
                await TransitionToResultsAsync(room, state);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { logger.LogError(ex, "Room {RoomCode}: voting timer error.", room.RoomCode); }
    }
}
