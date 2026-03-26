# Story 7.2: iOS Safari visibilitychange Reconnect Hook

## Status: Done

## Story
As a **player on iOS Safari**, I want the app to detect when I return from a locked screen and trigger reconnection, so that screen-locking my phone does not permanently drop me from the game.

## Acceptance Criteria
- Given `game-interop.js` is loaded, when `visibilitychange` fires with `visibilityState === 'visible'`, then `VisibilityInterop.OnVisibilityRestored` is invoked via JS interop.
- Given `OnVisibilityRestored` fires and the hub is `Disconnected` or `Reconnecting`, then a manual reconnect is attempted followed by `RejoinRoom`.
- Given the component is disposed, then the JS event listener is removed to prevent memory leaks.

## Implementation Notes
- `game-interop.js` in `StandupAndDeliver/wwwroot/` — loaded via `<script>` in `App.razor`
- `VisibilityInterop.cs` in `StandupAndDeliver.Client/Services/` — `[JSInvokable]` method, `IAsyncDisposable`
- `DotNetObjectReference<VisibilityInterop>` passed to JS; disposed in `DisposeAsync`
- `GameRoom.razor` creates and registers `VisibilityInterop` after hub connection established
