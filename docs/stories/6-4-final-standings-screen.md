# Story 6.4: Final Standings Screen

## Status: Done

## Story
As a **player**, I want to see the final standings with all players' scores at the end of the round, so that the winner is clear and the game has a satisfying conclusion.

## Acceptance Criteria
- Given `GameOver` phase, when the final standings screen renders, then all players are listed in descending score order with name and total score.
- Given two players have equal scores, then they are displayed at the same rank position.
- Given the screen renders, then the current player's own name is highlighted in yellow.
- Given the host views the screen, then a "Back to Home" button is available.

## Implementation Notes
- `GameOverView.razor` in `StandupAndDeliver.Client/Components/`
- Rank calculated by tracking `prevScore` — tied players share the same rank number
- "Back to Home" calls `GameState.Clear()` and `Nav.NavigateTo("/")`
