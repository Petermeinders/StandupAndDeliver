namespace StandupAndDeliver.Shared;

public record TurnResultDto(
    string ActivePlayerName,
    string PromptCardText,
    int LiedVoteCount,
    int TotalVoteCount,
    double ImpressionScore,
    int TurnScore
);
