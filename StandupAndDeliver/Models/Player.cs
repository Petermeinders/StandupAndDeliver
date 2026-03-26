namespace StandupAndDeliver.Models;

public class Player
{
    public required string Name { get; set; }
    public required string ConnectionId { get; set; }
    public bool IsHost { get; set; }
    public bool IsConnected { get; set; } = true;
    public int Score { get; set; }
}
