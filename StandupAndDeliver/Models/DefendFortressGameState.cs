namespace StandupAndDeliver.Models;

public class DefendFortressGameState
{
    public const int MaxFortressHp = 100;
    public const int EnemiesPerPlayer = 20;
    public const int BreachDamage = 8;

    public const float WorldWidth = 800f;
    public const float WorldHeight = 360f;
    public const float GroundOffset = 36f;
    public const float CastleOffset = 48f;
    public const float Gravity = 820f;
    public const int MaxOnScreen = 8;
    public const float SpawnInterval = 1.2f;
    public const float TickSeconds = 0.05f; // 20 Hz
    /// <summary>Auto-release held enemies with no move input (clears stuck grabs).</summary>
    public const float HeldStaleSeconds = 2.5f;

    public int FortressHp { get; set; } = MaxFortressHp;
    public int Wave { get; set; } = 1;
    public int ServerTick { get; set; }
    public string? ResultMessage { get; set; }

    public int EnemiesToSpawn { get; set; }
    public int NextEnemyId { get; set; } = 1;
    public float SpawnTimer { get; set; }

    public List<DefendFortressEnemy> Enemies { get; set; } = [];
    public Dictionary<string, DefendFortressPlayerState> Players { get; set; } = new();
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
    /// <summary>Seconds since last grab/move while held — used for stale-hold timeout.</summary>
    public float HeldAge { get; set; }
}

public class DefendFortressPlayerState
{
    public int Kills { get; set; }
    public int Breaches { get; set; }
}
