# Story 5.1: Voting Screen

## Status: Done

## Story
As a **non-active player**, I want to submit a binary lie vote and an impressiveness rating during the voting phase, so that I can judge the speaker's performance.

## Acceptance Criteria
- Given `Voting` phase, when a non-active player's screen renders, then they see a "Lied / Didn't Lie" toggle and a 1–5 impressiveness picker.
- Given a player submits their vote, then both controls are required; submission is blocked if either is missing.
- Given `SubmitVote` is called, then the server returns `HubResult(true)` and records the vote.
- Given a player has already voted, when they attempt to submit again, then the server returns `HubResult(false, ...)` and the original vote is unchanged.
- Given the active speaker's client during `Voting` phase, then voting controls are not rendered.

## Implementation Notes
- `VotingView.razor` in `StandupAndDeliver.Client/Components/`
- Active speaker sees a waiting message with vote count instead of controls
- `_submitted` flag prevents showing controls after successful submission
