namespace StandupAndDeliver.Shared;

public record RoomInfoPlayerDto(string Name, bool IsHost, bool IsConnected);

public record RoomInfoDto(
    string RoomCode,
    string GameType,
    string Phase,
    IReadOnlyList<RoomInfoPlayerDto> Players);
