# Fireside Arcade rewrite — plan index

The .NET/Blazor site is being rewritten in TypeScript under `arcade/`. These docs are the
plan, written so a person or another AI can pick up any step cold. The checklist that tracks
progress is `../../TODO.md`; update both when something changes.

| Doc | Covers |
|---|---|
| [01-scaffold.md](01-scaffold.md) | Workspace layout, tooling, dev/prod commands |
| [02a-platform.md](02a-platform.md) | Rooms, identity, presence, the socket protocol, HTTP API |
| [02b-games.md](02b-games.md) | Game module contract + rules spec for the four card games |
| [02c-site-shell.md](02c-site-shell.md) | React client: state store, screens, components, sounds |
| [03-fortress-phaser.md](03-fortress-phaser.md) | Porting Protect Thy Fortress to a Phaser 3 scene |
| [04-visuals.md](04-visuals.md) | Design system, carousel, preview clips, cover art specs |
| [05-cutover.md](05-cutover.md) | Railway deploy, data, removing the .NET projects |
| [06-later.md](06-later.md) | Crypt Sweepers → Phaser, Bubble Conquest, recommendations |

## Current handoff

Steps 1–4 are implemented locally. See [HANDOFF.md](HANDOFF.md) for verified behavior, known limits, and remaining cutover work. [Local run instructions](../README.md) and [cover prompts](cover-art.md) are also available.

## Ground rules

- **Server-authoritative.** Clients send intents; the server validates, mutates, and sends each
  player a view containing only what that player may see (hands and prompt cards are private).
- **The .NET code is the reference.** Until cutover, `StandupAndDeliver/Games/*.cs` and the
  `.razor` components define correct behaviour. Each doc names the file it was ported from.
  Deliberate differences are listed under "Changes from .NET" in each doc.
- **Shell and games are separate.** The shell never imports a game's internals; games never
  touch the socket directly (they get `send(action, payload)`). A game view may be DOM or Phaser.
- **Phaser is lazy.** Nothing on the landing page or in a card game may import `phaser`.
- **One process, in-memory rooms.** Rooms die on restart. That is accepted for now (see 06).

## Where the old code lives

| Old (.NET) | New (TypeScript) |
|---|---|
| `StandupAndDeliver.Shared/` DTOs | `arcade/shared/src/index.ts` |
| `Hubs/GameHub.cs`, `Services/GameRoomService.cs` | `arcade/server/src/rooms.ts`, `sockets.ts` |
| `Games/*.cs`, `Services/GameTimerService.cs` | `arcade/server/src/games/*.ts` |
| `Endpoints/*.cs` | `arcade/server/src/http.ts` |
| `StandupAndDeliver.Client/Pages`, `Components` | `arcade/client/src/` |
| `wwwroot/game-interop.js` | `arcade/client/src/lib/{sound,speech}.ts` |
| `wwwroot/fortress-prototype.js` | `arcade/client/src/games/fortress/` (Phaser) |
