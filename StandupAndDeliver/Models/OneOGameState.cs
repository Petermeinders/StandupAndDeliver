namespace StandupAndDeliver.Models;

public class OneOGameState
{
    public List<OneOCard> DrawPile { get; set; } = [];
    public List<OneOCard> DiscardPile { get; set; } = [];
    public Dictionary<string, List<OneOCard>> PlayerHands { get; set; } = [];
    public int CurrentPlayerIndex { get; set; }
    public bool Clockwise { get; set; } = true;
    public OneOColor CurrentColor { get; set; }
    public string? WinnerName { get; set; }
    public string? LastAction { get; set; }
    public OneOCard? LastPlayedCard { get; set; }
    public bool NumbersOnly { get; set; }
    /// <summary>Host-dropped players — their hand is discarded and turn order skips their seat.
    /// Distinct from a disconnect: the game doesn't auto-skip an away player's turn on its own
    /// (it pauses, by design), this is only populated by an explicit host Drop action.</summary>
    public HashSet<string> DroppedPlayers { get; set; } = [];
}
