# Story 2.3: Live Lobby Player List

## Status: Done

## Story
As a **player in the lobby**, I want to see a live list of who has joined, so that I know who is in the room before the game starts.

## Acceptance Criteria
- Given a player joins a room, when the server processes the join, then all clients in the room receive an updated `GameStateDto` with the new player in the `Players` list.
- Given the lobby view renders, when `GameStateDto.Players` is received, then each player's name and connected/disconnected status is displayed.
- Given a player disconnects, when `OnDisconnectedAsync` fires, then all remaining clients see that player's status change to disconnected (greyed out).

## Implementation Notes
- `LobbyView.razor` in `StandupAndDeliver.Client/Components/`
- Connected indicator: green dot / grey dot via `player.IsConnected`
- Host badge rendered for `player.IsHost`
- `GameStateService` holds `State` and `PlayerName`; injected into `LobbyView`
