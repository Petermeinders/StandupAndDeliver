# Story 2.1: Create Room & Generate Room Code

Status: ready-for-dev

## Story

As a **player**,
I want to create a new game room and receive a unique 4-letter room code,
So that I can share the code with friends and have them join my game.

## Acceptance Criteria

1. Calling `CreateRoom(playerName)` on the hub creates a room, adds the caller as host, and returns `HubResult` with `Success = true`.
2. The returned room code is a 4-letter uppercase alphabetic string (A–Z only).
3. The server verifies the generated code is not already in use before assigning it.
4. After `CreateRoom` succeeds, the caller is added to the SignalR group for that room code and receives a `GameStateDto` with `Phase = Lobby` and themselves in `Players`.
5. `dotnet build` succeeds with 0 errors.

## Tasks / Subtasks

- [ ] Task 1: Create server-side domain models (AC: 1)
  - [ ] Create `StandupAndDeliver/Models/Player.cs` — server-side player (Name, ConnectionId, IsHost, IsConnected, Score)
  - [ ] Create `StandupAndDeliver/Models/GameRoom.cs` — server-side room (RoomCode, Players, Phase, Lock, LastActivity)

- [ ] Task 2: Create `GameRoomService` (AC: 2, 3)
  - [ ] Create `StandupAndDeliver/Services/GameRoomService.cs` with `ConcurrentDictionary<string, GameRoom>` and `CreateRoom()` method
  - [ ] Room code generation: random 4 uppercase letters, collision-checked

- [ ] Task 3: Implement `GameHub.CreateRoom()` (AC: 1, 4)
  - [ ] Add `CreateRoom(string playerName)` to `GameHub.cs`
  - [ ] Register caller in SignalR group, send `GameStateDto` to caller

- [ ] Task 4: Register services in `Program.cs` (AC: 5)
  - [ ] Register `GameRoomService` as singleton

- [ ] Task 5: Verify build (AC: 5)
  - [ ] `dotnet build` — 0 errors

## Dev Notes

### Server-Side Models (not DTOs)

Models live in `StandupAndDeliver/Models/` — these are internal server domain objects, not shared with the client.

```csharp
// Models/Player.cs
namespace StandupAndDeliver.Models;

public class Player
{
    public required string Name { get; set; }
    public required string ConnectionId { get; set; }
    public bool IsHost { get; set; }
    public bool IsConnected { get; set; } = true;
    public int Score { get; set; }
}
```

```csharp
// Models/GameRoom.cs
namespace StandupAndDeliver.Models;

public class GameRoom
{
    public required string RoomCode { get; set; }
    public List<Player> Players { get; set; } = [];
    public GamePhase Phase { get; set; } = GamePhase.Lobby;
    public SemaphoreSlim Lock { get; set; } = new(1, 1);
    public DateTime LastActivity { get; set; } = DateTime.UtcNow;
    public int CurrentSpeakerIndex { get; set; }
    public HashSet<int> UsedCardIds { get; set; } = [];
    public Dictionary<string, (bool Lied, int Impressiveness)> CurrentTurnVotes { get; set; } = [];
    public int? ActiveCardId { get; set; }
}
```

### `GameRoomService`

```csharp
namespace StandupAndDeliver.Services;

public class GameRoomService
{
    private readonly ConcurrentDictionary<string, GameRoom> _rooms = new();
    private static readonly Random _rng = Random.Shared;

    public (GameRoom Room, string RoomCode)? CreateRoom(string playerName, string connectionId)
    {
        var code = GenerateUniqueCode();
        var player = new Player { Name = playerName, ConnectionId = connectionId, IsHost = true };
        var room = new GameRoom { RoomCode = code };
        room.Players.Add(player);
        _rooms[code] = room;
        return (room, code);
    }

    public GameRoom? GetRoom(string roomCode) =>
        _rooms.TryGetValue(roomCode, out var room) ? room : null;

    private string GenerateUniqueCode()
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        string code;
        do { code = new string(Enumerable.Range(0, 4).Select(_ => chars[_rng.Next(chars.Length)]).ToArray()); }
        while (_rooms.ContainsKey(code));
        return code;
    }
}
```

### `GameHub.CreateRoom()`

```csharp
public async Task<HubResult> CreateRoom(string playerName)
{
    if (string.IsNullOrWhiteSpace(playerName))
        return new HubResult(false, "Player name is required.");

    var result = _gameRoomService.CreateRoom(
        WebUtility.HtmlEncode(playerName.Trim()), Context.ConnectionId);

    if (result is null) return new HubResult(false, "Failed to create room.");

    var (room, code) = result.Value;
    await Groups.AddToGroupAsync(Context.ConnectionId, code);
    await Clients.Caller.ReceiveGameState(BuildStateDto(room, Context.ConnectionId));
    return new HubResult(true);
}
```

### `BuildStateDto` Helper

`GameHub` needs a private helper to build `GameStateDto` from `GameRoom`. `PromptCardText` is always null here (lobby phase):

```csharp
private static GameStateDto BuildStateDto(GameRoom room, string? callerConnectionId = null)
{
    var players = room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected)).ToList();
    return new GameStateDto(
        Phase: room.Phase,
        RoomCode: room.RoomCode,
        Players: players,
        ActivePlayerName: null,
        SecondsRemaining: null,
        PromptCardText: null,
        VotesSubmitted: 0,
        VotesTotal: 0,
        LastTurnResult: null
    );
}
```

### Architecture Rules
- `GameRoomService` registered as **singleton** — room state must survive across requests
- `WebUtility.HtmlEncode` player names before storing (NFR-S2) — add `using System.Net;`
- `HubResult` always returned — never void hub methods

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
