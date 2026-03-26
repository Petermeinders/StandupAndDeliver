# Story 3.2: Seed 50+ Unique Prompt Cards

## Status: Done

## Story
As a **game designer**, I want at least 50 unique prompt cards in the database at first run, so that players have enough variety for a full session without repetition.

## Acceptance Criteria
- Given `SeedData.SeedAsync()` runs on a fresh database, then at least 50 distinct prompt card records exist.
- Given any two cards are compared, then no two have identical prompt text.
- Given a prompt card record, then it contains: `Id` (int PK), `Text` (string required), `IsActive` (bool default true).

## Implementation Notes
- `SeedData.cs` in `StandupAndDeliver/Data/`
- 55 corporate-buzzword themed cards seeded
- Idempotent: skips entirely if `PromptCards` table already has rows
