# Story 4.4: Non-Active Player Waiting State

## Status: Done

## Story
As a **non-active player**, I want to see who is currently speaking and that a turn is in progress, so that I know what is happening and can prepare to vote.

## Acceptance Criteria
- Given `SpeakerTurn` phase, when a non-active player's screen renders, then the active speaker's name is shown clearly.
- Given `SpeakerTurn` phase, when a non-active player's screen renders, then the remaining time counts down in real time.
- Given `SpeakerTurn` phase, when a non-active player's screen renders, then no prompt card text is visible.

## Implementation Notes
- `WaitingView.razor` in `StandupAndDeliver.Client/Components/`
- Host also sees Skip Turn button in `WaitingView`
- `GameRoom.razor` routes: active speaker → `SpeakerView`, everyone else → `WaitingView`
