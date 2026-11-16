import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_MODULES } from './games/registry.js';
import { createApp } from './http.js';
import { DEFAULT_TIMINGS, RoomManager, type Transport } from './rooms.js';
import { attachHandlers, createSocketServer } from './sockets.js';
import { logEvent } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = process.env.CLIENT_DIR ?? path.resolve(here, '../../client/dist');
// In dev the port is fixed so Vite's proxy can find it, whatever PORT the shell happens to export.
const DEV_PORT = Number(process.env.ARCADE_DEV_PORT ?? 3001);
const port = process.argv.includes('--dev') ? DEV_PORT : Number(process.env.PORT ?? DEV_PORT);

// The room manager and the socket server need each other; the manager gets a
// transport that forwards to the real one once it exists.
let live: Transport | null = null;
const transport: Transport = {
  toRoom: (...a) => live?.toRoom(...a),
  toSocket: (...a) => live?.toSocket(...a),
  join: (...a) => live?.join(...a),
  leave: (...a) => live?.leave(...a),
};

const rooms = new RoomManager(transport, GAME_MODULES, DEFAULT_TIMINGS, logEvent);
const http = createServer(createApp(rooms, clientDir));
const sockets = createSocketServer(http);
live = sockets.transport;
attachHandlers(sockets.io, rooms);

setInterval(() => {
  const removed = rooms.sweep();
  if (removed) console.log(`[rooms] removed ${removed} idle room(s)`);
}, 5 * 60_000).unref();

http.listen(port, () => console.log(`Fireside Arcade listening on :${port}`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    sockets.io.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
