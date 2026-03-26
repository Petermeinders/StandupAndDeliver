# Story 7.3: Rejoin In-Progress Session

## Status: Done

## Story
As a **player**, I want to rejoin a game that is already in progress by entering my room code, so that I can return to the game after a longer absence or browser refresh.

## Acceptance Criteria
- Given a player navigates to home and enters their room code + original name, then `RejoinRoom` is invoked.
- Given `RejoinRoom` is called and the name matches a player in the room, then the player is reconnected, added to the SignalR group, and receives full `GameStateDto`.
- Given the name does not match any player, then `HubResult(false, ...)` is returned.
- Given the player rejoins, then `IsConnected` is set to `true` and all clients see the indicator update.

## Implementation Notes
- `GameHub.RejoinRoom(roomCode, playerName)` — matches by HTML-encoded name, updates `ConnectionId`
- Rejoining active speaker during `SpeakerTurn` receives their card text via `GameTimerService.GetActiveCardTextAsync()`
- `Index.razor` "Join" flow doubles as rejoin — server distinguishes new join (Lobby only) vs rejoin (any phase)
