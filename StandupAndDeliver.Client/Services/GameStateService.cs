using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Client.Services;

public record ReactionItem(string PlayerName, string Emoji, DateTime ReceivedAt);

public class GameStateService
{
    public GameStateDto? State { get; private set; }
    public string? PlayerName { get; set; }
    public int SecondsRemaining { get; private set; }

    private readonly List<ReactionItem> _reactions = [];

    public string CurrentTranscript { get; private set; } = "";
    public event Action? OnTranscriptUpdated;

    public void Update(GameStateDto state)
    {
        // Clear transcript whenever we leave the speaker turn phase
        if (State?.Phase == GamePhase.SpeakerTurn && state.Phase != GamePhase.SpeakerTurn)
            CurrentTranscript = "";

        State = state;
        if (state.SecondsRemaining.HasValue)
            SecondsRemaining = state.SecondsRemaining.Value;
    }

    public void UpdateTranscript(string text)
    {
        CurrentTranscript = text;
        OnTranscriptUpdated?.Invoke();
    }

    public void UpdateTimer(int seconds) => SecondsRemaining = seconds;

    public void UpdateVoteCount(int submitted, int total)
    {
        if (State is null) return;
        State = State with { VotesSubmitted = submitted, VotesTotal = total };
    }

    public void AddReaction(string playerName, string emoji)
    {
        _reactions.Add(new ReactionItem(playerName, emoji, DateTime.UtcNow));
        if (_reactions.Count > 12)
            _reactions.RemoveAt(0);
    }

    public IReadOnlyList<ReactionItem> GetActiveReactions()
    {
        var cutoff = DateTime.UtcNow.AddSeconds(-4);
        _reactions.RemoveAll(r => r.ReceivedAt < cutoff);
        return _reactions.AsReadOnly();
    }

    public void Clear()
    {
        State = null;
        PlayerName = null;
        SecondsRemaining = 0;
        CurrentTranscript = "";
        _reactions.Clear();
    }
}
