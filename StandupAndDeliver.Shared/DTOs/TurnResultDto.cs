namespace StandupAndDeliver.Shared;

public record TurnResultDto(
    string ActivePlayerName,
    string PromptCardText,
    double ImpressionScore,
    int TurnScore
);
