using StandupAndDeliver.Services;

namespace StandupAndDeliver.Endpoints;

public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this WebApplication app)
    {
        app.MapGet("/api/rooms/{code}/info", (string code, GameRoomService roomService) =>
        {
            var room = roomService.GetRoom(code.ToUpperInvariant());
            if (room is null) return Results.NotFound();
            return Results.Ok(new { GameType = room.GameType });
        });
    }
}
