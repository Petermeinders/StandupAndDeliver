using System.Text.Json;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Client.Services;

public record ReactionItem(string PlayerName, string Emoji, DateTime ReceivedAt);

public class GameStateService
{
    public GameStateDto? PlatformState { get; private set; }
    public string? PlayerName { get; set; }
    public string SelectedGameType { get; set; } = "standup";
    public int SecondsRemaining { get; private set; }

    private readonly Dictionary<string, string> _gameStates = new();
    private readonly List<ReactionItem> _reactions = [];

    public string CurrentTranscript { get; private set; } = "";
    public event Action? OnTranscriptUpdated;

    public void UpdatePlatform(GameStateDto state)
    {
        PlatformState = state;
    }

    public void UpdateGameState(string gameType, string json)
    {
        _gameStates[gameType] = json;
    }

    public T? GetState<T>(string gameType) where T : class
    {
        if (!_gameStates.TryGetValue(gameType, out var json)) return null;
        try { return JsonSerializer.Deserialize<T>(json); }
        catch { return null; }
    }

    public void UpdateTranscript(string text)
    {
        CurrentTranscript = text;
        OnTranscriptUpdated?.Invoke();
    }

    public void UpdateTimer(int seconds) => SecondsRemaining = seconds;

    public void UpdateVoteCount(int submitted, int total)
    {
        if (!_gameStates.TryGetValue("standup", out var json)) return;
        try
        {
            var dto = JsonSerializer.Deserialize<StandupGameStateDto>(json);
            if (dto is null) return;
            var updated = dto with { VotesSubmitted = submitted, VotesTotal = total };
            _gameStates["standup"] = JsonSerializer.Serialize(updated);
        }
        catch { }
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
        PlatformState = null;
        _gameStates.Clear();
        SecondsRemaining = 0;
        CurrentTranscript = "";
        _reactions.Clear();
    }
}
