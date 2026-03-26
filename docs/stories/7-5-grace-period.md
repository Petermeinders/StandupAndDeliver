# Story 7.5: Grace Period Before Session Continues

## Status: Done

## Story
As a **player**, I want the game to wait briefly for a disconnected player before continuing without them, so that a short disconnect does not permanently remove someone from the session.

## Acceptance Criteria
- Given a player disconnects during an active session, when `OnDisconnectedAsync` fires, then a 30-second grace period timer starts.
- Given the player rejoins within 30 seconds, then the grace period is cancelled and the session continues normally.
- Given the 30-second grace period expires without rejoin, then the session continues (player marked inactive, not removed from standings).
- Given the disconnected player was the active speaker and the grace period expires during `SpeakerTurn`, then the turn is auto-skipped (NFR-R4).

## Implementation Notes
- `GameRoomService.StartGracePeriod(roomCode, playerName, onExpired)` — `Task.Delay(30s, cts.Token)` in background task
- `GameRoomService.CancelGracePeriod(roomCode, playerName)` — called from `GameHub.RejoinRoom()`
- Grace period key: `"roomCode:playerName"` in `ConcurrentDictionary<string, CancellationTokenSource>`
- Auto-skip: `onExpired` callback checks `wasActiveSpeaker && room.Phase == SpeakerTurn` → `gameTimerService.SkipTurnAsync()`
