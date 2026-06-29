using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Models;

public enum CursedVaultCardType { Gold, Skull }

public class CursedVaultHand
{
    public int Gold { get; set; } = 5;
    public bool HasSkull { get; set; } = true;

    public int TotalCards => Gold + (HasSkull ? 1 : 0);
    public bool IsEmpty => TotalCards == 0;
}

public class CursedVaultActiveGamble
{
    public int Declared { get; set; }
    public List<CursedVaultCardType> FlippedCards { get; set; } = [];
    public int GoldCollectedSoFar => FlippedCards.Count(c => c == CursedVaultCardType.Gold);
    public bool AwaitingCardPlay { get; set; }
    public string? LastFlippedCard { get; set; }
}

public class CursedVaultGameState
{
    public int Round { get; set; } = 1;
    public int CurrentPlayerIndex { get; set; }
    public List<string> PlayerOrder { get; set; } = [];
    public Dictionary<string, CursedVaultHand> PlayerHands { get; set; } = new();
    public List<CursedVaultCardType> Pile { get; set; } = [];
    public CursedVaultActiveGamble? ActiveGamble { get; set; }
    public CursedVaultLastTurnDto? LastTurnSummary { get; set; }
    public string? WinnerName { get; set; }
    public List<string> EliminatedPlayers { get; set; } = [];
}
