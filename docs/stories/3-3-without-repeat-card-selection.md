# Story 3.3: Without-Repeat Card Selection

## Status: Done

## Story
As a **player**, I want the game to select a different prompt card for each turn within a session, so that no card is repeated during a single game.

## Acceptance Criteria
- Given a turn begins, when `PromptCardService.DrawCardAsync(usedCardIds)` is called, then a card is selected at random from active cards not in `usedCardIds`.
- Given a card is assigned to a turn, then its ID is added to `GameRoom.UsedCardIds` before broadcasting.
- Given all active cards have been used, when a new turn starts, then the server logs a warning and transitions to `GameOver` gracefully.

## Implementation Notes
- `PromptCardService.DrawCardAsync(HashSet<int> usedCardIds)` in `StandupAndDeliver/Services/`
- Uses `IDbContextFactory<AppDbContext>` for thread-safe async DB access
- `GameRoom.UsedCardIds` is a `HashSet<int>` tracking used card IDs per session
