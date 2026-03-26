# Story 2.2: Join Room by Code

Status: ready-for-dev

## Story

As a **player**,
I want to join an existing game room by entering a room code and my display name,
So that I can participate in a game my friend created.

## Acceptance Criteria

1. `JoinRoom(roomCode, playerName)` adds the caller to the room and returns `HubResult(true)`.
2. Invalid room code returns `HubResult(false, "Room not found or has expired.")`.
3. Empty/whitespace name returns `HubResult(false, "Player name is required.")`.
4. Joining a room that is not in Lobby phase returns `HubResult(false, "Game already in progress.")`.
5. Player name is HTML-encoded before storage.
6. On successful join, all clients in the room receive updated `GameStateDto`.
7. `dotnet build` succeeds with 0 errors.

## Tasks / Subtasks

- [ ] Task 1: Add `JoinRoom` to `GameRoomService` (AC: 2, 3, 4, 5)
  - [ ] Add `JoinRoom(roomCode, playerName, connectionId)` returning `(GameRoom room, HubResult result)`

- [ ] Task 2: Implement `GameHub.JoinRoom()` (AC: 1, 6)
  - [ ] Add `JoinRoom(string roomCode, string playerName)` to `GameHub.cs`
  - [ ] Broadcast updated `GameStateDto` to the full room group on success

- [ ] Task 3: Implement `GameHub.OnDisconnectedAsync()` (AC: 6)
  - [ ] Mark player `IsConnected = false` on disconnect, broadcast updated state

- [ ] Task 4: Verify build (AC: 7)

## Dev Notes

### `GameRoomService.JoinRoom()`

```csharp
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
```

### `GameHub.JoinRoom()`

```csharp
public async Task<HubResult> JoinRoom(string roomCode, string playerName)
{
    if (string.IsNullOrWhiteSpace(playerName))
        return new HubResult(false, "Player name is required.");

    var safeName = WebUtility.HtmlEncode(playerName.Trim());
    var (room, result) = gameRoomService.JoinRoom(roomCode.ToUpperInvariant(), safeName, Context.ConnectionId);
    if (!result.Success) return result;

    await Groups.AddToGroupAsync(Context.ConnectionId, room!.RoomCode);
    await Clients.Group(room.RoomCode).ReceiveGameState(BuildStateDto(room));
    return new HubResult(true);
}
```

### `OnDisconnectedAsync`

```csharp
public override async Task OnDisconnectedAsync(Exception? exception)
{
    // Find any room this connection belongs to
    foreach (var room in gameRoomService.GetAllRooms())
    {
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player is not null)
        {
            player.IsConnected = false;
            await Clients.Group(room.RoomCode).ReceiveGameState(BuildStateDto(room));
            break;
        }
    }
    await base.OnDisconnectedAsync(exception);
}
```

Add `GetAllRooms()` to `GameRoomService`: `public IEnumerable<GameRoom> GetAllRooms() => _rooms.Values;`

### Architecture Rules
- Broadcast full `GameStateDto` to group on every join/leave — never delta updates
- `SemaphoreSlim` lock not needed for simple `Players.Add` yet — needed for multi-step operations in later stories

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
