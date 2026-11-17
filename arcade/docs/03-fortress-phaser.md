# 3. Protect Thy Fortress → Phaser 3

Sources: `Games/DefendFortressGame.cs` (1,182 lines), `Models/DefendFortressGameState.cs`,
`Shared/DTOs/DefendFortressGameStateDto.cs`, `wwwroot/fortress-prototype.js` (1,272-line canvas
renderer), `Components/Games/DefendFortress/DefendFortressGameRoot.razor` (685 lines of HUD/shop),
`StandupAndDeliver.Tests/Services/DefendFortressGameTests.cs` (552 lines),
design docs in `docs/games/defend-thy-fortress.md` and `docs/games/Protect Thy Fortress/`.

Co-op wave defence, up to 4 players, mid-run join as spectator, flagged experimental.

## Split

| Part | Where | Tech |
|---|---|---|
| Simulation (20 Hz tick, world 800×360) | `server/src/games/fortress.ts` | Plain TS, no Phaser on the server |
| Battlefield rendering + input | `client/src/games/fortress/scene.ts` | Phaser 3 scene, dynamic `import('phaser')` |
| HUD, shop, recap, ready-up | `client/src/games/fortress/View.tsx` | React DOM overlaid on the canvas |

The server stays authoritative; Phaser only draws snapshots and sends intents. Do **not** use
Phaser physics for gameplay — only for cosmetic particles.

## Server port, by feature (maps to PTF stories)

| # | Feature | .NET entry points | Notes |
|---|---|---|---|
| a | Phase machine: `WavePlaying → WaveRecap/Shop → Countdown → …→ Victory/Defeat` | `BeginWave`, `CheckEndGame`, `BeginCountdown` | PTF-1.1, 1.9 |
| b | Game modes 10/50/100/endless | `ParseGameMode` | settings `{gameMode}` |
| c | Wave table: queue size, on-field cap, spawn interval, speed multiplier, gold pool | `DefendFortressWaveConfig` | PTF-1.2b, 2.5 |
| d | Enemy sim: march, attack wall, airborne (gravity, bounce, fall damage), splat | `SimulateMarch/Attacking/Airborne` | enemy types PTF-2.4 (runner from wave 4) |
| e | Grab / move / fling | `GrabEnemy`, `MoveHeld`, `ReleaseEnemy` | grab radius 48, one holder per enemy, velocity clamp |
| f | Gold: personal for own kills, split for auto-unit kills | `EliminateEnemy`, `AwardGoldSplit` | PTF-1.3 |
| g | Shop upgrades + costs | `PurchaseUpgrade`, `UpgradeCost` | archer 100, wizard 150, engineer 125, wall 200, repair 75, soldier 150, ballista 300, sling_* 80–250 (cost scaling by tier: read the function) |
| h | Auto units: archers, soldiers, ballistas, engineer repair, wizard spell | `SimulateAutoUnits`, `FireAutoUnit`, `SimulateEngineerRepair`, `CastWizardSpell` | |
| i | Ready-up + host force start + countdown | `ReadyForWave`, `StartNextWaveAction` | |
| j | Artillery seat: volunteer, slingshot discs, combos on airborne enemies, upgrade tree | `VolunteerArtillery`, `FireSlingshot`, `SimulateDiscs`, `ResolveArtilleryCombo` | PTF-3.x; lobby pre-pick via `room:setRole` |
| k | Spectators: mid-run join, sit out, drop | `OnPlayerJoined`, `MoveToSpectator` | |
| l | Pause (host) | `TogglePause` | |
| m | Save export/import | `ImportSave` | PTF-2.1 |
| n | Tick loop + broadcast | `StartTickLoop`, `BuildDto` | 50 ms; stop when room empty (PTF-2.2) |

Port order: a–f + n (playable core) → g–i (shop loop) → k, l → h → j → m. Port the xUnit
tests alongside each group; they pin the tuning numbers.

Networking: keep full snapshots at 20 Hz to start (≤ ~40 enemies). Send via
`socket.volatile.emit` so a slow client drops frames instead of queueing. `MoveHeld` should be
throttled client-side to the tick rate. Delta compression only if profiling says so.

## Phaser client, by feature

| Feature | From `fortress-prototype.js` | Phaser approach |
|---|---|---|
| World scaling | `updateViewport`, `toCanvas/toWorld` | `Scale.FIT`, 800×360 game size, world coords = game coords |
| Background, castle | `drawSkyAndGround`, `drawCastle`, castle layout table | Images; drop the layout debug tool |
| Enemies | custom GIF decoder + `drawSpriteEnemy` / `drawStickEnemy` | Convert the three skeleton GIFs to a sprite sheet (ffmpeg → PNG strip) and use Phaser animations; delete the GIF decoder |
| Interpolation | `getDisplayEnemies`, `INTERP_MS = 50` | Keep two snapshots, lerp position/rotation in `update()` |
| Grab/fling input | pointer handlers, velocity from recent pointer samples | Phaser pointer events; own enemy follows the pointer locally (prediction), server corrects |
| Hit feedback | `drawSplat` | Particle emitters, camera shake on breach, tweened damage numbers — the reason for moving to Phaser |
| Artillery top-down view | PTF-3.2 renderer | Second scene; portrait layout |
| Mobile landscape | CSS rotate hack (`html.fortress-is-mobile`) | Try `screen.orientation.lock('landscape')` in fullscreen, fall back to the rotate approach |
| Sounds | `playFortressSfx*` | Shell `sound.ts` (already throttled) |

React ↔ Phaser bridge: the React view creates the `Phaser.Game` in an effect, passes a small
bus `{onState(cb), send(action,payload)}`, and destroys the game on unmount. HUD/shop are React.

## Risks

- Biggest single chunk of the rewrite; budget it separately from the card games.
- Tuning drift: copy constants verbatim, port tests before refactoring.
- Phaser bundle ~1 MB gzipped ~350 KB: must stay in its own chunk (check `vite build` output).

## Implementation status — November 16, 2026

All playable core features above are implemented. `registry.tsx` exposes the experimental tile;
`Lobby.tsx` offers run length and an exclusive artillery seat. `View.tsx` lazy-imports `scene.ts`,
which imports Phaser 3.90.0. The scene module is a separate production chunk (~344 KB gzip).
No Phaser request occurs on the home screen, including while its recorded preview plays.

The scene uses the existing background/castle and prepared skeleton PNG grids (walk 111×184,
attack 180×184, sway 159×177 per frame), interpolates snapshots, predicts the local held enemy,
sends held positions at most every 50 ms, and estimates fling velocity over the last 120 ms.
Pointer cancellation, blur and visibility loss release the grab. Cosmetics include particles,
runner tint, health bars, held-player rings and restrained wall-hit camera shake. Reduced motion
disables sprite playback, particles and shake. The artillery perspective projects the same
server coordinates onto a portrait field, with an aiming line and cooldown ring.

The React HUD includes wall health, wave target, gold, enemy count, roster, host pause, fireball,
shop tiers/prices, ready-up/host start, role switching, save download/import, and fullscreen with
an explicit exit control. Fullscreen requests orientation when supported. Unsupported browsers
keep the responsive layout and a rotate-phone hint; there is no forced CSS rotation.

## Changes from .NET / deliberate limits

- Pause is host-only, matching this plan; the old handler permitted any active player.
- Spectators and players sitting out cannot purchase, ready up, claim artillery or send combat
  actions. A late arrival joins at the next shop. Arrivals during countdown also wait until shop.
- Permanently leaving a room removes its simulation seat; sitting out preserves purchased units.
- Non-finite move, throw and fire values are rejected. Repair at full health cannot consume gold.
- Only repeated combat snapshots use volatile delivery. Initial/reconnect state and phase changes
  remain reliable. Connected runs refresh room activity; unattended runs hold the simulation.
- Save schema v1 preserves a cleared wave, mode, walls and the exporting host's castle upgrades
  and wallet. It does **not** snapshot all players or artillery upgrades. Loading preserves other
  wallets and resets all ready flags. The file format stays compatible with the existing export.
- `sling_multi` and `sling_mark` had prices but no combat effects in the source. They are deliberately
  absent from the shop until their effects are implemented; the three working sling upgrades are
  available. `GoldPool` was diagnostic wave metadata, not a reward mechanic; rewards still use
  the original per-kill constants rather than introducing a new payout.
- Test scenarios were ported to the current reference behavior: starter archers cost 150 for
  their next tier (the older test expected an empty upgrade map), and high arcs eventually land
  rather than asserting survival after an arbitrary six seconds.

## Verification

- 26 Fortress rule tests, plus a real-socket test covering tick delivery, exclusive artillery,
  grab release on disconnect, restored identity and pause.
- `npm run test:fortress:browser` passed with desktop and mobile-sized Chromium clients:
  real pointer flings, artillery, pause, reload/reconnect, mid-wave spectator, first-wave clear,
  shop, save download/import, responsive layout, and all-player ready-up into wave two.
- `npm run previews -- defend-fortress` records a real two-player WebM/MP4 carousel loop.
- Physical iOS/Android touch and fullscreen remain on the cutover checklist.

Phaser references: [scale manager](https://docs.phaser.io/phaser/concepts/scale-manager),
[input](https://docs.phaser.io/phaser/concepts/input). Local installed types were used for API checks.
