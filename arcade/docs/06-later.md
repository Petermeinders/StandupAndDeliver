# 6. Later

## Convert Crypt Sweepers to Phaser (maybe)
Separate repo (`Game2/`, vanilla JS modules, GitHub Pages). Worth it if the goal is better
animation/effects; the Minesweeper logic can be kept as-is behind a Phaser scene. Use the
fortress port (step 3) as the template for scene structure and asset pipeline. Stays an
external tile on the arcade either way.

## Add Bubble Conquest
Needs from Peter: URL, cover (2:3), tagline, single- or multiplayer. If it is a standalone
Phaser game on Cloudflare, add it as an external tile in `client/src/games/registry.ts`
(5 minutes). If it should use arcade rooms, see "Shared game SDK" below.

## Recommendations

| Idea | Why | Size |
|---|---|---|
| TV mode | A shared big-screen table view while phones are controllers — the party-game format people expect | M |
| Persist rooms across deploys | A Railway redeploy currently ends every game. Snapshot room + game state to disk/Redis on change, restore on boot | M |
| Bots in every card game | Solo visitors can try a game instantly; also what the preview recorder plays against | S each |
| Per-game share links + social cards | `/g/cursed-vault` with an Open Graph image, so a link in a group chat looks like something | S |
| Playwright smoke test per game in CI | Two browsers play one scripted round; catches protocol breaks | M |
| Rate limiting on socket actions | One client can currently spam actions | S |
| Service worker | Offline shell + instant repeat loads; finishes the PWA | S |
| Shared game SDK | Tiny client lib (join room, names, send/receive) so external Phaser games can use arcade rooms instead of each building multiplayer | L |
| Analytics that respect privacy | Know which games get played (the event log exists; add a small admin page) | S |
| Accessibility pass | Colour-blind marks on OneO cards, focus order, screen-reader labels on hands | S |
