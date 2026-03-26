namespace StandupAndDeliver.Shared;

public interface IGameClient
{
    Task ReceiveGameState(GameStateDto state);
    Task ReceiveTimerTick(int secondsRemaining);
    Task ReceiveVoteCount(int submitted, int total);
    Task ReceivePhaseChange(GamePhase newPhase);
    Task ReceiveError(string message);
}
