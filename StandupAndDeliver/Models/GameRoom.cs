using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Models;

public class GameRoom
{
    public required string RoomCode { get; set; }
    public List<Player> Players { get; set; } = [];
    public GamePhase Phase { get; set; } = GamePhase.Lobby;
    public SemaphoreSlim Lock { get; set; } = new(1, 1);
    public DateTime LastActivity { get; set; } = DateTime.UtcNow;
    public string GameType { get; set; } = "standup";
}
