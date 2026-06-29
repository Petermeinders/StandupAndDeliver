using System.Collections.Concurrent;
using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Services;

public class GameRoomService
{
    private readonly ConcurrentDictionary<string, GameRoom> _rooms = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _gracePeriods = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _emptyRoomTimers = new();
    private const string CodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // ── Create / Join ─────────────────────────────────────────────────────────

    /// Creates a new room (with generated code) or joins an existing one.
    /// If <paramref name="requestedCode"/> is empty, a new code is generated.
    /// If a room with that code exists, the player joins it.
    /// If no room exists with that code, a new room is created with that code.
    public (GameRoom? Room, string RoomCode, bool Created, string? Error) CreateOrJoinRoom(
        string? requestedCode, string playerName, string connectionId,
        string gameType, bool useFunName)
    {
        // Normalize code
        var code = string.IsNullOrWhiteSpace(requestedCode)
            ? null
            : requestedCode.Trim().ToUpperInvariant();

        // If no code provided, generate one
        if (code is null)
            code = useFunName ? GenerateFunCode() : GenerateUniqueCode();

        // Existing room → join it
        if (_rooms.TryGetValue(code, out var existing))
        {
            CancelEmptyRoomTimer(code);
            var humanCount = existing.Players.Count(p => !p.IsBot);
            if (humanCount >= 8)
                return (null, code, false, "Room is full (max 8 players).");
            if (!existing.Players.Any(p => p.Name.Equals(playerName, StringComparison.OrdinalIgnoreCase)))
            {
                existing.Players.Add(new Player { Name = playerName, ConnectionId = connectionId });
                existing.LastActivity = DateTime.UtcNow;
            }
            // Second human joined — lobby bot no longer needed
            if (existing.Players.Count(p => !p.IsBot) >= 2)
                existing.Players.RemoveAll(p => p.IsBot);
            return (existing, code, false, null);
        }

        // New room — add a lobby bot placeholder so solo player sees a companion
        var player = new Player { Name = playerName, ConnectionId = connectionId, IsHost = true };
        var room = new GameRoom { RoomCode = code, GameType = gameType };
        room.Players.Add(player);
        room.Players.Add(new Player { Name = "🤖 Bot", ConnectionId = $"bot-{code}", IsBot = true, IsConnected = false });
        _rooms[code] = room;
        return (room, code, true, null);
    }

    public (GameRoom Room, string RoomCode) CreateRoom(string playerName, string connectionId, string gameType = "standup")
    {
        var code = GenerateUniqueCode();
        var player = new Player { Name = playerName, ConnectionId = connectionId, IsHost = true };
        var room = new GameRoom { RoomCode = code, GameType = gameType };
        room.Players.Add(player);
        _rooms[code] = room;
        return (room, code);
    }

    public (GameRoom? Room, HubResult Result) JoinRoom(string roomCode, string playerName, string connectionId)
    {
        var room = GetRoom(roomCode);
        if (room is null) return (null, new HubResult(false, "Room not found or has expired."));
        if (room.Phase != GamePhase.Lobby) return (null, new HubResult(false, "Game already in progress."));
        if (room.Players.Count(p => !p.IsBot) >= 8) return (null, new HubResult(false, "Room is full (max 8 players)."));
        if (room.Players.Any(p => p.Name.Equals(playerName, StringComparison.OrdinalIgnoreCase)))
            return (null, new HubResult(false, "That name is already taken in this room."));

        var player = new Player { Name = playerName, ConnectionId = connectionId };
        room.Players.Add(player);
        room.LastActivity = DateTime.UtcNow;
        // Second human joined — lobby bot no longer needed
        if (room.Players.Count(p => !p.IsBot) >= 2)
            room.Players.RemoveAll(p => p.IsBot);
        return (room, new HubResult(true));
    }

    public GameRoom? GetRoom(string roomCode) =>
        _rooms.TryGetValue(roomCode.ToUpperInvariant(), out var room) ? room : null;

    /// Reset room back to lobby after a game ends so the group can play again.
    public void ResetToLobby(GameRoom room)
    {
        room.Phase = GamePhase.Lobby;
        room.LastActivity = DateTime.UtcNow;
        room.Players.RemoveAll(p => p.IsBot);
    }

    public (GameRoom? Room, HubResult Result) StartGame(string roomCode, string connectionId)
    {
        var room = GetRoom(roomCode);
        if (room is null) return (null, new HubResult(false, "Room not found."));

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (player is null || !player.IsHost) return (null, new HubResult(false, "Only the host can start the game."));
        if (room.Phase != GamePhase.Lobby) return (null, new HubResult(false, "Game already started."));
        if (room.Players.Count(p => p.IsConnected) < 1) return (null, new HubResult(false, "At least 1 player is required to start."));

        // Mark as starting immediately so concurrent calls can't pass the Lobby check twice.
        room.Phase = GamePhase.Playing;
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

    // ── Empty-room expiry (5 minutes) ────────────────────────────────────────

    /// Start a 5-minute countdown to remove a room once all human players disconnect.
    public void StartEmptyRoomTimer(string roomCode)
    {
        var cts = new CancellationTokenSource();
        _emptyRoomTimers[roomCode] = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(5), cts.Token);
                if (!cts.Token.IsCancellationRequested)
                {
                    if (_rooms.TryGetValue(roomCode, out var r) &&
                        !r.Players.Any(p => p.IsConnected && !p.IsBot))
                        RemoveRoom(roomCode);
                }
            }
            catch (OperationCanceledException) { }
            finally
            {
                _emptyRoomTimers.TryRemove(roomCode, out _);
                cts.Dispose();
            }
        });
    }

    public void CancelEmptyRoomTimer(string roomCode)
    {
        if (_emptyRoomTimers.TryRemove(roomCode, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    // ── Code generation ───────────────────────────────────────────────────────

    private string GenerateFunCode()
    {
        var available = Models.FunRoomNames.Names
            .Where(n => !_rooms.ContainsKey(n.ToUpperInvariant()))
            .ToList();
        return available.Count > 0
            ? available[Random.Shared.Next(available.Count)].ToUpperInvariant()
            : GenerateUniqueCode();
    }

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
