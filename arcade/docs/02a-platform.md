# 2a. Multiplayer platform

Ported from `Hubs/GameHub.cs`, `Services/GameRoomService.cs`, `Services/RoomCleanupService.cs`,
`Endpoints/*.cs`.

## Model

```ts
Room   { code, gameType, phase: Lobby|Playing|GameOver, players: Player[], game: GameInstance|null, lastActivity }
Player { id, name, socketId|null, isHost, isConnected, isBot, score, preferredRole, away }
```

- `Player.id` is a random token the browser keeps in `localStorage` and sends in the socket
  handshake (`auth.playerId`). **Identity is the token, not the name** — this replaces the .NET
  "rejoin by name" and all of its connection-id scrubbing.
- Names are unique per room (case-insensitive), trimmed, max 20 chars. Game state is keyed by name.
- One socket ↔ at most one room. Entering a room leaves the previous one.
- Each socket joins Socket.IO room `code`; private sends go to `player.socketId`.

## Features

| Feature | Behaviour | Status |
|---|---|---|
| Create room | 4-letter code A–Z, or a fun name (`WackyOnion`) if asked. Creator is host. | [x] |
| Join by code | Case-insensitive. Lobby only, except games flagged `midRunJoin`. Full → error. Name taken → error. | [x] |
| Enter with unknown code | Creates a room with that code (lets friends agree on a name up front). | [x] |
| Invite link | `/?join=CODE`; client calls `GET /api/rooms/:code` to show who is inside before joining. | [x] |
| Rejoin | On socket (re)connect the client sends `room:rejoin {code}`; server matches `playerId`, re-sends room + private game state. | [x] |
| Disconnect grace | 30 s. On expiry the game's `onGraceExpired` runs. If the host is gone, anyone may `room:claimHost`. | [x] |
| Empty-room expiry | No connected humans for 5 min → room deleted. Idle 2 h → deleted (sweep every 5 min). | [x] |
| Sit out ("Leave game") | Player stays in the room, flagged `away`; game's `onDropped` runs. Reload clears the room's away flag; each game's elimination/spectator rules still apply. | [x] |
| Leave room | Player removed outright. Last human out → room deleted. Host leaving → next connected human becomes host. | [x] |
| Host drop | `scope: game` → target flagged away + `onDropped`. `scope: room` → removed. Non-hosts may drop an away host from the game. | [x] |
| Switch game in lobby | Host only (`room:setGame`). New: .NET required a fresh room. | [x] |
| Seat preference | `room:setRole` (only "artillery" today), one holder per role. | [x] |
| Solo bot | If one human starts a game whose module has `botName`, a bot player is added for that game and removed on return to lobby. | [x] |
| Back to lobby | Games call `ctx.endGame()`; after 8 s the room returns to Lobby with the same players. | [x] |

## Socket protocol

Types: `ClientToServerEvents` / `ServerToClientEvents` in `shared/src/index.ts`. Every
client→server event takes an ack that receives `{ok:true,...}` or `{ok:false,error}`.

| Client → server | Payload | Notes |
|---|---|---|
| `room:enter` | `{name, gameType, code?, funName?}` | Create or join. Ack: `{roomCode, created}` |
| `room:rejoin` | `{code}` | After reconnect / page reload |
| `room:leave` | – | Leave room for good |
| `room:setGame` | `{gameType}` | Host, lobby |
| `room:setRole` | `{role|null}` | Lobby |
| `room:claimHost` | – | Only when no connected host |
| `room:drop` | `{name, scope}` | See Host drop |
| `game:start` | `{settings?}` | Host, lobby |
| `game:action` | `{action, payload?}` | Routed to the game instance |
| `game:sitOut` | – | "Leave game" |

| Server → client | Payload | Sent to |
|---|---|---|
| `room:state` | `RoomState` | Whole room, on any roster/phase change |
| `game:state` | `{gameType, state}` | Per player (private view) |
| `room:removed` | `{reason}` | A player who was dropped from the room |
| `timer:tick` | seconds | Room (Standup turn clock) |
| `vote:count` | `{submitted,total}` | Room (Standup) |
| `reaction` | `{name, emoji}` | Room (Standup) |
| `transcript` | text | Room except speaker (Standup) |

## HTTP API

| Route | Purpose |
|---|---|
| `GET /health` | Railway health check |
| `GET /api/rooms/:code` | `RoomInfo` for invite previews; 404 if none |
| `POST /api/feedback` `{message}` | ≤2000 chars, 5/hour per IP; stored, then emailed via Resend if configured |
| `GET /api/stats/active-players` | Unique player names seen in the last 30 min |

## Changes from .NET

- Token identity instead of name identity.
- No lobby placeholder bot; bots are added at game start only (the .NET placeholder bot would
  stall Last Stand, which had no bot logic).
- No per-room semaphore: Node is single-threaded, every handler runs to completion.
- No EF Core. Prompt cards are a static list in `server/src/data`; the admin card endpoints
  are dropped. Feedback and events append to JSONL files in `DATA_DIR`.
- HTML-encoding of names is dropped; React escapes on render.

## Fortress transport and lifecycle

`sendState(player, state, volatile?)` defaults to reliable delivery. Fortress uses volatile delivery only for repeated combat ticks; initial state, phase transitions and explicit sync remain reliable. Games may implement `onLeft(name)` to distinguish leaving the room from sitting out. Fortress removes permanently departed seats and their automatic units so absent players cannot block ready-up. Connected Fortress runs refresh room activity so an ongoing long run is not swept as idle.
