# Story 4.2: Private Prompt Card Dual Broadcast

## Status: Done

## Story
As an **active speaker**, I want to see my assigned prompt card privately, so that other players cannot read the card and must judge my delivery honestly.

## Acceptance Criteria
- Given a turn begins, when the server broadcasts to the room group, then `PromptCardText` is `null` in the group broadcast.
- Given a turn begins, when the server sends to the active speaker's connection, then that `GameStateDto` contains the actual `PromptCardText`.
- Given a non-active player receives `GameStateDto` during `SpeakerTurn`, then `PromptCardText` is null and no card text is rendered.
- Given the active speaker's client renders, then the prompt card text is displayed prominently.

## Implementation Notes
- `GameTimerService.StartTurnAsync()` uses `Clients.GroupExcept()` for group and `Clients.Client()` for speaker
- `SpeakerView.razor` displays the card; `WaitingView.razor` shows no card text
- `GameRoom.razor` routes based on `State.ActivePlayerName == GameState.PlayerName`
