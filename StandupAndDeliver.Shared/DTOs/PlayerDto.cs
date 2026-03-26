namespace StandupAndDeliver.Shared;

public record PlayerDto(
    string Name,
    int Score,
    bool IsHost,
    bool IsConnected
);
