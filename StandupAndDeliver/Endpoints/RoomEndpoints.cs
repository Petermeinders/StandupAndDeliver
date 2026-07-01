using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Endpoints;

public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this WebApplication app)
    {
        app.MapGet("/api/rooms/{code}/info", (string code, GameRoomService roomService) =>
        {
            var room = roomService.GetRoom(code);
            if (room is null) return Results.NotFound();
            var players = room.Players
                .Where(p => !p.IsBot)
                .Select(p => new RoomInfoPlayerDto(p.Name, p.IsHost, p.IsConnected))
                .ToList();
            return Results.Ok(new RoomInfoDto(
                room.RoomCode,
                room.GameType,
                room.Phase.ToString(),
                players));
        });
    }
}
