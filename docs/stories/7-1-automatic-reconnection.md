# Story 7.1: Automatic Reconnection with WithAutomaticReconnect

## Status: Done

## Story
As a **player**, I want the app to attempt reconnection automatically after a brief disconnection, so that a momentary network hiccup does not remove me from the game.

## Acceptance Criteria
- Given `HubConnectionBuilder` is constructed, then `WithAutomaticReconnect([0s, 2s, 5s, 10s])` is applied.
- Given SignalR successfully reconnects, then the `Reconnected` callback fires and invokes `RejoinRoom`.
- Given `RejoinRoom` is invoked, then the player is re-added to their SignalR group and receives full state sync.
- Given a player reconnects, then other players are not disconnected or disrupted (NFR-R2).

## Implementation Notes
- `GameRoom.razor`: `WithAutomaticReconnect` with explicit intervals, `Reconnected` callback calls `RejoinRoom`
- `Reconnecting` callback sets `_reconnecting = true` → yellow "Reconnecting…" banner shown
- `Closed` callback clears `_reconnecting`
