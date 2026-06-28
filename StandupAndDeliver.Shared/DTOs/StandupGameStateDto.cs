namespace StandupAndDeliver.Shared;

public record StandupGameStateDto(
    StandupSubPhase SubPhase,
    string? ActivePlayerName,
    int? SecondsRemaining,
    string? PromptCardText,
    int VotesSubmitted,
    int VotesTotal,
    TurnResultDto? LastTurnResult,
    bool CardFlipped,
    string? LastTranscript
);
