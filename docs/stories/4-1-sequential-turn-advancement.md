# Story 4.1: Sequential Turn Advancement

## Status: Done

## Story
As a **player**, I want the game to advance through each player's turn in order, so that every player gets exactly one turn as the active speaker per round.

## Acceptance Criteria
- Given the game transitions to `SpeakerTurn`, when the first turn begins, then the first player in the room's player list is the active speaker.
- Given a turn completes, when the server advances, then the next player in sequence becomes the active speaker.
- Given `GameStateDto` is broadcast during `SpeakerTurn`, then `ActivePlayerName` is set to the current speaker's name.
- Given all players have completed their turns, when the last turn ends, then the server transitions to `GameOver`.

## Implementation Notes
- `GameRoom.CurrentSpeakerIndex` incremented in `GameTimerService.AdvanceToNextTurnAsync()`
- `GameOverView.razor` shown when `Phase == GameOver`
- Index bounds check: if `CurrentSpeakerIndex >= Players.Count` → `GameOver`
