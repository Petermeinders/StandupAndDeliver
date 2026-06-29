namespace StandupAndDeliver.Shared;

public record HubResult(bool Success, string? Error = null, string? RoomCode = null);
public record HubResult<T>(bool Success, T? Data = default, string? Error = null) : HubResult(Success, Error);
