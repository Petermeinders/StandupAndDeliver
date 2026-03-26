# Story 4.5: Host Skip Turn

## Status: Done

## Story
As a **host**, I want to skip the active speaker's turn, so that I can keep the game moving if a player is stuck or needs to pass.

## Acceptance Criteria
- Given `SpeakerTurn` phase, when the host invokes `SkipTurn`, then the server cancels the active timer and transitions to `Voting`.
- Given `SkipTurn` is called by a non-host, then the server returns `HubResult(false, "Only the host can skip a turn.")`.
- Given a non-host client during `SpeakerTurn`, then the skip control is not rendered.
- Given the host skips, when the phase transitions to `Voting`, then all clients receive the updated `GameStateDto` within 500ms.

## Implementation Notes
- `GameHub.SkipTurn()` validates host, calls `GameTimerService.SkipTurnAsync()`
- `SkipTurnAsync` cancels `_turnTimers[roomCode]` then calls `TransitionToVotingAsync`
- Skip button rendered in both `SpeakerView` and `WaitingView` only when `_isHost`
