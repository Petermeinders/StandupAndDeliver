namespace StandupAndDeliver.Shared;

public record DefendFortressEnemyDto(
    int Id,
    float X,
    float Y,
    float Vx,
    float Vy,
    string State,
    string? HeldBy,
    float Rotation,
    int Hp,
    int MaxHp,
    string EnemyType);

public record DefendFortressDiscDto(
    int Id,
    float X,
    float Y,
    float Vx,
    float Vy,
    string? FiredBy);

public record DefendFortressPlayerDto(
    string Name,
    int Kills,
    int Breaches,
    int Flings,
    int Gold,
    int ArtilleryGold,
    bool IsConnected,
    bool IsSpectator,
    bool Ready,
    string Role, // "flinger" | "artillery" | "spectator"
    IReadOnlyDictionary<string, int> Upgrades);

public record DefendFortressWaveConfigDto(
    int Wave,
    int QueueRemaining,
    int OnFieldCap,
    float SpawnInterval,
    float SpeedMultiplier,
    int GoldPool);

public record DefendFortressGameStateDto(
    string Phase,
    string GameMode,
    int FortressHp,
    int FortressMaxHp,
    int MaxFortressHp,
    int TotalEnemiesRemaining,
    int ActiveEnemyCount,
    int Wave,
    int VictoryWave,
    int ServerTick,
    long ServerTimeMs,
    float WorldWidth,
    float WorldHeight,
    float CountdownRemaining,
    IReadOnlyList<DefendFortressEnemyDto> Enemies,
    IReadOnlyList<DefendFortressPlayerDto> Players,
    IReadOnlyDictionary<string, int> CastleUpgrades,
    DefendFortressWaveConfigDto WaveConfig,
    bool SaveExportAllowed,
    bool SaveImportAllowed,
    string? ArtilleryPlayerName,
    float ArtilleryCooldownRemaining,
    IReadOnlyList<DefendFortressDiscDto> Discs,
    IReadOnlyList<int> AirborneHighlightIds,
    bool IsPaused,
    string? PausedBy,
    string? ResultMessage);
