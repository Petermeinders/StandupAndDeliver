namespace StandupAndDeliver.Shared;

public record PlayerDto(
    string Name,
    int Score,
    bool IsHost,
    bool IsConnected,
    bool IsBot = false,
    string? PreferredRole = null,
    bool AwayFromGame = false
);
