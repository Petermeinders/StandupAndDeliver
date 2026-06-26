using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Services;

public class EventLogService(IDbContextFactory<AppDbContext> dbFactory)
{
    public async Task LogAsync(string eventName, string gameType, string roomCode, string playerName, int playerCount)
    {
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync();
            db.GameEvents.Add(new GameEventLog
            {
                Event = eventName,
                GameType = gameType,
                RoomCode = roomCode,
                PlayerName = playerName,
                PlayerCount = playerCount
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Non-critical — don't let logging failures affect gameplay
            Console.WriteLine($"[EventLog] Failed to write event: {ex.Message}");
        }
    }
}
