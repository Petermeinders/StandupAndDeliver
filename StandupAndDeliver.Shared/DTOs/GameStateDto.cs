namespace StandupAndDeliver.Shared;

public record GameStateDto(
    GamePhase Phase,
    string RoomCode,
    IReadOnlyList<PlayerDto> Players,
    string GameType
);
