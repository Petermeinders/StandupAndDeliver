# Story 2.5: Room Cleanup Service

## Status: Done

## Story
As a **developer**, I want inactive rooms to be automatically removed, so that the server doesn't accumulate stale state indefinitely.

## Acceptance Criteria
- Given a room's `LastActivity` is older than 2 hours, when the cleanup service runs, then the room is removed from `GameRoomService`.
- Given the cleanup service starts, when the server boots, then it runs on a 5-minute interval.
- Given a room is removed, when any client attempts a hub call with that room code, then the server returns an appropriate error.

## Implementation Notes
- `RoomCleanupService` : `BackgroundService` in `StandupAndDeliver/Services/`
- `GameRoomService.RemoveRoom(roomCode)` uses `ConcurrentDictionary.TryRemove`
- Registered via `builder.Services.AddHostedService<RoomCleanupService>()`
