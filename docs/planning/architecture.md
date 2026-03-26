---
stepsCompleted: [step-01-init, step-02-context, step-03-starter, step-04-decisions, step-05-patterns, step-06-structure, step-07-validation, step-08-complete]
workflowStatus: complete
completedDate: 2026-03-25
inputDocuments:
  - planning_artifacts/prd.md
  - planning_artifacts/research/technical-standup-and-deliver-research-2026-03-25.md
workflowType: 'architecture'
project_name: 'Standup & Deliver'
user_name: 'Peter'
date: '2026-03-25'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 31 FRs across 6 capability areas.

| Capability Area | FRs | Architectural Implication |
|---|---|---|
| Session Management (FR1–FR6) | 6 | Room lifecycle: create, join, rejoin, inactivity cleanup |
| Turn & Game Flow (FR7–FR14) | 8 | Server-driven state machine; host skip; auto-advance |
| Voting & Scoring (FR15–FR20) | 6 | Concurrent vote collection; majority detection; score accumulation |
| Results & Reveal (FR21–FR24) | 4 | Deferred card disclosure; ordered reveal before scores |
| Prompt Card Management (FR25–FR27) | 3 | Without-repeat deck selection; 50+ cards; admin management |
| Connectivity & Presence (FR28–FR31) | 4 | Reconnect, state sync, grace period, session continuity |

**Non-Functional Requirements driving architecture:**

- **NFR-P1–P3:** < 5s initial load; < 200ms SignalR RTT; < 500ms phase transition render — server push latency is a hard constraint on hub and state broadcast design
- **NFR-R3:** Server-side timer runs regardless of client connection state — requires BackgroundService, not client-driven timing
- **NFR-R4:** Every game state has a defined next transition — demands a formal state machine, not ad-hoc conditionals
- **NFR-SC2/SC3:** Room state isolation + race condition protection — concurrent vote submission requires explicit concurrency model
- **NFR-S1/S2:** HTTPS/WSS + XSS input sanitization — transport security and output encoding required

**Scale & Complexity:**

- Primary domain: Full-stack real-time web (Blazor WASM + ASP.NET Core + SignalR)
- Complexity level: Medium — real-time multiplayer state machine with reconnect logic is the hard part; bounded scope (no auth, no payments, no external integrations, no multi-tenancy)
- Estimated architectural components: 8–10

### Technical Constraints & Dependencies

- **Blazor WebAssembly Hosted** — 3-project solution (Client/Server/Shared); WASM bundle size is a known mobile load constraint
- **SignalR WebSocket-only** — `SkipNegotiation = true` eliminates Fly.io sticky session requirement; no Redis backplane needed
- **iOS Safari reconnect** — `WithAutomaticReconnect()` alone insufficient; `visibilitychange` JS Interop hook required; ConnectionId changes on every reconnect
- **In-memory state only** — SQLite for prompt cards; all session/game state lives in singleton service; no external state store
- **Docker + Fly.io** — single container deployment; multi-stage build from solution root
- **Solo dev, greenfield** — no legacy constraints; MVP must be achievable within a 4-week window

### Cross-Cutting Concerns Identified

1. **Real-time state synchronization** — every component that mutates game state must broadcast to the correct SignalR group; affects hub, timer service, room service, and all state transitions
2. **Connection lifecycle** — connect → active → disconnected → grace period → removed; must be handled consistently across hub, room service, and background cleanup
3. **Concurrency on shared mutable state** — `ConcurrentDictionary<string, GameRoom>` + `SemaphoreSlim(1,1)` per room; all multi-step operations (vote tallying, turn advancement) must be atomic
4. **Error containment** — NFR-R4 requires every phase to have a defined outbound transition; no game flow can dead-end due to missing votes or disconnected players
5. **iOS Safari browser compatibility** — affects SignalR transport configuration, reconnect strategy, and JS Interop approach

## Starter Template & Technology Foundation

### Primary Technology Domain

Full-stack real-time web application — ASP.NET Core server with Blazor WebAssembly client, connected via SignalR.

### Starter Template Decision

**Selected:** .NET 10 Blazor Web App template with WebAssembly interactivity + manual Shared library

**Rationale:** .NET 10 is the current LTS release (supported until November 2028), making it the correct target for any new project started in 2026. The old `dotnet new blazorwasm --hosted` 3-project template was removed in .NET 8+; the modern equivalent requires a manual Shared library addition, which is a one-time setup step and produces the same logical architecture.

**Initialization Commands:**

```bash
# Create the solution
dotnet new sln -n StandupAndDeliver

# Server + Client (2-project Blazor Web App with WASM interactivity)
dotnet new blazor --interactivity WebAssembly -n StandupAndDeliver -o StandupAndDeliver --framework net10.0
dotnet sln add StandupAndDeliver/StandupAndDeliver.csproj
dotnet sln add StandupAndDeliver.Client/StandupAndDeliver.Client.csproj

# Shared class library for DTOs, hub interfaces, and game models
dotnet new classlib -n StandupAndDeliver.Shared -f net10.0
dotnet sln add StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj

# Add project references
dotnet add StandupAndDeliver/StandupAndDeliver.csproj reference StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj
dotnet add StandupAndDeliver.Client/StandupAndDeliver.Client.csproj reference StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj
```

**Resulting Solution Structure:**

| Project | Type | Purpose |
|---|---|---|
| `StandupAndDeliver` | ASP.NET Core host | SignalR hubs, game services, EF Core, Minimal API endpoints, Docker entry point |
| `StandupAndDeliver.Client` | Blazor WASM | All Blazor components, GameStateService, HubConnection, JS Interop |
| `StandupAndDeliver.Shared` | Class library | DTOs, hub interface (`IGameClient`), `GamePhase` enum, game models |

### Architectural Decisions Established by Template

**Language & Runtime:** C# on .NET 10 LTS throughout. No mixed-language boundaries.

**Hosting Model:** Blazor Web App with `InteractiveWebAssembly` render mode. Server handles SSR for initial load and serves the WASM bundle; all game UI runs client-side in the browser after load.

**Build Tooling:** `dotnet build` / `dotnet publish` via MSBuild. Tailwind CSS v4 standalone CLI integrated via `.csproj` MSBuild target (no Node.js required).

**Testing Infrastructure:**
- `bUnit` for Blazor component testing (Client project)
- `xUnit` + `Moq` for hub and service unit tests (Server project)
- Integration tests against real SignalR hub via `WebApplicationFactory`

**Development Workflow:** `dotnet watch run` for hot reload during development. `docker compose up` as the canonical local dev command once containerized.

**Note:** Project initialization using these commands is the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical (block implementation):**
- Game state management model (server-authoritative, in-memory singleton)
- SignalR hub interface design (`Hub<IGameClient>` strongly-typed)
- Reconnect strategy (WebSocket-only + `RejoinRoom` on every `Reconnected` callback)
- Concurrency model (`SemaphoreSlim(1,1)` per room for atomic operations)

**Important (shape architecture):**
- API surface (Controllers, not Minimal APIs)
- Hub error handling (result DTOs, not `HubException`)
- Client state (properties + `StateHasChanged()`, not reactive streams)
- CSS (Tailwind v4 standalone CLI via MSBuild)
- Logging (Serilog with console sink)

**Deferred (post-MVP):**
- EF Core provider switch (SQLite → PostgreSQL)
- Reactive state model (`IObservable<GameState>`)
- Advanced structured logging sinks (file, cloud)

### Data Architecture

| Decision | Choice | Rationale |
|---|---|---|
| ORM | EF Core (latest stable with .NET 10) | Standard .NET data access; provider-switching supported post-MVP |
| Database (MVP) | SQLite | Prompt cards only; zero infrastructure; embedded in container |
| Schema initialization | `EnsureCreated()` | Solo-dev MVP with a single stable table; no migration ceremony needed |
| Provider migration path | Deferred | Abstract to `IDbContextFactory<AppDbContext>` at the point it's needed |
| Persisted data | Prompt cards only | All session/game state is in-memory; no GDPR exposure |

### Authentication & Security

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | None | Name-entry only; no accounts, no sessions, no identity provider |
| Authorization | None | No protected resources; room code is the implicit access control |
| XSS protection | Blazor default HTML encoding | Razor components encode all output by default; sufficient for MVP |
| Input validation | Max-length constraint on player name (server-side) | Prevent abuse via oversized names; character whitelist deferred |
| Room code collision | Random generation + existence check | 26⁴ = 456,976 codes; negligible collision probability at ≤10 concurrent rooms |
| Transport security | HTTPS/WSS enforced in production (Fly.io TLS termination) | NFR-S1; dev runs HTTP locally via Docker |

### API & Communication Patterns

| Decision | Choice | Rationale |
|---|---|---|
| HTTP API style | MVC Controllers | Familiar from developer's .NET MVC background; ~3 endpoints only |
| HTTP endpoints | Room creation, health check, prompt count | All game logic flows through SignalR hub |
| Hub interface | Strongly-typed `Hub<IGameClient>` | Compile-time safety; AI-agent consistency; no magic strings |
| Hub error handling | Result DTO pattern | Invalid game state operations return `{ Success: false, Error: "..." }`; no `HubException` for guard violations |
| Hub broadcasting | `IHubContext<GameHub, IGameClient>` | Required for broadcasting from `BackgroundService` outside hub context |
| API documentation | None (MVP) | Internal-only API; no external consumers |

### Frontend Architecture

| Decision | Choice | Rationale |
|---|---|---|
| Render mode | `InteractiveWebAssembly` | All game UI runs client-side after initial load; server-rendered shell only |
| Routing | Single-page: Landing (`/`) + Game room (`/room/{code}`) | No navigation during active session; phase switching is in-component |
| State management | `GameStateService` scoped singleton + `StateHasChanged()` | Standard Blazor pattern; debuggable; reactive streams deferred unless needed |
| Component structure | Single `GameRoom.razor` with `@switch` on `GamePhase` enum | One entry point; phase sub-components rendered inline; no page nav |
| CSS | Tailwind CSS v4 standalone CLI via `.csproj` MSBuild target | No Node.js; utility-first; optimal for phone-portrait game UI; tiny output |
| Bundle optimization | Default Blazor WASM publish settings (IL trimming enabled) | AOT compilation deferred; monitor initial load against NFR-P1 (< 5s on 4G) |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|---|---|---|
| Containerization | Docker multi-stage build from solution root | MVP requirement; local dev via `docker compose up`; production via Fly.io |
| Deployment target | Fly.io (single instance) | Personal project scale; NFR-R5 accepts single-instance for MVP |
| Sticky sessions | Not required | `SkipNegotiation = true` + WebSocket-only eliminates this problem entirely |
| Logging | Serilog with console sink | Structured output; Fly.io captures stdout; readable locally; simple setup via `UseSerilog()` |
| Health check | ASP.NET Core built-in health checks at `/health` | Fly.io liveness probe; one-line setup |
| Environment config | `appsettings.json` + environment variable overrides + Fly.io secrets | Standard ASP.NET Core pattern; nothing sensitive in source control |
| Monitoring | None (MVP) | Fly.io metrics dashboard sufficient; APM deferred |

### Decision Impact Analysis

**Implementation sequence dependencies:**

1. Shared project + `IGameClient` interface + `GamePhase` enum → everything else depends on this
2. `GameRoomService` (singleton, `ConcurrentDictionary`, `SemaphoreSlim`) → hub and timer service depend on it
3. `GameHub : Hub<IGameClient>` → client connection depends on this
4. `GameTimerService : BackgroundService` → depends on `IHubContext<GameHub, IGameClient>` and `GameRoomService`
5. `GameRoom.razor` + `GameStateService` → depends on hub interface being stable
6. EF Core + SQLite prompt card seeding → independent; can be done in parallel with game logic
7. Docker + Fly.io config → depends on everything else being buildable

**Cross-component dependencies:**
- `IGameClient` (Shared) is the contract between hub (Server) and client registration (Client) — changes here cascade everywhere
- `GamePhase` enum (Shared) drives both server state machine transitions and client `@switch` rendering — must be exhaustive from day one
- `SemaphoreSlim` per room must wrap any operation that reads-then-writes room state (vote submission, turn advancement, phase transitions)

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

10 areas where AI agents could make incompatible choices without explicit rules.

### Naming Patterns

**C# Naming Conventions (standard .NET — all agents must follow):**

| Element | Convention | Example |
|---|---|---|
| Classes, interfaces, enums | PascalCase | `GameHub`, `IGameClient`, `GamePhase` |
| Methods | PascalCase | `SubmitVote`, `RejoinRoom` |
| Properties | PascalCase | `RoomCode`, `PlayerName` |
| Private fields | `_camelCase` | `_gameRoomService`, `_hubContext` |
| Local variables / parameters | camelCase | `roomCode`, `playerName` |
| Constants | PascalCase | `MaxPlayerCount`, `TurnDurationSeconds` |

**Hub Method Naming — server-to-client (`IGameClient` methods):**

Pattern: `{Verb}{Subject}` in PascalCase. These are events pushed *to* the client.

| Method | Purpose |
|---|---|
| `ReceiveGameState(GameStateDto state)` | Full state sync (used on reconnect and phase transitions) |
| `ReceiveTimerTick(int secondsRemaining)` | Timer countdown broadcast |
| `ReceiveVoteCount(int submitted, int total)` | Voting progress (no content) |
| `ReceivePhaseChange(GamePhase newPhase)` | Phase transition notification |
| `ReceiveError(string message)` | Non-fatal error feedback to a single client |

**Hub Method Naming — client-to-server (`GameHub` methods):**

Pattern: `{Verb}{Subject}` in PascalCase. These are actions *from* the client.

| Method | Purpose |
|---|---|
| `CreateRoom(string playerName)` | Host creates a room |
| `JoinRoom(string roomCode, string playerName)` | Player joins existing room |
| `RejoinRoom(string roomCode, string playerName)` | Reconnect — called on every `Reconnected` callback |
| `StartGame()` | Host starts game (host only) |
| `SubmitVote(bool lied, int impressiveness)` | Non-active player submits vote |
| `SkipTurn()` | Host skips active speaker (host only) |

**DTO/Model Naming:**

- All DTOs in `StandupAndDeliver.Shared` namespace
- Suffix `Dto` on data transfer objects: `GameStateDto`, `PlayerDto`, `TurnResultDto`
- No `Dto` suffix on domain models used internally on the server: `GameRoom`, `Player`, `PromptCard`
- Hub result wrapper: `HubResult` (see Format Patterns below)

**JSON Field Naming:**

camelCase for all JSON serialization (ASP.NET Core default with `System.Text.Json`). No snake_case. No PascalCase in JSON payloads.

```json
{ "roomCode": "QRKZ", "playerName": "Marcus", "isHost": true }
```

**Database Naming (EF Core + SQLite):**

- Table names: plural PascalCase via EF Core conventions (`PromptCards`)
- Column names: PascalCase matching C# property names (`Id`, `Text`, `IsActive`)
- No underscores in database identifiers

### Structure Patterns

**Project Organization:**

```
StandupAndDeliver/              ← Server project
  Controllers/                  ← MVC controllers (RoomController, HealthController)
  Hubs/                         ← SignalR hubs (GameHub.cs)
  Services/                     ← GameRoomService, GameTimerService, RoomCleanupService
  Data/                         ← AppDbContext, PromptCard entity
  wwwroot/                      ← Static assets, Tailwind output CSS

StandupAndDeliver.Client/       ← Blazor WASM project
  Pages/                        ← Routable components (Index.razor, GameRoom.razor)
  Components/                   ← Phase sub-components (LobbyView, SpeakerView, VotingView, RevealView, ResultsView)
  Services/                     ← GameStateService
  Interop/                      ← JS Interop wrappers (VisibilityInterop.cs)
  wwwroot/                      ← JS files (game-interop.js), Tailwind input CSS

StandupAndDeliver.Shared/       ← Shared class library
  DTOs/                         ← All Dto classes
  Interfaces/                   ← IGameClient interface
  Enums/                        ← GamePhase enum
  Models/                       ← Shared domain models (if any)
```

**Test Organization:**

```
StandupAndDeliver.Tests/        ← xUnit test project
  Hubs/                         ← Hub unit tests (GameHubTests.cs)
  Services/                     ← Service unit tests (GameRoomServiceTests.cs)
  Integration/                  ← WebApplicationFactory SignalR integration tests
  Components/                   ← bUnit component tests
```

Co-located test files (`.test.cs` alongside source) are not used. All tests in the dedicated test project.

### Format Patterns

**Hub Operation Result — all client-invokable hub methods return `HubResult`:**

```csharp
// In StandupAndDeliver.Shared
public record HubResult(bool Success, string? Error = null);
public record HubResult<T>(bool Success, T? Data = default, string? Error = null) : HubResult(Success, Error);
```

```csharp
// Usage in hub method
public async Task<HubResult> SubmitVote(bool lied, int impressiveness)
{
    if (!IsVotingPhase()) return new HubResult(false, "Voting is not currently open.");
    // ... process vote
    return new HubResult(true);
}
```

**GamePhase Enum — exhaustive, no implicit fallthrough:**

```csharp
public enum GamePhase
{
    Lobby,
    SpeakerTurn,
    Voting,
    Reveal,
    GameOver
}
```

Every `@switch` on `GamePhase` and every server-side phase handler **must** have a case for every value. No `default:` that silently swallows unknown phases.

**GameStateDto — the canonical state broadcast shape:**

```csharp
public record GameStateDto(
    GamePhase Phase,
    string RoomCode,
    IReadOnlyList<PlayerDto> Players,
    string? ActivePlayerName,
    int? SecondsRemaining,
    string? PromptCardText,      // Only populated for active player; null for others
    int VotesSubmitted,
    int VotesTotal,
    TurnResultDto? LastTurnResult // Populated during Reveal phase
);
```

**API HTTP Response — MVC controllers use `ActionResult<T>` with standard HTTP status codes:**

- `200 OK` — success with body
- `400 Bad Request` — invalid input (validation failure)
- `404 Not Found` — room not found
- `409 Conflict` — room full, name taken

No custom envelope wrapper for HTTP responses. `ProblemDetails` for error responses (built-in ASP.NET Core).

**Date/Time:** All timestamps as ISO 8601 strings (`"2026-03-25T14:30:00Z"`). No Unix timestamps.

### Communication Patterns

**SignalR State Sync — always push full `GameStateDto` on phase transitions:**

On every phase change, broadcast the full `GameStateDto` to the group — never delta updates. Reconnecting clients get a complete picture from a single `ReceiveGameState` call; no partial-state risk.

```csharp
// Always: full state broadcast on phase change
// Note: PromptCardText populated selectively per-connection, not per-group broadcast
await _hubContext.Clients.Group(roomCode).ReceiveGameState(BuildGroupStateDto(room));
await _hubContext.Clients.Client(activePlayerConnectionId).ReceiveGameState(BuildActiveSpeakerStateDto(room));
```

**Reconnect Pattern — mandatory sequence:**

```csharp
// Client-side: every Reconnected callback must call RejoinRoom
_hubConnection.Reconnected += async _ =>
{
    await _hubConnection.InvokeAsync("RejoinRoom", _roomCode, _playerName);
};
```

**`StateHasChanged()` Call Pattern:**

- Call `await InvokeAsync(StateHasChanged)` in SignalR `On<T>` handlers — these run on a non-UI thread
- Do NOT call bare `StateHasChanged()` from background thread contexts
- Synchronous Blazor event handlers do not need `StateHasChanged()` — Blazor handles these automatically

```csharp
// Correct — SignalR callback runs off UI thread
_hubConnection.On<GameStateDto>("ReceiveGameState", async state =>
{
    _gameState.Update(state);
    await InvokeAsync(StateHasChanged);
});
```

**JS Interop Naming — C# call site must exactly match JavaScript function name:**

```csharp
// C# (Interop wrapper)
await _js.InvokeVoidAsync("gameInterop.registerVisibilityHandler", dotNetRef);
```

```javascript
// wwwroot/game-interop.js — must match exactly
window.gameInterop = {
    registerVisibilityHandler: function(dotNetRef) { /* ... */ }
};
```

### Process Patterns

**Error Handling:**

- Hub guard violations (wrong phase, not host, etc.) → return `HubResult(false, "message")` — never throw
- Unhandled server exceptions → caught by global `UseExceptionHandler`; logged at `Error` level; client receives `ReceiveError`
- Missing room → `HubResult(false, "Room not found or has expired.")` — client redirects to home
- SignalR disconnection → `visibilitychange` hook triggers reconnect; no user-visible error unless retries exhausted

**`SemaphoreSlim` Usage — required for all multi-step room mutations:**

```csharp
await room.Lock.WaitAsync();
try
{
    room.Votes[playerName] = new Vote(lied, impressiveness);
    if (AllVotesIn(room)) await AdvanceToReveal(room);
}
finally
{
    room.Lock.Release();
}
```

Read-only operations (building `GameStateDto` for broadcast) do not require the lock.

**Logging Levels (Serilog):**

| Level | Use For |
|---|---|
| `Debug` | SignalR connection events, timer ticks, vote submissions |
| `Information` | Room creation/destruction, game start, phase transitions |
| `Warning` | Reconnect attempts, invalid hub method calls, room not found |
| `Error` | Unhandled exceptions, service failures |

### Enforcement Guidelines

**All AI agents MUST:**

- Use the `IGameClient` interface for all server-to-client hub calls — no string-based `SendAsync`
- Return `HubResult` from all client-invokable hub methods — never void
- Acquire `room.Lock` before any multi-step read-modify-write on `GameRoom` state
- Call `RejoinRoom` in every `Reconnected` callback
- Handle every `GamePhase` value explicitly in `@switch` blocks — no silent default fallthrough
- Call `await InvokeAsync(StateHasChanged)` in SignalR `On<T>` handlers

**Anti-Patterns:**

```csharp
// ❌ String-based hub call
await Clients.All.SendAsync("ReceiveGameState", state);
// ✅ Strongly-typed
await Clients.All.ReceiveGameState(state);

// ❌ Void hub method with silent failure
public async Task SubmitVote(bool lied, int impressiveness) { ... }
// ✅ HubResult return
public async Task<HubResult> SubmitVote(bool lied, int impressiveness) { ... }

// ❌ StateHasChanged on background thread
_hubConnection.On<GameStateDto>("ReceiveGameState", state => {
    _gameState.Update(state);
    StateHasChanged();
});
// ✅ InvokeAsync wrapper
_hubConnection.On<GameStateDto>("ReceiveGameState", async state => {
    _gameState.Update(state);
    await InvokeAsync(StateHasChanged);
});
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
StandupAndDeliver/                          ← Solution root
├── StandupAndDeliver.sln
├── Dockerfile                              ← Multi-stage build (solution root)
├── docker-compose.yml                      ← Local dev: build + run
├── docker-compose.override.yml             ← Local overrides (ports, volumes)
├── fly.toml                                ← Fly.io deployment config
├── .gitignore
├── .dockerignore
│
├── StandupAndDeliver/                      ← Server project (ASP.NET Core host)
│   ├── StandupAndDeliver.csproj
│   ├── Program.cs                          ← DI registration, middleware pipeline, SignalR config
│   ├── appsettings.json
│   ├── appsettings.Development.json
│   │
│   ├── Controllers/
│   │   ├── RoomController.cs               ← POST /api/rooms, GET /api/rooms/{code}
│   │   └── PromptsController.cs            ← GET /api/prompts/count
│   │
│   ├── Hubs/
│   │   └── GameHub.cs                      ← Hub<IGameClient>: CreateRoom, JoinRoom, RejoinRoom, StartGame, SubmitVote, SkipTurn
│   │
│   ├── Services/
│   │   ├── GameRoomService.cs              ← Singleton: ConcurrentDictionary<string, GameRoom>, SemaphoreSlim per room
│   │   ├── GameTimerService.cs             ← BackgroundService: PeriodicTimer, IHubContext<GameHub, IGameClient>
│   │   └── RoomCleanupService.cs           ← BackgroundService: 1-min sweep, 30-min TTL room removal
│   │
│   ├── Data/
│   │   ├── AppDbContext.cs                 ← EF Core DbContext, EnsureCreated() on startup
│   │   ├── PromptCard.cs                   ← Entity: Id (int), Text (string), IsActive (bool)
│   │   └── SeedData.cs                     ← 50+ prompt cards seeded on first run
│   │
│   └── wwwroot/
│       └── css/
│           └── app.css                     ← Tailwind v4 output (generated by MSBuild target)
│
├── StandupAndDeliver.Client/               ← Blazor WASM project
│   ├── StandupAndDeliver.Client.csproj
│   ├── Program.cs                          ← WASM entry: GameStateService DI, HubConnection config
│   │
│   ├── Pages/
│   │   ├── Index.razor                     ← Landing page: Create Room / Join Room forms
│   │   └── GameRoom.razor                  ← Main game page: @switch(Phase) dispatcher + HubConnection lifecycle
│   │
│   ├── Components/
│   │   ├── LobbyView.razor                 ← FR3, FR4: player list, Start Game button (host only)
│   │   ├── SpeakerView.razor               ← FR8, FR9: prompt card display, countdown timer
│   │   ├── WaitingView.razor               ← FR10: non-active player waiting state
│   │   ├── VotingView.razor                ← FR15, FR16, FR17: lie binary + impressiveness slider + vote count
│   │   ├── RevealView.razor                ← FR21, FR22, FR24: card reveal + vote breakdown
│   │   └── ResultsView.razor               ← FR23: final standings screen
│   │
│   ├── Services/
│   │   └── GameStateService.cs             ← Scoped singleton: GameStateDto properties + Update(dto) method
│   │
│   ├── Interop/
│   │   └── VisibilityInterop.cs            ← JS Interop wrapper: registerVisibilityHandler, dispose
│   │
│   └── wwwroot/
│       ├── css/
│       │   └── app.input.css               ← Tailwind v4 input (source directives)
│       ├── js/
│       │   └── game-interop.js             ← visibilitychange handler, DotNet.invokeMethodAsync bridge
│       └── index.html                      ← WASM bootstrap shell
│
├── StandupAndDeliver.Shared/               ← Shared class library
│   ├── StandupAndDeliver.Shared.csproj
│   │
│   ├── DTOs/
│   │   ├── GameStateDto.cs                 ← Canonical state broadcast shape
│   │   ├── PlayerDto.cs                    ← Id, Name, Score, IsHost, IsConnected
│   │   ├── TurnResultDto.cs                ← PromptCardText, LieVotes, TotalVotes, ImpressivenessAvg, Points
│   │   └── HubResult.cs                    ← HubResult(bool Success, string? Error) + generic HubResult<T>
│   │
│   ├── Interfaces/
│   │   └── IGameClient.cs                  ← ReceiveGameState, ReceiveTimerTick, ReceiveVoteCount, ReceivePhaseChange, ReceiveError
│   │
│   └── Enums/
│       └── GamePhase.cs                    ← Lobby, SpeakerTurn, Voting, Reveal, GameOver
│
└── StandupAndDeliver.Tests/                ← xUnit test project
    ├── StandupAndDeliver.Tests.csproj
    │
    ├── Hubs/
    │   └── GameHubTests.cs                 ← Hub method unit tests (Moq IGameClient, IGroupManager)
    │
    ├── Services/
    │   ├── GameRoomServiceTests.cs          ← Concurrency tests, room lifecycle, vote tallying
    │   └── GameTimerServiceTests.cs         ← Timer advancement, phase auto-transition
    │
    ├── Integration/
    │   └── GameSessionTests.cs             ← WebApplicationFactory: full join→play→reveal flow via real SignalR
    │
    └── Components/
        ├── VotingViewTests.cs              ← bUnit: vote submission UI, impressiveness slider
        └── GameRoomTests.cs                ← bUnit: phase switching, state updates
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Technology | Endpoints / Methods |
|---|---|---|
| HTTP (room management) | MVC Controllers | `POST /api/rooms`, `GET /api/rooms/{code}`, `GET /api/prompts/count` |
| HTTP (health) | ASP.NET Health Checks | `GET /health` |
| Real-time (game) | SignalR Hub at `/gamehub` | All game flow — see hub method table in Naming Patterns |
| Static assets | Blazor WASM host | WASM bundle from `/_framework/`, static files from `wwwroot/` |

**Component Boundaries:**

- `GameRoom.razor` owns the `HubConnection` lifecycle — creates on `OnInitializedAsync`, disposes on `DisposeAsync`
- Phase sub-components receive state via cascading `GameStateService` — they do not hold hub references
- `GameStateService` is the single source of truth on the client — no component maintains local state copies
- `VisibilityInterop` is the only component that touches JS directly

**Service Boundaries (Server):**

- `GameRoomService` owns all room state — hub and timer service call into it; they do not hold room state
- `GameTimerService` calls `GameRoomService` to advance phase, then broadcasts via `IHubContext` — no direct room writes
- `RoomCleanupService` calls `GameRoomService.RemoveExpiredRooms()` — no hub interaction
- EF Core `AppDbContext` accessed only by `PromptsController` and `SeedData` — game services never touch the database

**Data Boundaries:**

- SQLite (`app.db`) — effectively read-only at runtime; seeded once on startup
- In-memory room state — lives entirely in `GameRoomService` singleton; lost on process restart (acceptable for MVP)
- No session cookies, no distributed cache, no external state store

### Requirements to Structure Mapping

| FR Capability Area | Primary Files |
|---|---|
| Session Management (FR1–FR6) | `GameHub.cs`, `GameRoomService.cs`, `RoomCleanupService.cs`, `RoomController.cs` |
| Turn & Game Flow (FR7–FR14) | `GameHub.cs`, `GameRoomService.cs`, `GameTimerService.cs` |
| Voting & Scoring (FR15–FR20) | `GameHub.cs`, `GameRoomService.cs`, `VotingView.razor` |
| Results & Reveal (FR21–FR24) | `GameRoomService.cs`, `RevealView.razor`, `ResultsView.razor`, `TurnResultDto.cs` |
| Prompt Card Management (FR25–FR27) | `AppDbContext.cs`, `PromptCard.cs`, `SeedData.cs`, `GameRoomService.cs` |
| Connectivity & Presence (FR28–FR31) | `GameHub.cs`, `GameRoomService.cs`, `VisibilityInterop.cs`, `game-interop.js` |

### Integration Points & Data Flow

**Full game flow:**
```
Player browser → HubConnection → SignalR (/gamehub) → GameHub.cs
  → GameRoomService.cs (mutates state, acquires lock)
  → IHubContext broadcasts GameStateDto to group
  → All clients: ReceiveGameState → GameStateService.Update() → InvokeAsync(StateHasChanged)
  → GameRoom.razor @switch(Phase) → active sub-component re-renders
```

**Timer path:**
```
GameTimerService (PeriodicTimer, 1s)
  → GameRoomService.TickActiveTurns() (lock, decrement)
  → On expiry: AdvancePhase() → IHubContext broadcasts to group
```

**Reconnect path:**
```
Screen unlock → visibilitychange (game-interop.js) → VisibilityInterop → HubConnection.StartAsync()
  → Reconnected callback → RejoinRoom(roomCode, playerName)
  → GameHub: re-adds to group, broadcasts current GameStateDto to this connection only
```

### Development & Deployment Workflow

**Local:** `docker compose up` — builds image, starts container, exposes port 8080

**First run:** `EnsureCreated()` creates `app.db`; `SeedData.cs` inserts 50 prompt cards

**CSS build:** MSBuild target runs Tailwind standalone CLI on `app.input.css` → `wwwroot/css/app.css` before publish

**Deployment:** `docker build` → `fly deploy` using `fly.toml` at solution root

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices are compatible. .NET 10 + Blazor WASM + SignalR + EF Core + SQLite is a well-tested combination. Serilog integrates via `UseSerilog()` in `Program.cs`. Tailwind v4 standalone CLI integrates via MSBuild — no runtime Node.js dependency. `SkipNegotiation = true` + WebSocket-only is explicitly compatible with SignalR's .NET client. No version conflicts identified.

**Pattern Consistency:** `Hub<IGameClient>` strongly-typed pattern and result DTO pattern both enforce compile-time correctness. `StateHasChanged()` threading pattern is correctly specified for Blazor WASM's single-threaded JS runtime. `SemaphoreSlim` per room is coherent with `ConcurrentDictionary` — the dictionary provides safe key lookups; the semaphore protects multi-step mutations inside a room.

**Structure Alignment:** The 4-project solution maps cleanly to boundaries. `Shared` is the only project referenced by both Server and Client — enforcing the contract boundary. `GameRoomService` as the sole owner of room state is structurally enforced: no other service holds a `GameRoom` reference.

**Dual broadcast on `SpeakerTurn` resolved:** Group broadcast with `PromptCardText = null`, then targeted send to active speaker's `ConnectionId` with card text populated. `GameHub` must send two distinct messages on `SpeakerTurn` phase start. Documented in data flow.

### Requirements Coverage Validation ✅

**All 31 FRs architecturally supported:**

| FR Area | Coverage |
|---|---|
| Session Management (FR1–FR6) | `GameHub` + `GameRoomService` + `RoomCleanupService` — all methods named and mapped |
| Turn & Game Flow (FR7–FR14) | `GameTimerService` (FR9, FR11), `GameHub.SkipTurn` (FR12), `GameRoomService` phase state machine (FR7, FR13, FR14) |
| Voting & Scoring (FR15–FR20) | `GameHub.SubmitVote`, `GameRoomService` majority detection and score averaging, `VotingView.razor` |
| Results & Reveal (FR21–FR24) | `TurnResultDto`, `RevealView.razor`, `ResultsView.razor`; reveal-before-scores enforced by `GamePhase.Reveal` preceding `GamePhase.GameOver` |
| Prompt Card Management (FR25–FR27) | `SeedData.cs` (50 cards); without-repeat selection via dealt card ID tracking in `GameRoomService` |
| Connectivity & Presence (FR28–FR31) | `VisibilityInterop` + `game-interop.js` (FR28); `RejoinRoom` broadcasts full `GameStateDto` (FR29); `PlayerDto.IsConnected` flag (FR30); grace period `CancellationTokenSource` in `OnDisconnectedAsync` (FR31) |

**All 17 NFRs architecturally addressed:**

| NFR | Architectural Coverage |
|---|---|
| NFR-P1 (< 5s load) | IL trimming on publish; single-screen architecture minimizes WASM bundle size |
| NFR-P2 (< 200ms SignalR) | WebSocket-only transport; single Fly.io instance (no backplane hop) |
| NFR-P3 (< 500ms phase render) | Full `GameStateDto` broadcast on phase change; client re-renders synchronously from state |
| NFR-P4 (±1s timer) | `PeriodicTimer` 1s interval server-side; not dependent on client clock |
| NFR-P5 (responsive during voting) | Voting UI is local-state pending submit; doesn't block on others' submissions |
| NFR-S1 (HTTPS/WSS) | Fly.io TLS termination; `SkipNegotiation = true` goes straight to WSS |
| NFR-S2 (XSS) | Blazor Razor encoding by default; server-side name length validation |
| NFR-S3 (room code collision) | 26⁴ = 456,976 code space + existence check |
| NFR-S4 (no PII) | In-memory only; no user data in SQLite; player names not logged at Info level+ |
| NFR-R1–R4 (reliability) | Exhaustive `GamePhase` enum; `HubResult` pattern; grace period handling; `SemaphoreSlim` prevents deadlock |
| NFR-R5 (availability) | Single Fly.io instance + `/health` liveness probe |
| NFR-SC1–SC3 (scalability) | `ConcurrentDictionary` for room isolation; `SemaphoreSlim` per room (not global); 10-room MVP target trivially supported |
| NFR-A1–A3 (accessibility) | Tailwind utilities for contrast and touch targets; semantic HTML for keyboard nav |
| NFR-A4 (deferred) | Explicitly deferred; documented |

### Implementation Readiness Validation ✅

**Decision completeness:** All critical decisions documented with rationale. Technology stack specified at .NET 10 LTS. All hub method names, DTO shapes, enum values, and file locations are explicit — no ambiguous choices remain for AI agents.

**Structure completeness:** Every file in the project tree is named with its purpose. No placeholders. FR-to-file mapping table closes the loop between requirements and code locations.

**Pattern completeness:** 10 conflict points identified and resolved. Anti-pattern code examples provided for the three most dangerous Blazor + SignalR mistakes (string-based hub calls, void hub methods, `StateHasChanged()` threading).

### Gap Analysis

**Critical gaps:** None.

**Gaps identified and resolved during validation:**
1. **Dual broadcast on `SpeakerTurn`** — group gets `PromptCardText = null`; active speaker gets card text via targeted send. Must be explicit in `GameHub` implementation.
2. **`PlayerDto.IsConnected` flag** — required for FR30; `GameRoomService` must update this in `OnDisconnectedAsync` and `RejoinRoom`.
3. **Grace period implementation** — `OnDisconnectedAsync` starts a 30s `CancellationTokenSource`; cancelled on rejoin; on expiry, player marked removed (future turns skipped).

**Post-MVP nice-to-have:**
- `fly.toml` configuration detail
- CI/CD pipeline (GitHub Actions → Fly.io)

### Architecture Completeness Checklist

- [x] All 31 FRs analyzed and mapped to specific files
- [x] All 17 NFRs mapped to architectural decisions
- [x] Technology stack fully specified (.NET 10, Blazor WASM, SignalR, EF Core, SQLite, Tailwind v4, Serilog)
- [x] 10 AI agent conflict points identified and resolved with concrete code examples
- [x] Complete 4-project solution tree with every file named and purposed
- [x] Three data flow paths documented (game flow, timer, reconnect)
- [x] Hub contract fully defined (10 methods, all DTOs, all enum values)
- [x] Deferred decisions explicitly noted with rationale

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**
**Confidence Level: High**

**Key Strengths:**
- Server-authoritative design eliminates client/server state drift bugs by design
- `IGameClient` strongly-typed interface means the compiler catches breaking hub contract changes
- Reconnect strategy fully specified before a line of code is written — the hardest problem is solved on paper
- `GamePhase` enum exhaustiveness requirement prevents dead-end states at the type level
- All 31 FRs have explicit file homes — no ambiguity about where to implement any feature

**Areas for future enhancement (post-MVP):**
- EF Core provider switch to PostgreSQL (persistent leaderboard, Growth phase)
- `[PersistentState]` attribute (.NET 10) for declarative reconnect state persistence
- Distributed tracing via SignalR `ActivitySource` (.NET 9+)
- CI/CD pipeline (GitHub Actions → Fly.io on push)

### Implementation Handoff

**First implementation story:** Run initialization commands from the Starter Template section to create the 4-project solution.

**Implementation order:**
1. Shared project — `IGameClient`, `GamePhase` enum, all DTOs, `HubResult`
2. `GameRoomService` — in-memory state, `ConcurrentDictionary`, `SemaphoreSlim`, room CRUD
3. `GameHub` — all hub methods wired to `GameRoomService`
4. `GameTimerService` + `RoomCleanupService` — background services
5. Blazor client — `GameStateService`, `GameRoom.razor`, all phase sub-components, `VisibilityInterop`
6. EF Core + SQLite — `AppDbContext`, `PromptCard`, `SeedData` (50 cards)
7. MVC Controllers — `RoomController`, `PromptsController`, health check
8. Docker + Fly.io — `Dockerfile`, `docker-compose.yml`, `fly.toml`
