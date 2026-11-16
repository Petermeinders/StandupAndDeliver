# Fireside Arcade

React + TypeScript site, Node + Socket.IO multiplayer server, and Phaser 3 for Protect Thy Fortress. The card games use DOM views; Crypt Sweepers and Spellbound remain external links. Railway runs one container and one replica.

## Run locally

Requires Node 22+ and npm.

```sh
npm ci
npm run dev
```

Open the Vite URL (normally http://localhost:5173). It proxies API/socket traffic to port 3001. If that port is occupied:

```sh
ARCADE_DEV_PORT=3011 ARCADE_SERVER=http://localhost:3011 npm run dev
```

Fortress is under **Settings → Show experimental games**, or open `/?game=defend-fortress`. Start solo or share the lobby code/QR. One player can choose artillery before starting; the host chooses 10, 50, 100, or endless waves.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm start
```

The production server serves the built client and `/health` on `PORT` (default 3001). Tests include rules for all five games and real Socket.IO connections. Rules use fake timers; real-socket tests require permission to bind a local port.

With the dev servers running, Chromium installed via Playwright, and ffmpeg available:

```sh
npx playwright install chromium
npm run test:fortress:browser
node tools/check-carousel.mjs
npm run previews                         # five games; records real browser input
npm run previews -- defend-fortress      # one game
```

After `npm run build`, `node tools/check-production.mjs` starts an isolated server on port 3012 and checks the built client, sockets, lazy Phaser boot and fullscreen controls (override with `ARCADE_SMOKE_PORT`).

Set `ARCADE_URL` to the actual Vite URL if it selects another port. The Fortress browser check exercises pointer flings, artillery, pause, reload/reconnect, late join, a complete first wave, shop, saves, mobile layout, and ready-up. It writes screenshots and a downloaded save under the OS temp directory. It reads development snapshots for assertions; it does not mutate the simulation or use production test endpoints.

## Deploy

Use **`arcade/` as the Railway service root**, with this folder's `Dockerfile` and `railway.json`. The Docker build context must be `arcade/`; merely selecting `arcade/Dockerfile` with repository-root context is insufficient.

```sh
docker build -t fireside-arcade .
docker run --rm -p 3001:3001 fireside-arcade
```

`PORT` is supplied by Railway. Optional feedback mail variables are `RESEND_API_KEY`, `FEEDBACK_TO`, and `FEEDBACK_FROM`. Mount a volume at `/app/data` to retain feedback/event JSONL logs. Rooms and active games remain in memory and end on restart; keep one replica.

[Handoff and verification](docs/HANDOFF.md) · [Feature plans](docs/README.md) · [Cutover checklist](docs/05-cutover.md) · [Roadmap](../TODO.md)
