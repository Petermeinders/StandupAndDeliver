# Story 5.4: Score Calculation & Accumulation

## Status: Done

## Story
As a **player**, I want my score to be calculated and accumulated fairly after each turn, so that the final standings reflect the quality of every player's performance.

## Acceptance Criteria
- Given a strict majority voted "Lied", then the active speaker's turn score is 0.
- Given no majority lie, then turn score = average impressiveness × 10 (rounded to nearest int).
- Given a turn result is calculated, then it is added to `Player.Score` in `GameRoom` state.
- Given concurrent vote submissions, then `SemaphoreSlim(1,1)` per room ensures no data corruption (NFR-SC3).
- Given `TurnResultDto` is populated, then it contains: `ActivePlayerName`, `PromptCardText`, `LiedVoteCount`, `TotalVoteCount`, `ImpressionScore`, `TurnScore`.

## Implementation Notes
- Scoring in `GameTimerService.TransitionToRevealAsync()`
- `room.Lock.WaitAsync()` / `room.Lock.Release()` wraps vote write in `GameHub.SubmitVote()`
- `TurnResultDto` passed to `BuildStateDto()` as `lastTurnResult` parameter
- `ImpressionScore` stored as `double` rounded to 1 decimal; `TurnScore` is `int`
