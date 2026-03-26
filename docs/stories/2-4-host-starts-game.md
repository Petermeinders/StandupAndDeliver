# Story 2.4: Host Starts Game

## Status: Done

## Story
As the **host**, I want to start the game once at least 3 players have joined, so that the session begins when the room is ready.

## Acceptance Criteria
- Given fewer than 3 connected players, when the host views the lobby, then the Start Game button is disabled and a "Need X more player(s)" message is shown.
- Given 3 or more connected players, when the host clicks Start Game, then `StartGame` is invoked on the hub.
- Given `StartGame` is called by a non-host, then the server returns `HubResult(false, "Only the host can start the game.")`.
- Given `StartGame` succeeds, then all clients receive `GameStateDto` with `Phase = SpeakerTurn`.

## Implementation Notes
- `GameHub.StartGame()` delegates to `GameRoomService.StartGame()` then `GameTimerService.StartTurnAsync()`
- `Index.razor` handles Create/Join forms; navigates to `/room?action=create` or `/room?action=join&code=XXXX`
- `GameRoom.razor` establishes hub connection on first render, dispatches phases via `@switch`
