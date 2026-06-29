namespace StandupAndDeliver.Shared;

public record CursedVaultGameStateDto(
    string Phase,
    int Round,
    string CurrentPlayerName,
    int MyGold,
    bool MyHasSkull,
    int PileCount,
    bool IsMyTurn,
    bool IsRoundOne,
    bool AwaitingMyCardPlay,
    ActiveGambleDto? ActiveGamble,
    IReadOnlyList<CursedVaultPlayerDto> Players,
    CursedVaultLastTurnDto? LastTurnSummary,
    string? WinnerName
);

public record ActiveGambleDto(
    string PlayerName,
    int Declared,
    int FlipsSoFar,
    int GoldCollectedSoFar,
    string? LastFlippedCard
);

public record CursedVaultPlayerDto(
    string Name,
    int Gold,
    bool IsEliminated,
    bool IsConnected,
    bool IsCurrentPlayer
);

public record CursedVaultLastTurnDto(
    string PlayerName,
    string Action,
    int GoldGained,
    bool SkullLost,
    bool Eliminated
);
