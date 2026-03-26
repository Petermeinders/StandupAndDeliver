using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Client.Services;

public class GameStateService
{
    public GameStateDto? State { get; private set; }
    public string? PlayerName { get; set; }
    public int SecondsRemaining { get; private set; }

    public void Update(GameStateDto state)
    {
        State = state;
        if (state.SecondsRemaining.HasValue)
            SecondsRemaining = state.SecondsRemaining.Value;
    }

    public void UpdateTimer(int seconds) => SecondsRemaining = seconds;

    public void UpdateVoteCount(int submitted, int total)
    {
        if (State is null) return;
        State = State with { VotesSubmitted = submitted, VotesTotal = total };
    }

    public void Clear()
    {
        State = null;
        PlayerName = null;
        SecondsRemaining = 0;
    }
}
