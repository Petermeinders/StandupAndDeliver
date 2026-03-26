# Story 6.2: Turn Results Display

## Status: Done

## Story
As a **player**, I want to see the full vote breakdown and impressiveness score after each turn, so that I understand how the speaker was judged before the game moves on.

## Acceptance Criteria
- Given the Reveal phase, when the results screen renders, then: prompt card text, speaker name, lie vote count vs total, impressiveness score, and turn score are all shown.
- Given a majority lie was detected, then the UI clearly indicates 0 points with a "lie penalty" label.
- Given the host views the Reveal screen, then a "Next Turn" or "See Final Results" button is present.
- Given the host clicks "Next Turn" with remaining players, then the server transitions to `SpeakerTurn` for the next player.

## Implementation Notes
- `RevealView.razor` in `StandupAndDeliver.Client/Components/`
- "Next Turn" vs "See Final Results" label determined by comparing `ActivePlayerName` index to `Players.Count - 1`
- `AdvanceTurnFunc` → `GameHub.AdvanceTurn()` → `GameTimerService.AdvanceToNextTurnAsync()`
