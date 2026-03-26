# Story 1.2: Define Shared Contracts

Status: review

## Story

As a **developer**,
I want the shared contracts (hub interface, enums, DTOs) defined in the Shared project,
So that the server hub and Blazor client can reference a single source of truth with no magic strings.

## Acceptance Criteria

1. The following types are available when referencing `StandupAndDeliver.Shared` from Server or Client: `IGameClient`, `GamePhase` enum, `GameStateDto`, `PlayerDto`, `TurnResultDto`, `HubResult`, `HubResult<T>`.
2. `GamePhase` enum has exactly 5 values: `Lobby`, `SpeakerTurn`, `Voting`, `Reveal`, `GameOver` — a compiler-exhaustive switch requires no `default` case.
3. `HubResult` carries `bool Success` and `string? Error` with no additional dependencies.
4. `dotnet build` from solution root succeeds with 0 errors after all types are added.

## Tasks / Subtasks

- [x] Task 1: Define `GamePhase` enum (AC: 1, 2)
  - [x] Create `StandupAndDeliver.Shared/Enums/GamePhase.cs` with 5 values: `Lobby, SpeakerTurn, Voting, Reveal, GameOver`
  - [x] Remove template placeholder file `Class1.cs` from Shared project root if present

- [x] Task 2: Define `HubResult` and `HubResult<T>` (AC: 1, 3)
  - [x] Create `StandupAndDeliver.Shared/DTOs/HubResult.cs` with both record types

- [x] Task 3: Define `PlayerDto` (AC: 1)
  - [x] Create `StandupAndDeliver.Shared/DTOs/PlayerDto.cs`

- [x] Task 4: Define `TurnResultDto` (AC: 1)
  - [x] Create `StandupAndDeliver.Shared/DTOs/TurnResultDto.cs`

- [x] Task 5: Define `GameStateDto` (AC: 1)
  - [x] Create `StandupAndDeliver.Shared/DTOs/GameStateDto.cs` — depends on `PlayerDto`, `TurnResultDto`, `GamePhase`

- [x] Task 6: Define `IGameClient` interface (AC: 1)
  - [x] Create `StandupAndDeliver.Shared/Interfaces/IGameClient.cs` with all 5 server-to-client methods

- [x] Task 7: Verify build (AC: 4)
  - [x] Run `dotnet build` from solution root — confirm 0 errors

## Dev Notes

### Namespace

All types use namespace `StandupAndDeliver.Shared`. No sub-namespaces (e.g. not `StandupAndDeliver.Shared.DTOs`). This keeps using statements clean across Server and Client.

### Exact Type Definitions

**`GamePhase.cs`** — must be exhaustive, compiler will enforce switch completeness:
```csharp
namespace StandupAndDeliver.Shared;

public enum GamePhase
{
    Lobby,
    SpeakerTurn,
    Voting,
    Reveal,
    GameOver
}
```

**`HubResult.cs`** — positional records, no external dependencies:
```csharp
namespace StandupAndDeliver.Shared;

public record HubResult(bool Success, string? Error = null);
public record HubResult<T>(bool Success, T? Data = default, string? Error = null) : HubResult(Success, Error);
```

**`PlayerDto.cs`** — includes `IsConnected` for FR30 (host disconnection indicator):
```csharp
namespace StandupAndDeliver.Shared;

public record PlayerDto(
    string Name,
    int Score,
    bool IsHost,
    bool IsConnected
);
```

**`TurnResultDto.cs`**:
```csharp
namespace StandupAndDeliver.Shared;

public record TurnResultDto(
    string ActivePlayerName,
    string PromptCardText,
    int LiedVoteCount,
    int TotalVoteCount,
    double ImpressionScore,
    int TurnScore
);
```

**`GameStateDto.cs`** — the canonical broadcast shape; `PromptCardText` is null in group broadcasts, populated only in targeted active-speaker send:
```csharp
namespace StandupAndDeliver.Shared;

public record GameStateDto(
    GamePhase Phase,
    string RoomCode,
    IReadOnlyList<PlayerDto> Players,
    string? ActivePlayerName,
    int? SecondsRemaining,
    string? PromptCardText,
    int VotesSubmitted,
    int VotesTotal,
    TurnResultDto? LastTurnResult
);
```

**`IGameClient.cs`** — these are the server-to-client SignalR push methods; hub will be `Hub<IGameClient>`:
```csharp
namespace StandupAndDeliver.Shared;

public interface IGameClient
{
    Task ReceiveGameState(GameStateDto state);
    Task ReceiveTimerTick(int secondsRemaining);
    Task ReceiveVoteCount(int submitted, int total);
    Task ReceivePhaseChange(GamePhase newPhase);
    Task ReceiveError(string message);
}
```

### Architecture Guardrails

- **No string-based hub calls** — `IGameClient` exists precisely to prevent `SendAsync("ReceiveGameState", ...)` anti-pattern
- **No `default` in GamePhase switches** — the compiler must enforce exhaustiveness; adding a new phase later will immediately surface all unhandled call sites
- **`HubResult<T>` inherits `HubResult`** — both are needed; the generic variant is for hub methods that return data alongside success/failure
- **`IReadOnlyList<PlayerDto>` not `List<PlayerDto>`** — prevents accidental mutation of the broadcast state on the client

### Previous Story Context

Story 1.1 created `StandupAndDeliver.Shared/` with empty `DTOs/`, `Interfaces/`, `Enums/` folders and a `.gitkeep` in each. The template also created a `Class1.cs` at the project root — delete it.

### Solution Root

`C:\Users\peter\Github\StandupAndDeliver\StandupAndDeliver\` — one level deeper than the outer directory due to template output naming.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Removed `Class1.cs` template placeholder from Shared project root
- Created all 7 types in correct folder locations under `StandupAndDeliver.Shared/`
- `GamePhase` has exactly 5 values — compiler-exhaustive switches require no `default`
- `IGameClient` defines all 5 server-to-client push methods
- `GameStateDto.PromptCardText` is nullable — null in group broadcasts, populated in targeted active-speaker send only
- `PlayerDto.IsConnected` included for FR30 (disconnection indicator)
- `dotnet build` — 0 errors, 0 warnings, all 4 projects

### File List

- `StandupAndDeliver/StandupAndDeliver.Shared/Enums/GamePhase.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/DTOs/HubResult.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/DTOs/PlayerDto.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/DTOs/TurnResultDto.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/DTOs/GameStateDto.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/Interfaces/IGameClient.cs` (new)
- `StandupAndDeliver/StandupAndDeliver.Shared/Class1.cs` (deleted)
