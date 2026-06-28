namespace StandupAndDeliver.Shared;

public interface IGameClient
{
    Task ReceiveGameState(GameStateDto state);
    Task ReceiveGameSpecificState(string gameType, string json);
    Task ReceiveTimerTick(int secondsRemaining);
    Task ReceiveVoteCount(int submitted, int total);
    Task ReceivePhaseChange(GamePhase newPhase);
    Task ReceiveError(string message);
    Task ReceiveReaction(string playerName, string emoji);
    Task ReceiveTranscript(string text);
}
