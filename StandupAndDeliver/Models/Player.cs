namespace StandupAndDeliver.Models;

public class Player
{
    public required string Name { get; set; }
    public required string ConnectionId { get; set; }
    public bool IsHost { get; set; }
    public bool IsConnected { get; set; } = true;
    public int Score { get; set; }
    public bool IsBot { get; set; }

    /// <summary>Generic lobby-time role preference, set before a game starts. Currently only
    /// consumed by defend-fortress ("artillery" — epic §14/Q18 lobby-time seat pre-pick); other
    /// games ignore it. Kept on Player rather than a game-specific bag so any game can reuse the
    /// same "pick your seat before start" pattern without new plumbing.</summary>
    public string? PreferredRole { get; set; }

    /// <summary>Set by the explicit "Leave Game" action — distinct from <see cref="IsConnected"/>.
    /// The player stays connected to the room/SignalR group and keeps receiving live state, but is
    /// treated like a spectator by every game's active-roster/turn-order logic until they resume
    /// (which clears this). "Leave Room" is the other tier — that removes the player outright rather
    /// than setting this flag.</summary>
    public bool AwayFromGame { get; set; }
}
