---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-validate]
workflowStatus: complete
completedDate: 2026-03-25
inputDocuments:
  - planning_artifacts/prd.md
  - planning_artifacts/architecture.md
---

# Standup & Deliver - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Standup & Deliver, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: A player can create a new game room and receive a unique 4-letter room code
- FR2: A player can join an existing game room by entering a room code and their display name
- FR3: The host can view the live list of players in the lobby
- FR4: The host can start the game once at least 3 players have joined
- FR5: A player can rejoin an in-progress session using the original room code after a disconnection
- FR6: The system removes a game room and its state after a period of inactivity
- FR7: The system advances through all players' turns sequentially, one player designated as active speaker per turn
- FR8: The active speaker can view their assigned prompt card privately (not visible to other players)
- FR9: The system enforces a 60-second time limit on the active speaker's turn
- FR10: Non-active players can see that a turn is in progress and who the active speaker is
- FR11: The system automatically advances to the voting phase when the turn timer expires
- FR12: The host can skip the active speaker's turn
- FR13: The system advances to the next player's turn after all votes are submitted or the voting window closes
- FR14: The system detects when all players have completed their turns and transitions to final results
- FR15: Each non-active player can submit a binary vote on whether the active speaker lied
- FR16: Each non-active player can submit an impressiveness rating on a numeric scale
- FR17: Players can view the count of submitted votes without seeing their content
- FR18: The system applies a zero-point penalty when a majority of voters indicate the active speaker lied
- FR19: The system calculates each player's impressiveness score as the average of submitted ratings
- FR20: The system accumulates each player's score across all turns in a round
- FR21: All players view the active speaker's prompt card after voting closes
- FR22: All players view the vote breakdown and impressiveness score for each completed turn
- FR23: All players view final standings with scores at the end of the round
- FR24: The results sequence shows the prompt card before displaying scores
- FR25: The system selects a prompt card for each turn without repeating cards within a session
- FR26: An administrator can manage the prompt card deck (add, view, remove cards)
- FR27: The system supports a minimum of 50 unique prompt cards
- FR28: The system automatically restores a player's connection after a brief disconnection without disrupting other players
- FR29: The system synchronizes current game state to a reconnecting player
- FR30: The system indicates to the host when a player has disconnected
- FR31: The system continues a session if a disconnected player does not return within a grace period

### NonFunctional Requirements

- NFR-P1: Application reaches interactive state within 5 seconds on mobile 4G (cold load)
- NFR-P2: SignalR messages broadcast to all connected clients within 200ms under normal conditions
- NFR-P3: Game phase transitions render on all clients within 500ms of server state change
- NFR-P4: Server-side 60-second turn timer deviates by no more than ±1 second
- NFR-P5: UI remains responsive during voting; does not freeze awaiting other players' submissions
- NFR-S1: All client-server traffic encrypted via HTTPS/WSS in production
- NFR-S2: Player name input sanitized before display to prevent XSS
- NFR-S3: 4-letter room code space large enough that accidental collisions are negligible at expected volumes
- NFR-S4: No PII stored; player names exist in memory only for session duration
- NFR-R1: A full session completes without server error under normal conditions
- NFR-R2: A player disconnecting and reconnecting mid-session does not terminate the session for remaining players
- NFR-R3: Server-side timer runs regardless of individual client connection state
- NFR-R4: Every game state has a defined next transition; no player can reach an unrecoverable UI state
- NFR-R5: Application available at production URL for the duration of any active session
- NFR-SC1: Server supports at least 10 concurrent game rooms without degraded performance
- NFR-SC2: Game room state is isolated; actions in one room cannot affect another room
- NFR-SC3: In-memory room store protected against race conditions when multiple players submit votes simultaneously

### Additional Requirements

- ARCH-1: 4-project .NET 10 solution (`StandupAndDeliver`, `StandupAndDeliver.Client`, `StandupAndDeliver.Shared`, `StandupAndDeliver.Tests`) created via `dotnet new` CLI; first implementation story
- ARCH-2: Shared project (`IGameClient`, `GamePhase` enum, all DTOs, `HubResult`) must exist before hub or client implementation
- ARCH-3: Multi-stage `Dockerfile` at solution root; `docker-compose.yml` for local dev; `fly.toml` for Fly.io deployment
- ARCH-4: SignalR WebSocket-only — `SkipNegotiation = true` + WebSocket transport in `Program.cs`
- ARCH-5: Serilog logging — `UseSerilog()` with console sink in `Program.cs`
- ARCH-6: `/health` endpoint via ASP.NET Core health checks for Fly.io liveness probe
- ARCH-7: EF Core + SQLite — `EnsureCreated()` on startup; `SeedData.cs` with minimum 50 prompt cards
- ARCH-8: Tailwind CSS v4 standalone CLI — MSBuild target in server `.csproj`; no Node.js
- ARCH-9: `visibilitychange` JS event listener (`game-interop.js` + `VisibilityInterop.cs`) for iOS Safari screen-lock reconnect

### UX Design Requirements

None — no UX design document provided.

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 2 | Room creation + 4-letter code |
| FR2 | Epic 2 | Join by room code + name entry |
| FR3 | Epic 2 | Live lobby player list |
| FR4 | Epic 2 | Host-only Start Game (3 player min) |
| FR5 | Epic 7 | Rejoin in-progress session |
| FR6 | Epic 2 | Room inactivity cleanup |
| FR7 | Epic 4 | Sequential turn advancement |
| FR8 | Epic 4 | Private prompt card to active speaker |
| FR9 | Epic 4 | 60-second server-side timer |
| FR10 | Epic 4 | Non-active player waiting state |
| FR11 | Epic 4 | Auto-advance to voting on timer expiry |
| FR12 | Epic 4 | Host skip turn |
| FR13 | Epic 5 | Advance after all votes submitted |
| FR14 | Epic 6 | Detect all turns complete → final results |
| FR15 | Epic 5 | Binary lie vote |
| FR16 | Epic 5 | Impressiveness rating (numeric scale) |
| FR17 | Epic 5 | Vote count indicator (no content) |
| FR18 | Epic 5 | Majority lie → 0 points |
| FR19 | Epic 5 | Impressiveness average calculation |
| FR20 | Epic 5 | Score accumulation across turns |
| FR21 | Epic 6 | Prompt card reveal to all |
| FR22 | Epic 6 | Vote breakdown + impressiveness display |
| FR23 | Epic 6 | Final standings screen |
| FR24 | Epic 6 | Card shown before scores |
| FR25 | Epic 3 | Without-repeat card selection |
| FR26 | Epic 3 | Admin deck management |
| FR27 | Epic 3 | 50+ unique cards |
| FR28 | Epic 7 | Auto-reconnect without disrupting others |
| FR29 | Epic 7 | State sync on reconnect |
| FR30 | Epic 7 | Disconnected player indicator |
| FR31 | Epic 7 | Grace period before session continues |

## Epic List

### Epic 1: Project Foundation & Infrastructure
The development team can initialize, run locally, and deploy the application. This epic establishes the 4-project solution structure, Docker containerization, Fly.io deployment config, Tailwind CSS build pipeline, Serilog logging, and health check endpoint.
**Requirements covered:** ARCH-1, ARCH-2, ARCH-3, ARCH-4, ARCH-5, ARCH-6, ARCH-8

### Epic 2: Room Creation & Lobby
Players can create a room, join via code, and wait together in a lobby until the host starts the game. Covers the full pre-game flow: room creation, 4-letter code generation, name entry, live lobby list, host Start Game control, and room inactivity cleanup.
**FRs covered:** FR1, FR2, FR3, FR4, FR6
**NFRs addressed:** NFR-S3

### Epic 3: Prompt Card Deck
The game has a deck of 50+ unique prompt cards served without repeating within a session. Covers EF Core + SQLite setup, seed data, without-repeat selection logic, and admin deck management.
**FRs covered:** FR25, FR26, FR27
**Requirements covered:** ARCH-7

### Epic 4: The Speaker's Turn
The active speaker receives their prompt card privately and the 60-second verbal delivery phase runs. Covers private card display, server-side countdown timer, waiting state for non-active players, auto-advance on expiry, host skip, and the dual-broadcast pattern.
**FRs covered:** FR7, FR8, FR9, FR10, FR11, FR12
**NFRs addressed:** NFR-P4, NFR-R3

### Epic 5: Voting & Scoring
Players vote on whether the speaker lied and rate their impressiveness; scores are calculated and applied. Covers voting screen, vote count indicator, majority lie detection, impressiveness averaging, score accumulation, and auto-advance after all votes.
**FRs covered:** FR13, FR15, FR16, FR17, FR18, FR19, FR20
**NFRs addressed:** NFR-SC3, NFR-P5

### Epic 6: Results & Reveal
After voting, the prompt card is revealed, scores are shown, and the game advances to the next turn or final standings. Covers card reveal (the punchline), turn results display, reveal-before-scores sequencing, turn advancement, and final standings screen.
**FRs covered:** FR14, FR21, FR22, FR23, FR24

### Epic 7: Reconnection & Session Resilience
A player who briefly disconnects (e.g., locks their phone) can rejoin without breaking the session for others. Covers iOS Safari visibilitychange hook, RejoinRoom hub method, full state sync, disconnected player indicator for host, and 30-second grace period.
**FRs covered:** FR5, FR28, FR29, FR30, FR31
**Requirements covered:** ARCH-9
**NFRs addressed:** NFR-R2, NFR-R4

---

## Epic 1: Project Foundation & Infrastructure

The development team can initialize, run locally, and deploy the application. This epic establishes the 4-project solution structure, Docker containerization, Fly.io deployment config, Tailwind CSS build pipeline, Serilog logging, and health check endpoint.

**Requirements covered:** ARCH-1, ARCH-2, ARCH-3, ARCH-4, ARCH-5, ARCH-6, ARCH-8

### Story 1.1: Initialize Solution Structure

As a **developer**,
I want a 4-project .NET 10 solution initialized with correct references,
So that all subsequent development has a consistent, buildable foundation.

**Acceptance Criteria:**

**Given** a developer clones the repository
**When** they run `dotnet build` from the solution root
**Then** all 4 projects build successfully with no errors
**And** project references are correct: Server → Shared, Client → Shared, Tests → Server + Client

**Given** the solution structure exists
**When** a developer inspects the solution
**Then** the following projects exist: `StandupAndDeliver` (server), `StandupAndDeliver.Client` (WASM), `StandupAndDeliver.Shared` (class library), `StandupAndDeliver.Tests` (xUnit)

---

### Story 1.2: Define Shared Contracts

As a **developer**,
I want the shared contracts (hub interface, enums, DTOs) defined in the Shared project,
So that the server hub and Blazor client can reference a single source of truth with no magic strings.

**Acceptance Criteria:**

**Given** the Shared project exists
**When** a developer references it from Server or Client
**Then** the following types are available: `IGameClient`, `GamePhase` enum (Lobby, SpeakerTurn, Voting, Reveal, GameOver), `GameStateDto`, `PlayerDto`, `TurnResultDto`, `HubResult`, `HubResult<T>`

**Given** `GamePhase` is defined
**When** a switch statement covers all values
**Then** there are exactly 5 cases with no default required to satisfy the compiler

**Given** `HubResult` is defined
**When** a hub method returns it
**Then** it carries `bool Success` and `string? Error` with no additional dependencies

---

### Story 1.3: Configure Server Infrastructure

As a **developer**,
I want the ASP.NET Core server configured with SignalR, Serilog, and a health check endpoint,
So that the real-time hub, structured logging, and liveness probe are ready for all subsequent stories.

**Acceptance Criteria:**

**Given** the server starts
**When** a client connects to `/gamehub`
**Then** the SignalR hub accepts WebSocket connections with `SkipNegotiation = true` and WebSocket-only transport

**Given** the server starts
**When** any log event is emitted
**Then** it is written to the console in Serilog structured format with level, timestamp, and message

**Given** the server is running
**When** a GET request is made to `/health`
**Then** the response is `200 OK` with body `Healthy`

**Given** `Program.cs` is reviewed
**When** checking transport configuration
**Then** HTTP long-polling and Server-Sent Events transports are explicitly disabled

---

### Story 1.4: Docker & Fly.io Deployment

As a **developer**,
I want the application containerized and deployable to Fly.io,
So that local development uses `docker compose up` and production deployment works via `fly deploy`.

**Acceptance Criteria:**

**Given** a developer runs `docker compose up` from the solution root
**When** the build completes
**Then** the application is accessible at `http://localhost:8080` and `/health` returns `200 OK`

**Given** the multi-stage `Dockerfile` exists at the solution root
**When** `docker build` is run
**Then** the final image contains only the published application (no SDK, no source files)

**Given** `fly.toml` exists at the solution root
**When** `fly deploy` is run with valid credentials
**Then** the application deploys successfully and `/health` returns `200 OK` at the production URL

**Given** the Docker image runs
**When** environment variables override `appsettings.json` values
**Then** the application uses the environment variable values

---

### Story 1.5: Tailwind CSS Build Integration

As a **developer**,
I want Tailwind CSS v4 built automatically as part of the .NET build process,
So that styling is available without any Node.js tooling or manual build steps.

**Acceptance Criteria:**

**Given** a developer runs `dotnet build` or `dotnet publish`
**When** the build completes
**Then** `wwwroot/css/app.css` is present and contains compiled Tailwind CSS output

**Given** a utility class is added to a Blazor component
**When** the project is built
**Then** that utility class is present in the compiled `app.css` output

**Given** the Tailwind standalone CLI binary is committed to the repository
**When** the build runs on a machine with no Node.js installed
**Then** the CSS build succeeds without error

---

---

## Epic 2: Room Creation & Lobby

Players can create a room, join via code, and wait together in a lobby until the host starts the game. Covers the full pre-game flow: room creation, 4-letter code generation, name entry, live lobby list, host Start Game control, and room inactivity cleanup.

**FRs covered:** FR1, FR2, FR3, FR4, FR6
**NFRs addressed:** NFR-S3

### Story 2.1: Create Room & Generate Room Code

As a **player**,
I want to create a new game room and receive a unique 4-letter room code,
So that I can share the code with friends and have them join my game.

**Acceptance Criteria:**

**Given** a player navigates to the home page
**When** they click "Create Room" and enter a display name
**Then** a new game room is created on the server and they are connected as host
**And** a unique 4-letter uppercase alphabetic room code is displayed to them

**Given** a room code is generated
**When** the room code space is considered (26^4 = 456,976 possible codes)
**Then** the probability of collision is negligible at the expected volume of concurrent rooms (≤10)

**Given** a room is created
**When** the server generates the room code
**Then** it verifies the code is not already in use before assigning it

---

### Story 2.2: Join Room by Code

As a **player**,
I want to join an existing game room by entering a room code and my display name,
So that I can participate in a game my friend created.

**Acceptance Criteria:**

**Given** a player is on the home page
**When** they enter a valid room code and a display name, then click "Join"
**Then** they are connected to the room and see the lobby screen

**Given** a player attempts to join
**When** the room code does not exist
**Then** an error message is displayed and they remain on the home page

**Given** a player attempts to join
**When** the display name entered is empty or whitespace
**Then** client-side validation prevents submission and an error is shown

**Given** a player enters a display name
**When** it is sent to the server
**Then** it is HTML-encoded before storage and broadcast to prevent XSS (NFR-S2)

**Given** a player joins a room
**When** the game has already started (phase is not Lobby)
**Then** the server returns an error and the player is not added to the room

---

### Story 2.3: Live Lobby Player List

As a **host**,
I want to see a live list of all players who have joined my room,
So that I know who is present before starting the game.

**Acceptance Criteria:**

**Given** a player joins a room
**When** the `JoinRoom` hub method completes successfully
**Then** all connected clients in that room receive an updated `GameStateDto` with the new player in the `Players` list

**Given** the lobby screen is displayed
**When** the `Players` list in `GameStateDto` is updated via SignalR
**Then** the UI re-renders within 500ms to show the current player list without a page reload (NFR-P3)

**Given** a player is viewing the lobby
**When** another player joins
**Then** the new player's name appears in the list in real time

---

### Story 2.4: Host Starts Game (3-Player Minimum)

As a **host**,
I want to start the game once at least 3 players have joined,
So that the game has enough participants to be fun.

**Acceptance Criteria:**

**Given** the host is in the lobby
**When** fewer than 3 players are present (including the host)
**Then** the "Start Game" button is disabled and a message indicates how many more players are needed

**Given** the host is in the lobby
**When** 3 or more players are present
**Then** the "Start Game" button is enabled

**Given** the host clicks "Start Game"
**When** the server validates the request (caller is host, phase is Lobby, ≥3 players)
**Then** the game phase transitions to `SpeakerTurn` and all clients receive the updated `GameStateDto`

**Given** a non-host player's client
**When** the game is in the Lobby phase
**Then** the "Start Game" button is not rendered (host-only control)

---

### Story 2.5: Room Inactivity Cleanup

As a **system operator**,
I want inactive game rooms to be automatically removed,
So that server memory is not consumed by abandoned sessions.

**Acceptance Criteria:**

**Given** a `RoomCleanupService` BackgroundService is running
**When** a room's last activity timestamp exceeds 30 minutes
**Then** the room is removed from the in-memory store

**Given** the cleanup service runs
**When** it scans for stale rooms
**Then** it runs on a periodic interval (every 5 minutes) without blocking other operations

**Given** a room is cleaned up
**When** any connected clients attempt hub method calls for that room code
**Then** the server returns a `HubResult` with `Success = false` and an appropriate error message

---

## Epic 3: Prompt Card Deck

The game has a deck of 50+ unique prompt cards served without repeating within a session. Covers EF Core + SQLite setup, seed data, without-repeat selection logic, and admin deck management.

**FRs covered:** FR25, FR26, FR27
**Requirements covered:** ARCH-7

### Story 3.1: EF Core + SQLite Data Layer

As a **developer**,
I want EF Core with SQLite configured and the database created on startup,
So that prompt cards are persisted across server restarts without a migration workflow.

**Acceptance Criteria:**

**Given** the server starts
**When** `EnsureCreated()` is called on the `AppDbContext`
**Then** the SQLite database file is created if it does not exist, with the `PromptCards` table present

**Given** the database is created
**When** the `PromptCards` table is empty
**Then** `SeedData.cs` inserts the full deck of prompt cards automatically on startup

**Given** the server restarts
**When** the database file already exists with seeded data
**Then** no duplicate cards are inserted (seed is idempotent)

**Given** `AppDbContext` is registered
**When** it is resolved from DI
**Then** it is registered with the SQLite connection string from `appsettings.json` (overridable via environment variable)

---

### Story 3.2: Seed 50+ Unique Prompt Cards

As a **game designer**,
I want at least 50 unique prompt cards in the database at first run,
So that players have enough variety for a full session without repetition.

**Acceptance Criteria:**

**Given** `SeedData.cs` runs on a fresh database
**When** the seed completes
**Then** at least 50 distinct prompt card records exist in the `PromptCards` table

**Given** the prompt cards are seeded
**When** any two cards are compared
**Then** no two cards have identical prompt text

**Given** a prompt card record
**When** its schema is inspected
**Then** it contains at minimum: `Id` (int, PK), `Text` (string, required), `IsActive` (bool, default true)

---

### Story 3.3: Without-Repeat Card Selection

As a **player**,
I want the game to select a different prompt card for each turn within a session,
So that no card is repeated during a single game.

**Acceptance Criteria:**

**Given** a game session starts
**When** the first turn begins
**Then** a prompt card is selected at random from the pool of active cards not yet used in this session

**Given** a card has been used in the current session
**When** the next turn begins
**Then** that card is not eligible for selection again in the same session

**Given** a `GameRoom` tracks used card IDs
**When** a card is assigned to a turn
**Then** its ID is added to the session's used-card set before broadcasting to the active speaker

**Given** all active cards have been used in a session
**When** a new turn would start
**Then** the server logs a warning and the turn is handled gracefully (no unhandled exception)

---

### Story 3.4: Admin Prompt Card Management

As an **administrator**,
I want to add, view, and remove prompt cards via a protected admin endpoint,
So that I can curate the card deck without modifying the database directly.

**Acceptance Criteria:**

**Given** a GET request to `/admin/cards` with valid admin credentials
**When** the request is processed
**Then** a JSON list of all prompt cards (id, text, isActive) is returned with `200 OK`

**Given** a POST request to `/admin/cards` with a JSON body `{ "text": "..." }` and valid credentials
**When** the card text is non-empty
**Then** a new card is inserted and the response returns `201 Created` with the new card's id

**Given** a DELETE request to `/admin/cards/{id}` with valid credentials
**When** the card id exists
**Then** the card's `IsActive` flag is set to `false` (soft delete) and `204 No Content` is returned

**Given** any request to `/admin/*`
**When** the request does not include valid admin credentials
**Then** the response is `401 Unauthorized`

**Given** the admin credentials
**When** they are configured
**Then** they are read from environment variables (not hardcoded) and the endpoint uses HTTP Basic auth

---

## Epic 4: The Speaker's Turn

The active speaker receives their prompt card privately and the 60-second verbal delivery phase runs. Covers private card display, server-side countdown timer, waiting state for non-active players, auto-advance on expiry, host skip, and the dual-broadcast pattern.

**FRs covered:** FR7, FR8, FR9, FR10, FR11, FR12
**NFRs addressed:** NFR-P4, NFR-R3

### Story 4.1: Sequential Turn Advancement

As a **player**,
I want the game to advance through each player's turn in order,
So that every player gets exactly one turn as the active speaker per round.

**Acceptance Criteria:**

**Given** the game transitions to `SpeakerTurn` phase
**When** the first turn begins
**Then** the first player in the room's player list is designated as the active speaker

**Given** a turn completes (timer expires, skip, or voting finishes)
**When** the server advances to the next turn
**Then** the next player in sequence becomes the active speaker and receives their prompt card

**Given** `GameStateDto` is broadcast
**When** any client receives it during `SpeakerTurn` phase
**Then** `ActivePlayerName` is set to the current speaker's display name

**Given** all players have completed their turns
**When** the last turn ends
**Then** the server transitions to `GameOver` phase rather than selecting a next speaker

---

### Story 4.2: Private Prompt Card Dual Broadcast

As an **active speaker**,
I want to see my assigned prompt card privately,
So that other players cannot read the card and must judge my delivery honestly.

**Acceptance Criteria:**

**Given** a turn begins
**When** the server broadcasts `GameStateDto` to the room group
**Then** `PromptCardText` is `null` in the group broadcast

**Given** a turn begins
**When** the server sends a targeted message to the active speaker's connection
**Then** that `GameStateDto` contains the actual `PromptCardText` value

**Given** a non-active player's client
**When** it receives `GameStateDto` during `SpeakerTurn`
**Then** `PromptCardText` is null and no card text is rendered in the UI

**Given** the active speaker's client
**When** it receives `GameStateDto` during `SpeakerTurn`
**Then** the prompt card text is displayed prominently on their screen

---

### Story 4.3: Server-Side 60-Second Turn Timer

As a **player**,
I want the turn timer to run on the server,
So that the time limit is enforced fairly regardless of any individual client's state.

**Acceptance Criteria:**

**Given** a turn begins
**When** `GameTimerService` starts the countdown
**Then** a `PeriodicTimer` fires every second, decrementing `SecondsRemaining` in `GameStateDto`

**Given** the timer is ticking
**When** each tick occurs
**Then** `ReceiveTimerTick` is broadcast to all clients in the room with the updated `SecondsRemaining` value

**Given** the timer reaches zero
**When** `SecondsRemaining` hits 0
**Then** the server automatically transitions the game phase to `Voting` without any client action

**Given** a player disconnects mid-turn
**When** the timer is running
**Then** the countdown continues unaffected on the server (NFR-R3)

**Given** the server-side timer
**When** measured under normal conditions
**Then** the 60-second duration deviates by no more than ±1 second (NFR-P4)

---

### Story 4.4: Non-Active Player Waiting State

As a **non-active player**,
I want to see who is currently speaking and that a turn is in progress,
So that I know what is happening and can prepare to vote.

**Acceptance Criteria:**

**Given** the game is in `SpeakerTurn` phase
**When** a non-active player's screen renders
**Then** the active speaker's display name is shown clearly

**Given** the game is in `SpeakerTurn` phase
**When** a non-active player's screen renders
**Then** the remaining time is displayed and counts down in real time as `ReceiveTimerTick` messages arrive

**Given** the game is in `SpeakerTurn` phase
**When** a non-active player's screen renders
**Then** no prompt card text is visible to them

---

### Story 4.5: Host Skip Turn

As a **host**,
I want to skip the active speaker's turn,
So that I can keep the game moving if a player is stuck or needs to pass.

**Acceptance Criteria:**

**Given** the game is in `SpeakerTurn` phase
**When** the host invokes the `SkipTurn` hub method
**Then** the server validates the caller is the host, cancels the active timer, and transitions to `Voting` phase

**Given** the `SkipTurn` hub method is called
**When** the caller is not the host
**Then** the server returns `HubResult` with `Success = false` and an error message; no state change occurs

**Given** a non-host player's client
**When** the game is in `SpeakerTurn` phase
**Then** the skip control is not rendered in the UI

**Given** the host skips a turn
**When** the phase transitions to `Voting`
**Then** all clients receive the updated `GameStateDto` reflecting the new phase within 500ms (NFR-P3)

---

## Epic 5: Voting & Scoring

Players vote on whether the speaker lied and rate their impressiveness; scores are calculated and applied. Covers voting screen, vote count indicator, majority lie detection, impressiveness averaging, score accumulation, and auto-advance after all votes.

**FRs covered:** FR13, FR15, FR16, FR17, FR18, FR19, FR20
**NFRs addressed:** NFR-SC3, NFR-P5

### Story 5.1: Voting Screen

As a **non-active player**,
I want to submit a binary lie vote and an impressiveness rating during the voting phase,
So that I can judge the speaker's performance.

**Acceptance Criteria:**

**Given** the game transitions to `Voting` phase
**When** a non-active player's screen renders
**Then** they see two controls: a binary "Lied / Didn't Lie" selector and a numeric impressiveness rating (1–5 scale)

**Given** a non-active player is on the voting screen
**When** they submit their vote
**Then** both the lie vote and impressiveness rating are required; submission is blocked if either is missing

**Given** a non-active player submits their vote
**When** the `SubmitVote` hub method is called
**Then** the server returns `HubResult` with `Success = true` and the player's vote is recorded

**Given** a player has already submitted their vote
**When** they attempt to submit again
**Then** the server returns `HubResult` with `Success = false` and their original vote is unchanged

**Given** the active speaker's client
**When** the game is in `Voting` phase
**Then** the voting controls are not rendered (they cannot vote on their own turn)

---

### Story 5.2: Vote Count Indicator

As a **player**,
I want to see how many votes have been submitted without seeing their content,
So that I know when voting is nearly complete without being influenced by others.

**Acceptance Criteria:**

**Given** the game is in `Voting` phase
**When** any player submits a vote
**Then** all clients receive a `ReceiveVoteCount` message with `VotesSubmitted` and `VotesTotal` updated

**Given** `GameStateDto` is received during `Voting` phase
**When** the UI renders
**Then** a count such as "2 of 4 votes submitted" is displayed to all players

**Given** the vote count updates
**When** the UI re-renders
**Then** the voting controls remain interactive and the page does not freeze (NFR-P5)

---

### Story 5.3: Auto-Advance After All Votes

As a **player**,
I want the game to advance automatically once all votes are submitted,
So that the game keeps moving without the host having to manually trigger the next step.

**Acceptance Criteria:**

**Given** a vote is submitted
**When** `VotesSubmitted` equals `VotesTotal` (all non-active players have voted)
**Then** the server immediately transitions the phase to `Reveal`

**Given** the voting window
**When** not all players have voted and the turn timer has already expired
**Then** the server transitions to `Reveal` after a fixed 30-second voting window closes

**Given** the phase transitions to `Reveal`
**When** it is triggered by vote completion or timeout
**Then** all clients receive the updated `GameStateDto` within 500ms (NFR-P3)

---

### Story 5.4: Score Calculation & Accumulation

As a **player**,
I want my score to be calculated and accumulated fairly after each turn,
So that the final standings reflect the quality of every player's performance.

**Acceptance Criteria:**

**Given** all votes for a turn are collected
**When** the server calculates the turn result
**Then** if a strict majority of voters selected "Lied", the active speaker's turn score is 0

**Given** all votes for a turn are collected
**When** no majority lie is detected
**Then** the active speaker's turn score equals the average of all submitted impressiveness ratings, rounded to one decimal place

**Given** a turn result is calculated
**When** the score is applied
**Then** it is added to the player's cumulative score in `GameRoom` state

**Given** concurrent vote submissions arrive simultaneously
**When** the server processes them
**Then** a `SemaphoreSlim(1,1)` per room ensures only one vote is written at a time with no data corruption (NFR-SC3)

**Given** `TurnResultDto` is populated after scoring
**When** it is included in `GameStateDto`
**Then** it contains: `ActivePlayerName`, `PromptCardText`, `LiedVoteCount`, `TotalVoteCount`, `ImpressionScore`, `TurnScore`

---

## Epic 6: Results & Reveal

After voting, the prompt card is revealed, scores are shown, and the game advances to the next turn or final standings. Covers card reveal (the punchline), turn results display, reveal-before-scores sequencing, turn advancement, and final standings screen.

**FRs covered:** FR14, FR21, FR22, FR23, FR24

### Story 6.1: Prompt Card Reveal

As a **player**,
I want to see the active speaker's prompt card after voting closes,
So that I can discover the punchline and judge whether they were telling the truth.

**Acceptance Criteria:**

**Given** the phase transitions to `Reveal`
**When** all clients receive the updated `GameStateDto`
**Then** `PromptCardText` in the broadcast is now populated with the actual card text for all players

**Given** the Reveal screen renders
**When** the card text is displayed
**Then** it appears before any score information is shown on the screen (FR24)

**Given** a player who was the active speaker
**When** the Reveal screen renders
**Then** they see the same card text they were shown during their turn

---

### Story 6.2: Turn Results Display

As a **player**,
I want to see the full vote breakdown and impressiveness score after each turn,
So that I understand how the speaker was judged before the game moves on.

**Acceptance Criteria:**

**Given** the Reveal phase is active
**When** the results screen renders
**Then** the following are displayed: the prompt card text, the speaker's name, lie vote count vs total votes, the impressiveness score, and the turn score awarded

**Given** the turn score is displayed
**When** a majority lie was detected
**Then** the UI clearly indicates the speaker received 0 points due to the lie penalty

**Given** the Reveal screen is shown
**When** the host views it
**Then** a "Next Turn" or "See Final Results" button is present to advance the game manually

**Given** the host clicks "Next Turn"
**When** more players still have turns remaining
**Then** the server transitions to `SpeakerTurn` for the next player and all clients receive the updated `GameStateDto`

---

### Story 6.3: Detect End of Round & Transition to Final Results

As a **player**,
I want the game to automatically detect when all players have taken their turn,
So that the session concludes and final standings are shown without manual intervention.

**Acceptance Criteria:**

**Given** the host advances from the Reveal phase
**When** all players have completed their turns
**Then** the server transitions the phase to `GameOver` instead of `SpeakerTurn`

**Given** the phase is `GameOver`
**When** all clients receive the updated `GameStateDto`
**Then** the `Players` list contains each player's final cumulative score

**Given** the transition to `GameOver` occurs
**When** any client renders
**Then** the final standings screen is shown (not the speaker turn or voting screen)

---

### Story 6.4: Final Standings Screen

As a **player**,
I want to see the final standings with all players' scores at the end of the round,
So that the winner is clear and the game has a satisfying conclusion.

**Acceptance Criteria:**

**Given** the game phase is `GameOver`
**When** the final standings screen renders
**Then** all players are listed in descending score order with their display name and total score

**Given** two or more players have equal scores
**When** they are ranked
**Then** tied players are displayed at the same rank position

**Given** the final standings screen is shown
**When** a player views it
**Then** their own name is visually highlighted to make their result easy to find

**Given** the final standings screen is shown
**When** the host views it
**Then** a "Play Again" or "Back to Home" option is available to end the session gracefully

---

## Epic 7: Reconnection & Session Resilience

A player who briefly disconnects (e.g., locks their phone) can rejoin without breaking the session for others. Covers iOS Safari visibilitychange hook, RejoinRoom hub method, full state sync, disconnected player indicator for host, and 30-second grace period.

**FRs covered:** FR5, FR28, FR29, FR30, FR31
**Requirements covered:** ARCH-9
**NFRs addressed:** NFR-R2, NFR-R4

### Story 7.1: Automatic Reconnection with WithAutomaticReconnect

As a **player**,
I want the app to attempt reconnection automatically after a brief disconnection,
So that a momentary network hiccup does not remove me from the game.

**Acceptance Criteria:**

**Given** a SignalR connection is configured on the Blazor client
**When** `HubConnectionBuilder` is constructed
**Then** `WithAutomaticReconnect()` is applied with a retry policy (e.g., 0s, 2s, 5s, 10s intervals)

**Given** a player's connection drops briefly
**When** SignalR successfully reconnects
**Then** the `Reconnected` callback fires and immediately invokes `RejoinRoom` with the player's room code and name

**Given** `RejoinRoom` is invoked on reconnect
**When** the server processes it
**Then** the player is re-added to the SignalR group for their room and receives a full `GameStateDto` sync

**Given** a player reconnects
**When** the reconnection completes
**Then** other players in the room are not disconnected or disrupted (NFR-R2)

---

### Story 7.2: iOS Safari visibilitychange Reconnect Hook

As a **player on iOS Safari**,
I want the app to detect when I return from a locked screen and trigger reconnection,
So that screen-locking my phone does not permanently drop me from the game.

**Acceptance Criteria:**

**Given** `game-interop.js` is loaded with the Blazor app
**When** the `visibilitychange` event fires with `document.visibilityState === 'visible'`
**Then** a .NET `VisibilityInterop` method is invoked via JS interop

**Given** `VisibilityInterop.cs` receives the visibility-restored event
**When** the SignalR connection state is `Disconnected` or `Reconnecting`
**Then** it triggers a manual reconnect attempt and subsequently calls `RejoinRoom`

**Given** the `visibilitychange` listener is registered
**When** the component is disposed (`IAsyncDisposable`)
**Then** the JS event listener is removed to prevent memory leaks

---

### Story 7.3: Rejoin In-Progress Session

As a **player**,
I want to rejoin a game that is already in progress by entering my room code,
So that I can return to the game after a longer absence or browser refresh.

**Acceptance Criteria:**

**Given** a player navigates to the home page while a session is in progress
**When** they enter the room code and their original display name, then click "Join"
**Then** the `RejoinRoom` hub method is invoked on the server

**Given** `RejoinRoom` is called
**When** the room exists and the display name matches a player already in the room
**Then** the player is reconnected, added back to the SignalR group, and receives a full `GameStateDto`

**Given** `RejoinRoom` is called
**When** the display name does not match any player in the room
**Then** the server returns `HubResult` with `Success = false` and an appropriate error

**Given** a player rejoins
**When** their `PlayerDto.IsConnected` was `false`
**Then** it is set back to `true` and the host's lobby/game view updates to reflect reconnection

---

### Story 7.4: Disconnected Player Indicator for Host

As a **host**,
I want to see when a player has disconnected,
So that I know whether to wait for them or continue the session.

**Acceptance Criteria:**

**Given** a player's SignalR connection drops
**When** `OnDisconnectedAsync` fires on the hub
**Then** the player's `IsConnected` flag is set to `false` in `GameRoom` state and all clients receive the updated `GameStateDto`

**Given** the host's screen renders
**When** a player has `IsConnected = false`
**Then** that player's name is visually marked as disconnected (e.g., greyed out or with an indicator)

**Given** a disconnected player rejoins
**When** `RejoinRoom` completes successfully
**Then** their `IsConnected` flag returns to `true` and the disconnected indicator clears for all clients

---

### Story 7.5: Grace Period Before Session Continues

As a **player**,
I want the game to wait briefly for a disconnected player before continuing without them,
So that a short disconnect does not permanently remove someone from the session.

**Acceptance Criteria:**

**Given** a player disconnects during an active session
**When** `OnDisconnectedAsync` fires
**Then** a 30-second `CancellationTokenSource` grace period timer starts for that player

**Given** the disconnected player rejoins within 30 seconds
**When** `RejoinRoom` is called
**Then** the grace period timer is cancelled and the session continues normally with the player included

**Given** the 30-second grace period expires
**When** the player has not rejoined
**Then** the session continues without that player (they are marked inactive but not removed from standings)

**Given** a disconnected active speaker's grace period expires during `SpeakerTurn`
**When** the session continues
**Then** the turn is auto-skipped and the game advances to the next player (NFR-R4)
