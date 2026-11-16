# Continuation handoff — November 16, 2026

## State of the rewrite

Steps 1–4 are implemented under `arcade/`: React/Vite/Tailwind shell, Node/Socket.IO room
platform, four DOM card games, and Protect Thy Fortress with a lazy Phaser 3 renderer.
The existing .NET solution and its pre-existing changes were left untouched. Production
service, DNS and Railway settings remain unchanged. The rewrite is committed separately on
`ts-rewrite`; unrelated working-copy changes are excluded.

Run commands and environment settings: [arcade README](../README.md).
Feature plans: [index](README.md). Progress: [TODO](../../TODO.md).

## Completed in this continuation

- Finished Fortress's experimental carousel entry, how-to, lobby mode/role controls, React HUD,
  shop, ready-up, host pause/force start, fireball, save download/import and fullscreen controls.
- Added Phaser animation grids, snapshot interpolation, pointer flings, local held prediction,
  20 Hz movement throttling, particles, wall-hit shake, and a portrait artillery view.
- Hardened the existing simulation around spectator/away input, finite coordinates, seat cleanup,
  save validation/readiness, idle-room activity, and reliable versus volatile state delivery.
- Added 26 Fortress rule scenarios and one real-socket multiplayer scenario. Fixed a race in the
  existing OneO socket test: room GameOver can reach one player before the other's winner state.
- Added a reproducible real-browser Fortress smoke test and recorded its WebM/MP4 carousel clip.
  Re-ran and re-recorded the four existing card-game browser scripts.
- Generated portrait cover art for Last Stand and Standup & Deliver. Final paths and exact
  built-in generation prompts: [cover-art.md](cover-art.md). Existing original art was preserved.
- Fixed video fallback so a failed WebM request retries MP4 before returning to the cover.
- Fixed experimental deep links/invites so the selected tile is visible even without the setting.
- Scoped runtime-data ignore rules to keep `server/src/data` prompt cards, buzzwords and room
  names in Git. Verified the staged source in an isolated directory before pushing.
- Added local startup documentation, a Docker context ignore file, and corrected Railway build
  instructions: `arcade/` must be the service root and Docker build context.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 64 passing tests across 7 files, including real Socket.IO connections.
- `npm run build`: passed. Main client JS ~107 KB gzip; Phaser scene separately ~344 KB gzip.
  Vite reports its normal >500 KB uncompressed chunk warning for Phaser; the chunk is lazy.
- `npm run test:fortress:browser`: passed using real mouse/pointer actions against the dev server.
  Covers lazy loading, flinging, artillery, pause, offline/reload/reconnect, late spectator join,
  complete first wave, shop, save round-trip, mobile viewport, and all-player ready-up to wave two.
- `npm run previews -- standup oneo cursed-vault last-stand`: passed with two browser clients per game.
- `npm run previews -- defend-fortress`: passed; both formats stored in `client/public/previews/`.
- `node tools/check-production.mjs`: passed against the bundled production server: health, static
  client/assets, Socket.IO room creation, lazy Phaser boot, pause, fullscreen entry and exit.
- `node tools/check-carousel.mjs`: passed for the new Last Stand cover, reduced motion, Fortress
  deep-link selection, preview fade/playback, forced WebM failure → MP4 playback, and no Phaser request.

Useful browser artifacts from this run are in `/tmp`: `fortress-desktop.png`,
`fortress-artillery.png`, `fortress-shop.png`, `fortress-mobile.png`, and
`arcade-home-cover.png`. Temporary screenshots are evidence, not application dependencies.

## Deliberate limits / next work

- **No Railway cutover yet.** Follow [05-cutover.md](05-cutover.md). Docker was not installed in
  this environment, so the image itself has not been built/run here. The production JS build is verified.
- Physical-phone touch, orientation/fullscreen, audio and cellular reconnect still need a
  two-device playthrough. Chromium mobile-sized windows are not a substitute for those checks.
- Rooms live in one server process and disappear on restart. Use one Railway replica.
- Fortress retains its experimental flag. Legacy inert `sling_multi`/`sling_mark` purchases are
  omitted; three functional artillery upgrades are present. See [Fortress details](03-fortress-phaser.md).
- Save v1 is a run + host castle wallet export, not a full multiplayer-room snapshot. Artillery
  upgrades and other players' wallets are not exported; the UI explains this before download/import.
- New art covers the two missing/poorly fitted covers. Other existing covers remain; Spellbound's
  low-resolution artwork can be refreshed later with the game's own assets.
- Crypt Sweepers' possible Phaser rewrite and adding Bubble Conquest remain later work, with
  recommendations in [06-later.md](06-later.md).

## Main files for the next agent

| Concern | Entry point |
|---|---|
| Rules / simulation | `server/src/games/fortress.ts` |
| Shared constants / state | `shared/src/index.ts` (Fortress section) |
| Phaser lifecycle / input | `client/src/games/fortress/scene.ts` |
| HUD / shop / save UI | `client/src/games/fortress/View.tsx` |
| Room lifecycle / transient frames | `server/src/rooms.ts`, `server/src/sockets.ts` |
| Game catalogue / lazy views | `client/src/games/registry.tsx` |
| Rule + socket tests | `server/test/fortress.test.ts`, `server/test/e2e.test.ts` |
| Browser checks / recorder | `tools/fortress-browser.mjs`, `tools/record-previews.mjs`, `tools/check-carousel.mjs`, `tools/check-production.mjs` |
