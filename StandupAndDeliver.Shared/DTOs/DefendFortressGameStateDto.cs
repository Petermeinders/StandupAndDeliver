namespace StandupAndDeliver.Shared;

public record DefendFortressEnemyDto(
    int Id,
    float X,
    float Y,
    float Vx,
    float Vy,
    string State,
    string? HeldBy,
    float Rotation);

public record DefendFortressPlayerDto(
    string Name,
    int Kills,
    int Breaches,
    bool IsConnected);

public record DefendFortressGameStateDto(
    string Phase,
    int FortressHp,
    int MaxFortressHp,
    int TotalEnemiesRemaining,
    int ActiveEnemyCount,
    int Wave,
    int ServerTick,
    long ServerTimeMs,
    float WorldWidth,
    float WorldHeight,
    IReadOnlyList<DefendFortressEnemyDto> Enemies,
    IReadOnlyList<DefendFortressPlayerDto> Players,
    string? ResultMessage);
