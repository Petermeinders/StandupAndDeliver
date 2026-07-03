using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;

namespace StandupAndDeliver.Endpoints;

public static class StatsEndpoints
{
    private static readonly TimeSpan ActiveWindow = TimeSpan.FromMinutes(30);

    public static void MapStatsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/stats/active-players", async (IDbContextFactory<AppDbContext> dbFactory) =>
        {
            await using var db = await dbFactory.CreateDbContextAsync();
            var since = DateTime.UtcNow - ActiveWindow;

            var uniquePlayers = await db.GameEvents
                .Where(e => e.OccurredAt >= since && e.PlayerName != "")
                .Select(e => e.PlayerName)
                .Distinct()
                .CountAsync();

            return Results.Ok(new { uniquePlayers, windowMinutes = (int)ActiveWindow.TotalMinutes });
        });
    }
}
