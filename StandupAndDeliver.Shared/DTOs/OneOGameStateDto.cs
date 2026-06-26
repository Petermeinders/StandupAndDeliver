namespace StandupAndDeliver.Shared;

public record OneOCardDto(int Id, string Color, string Type, int Value);

public record OneOGameStateDto(
    string Phase,
    string RoomCode,
    IReadOnlyList<PlayerDto> Players,
    IReadOnlyList<OneOCardDto> MyHand,
    OneOCardDto? TopDiscard,
    string CurrentColor,
    string CurrentPlayerName,
    int DrawPileCount,
    IReadOnlyDictionary<string, int> PlayerHandCounts,
    bool Clockwise,
    string? LastAction,
    string? WinnerName
);
