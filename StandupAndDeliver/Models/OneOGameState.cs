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
}
