# Story 3.1: EF Core + SQLite Data Layer

## Status: Done

## Story
As a **developer**, I want EF Core with SQLite configured and the database created on startup, so that prompt cards are persisted across server restarts without a migration workflow.

## Acceptance Criteria
- Given the server starts, when `EnsureCreated()` is called on `AppDbContext`, then the SQLite database file is created if it does not exist with the `PromptCards` table present.
- Given the database is created and empty, when `SeedData.SeedAsync()` runs, then 50+ prompt cards are inserted.
- Given the server restarts with an existing database, when seed runs, then no duplicate cards are inserted (idempotent via `AnyAsync()` check).
- Given `AppDbContext` is resolved from DI, then it uses the SQLite connection string from config (default: `Data Source=standup.db`).

## Implementation Notes
- `AppDbContext` in `StandupAndDeliver/Data/`
- `AddDbContext` + `AddDbContextFactory` both registered (factory used by `PromptCardService` for thread safety)
- `EnsureCreatedAsync()` + `SeedData.SeedAsync()` called in `Program.cs` startup scope
- Package: `Microsoft.EntityFrameworkCore.Sqlite 10.0.*`
