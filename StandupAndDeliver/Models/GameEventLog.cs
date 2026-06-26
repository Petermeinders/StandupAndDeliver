namespace StandupAndDeliver.Models;

public class GameEventLog
{
    public int Id { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public string Event { get; set; } = "";      // "RoomCreated" | "PlayerJoined" | "GameStarted"
    public string GameType { get; set; } = "";
    public string RoomCode { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public int PlayerCount { get; set; }
}
