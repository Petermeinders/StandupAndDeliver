using Microsoft.EntityFrameworkCore;

namespace StandupAndDeliver.Data;

public static class DatabaseInitializer
{
    public static async Task InitializeAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();
        await EnsureGameEventsTableAsync(db);
    }

    /// <summary>
    /// EnsureCreated does not add tables to an existing database; apply new tables here.
    /// </summary>
    private static async Task EnsureGameEventsTableAsync(AppDbContext db)
    {
        if (db.Database.IsSqlite())
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS "GameEvents" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_GameEvents" PRIMARY KEY AUTOINCREMENT,
                    "OccurredAt" TEXT NOT NULL,
                    "Event" TEXT NOT NULL,
                    "GameType" TEXT NOT NULL,
                    "RoomCode" TEXT NOT NULL,
                    "PlayerName" TEXT NOT NULL,
                    "PlayerCount" INTEGER NOT NULL
                );
                """);
            return;
        }

        if (db.Database.IsNpgsql())
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS "GameEvents" (
                    "Id" serial PRIMARY KEY,
                    "OccurredAt" timestamptz NOT NULL,
                    "Event" text NOT NULL,
                    "GameType" text NOT NULL,
                    "RoomCode" text NOT NULL,
                    "PlayerName" text NOT NULL,
                    "PlayerCount" integer NOT NULL
                );
                """);
        }
    }
}
