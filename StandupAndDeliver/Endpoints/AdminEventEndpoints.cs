using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;

namespace StandupAndDeliver.Endpoints;

public static class AdminEventEndpoints
{
    public static void MapAdminEventEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/events", async (
            IDbContextFactory<AppDbContext> dbFactory,
            IConfiguration config,
            HttpContext ctx,
            int limit = 100) =>
        {
            var key = config["AdminKey"];
            if (string.IsNullOrEmpty(key) || ctx.Request.Headers["x-admin-key"] != key)
                return Results.Unauthorized();

            await using var db = await dbFactory.CreateDbContextAsync();
            var events = await db.GameEvents
                .OrderByDescending(e => e.OccurredAt)
                .Take(Math.Clamp(limit, 1, 500))
                .Select(e => new
                {
                    e.OccurredAt,
                    e.Event,
                    e.GameType,
                    e.RoomCode,
                    e.PlayerName,
                    e.PlayerCount
                })
                .ToListAsync();

            var summary = new
            {
                Total = await db.GameEvents.CountAsync(),
                RoomsCreated = await db.GameEvents.CountAsync(e => e.Event == "RoomCreated"),
                PlayersJoined = await db.GameEvents.CountAsync(e => e.Event == "PlayerJoined"),
                GamesStarted = await db.GameEvents.CountAsync(e => e.Event == "GameStarted"),
                Recent = events
            };

            return Results.Ok(summary);
        });
    }
}
