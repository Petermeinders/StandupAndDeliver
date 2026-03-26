# Story 6.1: Prompt Card Reveal

## Status: Done

## Story
As a **player**, I want to see the active speaker's prompt card after voting closes, so that I can discover the punchline and judge whether they were telling the truth.

## Acceptance Criteria
- Given the phase transitions to `Reveal`, when all clients receive `GameStateDto`, then `PromptCardText` is populated with the actual card text for all players.
- Given the Reveal screen renders, then the card text appears before any score information (FR24).
- Given the active speaker views the Reveal screen, then they see the same card they were shown during their turn.

## Implementation Notes
- `GameTimerService._activeCardText[roomCode]` stores the card text for the session
- `TransitionToRevealAsync()` passes `cardText` to `BuildStateDto()` for the group broadcast
- `RevealView.razor` renders the card in a yellow box at the top, scores below
