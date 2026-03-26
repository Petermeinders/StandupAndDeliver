namespace StandupAndDeliver.Shared;

public record GameStateDto(
    GamePhase Phase,
    string RoomCode,
    IReadOnlyList<PlayerDto> Players,
    string? ActivePlayerName,
    int? SecondsRemaining,
    string? PromptCardText,
    int VotesSubmitted,
    int VotesTotal,
    TurnResultDto? LastTurnResult,
    bool CardFlipped = false
);
