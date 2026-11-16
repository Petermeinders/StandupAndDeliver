# Fireside Arcade — TypeScript rewrite

Rewrite of the .NET/Blazor site in TypeScript. The new code lives in `arcade/`; the
.NET solution stays in place until cutover.

Detailed plan, broken down by feature: [`arcade/docs/`](arcade/docs/README.md).

## Architecture

| Layer | Tech | Folder |
|---|---|---|
| Site shell (carousel, lobby, settings, feedback) | React + Vite + Tailwind | `arcade/client` |
| Multiplayer platform + game rules (server-authoritative) | Node + Socket.IO | `arcade/server` |
| Contracts (state shapes, events) | TypeScript types | `arcade/shared` |
| Game views | DOM (card games) or Phaser 3 (action games), lazy-loaded per game | `arcade/client/src/games/*` |

Hosting: one container on Railway (long-lived process — rooms and timers are in memory).

## Implemented locally — November 16, 2026

See [`arcade/docs/HANDOFF.md`](arcade/docs/HANDOFF.md) for verification and remaining release work.
Checked items below mean implemented locally, not deployed.

## Steps 1–4

### 1. Scaffold
- [x] npm workspace: `shared`, `server`, `client`
- [x] Dev: Vite proxying `/socket.io` and `/api` to the Node server
- [x] Prod: Node serves the built client; `Dockerfile` for Railway
- [x] Vitest for game rules

### 2. Platform + four card games (DOM views)
- [x] Rooms: create/join by code, fun room names, invite links (`?join=CODE`)
- [x] Presence: reconnect, 30 s grace period, empty-room expiry, host promotion
- [x] Leave game / leave room / host drop
- [x] Site shell: header, name entry, lobby, settings, toasts, feedback, how-to-play
- [x] Standup & Deliver
- [x] OneO
- [x] Cursed Vault
- [x] Last Stand
- [x] Two-browser playthrough of every game

### 3. Protect Thy Fortress (Phaser 3)
- [x] Port server simulation (waves, gold, shop, artillery seat)
- [x] Rebuild the canvas renderer as a Phaser scene, loaded only when the game opens
- [x] Port the existing unit tests

### 4. Visuals
- [x] Carousel: keep the portrait card style, add a preview-clip layer that fades in on the selected card
- [x] Record looping gameplay clips from the new build (WebM + MP4 fallback)
- [x] New portrait covers for Standup & Deliver and Last Stand (1024×1536 WebP)
- [x] Fortress preview clip (WebM + MP4)

### Cutover
- [ ] Physical two-device playthrough, including touch/fullscreen and cellular reconnects
- [ ] Build and run the Docker image (Docker unavailable in the continuation environment)
- [ ] Set Railway service root/build context to `arcade/`, using its `Dockerfile` and `railway.json`
- [ ] Carry over data worth keeping (prompt cards, feedback)
- [ ] Remove the .NET projects, `fly.toml`, and the Fly deploy workflow

## Later
- [ ] Convert Crypt Sweepers to Phaser (maybe)
- [ ] Add Bubble Conquest to the games
- [ ] Recommendations (details in `arcade/docs/06-later.md`):
  - [ ] "TV mode": a shared big-screen view of the table while phones act as controllers
  - [ ] Persist rooms across deploys/restarts (snapshot to disk or Redis) so a Railway redeploy doesn't end games
  - [x] Bots for solo OneO, Cursed Vault, and Last Stand
  - [ ] Social preview images / per-game share links (`/g/cursed-vault`)
  - [ ] Playwright smoke test per game in CI
  - [ ] Rate limiting on socket actions (feedback already limited)
  - [ ] Shared game SDK so external Phaser games (Spellbound, Bubble Conquest) can use arcade rooms and names
