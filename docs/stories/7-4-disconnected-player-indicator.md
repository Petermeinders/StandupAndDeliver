# Story 7.4: Disconnected Player Indicator for Host

## Status: Done

## Story
As a **host**, I want to see when a player has disconnected, so that I know whether to wait for them or continue the session.

## Acceptance Criteria
- Given a player's connection drops, when `OnDisconnectedAsync` fires, then `IsConnected = false` and all clients receive the updated `GameStateDto`.
- Given the host's screen renders with a disconnected player, then that player's name is visually greyed out with a grey dot indicator.
- Given a disconnected player rejoins, then `IsConnected` returns to `true` and the indicator clears for all clients.

## Implementation Notes
- `LobbyView.razor` already renders connected status: green dot + white name vs grey dot + grey name
- `OnDisconnectedAsync` in `GameHub` sets `player.IsConnected = false` and broadcasts updated state
- `RejoinRoom` sets `player.IsConnected = true` and broadcasts to group
