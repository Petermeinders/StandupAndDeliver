namespace StandupAndDeliver.Services;

public class RoomCleanupService(GameRoomService gameRoomService, ILogger<RoomCleanupService> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MaxIdleAge = TimeSpan.FromHours(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Room cleanup service started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(Interval, stoppingToken);
            CleanupStaleRooms();
        }
    }

    private void CleanupStaleRooms()
    {
        var cutoff = DateTime.UtcNow - MaxIdleAge;
        var removed = 0;

        foreach (var room in gameRoomService.GetAllRooms())
        {
            if (room.LastActivity < cutoff)
            {
                if (gameRoomService.RemoveRoom(room.RoomCode))
                    removed++;
            }
        }

        if (removed > 0)
            logger.LogInformation("Cleaned up {Count} stale room(s).", removed);
    }
}
