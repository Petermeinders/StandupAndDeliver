namespace StandupAndDeliver.Models;

public enum OneOColor { Red, Green, Blue, Yellow, Wild }
public enum OneOCardType { Number, Skip, Reverse, DrawTwo, Wild, WildDrawFour }

public class OneOCard
{
    public int Id { get; set; }
    public OneOColor Color { get; set; }
    public OneOCardType Type { get; set; }
    public int Value { get; set; }

    public bool CanPlayOn(OneOCard top, OneOColor currentColor)
    {
        if (Type is OneOCardType.Wild or OneOCardType.WildDrawFour) return true;
        if (Color == currentColor) return true;
        if (Type == top.Type && Type != OneOCardType.Number) return true;
        if (Type == OneOCardType.Number && top.Type == OneOCardType.Number && Value == top.Value) return true;
        return false;
    }
}
