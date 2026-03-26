# Story 5.3: Auto-Advance After All Votes

## Status: Done

## Story
As a **player**, I want the game to advance automatically once all votes are submitted, so that the game keeps moving without manual intervention.

## Acceptance Criteria
- Given `VotesSubmitted == VotesTotal`, when the last vote arrives, then the server immediately transitions to `Reveal`.
- Given not all players have voted and the voting window closes, then the server transitions to `Reveal` after 30 seconds.
- Given the phase transitions to `Reveal`, then all clients receive the updated `GameStateDto` within 500ms.

## Implementation Notes
- `GameTimerService.OnVoteSubmittedAsync()` checks `submitted >= eligible` → calls `TransitionToRevealAsync()`
- 30-second `RunVotingTimerAsync()` starts when `TransitionToVotingAsync()` is called
- Voting window CTS stored in `_voteTimers[roomCode]`; cancelled on full vote completion
