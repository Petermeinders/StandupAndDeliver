---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain-skipped, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish, step-12-complete]
workflowStatus: complete
completedDate: 2026-03-25
inputDocuments:
  - planning_artifacts/research/technical-standup-and-deliver-research-2026-03-25.md
workflowType: 'prd'
classification:
  projectType: web_app
  domain: general
  complexity: medium
  projectContext: greenfield
briefCount: 0
researchCount: 1
brainstormingCount: 0
projectDocsCount: 0
---

# Product Requirements Document - Standup & Deliver

**Author:** Peter
**Date:** 2026-03-25

---

## Executive Summary

*Standup & Deliver* is a no-install, phone-only real-time party game for 3–8 players that satirizes corporate daily standup culture. Players join a shared session via a 4-letter room code on their smartphone browser — no app download, no shared TV screen required. Each round, one player receives a mundane work task on their phone (e.g., "Cleaned a printer jam") and has 60 seconds to verbally deliver it as if it were a monumental corporate achievement. Other players vote: did they lie, and how impressive was the spin (1–10)? The comedy lands in the reveal — the gap between the absurdly simple card and the corporate jargon performance is the entire joke. Works anywhere people can hear each other: a living room, a Zoom call, an office happy hour.

**Target users:** Office workers and former office workers who have inflated trivial tasks in status meetings — virtually anyone who has worked a corporate job.

**Problem solved:** Party games require shared screens, app installs, or complex setup. *Standup & Deliver* requires nothing except phones already in everyone's pockets and a shared sense of humor about work.

**Core differentiator:** The reveal mechanic — showing the card after the verbal performance — is the comedic punchline the entire game is built around. The simpler the real task, the harder the laugh. Every player's phone is an equal terminal; there is no dominant screen. This makes setup near-zero and allows the game to function identically in-person or on a video call.

**Stack:** Blazor WebAssembly SPA + ASP.NET Core + SignalR. Greenfield, solo developer, 4-week MVP. Dockerized for local development and Fly.io deployment.

---

## Success Criteria

### User Success

- Players can join a session and understand how to play without explanation beyond the on-screen prompt
- A full round completes — every player takes one turn, the group receives results — without confusion about what to do next
- The reveal moment (card shown after voting) lands as the comedic punchline
- The game remains engaging at the 3-player minimum count

### Business Success

- A complete, playable session hosted at a public URL, shareable with a friend group
- Zero session-ending crashes or errors during a normal playthrough
- Works on iOS Safari and Android Chrome without degraded experience
- Achievable by a solo developer within a 4-week build window

### Technical Success

- The entire application builds and runs inside Docker; local development and production deployment both use Docker
- A full round completes without errors in normal conditions
- The SignalR connection survives the full session duration including phase transitions and voting
- Game state remains consistent across all connected players throughout the round
- No player is stuck in an unrecoverable UI state during normal play
- Works on mobile browsers without requiring desktop fallback

### Measurable Outcomes

| Outcome | Definition of Done |
|---|---|
| Session completable | Host creates room → all players join → all turns complete → results shown → game ends cleanly |
| Mobile functional | Full session playable on iOS Safari and Android Chrome |
| Reconnect survivable | A player who briefly loses connection (e.g., locks phone) can rejoin without breaking the session |
| Prompt variety | Minimum 50 unique prompt cards in the deck at launch |
| Player range | Supports 3–8 players in a single session |
| Containerized | Application runs fully via `docker compose up` locally and deploys via Docker to Fly.io |

---

## Product Scope

### MVP (Phase 1)

- Room creation with 4-letter code
- Player join by code (no account, name entry only)
- One round: every player takes one turn as active speaker
- Active player sees their prompt card privately; 60-second server-side timer
- All other players vote: lie or not (binary) + impressiveness score (1–10)
- Card reveal + results screen after all votes are in
- Final standings after all turns complete
- Host controls: start game, skip a player's turn
- Reconnect handling: player can re-join mid-session via room code
- Prompt card deck: minimum 50 cards in SQLite
- Dockerized: runs locally via `docker compose up`; deploys to Fly.io via Docker image

### Growth (Phase 2 — Post-MVP)

- **Multiple rounds** — configurable count; running totals carry over
- **Lie detection scoring** — majority vote triggers "FIRED" penalty; balance refined after playtesting
- **Room persistence** — host replays with same group without re-entering names
- **Custom prompt cards** — host submits cards before starting
- **Spectator mode** — join as watcher without taking turns
- **Leaderboard** — persistent scores across sessions for a friend group

### Vision (Phase 3)

- **Live mic capture** — performance recorded and replayed during reveal; audio on results screen
- **Expansion packs** — themed decks (startup culture, remote work, middle management)
- **Public rooms** — strangers join open sessions; matchmaking by player count
- **Async mode** — submit recorded audio on your own time; group votes later

---

## User Journeys

### Journey 1: The Host — "Let's Play at Happy Hour"

**Persona:** Marcus, a mid-level project manager. It's Friday afternoon and his team's virtual happy hour is starting in 5 minutes.

**Scene:** Marcus opens his phone browser, hits "Create Room," enters his name. A 4-letter code — **QRKZ** — appears large on his screen. He reads it aloud on Zoom. He watches his lobby update in real-time as each teammate joins. Once all 4 are in, "Start Game" activates. He taps it.

**Play:** The game runs itself. Marcus gets "Replied to a Slack message" and spins it into a cross-functional stakeholder alignment initiative. His teammates lose it. Final results show him in third place; nobody cares — everyone's quoting his performance back at him.

**Outcome:** Marcus shares the scoreboard in Zoom chat. The team asks to play again next week. Total setup: under 2 minutes.

**Requirements revealed:** Room creation, name entry, live lobby with player list, host-only Start button, game flow automation, final results screen.

---

### Journey 2: The Voter — "What Did She Just Say?"

**Persona:** Priya, Marcus's teammate. She's never played before.

**Scene:** Priya hears "QRKZ," opens her phone browser, types the URL, enters her name, lands in the lobby. No tutorial. It just works.

**Play:** Game starts. Priya sees "Waiting for [player]'s turn..." and hears her coworker performing on Zoom. Her phone shifts to a voting screen: *"Did they lie? Yes / No"* and a 1–10 impressiveness slider. She votes.

**Outcome:** The results screen shows — "Sent a meeting invite" — and everyone erupts. When Priya's turn comes, her phone shows her prompt privately. She delivers, scores 7.5 impressiveness, finishes third. She texts the URL to her partner immediately after.

**Requirements revealed:** Join by code, name entry, waiting state, voting screen (lie binary + impressiveness 1–10), automatic turn advancement, private prompt display, results reveal with card shown.

---

### Journey 3: The Active Speaker — "The Moment of Truth"

**Persona:** Derek, mid-game, whose turn it is.

**Scene:** Derek's phone transitions from waiting to a new screen: *"Fixed a formula in an Excel spreadsheet."* A 60-second countdown starts. He weaves "data integrity remediation" and "cross-departmental reporting pipeline optimization" into his explanation. His phone just shows the prompt and the ticking timer — no tapping required during the performance.

**Play:** Timer hits zero. Derek's screen shows "Voting in progress..." with a vote count (3 of 4) but no content. Final vote in: *Lie vote: 2 Yes / 2 No — No majority. Impressiveness: 6.8 average.* Card revealed to all; group reacts.

**Outcome:** Derek earns 6.8 points. Screen returns to waiting as the next turn begins. If majority had voted "lied," he'd have scored 0.

**Requirements revealed:** Private prompt display, server-side 60-second timer, voting progress indicator (count only), majority lie detection, 0-point penalty on majority lie, card reveal, automatic advance.

---

### Journey 4: The Disconnected Player — "Phone Died for a Second"

**Persona:** Jamie, who locked their phone during someone else's turn.

**Scene:** Jamie's screen locks during the voting phase. The connection drops after 30 seconds. Jamie unlocks — the tab is still open. Connection restores automatically; game state syncs back. If it's now Jamie's turn, their prompt appears. If not, the waiting screen shows.

**Outcome:** Jamie continues normally. No one else's session was affected.

**Requirements revealed:** Automatic reconnect, `RejoinRoom` hub method on reconnect, server-authoritative state sync, graceful mid-phase reconnect without disrupting other players.

---

### Journey Requirements Summary

| Capability | Revealed By |
|---|---|
| Room creation + 4-letter code | Journey 1 |
| Name entry, no account required | Journeys 1, 2 |
| Live lobby with player list | Journey 1 |
| Host-only Start Game control | Journey 1 |
| Private prompt display (active player only) | Journeys 2, 3 |
| Server-side 60-second countdown timer | Journey 3 |
| Voting: lie binary + impressiveness 1–10 | Journeys 2, 3 |
| Voting progress indicator (count, not content) | Journey 3 |
| Majority lie detection → 0 points | Journey 3 |
| Card reveal after voting closes | Journeys 2, 3 |
| Automatic turn advancement | Journeys 2, 3 |
| Final standings screen | Journey 1 |
| Reconnect + state sync | Journey 4 |
| Mobile browser first-class support | All journeys |

---

## Innovation & Differentiation

### No-Screen Party Format

*Standup & Deliver* inverts the standard party game model. Where Jackbox-style games require a host TV, this game has no dominant screen — every player's phone is an equal terminal. The phone is invisible infrastructure; the experience is entirely verbal and social.

Consequences:
- Setup is near-zero: join via room code, no install, no TV
- Remote play is first-class: identical experience over Zoom or in a living room
- Scales without hardware: any 3–8 people with phones can play

### Verbal Performance as Mechanic

The active player never types. They read their card privately, then speak aloud. The game is scored on what the group heard, not what was submitted to a system:

- No AI scoring, no speech recognition, no processing latency
- Comedy is human-generated and human-judged
- Zero connectivity requirements during the performance phase (phone just shows card and timer)

### The Reveal as Punchline

The prompt card is hidden until after performance and voting are complete. Perform → vote → reveal. The gap between the mundane task and the corporate spin *is the joke*, and it only lands if the reveal is the last thing the group sees.

No competitor in the "phone-only party game" space occupies the "corporate satire, verbal performance, no shared screen" niche.

### Validation Approach

Highest-risk variable: prompt card quality. Cards must be mundane enough to be relatable but specific enough to be funny. Playtest with 10–15 cards before finalizing the 50-card MVP deck. Cards that don't land get cut.

---

## Web App Technical Requirements

### Architecture

**SPA:** Blazor WebAssembly Hosted (Client / Server / Shared). Single `GameRoom.razor` component switches UI via `@switch` on `GamePhase` enum — no page navigation during a session.

**Real-Time Layer:** SignalR WebSockets with `SkipNegotiation = true`, WebSocket-only transport. Eliminates Fly.io sticky session requirements; no Redis backplane needed. All game state transitions pushed server-to-client via hub.

**Server-Authoritative State:** All game logic (turn order, timer, vote tallying, lie detection, scoring) executes on the server. Client renders whatever state it receives. Reconnecting clients request current state and re-render from scratch.

**Deployment:** Multi-stage Docker build from solution root. `docker compose up` for local development. Fly.io via Docker image for production.

### Browser Support

| Browser | Platform | Support Level |
|---|---|---|
| Safari (latest) | iOS 15+ | Primary |
| Chrome (latest) | Android | Primary |
| Chrome (latest) | Desktop | Secondary |
| Firefox (latest) | Desktop | Secondary |
| Safari (latest) | macOS | Secondary |

**iOS Safari constraints:** `WithAutomaticReconnect()` alone insufficient for screen-lock disconnects; `visibilitychange` JS Interop listener required. ConnectionId changes on every reconnect; `RejoinRoom` hub method must be called in every `Reconnected` callback.

### Responsive Design

Phone-portrait-first (375px–430px viewport). All interactive surfaces (join form, lobby list, voting controls, prompt card, timer) operable with one thumb. No horizontal scrolling. No pinch-zoom required. Desktop adapts gracefully; not optimized for large screens in MVP.

### Implementation Constraints

- **No authentication:** Name entry only. No accounts, no server-side sessions, no GDPR-sensitive data stored.
- **No SEO:** Shared-link party game, not a content destination. Landing page requires title, description, and "Create Room" CTA only.
- **Minimal HTTP surface:** ~3 endpoints (room creation, health check, prompt count). All game logic flows through the SignalR hub.
- **Client state:** `GameStateService` singleton on the Blazor client; avoids prop-drilling across phase components.
- **Component lifecycle:** All components holding a `HubConnection` implement `IAsyncDisposable`; call `StopAsync()` then `DisposeAsync()` in sequence.

---

## Project Scoping

### MVP Strategy

**Approach:** Experience MVP. Validated the moment someone texts the URL to a friend after playing.

**Completion definition:** Host creates room → all players join → all complete one turn → results shown → session ends cleanly. No crashes. Works on iOS Safari and Android Chrome.

**Cut order if timeline pressure hits:** reconnect handling → skip-player control → custom prompts. Irreducible core: join → play → reveal → results.

### Risk Register

| Risk | Mitigation |
|---|---|
| SignalR reconnect on iOS Safari | `visibilitychange` JS hook + `RejoinRoom` on every `Reconnected` callback; researched before build |
| Fly.io sticky sessions | Eliminated by `SkipNegotiation = true` + WebSocket-only transport |
| Blazor WASM bundle size on 4G | Monitor initial load; AOT deferred; single-screen architecture minimizes lazy-load need |
| Prompt card quality | Playtest 10–15 cards before writing full deck; cut cards that don't land |
| Solo dev scope creep | Hard phase boundary; all Growth/Vision features explicitly deferred |

---

## Functional Requirements

> Capability contract. Every downstream design, architecture, and implementation decision traces back to this list. Capabilities not listed here will not exist in the final product.

### Session Management

- **FR1:** A player can create a new game room and receive a unique 4-letter room code
- **FR2:** A player can join an existing game room by entering a room code and their display name
- **FR3:** The host can view the live list of players in the lobby
- **FR4:** The host can start the game once at least 3 players have joined
- **FR5:** A player can rejoin an in-progress session using the original room code after a disconnection
- **FR6:** The system removes a game room and its state after a period of inactivity

### Turn & Game Flow

- **FR7:** The system advances through all players' turns sequentially, one player designated as active speaker per turn
- **FR8:** The active speaker can view their assigned prompt card privately (not visible to other players)
- **FR9:** The system enforces a 60-second time limit on the active speaker's turn
- **FR10:** Non-active players can see that a turn is in progress and who the active speaker is
- **FR11:** The system automatically advances to the voting phase when the turn timer expires
- **FR12:** The host can skip the active speaker's turn
- **FR13:** The system advances to the next player's turn after all votes are submitted or the voting window closes
- **FR14:** The system detects when all players have completed their turns and transitions to final results

### Voting & Scoring

- **FR15:** Each non-active player can submit a binary vote on whether the active speaker lied
- **FR16:** Each non-active player can submit an impressiveness rating on a numeric scale
- **FR17:** Players can view the count of submitted votes without seeing their content
- **FR18:** The system applies a zero-point penalty when a majority of voters indicate the active speaker lied
- **FR19:** The system calculates each player's impressiveness score as the average of submitted ratings
- **FR20:** The system accumulates each player's score across all turns in a round

### Results & Reveal

- **FR21:** All players view the active speaker's prompt card after voting closes
- **FR22:** All players view the vote breakdown and impressiveness score for each completed turn
- **FR23:** All players view final standings with scores at the end of the round
- **FR24:** The results sequence shows the prompt card before displaying scores

### Prompt Card Management

- **FR25:** The system selects a prompt card for each turn without repeating cards within a session
- **FR26:** An administrator can manage the prompt card deck (add, view, remove cards)
- **FR27:** The system supports a minimum of 50 unique prompt cards

### Connectivity & Presence

- **FR28:** The system automatically restores a player's connection after a brief disconnection without disrupting other players
- **FR29:** The system synchronizes current game state to a reconnecting player
- **FR30:** The system indicates to the host when a player has disconnected
- **FR31:** The system continues a session if a disconnected player does not return within a grace period

---

## Non-Functional Requirements

### Performance

- **NFR-P1:** Application reaches interactive state within 5 seconds on mobile 4G (cold load)
- **NFR-P2:** SignalR messages broadcast to all connected clients within 200ms under normal network conditions
- **NFR-P3:** Game phase transitions render on all clients within 500ms of the server state change
- **NFR-P4:** Server-side 60-second turn timer deviates by no more than ±1 second over its full duration
- **NFR-P5:** UI remains responsive during voting; does not freeze while awaiting other players' submissions

### Security

- **NFR-S1:** All client-server traffic encrypted via HTTPS/WSS in production
- **NFR-S2:** Player name input sanitized before display to prevent XSS
- **NFR-S3:** 4-letter room code space large enough that accidental collisions are negligible at expected session volumes
- **NFR-S4:** No PII stored; player names exist in memory only for session duration

### Reliability

- **NFR-R1:** A full session (all players completing one turn) completes without server error under normal conditions
- **NFR-R2:** A player disconnecting and reconnecting mid-session does not terminate the session for remaining players
- **NFR-R3:** Server-side timer runs regardless of individual client connection state
- **NFR-R4:** Every game state has a defined next transition; no player can reach an unrecoverable UI state during normal play
- **NFR-R5:** Application available at production URL for the duration of any active session (single-instance Fly.io deployment acceptable for MVP scale)

### Scalability

- **NFR-SC1:** Server supports at least 10 concurrent game rooms without degraded performance
- **NFR-SC2:** Game room state is isolated; actions in one room cannot affect another room's state
- **NFR-SC3:** In-memory room store protected against race conditions when multiple players submit votes simultaneously

### Accessibility

- **NFR-A1:** All interactive controls (buttons, sliders, inputs) meet WCAG 2.1 AA contrast requirements
- **NFR-A2:** Touch targets minimum 44×44px on mobile
- **NFR-A3:** Application operable via keyboard on desktop browsers
- **NFR-A4:** Full screen reader support for game state announcements deferred to post-MVP (verbal mechanic inherently limits full compliance)
