# Story 5.2: Vote Count Indicator

## Status: Done

## Story
As a **player**, I want to see how many votes have been submitted without seeing their content, so that I know when voting is nearly complete without being influenced by others.

## Acceptance Criteria
- Given any player submits a vote, then all clients receive `ReceiveVoteCount(submitted, total)`.
- Given `GameStateDto` is received during `Voting` phase, then "X of Y votes submitted" is displayed.
- Given the vote count updates, then the voting controls remain interactive and the page does not freeze (NFR-P5).

## Implementation Notes
- `GameTimerService.OnVoteSubmittedAsync()` calls `hubContext.Clients.Group().ReceiveVoteCount()`
- `GameStateService.UpdateVoteCount()` updates `State` via `with` expression (record mutation)
- `GameRoom.razor` hooks `ReceiveVoteCount` → `GameState.UpdateVoteCount` → `StateHasChanged`
