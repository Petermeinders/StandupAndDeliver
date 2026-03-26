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

    // Separate timer slots: one for speaker turn, one for voting window per room.
    private readonly Dictionary<string, CancellationTokenSource> _turnTimers = new();
    private readonly Dictionary<string, CancellationTokenSource> _voteTimers = new();

    // Stores active card text per room so Reveal can broadcast it.
    private readonly Dictionary<string, string> _activeCardText = new();

    public async Task StartTurnAsync(GameRoom room)
    {
        CancelTimer(_turnTimers, room.RoomCode);
        CancelTimer(_voteTimers, room.RoomCode);

        var card = await promptCardService.DrawCardAsync(room.UsedCardIds);
        if (card is null)
        {
            logger.LogWarning("Room {RoomCode}: no cards left — ending game.", room.RoomCode);
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await hubContext.Clients.Group(room.RoomCode)
                .ReceiveGameState(GameHub.BuildStateDto(room));
            return;
        }

        room.ActiveCardId = card.Id;
        room.UsedCardIds.Add(card.Id);
        room.CurrentTurnVotes.Clear();
        room.LastActivity = DateTime.UtcNow;
        _activeCardText[room.RoomCode] = card.Text;

        var activeSpeaker = room.Players[room.CurrentSpeakerIndex];

        // Dual broadcast: group gets no card text; speaker gets card text
        await hubContext.Clients.GroupExcept(room.RoomCode, activeSpeaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId));
        await hubContext.Clients.Client(activeSpeaker.ConnectionId)
            .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId, card.Text));

        var cts = new CancellationTokenSource();
        _turnTimers[room.RoomCode] = cts;
        _ = RunTurnTimerAsync(room, TurnSeconds, cts.Token);
    }

    public async Task SkipTurnAsync(GameRoom room)
    {
        CancelTimer(_turnTimers, room.RoomCode);
        await TransitionToVotingAsync(room);
    }

    // Called by GameHub.SubmitVote after a vote is recorded.
    public async Task OnVoteSubmittedAsync(GameRoom room)
    {
        var eligible = room.Players.Count(p => p.IsConnected) - 1; // exclude active speaker
        var submitted = room.CurrentTurnVotes.Count;

        await hubContext.Clients.Group(room.RoomCode)
            .ReceiveVoteCount(submitted, eligible);

        if (submitted >= eligible && eligible > 0)
        {
            CancelTimer(_voteTimers, room.RoomCode);
            await TransitionToRevealAsync(room);
        }
    }

    public async Task TransitionToVotingAsync(GameRoom room)
    {
        room.Phase = GamePhase.Voting;
        room.LastActivity = DateTime.UtcNow;

        var activeSpeaker = room.Players[room.CurrentSpeakerIndex];
        await hubContext.Clients.Group(room.RoomCode)
            .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId));

        // Start voting window in case not all players vote
        var cts = new CancellationTokenSource();
        _voteTimers[room.RoomCode] = cts;
        _ = RunVotingTimerAsync(room, VotingSeconds, cts.Token);
    }

    public async Task TransitionToRevealAsync(GameRoom room)
    {
        CancelTimer(_voteTimers, room.RoomCode);

        var activeSpeaker = room.Players[room.CurrentSpeakerIndex];
        var cardText = _activeCardText.GetValueOrDefault(room.RoomCode, "");

        // Score calculation
        var votes = room.CurrentTurnVotes.Values.ToList();
        var liedCount = votes.Count(v => v.Lied);
        var totalVotes = votes.Count;
        var majorityLied = totalVotes > 0 && liedCount > totalVotes / 2.0;
        var impressionScore = totalVotes > 0
            ? Math.Round(votes.Average(v => v.Impressiveness), 1)
            : 0.0;
        var turnScore = majorityLied ? 0 : (int)Math.Round(impressionScore * 10);

        activeSpeaker.Score += turnScore;

        var lastTurnResult = new TurnResultDto(
            ActivePlayerName: activeSpeaker.Name,
            PromptCardText: cardText,
            LiedVoteCount: liedCount,
            TotalVoteCount: totalVotes,
            ImpressionScore: impressionScore,
            TurnScore: turnScore
        );

        room.Phase = GamePhase.Reveal;
        room.LastActivity = DateTime.UtcNow;

        await hubContext.Clients.Group(room.RoomCode)
            .ReceiveGameState(GameHub.BuildStateDto(room, activeSpeaker.ConnectionId, cardText, lastTurnResult));
    }

    public async Task AdvanceToNextTurnAsync(GameRoom room)
    {
        room.CurrentSpeakerIndex++;

        if (room.CurrentSpeakerIndex >= room.Players.Count)
        {
            room.Phase = GamePhase.GameOver;
            room.LastActivity = DateTime.UtcNow;
            await hubContext.Clients.Group(room.RoomCode)
                .ReceiveGameState(GameHub.BuildStateDto(room));
            return;
        }

        room.Phase = GamePhase.SpeakerTurn;
        await StartTurnAsync(room);
    }

    public Task<string?> GetActiveCardTextAsync(string roomCode) =>
        Task.FromResult(_activeCardText.GetValueOrDefault(roomCode));

    public void CancelTimer(string roomCode)
    {
        CancelTimer(_turnTimers, roomCode);
        CancelTimer(_voteTimers, roomCode);
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

            while (remaining > 0 && await timer.WaitForNextTickAsync(ct))
            {
                remaining--;
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
                logger.LogInformation("Room {RoomCode}: voting window expired.", room.RoomCode);
                await TransitionToRevealAsync(room);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { logger.LogError(ex, "Room {RoomCode}: voting timer error.", room.RoomCode); }
    }
}
