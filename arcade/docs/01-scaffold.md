# 1. Scaffold

## Layout

```
arcade/
  package.json            npm workspaces: shared, server, client
  tsconfig.base.json      strict TS; path alias @arcade/shared → shared/src/index.ts
  Dockerfile              one image: builds client + server, runs node (Railway)
  shared/src/index.ts     all contracts (types + a few pure helpers)
  server/
    src/index.ts          boot: express + socket.io + static client
    src/rooms.ts          RoomManager (create/join/leave, grace, expiry)
    src/sockets.ts        socket event handlers → RoomManager / game instance
    src/http.ts           /api/* routes
    src/store.ts          feedback + event log persistence
    src/games/            one file per game + registry + types
    src/data/             prompt cards, buzzwords, fun room names
    test/                 Vitest rules + real Socket.IO integration tests
  client/
    vite.config.ts        proxies /api and /socket.io to :3001 in dev
    public/               covers, cards, sfx, previews (static, unhashed)
    src/                  see 02c-site-shell.md
  docs/                   these files
```

## Decisions

| Choice | Why |
|---|---|
| npm workspaces, no Turborepo/Nx | Three packages; nothing to orchestrate |
| `shared` is consumed as source via alias | No build step or version drift between client and server |
| Server bundled with esbuild (`--packages=external`) | Single `dist/index.js`, inlines `shared`, fast |
| Express 5 + Socket.IO 4 | Socket.IO gives acks (≈ SignalR invoke results), rooms (≈ groups), auto-reconnect, long-poll fallback |
| Vite + React 19 + Tailwind 4 | Matches the Phaser official template stack; existing UI was already Tailwind |
| Vitest | Same config language as Vite; rules are pure enough to test without sockets |

## Commands (run in `arcade/`)

| Command | Does |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Server on :3001 (tsx watch) + Vite on :5173 |
| `npm test` | Game rules + real-socket integration tests |
| `npm run typecheck` | `tsc --noEmit` for server and client |
| `npm run build` | `client/dist` then `server/dist/index.js` |
| `npm start` | Production: Node serves API, sockets and the built client on `$PORT` |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3001 | HTTP port (Railway sets this) |
| `DATA_DIR` | `./data` | Where feedback/event JSONL files go (mount a Railway volume to keep them) |
| `RESEND_API_KEY`, `FEEDBACK_TO`, `FEEDBACK_FROM` | unset | Email feedback via Resend; skipped if unset |
| `ARCADE_DEV_PORT` | 3001 | Dev server port override (pair with `ARCADE_SERVER`) |
| `ARCADE_SERVER` | `http://localhost:3001` | Dev only: Vite proxy target |

## Checklist

- [x] Workspace + tsconfig + alias
- [x] Static assets copied from `StandupAndDeliver/wwwroot` into `client/public`
- [x] `Dockerfile` + `.dockerignore`
- [x] Vitest wired, one test per game
