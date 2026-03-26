# Story 6.3: Detect End of Round & Transition to Final Results

## Status: Done

## Story
As a **player**, I want the game to automatically detect when all players have taken their turn, so that the session concludes and final standings are shown.

## Acceptance Criteria
- Given the host advances from Reveal and all players have had a turn, then the server transitions to `GameOver`.
- Given `Phase == GameOver`, when all clients receive `GameStateDto`, then `Players` contains each player's final cumulative score.
- Given the transition to `GameOver`, when any client renders, then the final standings screen is shown.

## Implementation Notes
- `GameTimerService.AdvanceToNextTurnAsync()`: if `CurrentSpeakerIndex >= Players.Count` → `Phase = GameOver`
- `GameRoom.razor` routes `GameOver` → `GameOverView`
