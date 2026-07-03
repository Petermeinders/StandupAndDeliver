namespace StandupAndDeliver.Models;

public enum DefendFortressPhase
{
    WavePlaying,
    WaveComplete,
    Shop,
    Countdown,
    GameOver
}

public class DefendFortressGameState
{
    public const int MaxFortressHp = 100;
    public const int BreachDamage = 8;
    /// <summary>HP/sec each enemy standing at the wall ("attacking" state) chips off the fortress —
    /// replaces the old instant-breach-on-contact behavior for ground marchers (real attack sprite
    /// supplied 2026-07-01). Multiple attackers stack additively.</summary>
    public const float WallAttackDps = 3f;

    public const float WorldWidth = 800f;
    public const float WorldHeight = 360f;
    public const float GroundOffset = 36f;
    public const float CastleOffset = 48f;
    /// <summary>Marchers are confined to the grass strip at the bottom of the landscape art (real
    /// bg supplied 2026-07-02) so they don't visibly walk through sky/clouds — roughly the bottom
    /// quarter of the world height, ending right at the ground line.</summary>
    public const float GrassBandHeight = WorldHeight * 0.25f;
    public const float Gravity = 820f;
    public const float TickSeconds = 0.05f; // 20 Hz
    /// <summary>Auto-release held enemies with no move input (clears stuck grabs).</summary>
    public const float HeldStaleSeconds = 2.5f;
    public const int CountdownSeconds = 3;

    public const int GoldPerFlingKill = 5;
    public const int GoldPerAutoKill = 3;

    public DefendFortressPhase Phase { get; set; } = DefendFortressPhase.WavePlaying;
    public string GameMode { get; set; } = "10"; // "10" | "50" | "100" | "endless"

    public int FortressHp { get; set; } = MaxFortressHp;
    public int FortressMaxHp { get; set; } = MaxFortressHp;
    public int Wave { get; set; } = 1;
    public int ServerTick { get; set; }
    public string? ResultMessage { get; set; }
    public float CountdownRemaining { get; set; }
    public bool IsPaused { get; set; }
    public string? PausedBy { get; set; }

    public int EnemiesToSpawn { get; set; }
    public int NextEnemyId { get; set; } = 1;
    public float SpawnTimer { get; set; }

    public float ArcherFireAccumulator { get; set; }
    public float SoldierFireAccumulator { get; set; }
    public float BallistaFireAccumulator { get; set; }

    // ---- Phase 3 (experimental) — Artillery view, epic §14 ----
    public const float SlingshotBaseCooldown = 1.2f;
    public const int GoldPerArtilleryKill = 5;
    public const int GoldPerArtilleryCombo = 10;

    public string? ArtilleryPlayerName { get; set; }
    public float ArtilleryCooldownRemaining { get; set; }
    public int NextDiscId { get; set; } = 1;
    public List<DefendFortressDisc> Discs { get; set; } = [];

    public List<DefendFortressEnemy> Enemies { get; set; } = [];
    public Dictionary<string, DefendFortressPlayerState> Players { get; set; } = new();

    public static int VictoryWave(string gameMode) => gameMode switch
    {
        "10" => 10,
        "50" => 50,
        "100" => 100,
        _ => 0 // endless / unknown: no victory wave
    };

    /// <summary>Sum of a given upgrade's tier across all players — drives shared castle effects.</summary>
    public int AggregateUpgrade(string upgradeId) =>
        Players.Values.Sum(p => p.Upgrades.GetValueOrDefault(upgradeId));

    public IEnumerable<string> ActivePlayerNames() =>
        Players.Where(kv => !kv.Value.IsSpectator).Select(kv => kv.Key);
}

public class DefendFortressEnemy
{
    public int Id { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Vx { get; set; }
    public float Vy { get; set; }
    public string State { get; set; } = "march";
    public string? HeldBy { get; set; }
    public float MarchSpeed { get; set; }
    public float Wobble { get; set; }
    public float Rotation { get; set; }
    public float Spin { get; set; }
    public string? LastTouchedBy { get; set; }
    public int Hp { get; set; } = 1;
    public int MaxHp { get; set; } = 1;
    public string EnemyType { get; set; } = "grunt";
    /// <summary>Seconds since last grab/move while held — used for stale-hold timeout.</summary>
    public float HeldAge { get; set; }
    /// <summary>Fractional wall-damage carried between ticks while State == "attacking" (WallAttackDps
    /// is a rate, FortressHp is an int, so partial-point damage accrues here until it rolls over).</summary>
    public float AttackAccumulator { get; set; }
}

public class DefendFortressPlayerState
{
    public int Kills { get; set; }
    public int Breaches { get; set; }
    public int Flings { get; set; }
    public int Gold { get; set; }
    /// <summary>Separate economy from <see cref="Gold"/> — earned only from artillery direct hits (epic §14).</summary>
    public int ArtilleryGold { get; set; }
    public bool IsSpectator { get; set; }
    public bool Ready { get; set; }
    public Dictionary<string, int> Upgrades { get; set; } = new();
}

/// <summary>A fired slingshot disc (epic §14) — bounces off world edges, despawns on enemy hit or timeout.</summary>
public class DefendFortressDisc
{
    public int Id { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Vx { get; set; }
    public float Vy { get; set; }
    public int BouncesLeft { get; set; } = 6;
    public float Life { get; set; } = 4f;
    public string? FiredBy { get; set; }
}

/// <summary>Per-wave difficulty/reward parameters — epic §7 wave table, extrapolated past wave 10.</summary>
public readonly record struct DefendFortressWaveConfig(
    int QueuePerPlayer,
    int OnFieldCap,
    float SpawnInterval,
    float SpeedMultiplier,
    int EnemyHp,
    int GoldPool)
{
    private static readonly DefendFortressWaveConfig[] Table =
    [
        new(20, 12, 1.2f, 1.00f, 1, 200),
        new(24, 16, 1.1f, 1.05f, 1, 280),
        new(28, 20, 1.0f, 1.10f, 1, 360),
        new(32, 24, 0.95f, 1.15f, 2, 450),
        new(36, 28, 0.9f, 1.20f, 2, 550),
        new(40, 32, 0.85f, 1.25f, 2, 660),
        new(44, 38, 0.8f, 1.30f, 2, 780),
        new(48, 44, 0.75f, 1.35f, 3, 910),
        new(52, 48, 0.7f, 1.40f, 3, 1050),
        new(60, 50, 0.65f, 1.50f, 3, 1200),
    ];

    public static DefendFortressWaveConfig For(int wave)
    {
        if (wave <= 0) wave = 1;
        if (wave <= Table.Length) return Table[wave - 1];

        var over = wave - Table.Length;
        var last = Table[^1];
        return new DefendFortressWaveConfig(
            QueuePerPlayer: last.QueuePerPlayer + over * 4,
            OnFieldCap: last.OnFieldCap + over * 3,
            SpawnInterval: MathF.Max(0.2f, last.SpawnInterval - over * 0.02f),
            SpeedMultiplier: last.SpeedMultiplier + over * 0.02f,
            EnemyHp: 1 + (wave - 1) / 3,
            GoldPool: last.GoldPool + over * 150);
    }
}
