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
    private readonly Dictionary<string, int> _currentSeconds = new(); // live tracking

    // ── Turn start ────────────────────────────────────────────────────────────

    public async Task StartTurnAsync(GameRoom room)
    {
        CancelAll(room.RoomCode);
        _pausedSeconds.Remove(room.RoomCode);

        // Skip any disconnected players whose turn it is, so the game doesn't stall
        // waiting for a card flip that will never come.
        while (room.CurrentSpeakerIndex < room.Players.Count
               && !room.Players[room.CurrentSpeakerIndex].IsConnected)
        {
            logger.LogInformation("Room {RoomCode}: speaker {Name} is disconnected — skipping their turn.",
                room.RoomCode, room.Players[room.CurrentSpeakerIndex].Name);
            room.CurrentSpeakerIndex++;
        }

        if (room.CurrentSpeakerIndex >= room.Players.Count)
        {
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(GameHub.BuildStateDto(room));
            return;
        }

        var card = await promptCardService.DrawCardAsync(room.UsedCardIds);
        if (card is null)
        {
            logger.LogWarning("Room {RoomCode}: no cards left — ending game.", room.RoomCode);
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(GameHub.BuildStateDto(room));
            return;
        }

        room.ActiveCardId = card.Id;
        room.UsedCardIds.Add(card.Id);
        room.CurrentTurnImpressiveness.Clear();
        room.CurrentTranscript = "";
        room.CardFlipped = false;
        room.LastActivity = DateTime.UtcNow;
        _activeCardText[room.RoomCode] = card.Text;

        var speaker = room.Players[room.CurrentSpeakerIndex];
        await hubContext.Clients.GroupExcept(room.RoomCode, speaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId));
        await hubContext.Clients.Client(speaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId, card.Text));
        // Timer does NOT start here — speaker must flip the card first
    }

    public async Task FlipCardAsync(GameRoom room)
    {
        if (room.CardFlipped) return;
        room.CardFlipped = true;
        room.LastActivity = DateTime.UtcNow;

        var speaker = room.Players[room.CurrentSpeakerIndex];
        var cardText = _activeCardText.GetValueOrDefault(room.RoomCode, "");

        // Broadcast flipped state to everyone (waiting players now see timer starting)
        await hubContext.Clients.GroupExcept(room.RoomCode, speaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId));
        await hubContext.Clients.Client(speaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId, cardText));

        StartTurnTimer(room, TurnSeconds);
    }

    // ── Speaker controls ──────────────────────────────────────────────────────

    public async Task EndTurnAsync(GameRoom room)
    {
        CancelTimer(_turnTimers, room.RoomCode);
        _pausedSeconds.Remove(room.RoomCode);
        await TransitionToVotingAsync(room);
    }

    public async Task<bool> PauseTurnAsync(GameRoom room)
    {
        if (_pausedSeconds.ContainsKey(room.RoomCode)) return false; // already paused
        var remaining = _currentSeconds.GetValueOrDefault(room.RoomCode, 0);
        CancelTimer(_turnTimers, room.RoomCode);
        _pausedSeconds[room.RoomCode] = remaining;
        await hubContext.Clients.Group(room.RoomCode).ReceiveTimerTick(remaining);
        return true;
    }

    public async Task<bool> ResumeTurnAsync(GameRoom room)
    {
        if (!_pausedSeconds.TryGetValue(room.RoomCode, out var remaining)) return false;
        _pausedSeconds.Remove(room.RoomCode);
        StartTurnTimer(room, remaining);
        await hubContext.Clients.Group(room.RoomCode).ReceiveTimerTick(remaining);
        return true;
    }

    public bool IsPaused(string roomCode) => _pausedSeconds.ContainsKey(roomCode);

    // ── Impressiveness voting ─────────────────────────────────────────────────

    public async Task OnImpressivenessSubmittedAsync(GameRoom room)
    {
        var eligible = room.Players.Count(p => p.IsConnected) - 1;
        var submitted = room.CurrentTurnImpressiveness.Count;

        await hubContext.Clients.Group(room.RoomCode).ReceiveVoteCount(submitted, eligible);

        if (submitted >= eligible && eligible > 0)
        {
            CancelTimer(_voteTimers, room.RoomCode);
            await TransitionToResultsAsync(room);
        }
    }

    // ── Results & advance ─────────────────────────────────────────────────────

    public async Task TransitionToResultsAsync(GameRoom room)
    {
        CancelTimer(_voteTimers, room.RoomCode);
        var speaker = room.Players[room.CurrentSpeakerIndex];
        var cardText = _activeCardText.GetValueOrDefault(room.RoomCode, "");

        var impressionValues = room.CurrentTurnImpressiveness.Values.ToList();
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

        room.Phase = GamePhase.Results;
        room.LastActivity = DateTime.UtcNow;

        await hubContext.Clients.Group(room.RoomCode)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId, cardText, lastTurnResult));
    }

    public async Task AdvanceToNextTurnAsync(GameRoom room)
    {
        room.CurrentSpeakerIndex++;

        if (room.CurrentSpeakerIndex >= room.Players.Count)
        {
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await hubContext.Clients.Group(room.RoomCode).ReceiveGameState(GameHub.BuildStateDto(room));
            return;
        }

        room.Phase = GamePhase.SpeakerTurn;
        await StartTurnAsync(room);
    }

    // ── Transition to voting (called by EndTurn / timer expiry / skip) ────────

    public async Task TransitionToVotingAsync(GameRoom room)
    {
        room.Phase = GamePhase.Voting;
        room.LastActivity = DateTime.UtcNow;

        var speaker = room.Players[room.CurrentSpeakerIndex];
        await hubContext.Clients.Group(room.RoomCode)
            .ReceiveGameState(GameHub.BuildStateDto(room, speaker.ConnectionId));

        var cts = new CancellationTokenSource();
        _voteTimers[room.RoomCode] = cts;
        _ = RunVotingTimerAsync(room, VotingSeconds, cts.Token);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    public Task<string?> GetActiveCardTextAsync(string roomCode) =>
        Task.FromResult(_activeCardText.GetValueOrDefault(roomCode));

    public void CancelAll(string roomCode)
    {
        CancelTimer(_turnTimers, roomCode);
        CancelTimer(_voteTimers, roomCode);
    }

    private void StartTurnTimer(GameRoom room, int seconds)
    {
        var cts = new CancellationTokenSource();
        _turnTimers[room.RoomCode] = cts;
        _ = RunTurnTimerAsync(room, seconds, cts.Token);
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

    private async Task RunTurnTimerAsync(GameRoom room, int seconds, CancellationToken ct)
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
                await TransitionToVotingAsync(room);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { logger.LogError(ex, "Room {RoomCode}: turn timer error.", room.RoomCode); }
    }

    private async Task RunVotingTimerAsync(GameRoom room, int seconds, CancellationToken ct)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
            if (!ct.IsCancellationRequested)
            {
                logger.LogInformation("Room {RoomCode}: impressiveness voting window expired.", room.RoomCode);
                await TransitionToResultsAsync(room);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { logger.LogError(ex, "Room {RoomCode}: voting timer error.", room.RoomCode); }
    }

}
