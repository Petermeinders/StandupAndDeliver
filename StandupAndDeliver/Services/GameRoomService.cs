using System.Collections.Concurrent;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Services;

public class GameRoomService
{
    private readonly ConcurrentDictionary<string, GameRoom> _rooms = new();
    // Key: "roomCode:playerName"
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _gracePeriods = new();
    private const string CodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    public (GameRoom Room, string RoomCode) CreateRoom(string playerName, string connectionId)
    {
        var code = GenerateUniqueCode();
        var player = new Player { Name = playerName, ConnectionId = connectionId, IsHost = true };
        var room = new GameRoom { RoomCode = code };
        room.Players.Add(player);
        _rooms[code] = room;
        return (room, code);
    }

    public (GameRoom? Room, HubResult Result) JoinRoom(string roomCode, string playerName, string connectionId)
    {
        var room = GetRoom(roomCode);
        if (room is null) return (null, new HubResult(false, "Room not found or has expired."));
        if (room.Phase != GamePhase.Lobby) return (null, new HubResult(false, "Game already in progress."));

        var player = new Player { Name = playerName, ConnectionId = connectionId };
        room.Players.Add(player);
        room.LastActivity = DateTime.UtcNow;
        return (room, new HubResult(true));
    }

    public GameRoom? GetRoom(string roomCode) =>
        _rooms.TryGetValue(roomCode.ToUpperInvariant(), out var room) ? room : null;

    public (GameRoom? Room, HubResult Result) StartGame(string roomCode, string connectionId)
    {
        var room = GetRoom(roomCode);
        if (room is null) return (null, new HubResult(false, "Room not found."));

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (player is null || !player.IsHost) return (null, new HubResult(false, "Only the host can start the game."));
        if (room.Phase != GamePhase.Lobby) return (null, new HubResult(false, "Game already started."));
        if (room.Players.Count(p => p.IsConnected) < 1) return (null, new HubResult(false, "At least 1 player is required to start."));

        room.Phase = GamePhase.SpeakerTurn;
        room.LastActivity = DateTime.UtcNow;
        return (room, new HubResult(true));
    }

    public IEnumerable<GameRoom> GetAllRooms() => _rooms.Values;

    public bool RemoveRoom(string roomCode) =>
        _rooms.TryRemove(roomCode.ToUpperInvariant(), out _);

    /// Starts a 30-second grace period; calls <paramref name="onExpired"/> if the player doesn't rejoin.
    public void StartGracePeriod(string roomCode, string playerName, Func<Task> onExpired)
    {
        var key = $"{roomCode}:{playerName}";
        var cts = new CancellationTokenSource();
        _gracePeriods[key] = cts;

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), cts.Token);
                if (!cts.Token.IsCancellationRequested)
                    await onExpired();
            }
            catch (OperationCanceledException) { }
            finally
            {
                _gracePeriods.TryRemove(key, out _);
                cts.Dispose();
            }
        });
    }

    public void CancelGracePeriod(string roomCode, string playerName)
    {
        var key = $"{roomCode}:{playerName}";
        if (_gracePeriods.TryRemove(key, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    public bool RoomExists(string roomCode) =>
        _rooms.ContainsKey(roomCode.ToUpperInvariant());

    private string GenerateUniqueCode()
    {
        string code;
        do
        {
            code = new string(Enumerable.Range(0, 4)
                .Select(_ => CodeChars[Random.Shared.Next(CodeChars.Length)])
                .ToArray());
        }
        while (_rooms.ContainsKey(code));
        return code;
    }
}
