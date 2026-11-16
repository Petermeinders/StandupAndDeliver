# 5. Cutover

Do this only after a full two-device playthrough of every ported game.

## Before deployment

- [ ] Build/run the Docker image; Docker was unavailable during the continuation.
- [ ] Play on two physical devices, including iOS/Android touch, fullscreen and a cellular reconnect. Automated Chromium coverage is recorded in [HANDOFF.md](HANDOFF.md).

## Railway

- [ ] Service root directory: `arcade/`; use `Dockerfile` relative to that root. The build context must also be `arcade/`
- [ ] One replica (rooms are in memory; no cross-process adapter yet)
- [ ] Health check path `/health`
- [ ] Env: `RESEND_API_KEY`, `FEEDBACK_TO`, `FEEDBACK_FROM` (copy from the .NET service's `Resend__*` vars)
- [ ] Optional volume mounted at `/app/data` for feedback/event logs
- [ ] Custom domain `firesidearcade.com` moved to the new service
- [ ] WebSockets work through Railway's proxy without config; confirm on a phone over cellular

## Data

- Prompt cards: already embedded (`server/src/data/promptCards.ts`). If cards were added in
  production through the admin endpoints, export them from the Postgres `PromptCards` table first.
- Feedback history: export the `Feedback` table if wanted; nothing reads it at runtime.
- Game event log: not migrated.

## Remove

- [ ] `StandupAndDeliver/`, `.Client/`, `.Shared/`, `.Tests/`, `.E2ETests/`, `StandupAndDeliver.sln`, `tools/`
- [ ] Root `Dockerfile`, `docker-compose.yml`, `fly.toml`, `.github/workflows/deploy.yml` (Fly)
- [ ] Rewrite the `AGENTS.md` files (they describe a standup-tracking app that never existed)
- [ ] Decide whether `arcade/` moves to the repo root
- [ ] Keep `docs/games/*` (design history)

## Open question

`localStorage` keys change (`sad_*` → `fa_*`), so nobody's saved name carries over. Acceptable
given no active users.
