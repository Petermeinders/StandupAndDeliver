import type { ClientToServerEvents, GameId, Result, ServerToClientEvents } from '@arcade/shared';
import { io, type Socket } from 'socket.io-client';
import { storage } from './storage';
import { addReaction, getState, setState, toast } from './store';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: { playerId: storage.playerId() },
  transports: ['websocket', 'polling'],
});

type Events = ClientToServerEvents;
type Req<E extends keyof Events> = Parameters<Events[E]> extends [infer R, unknown] ? [R] : [];
type Reply<E extends keyof Events> = Parameters<Events[E]> extends [...unknown[], (r: infer R) => void] ? R : never;

/** Send an event and wait for the server's answer. Never rejects. */
function call<E extends keyof Events>(event: E, ...req: Req<E>): Promise<Reply<E>> {
  return new Promise((resolve) => {
    const failed = (error: string) => resolve({ ok: false, error } as Reply<E>);
    if (!socket.connected) return failed("You're offline. Reconnecting…");
    (socket.timeout(8000).emit as (...a: unknown[]) => void)(event, ...req, (err: Error | null, result: Reply<E>) => {
      if (err) failed('The server took too long to answer.');
      else resolve(result);
    });
  });
}

function leaveLocally(): void {
  storage.setRoom(null);
  setState({ room: null, game: null, timer: null, votes: null, reactions: [], transcript: '', restoring: false });
}

socket.on('connect', async () => {
  const wasReconnecting = getState().conn === 'reconnecting';
  setState({ conn: 'online' });
  const code = getState().room?.roomCode ?? storage.room();
  if (!code) return setState({ restoring: false });
  const res = await call('room:rejoin', { code });
  if (!res.ok) {
    leaveLocally();
    if (wasReconnecting) toast(res.error, 'error');
  }
  setState({ restoring: false });
});

socket.on('disconnect', () => setState({ conn: 'reconnecting' }));
socket.on('connect_error', () => setState((s) => ({ conn: s.conn === 'online' ? 'reconnecting' : s.conn, restoring: false })));

socket.on('room:state', (room) => {
  storage.setRoom(room.roomCode);
  setState((s) => ({
    room,
    restoring: false,
    // A game's last state is stale once the room is back in the lobby or has switched game.
    game: room.phase === 'Lobby' || s.game?.type !== room.gameType ? null : s.game,
    ...(room.phase === 'Lobby' ? { timer: null, votes: null, transcript: '' } : {}),
  }));
});

socket.on('game:state', ({ gameType, state }) => setState({ game: { type: gameType, state } }));
socket.on('timer:tick', (seconds) => setState({ timer: seconds }));
socket.on('vote:count', (votes) => setState({ votes }));
socket.on('transcript', (text) => setState({ transcript: text }));
socket.on('reaction', ({ name, emoji }) => addReaction(name, emoji));
socket.on('room:removed', ({ reason }) => {
  leaveLocally();
  toast(reason, 'error');
});

// Phones suspend sockets in the background; nudge a reconnect the moment the tab is visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
});

export const api = {
  async enterRoom(name: string, gameType: GameId, code?: string, funName?: boolean): Promise<Result<{ roomCode: string; created: boolean }>> {
    const clean = name.trim();
    storage.setName(clean);
    setState({ name: clean });
    return call('room:enter', { name: clean, gameType, code, funName });
  },
  async leaveRoom(): Promise<void> {
    await call('room:leave');
    leaveLocally();
  },
  setGame: (gameType: GameId) => call('room:setGame', { gameType }),
  setRole: (role: string | null) => call('room:setRole', { role }),
  claimHost: () => call('room:claimHost'),
  drop: (name: string, scope: 'game' | 'room') => call('room:drop', { name, scope }),
  startGame: (settings?: Record<string, unknown>) => call('game:start', { settings }),
  sitOut: () => call('game:sitOut'),
  /** Send a game move. Shows the server's reason as a toast when the move is refused. */
  async act(action: string, payload?: unknown, quiet = false): Promise<Result> {
    const res = await call('game:action', { action, payload });
    if (!res.ok && !quiet) toast(res.error, 'error');
    return res;
  },
};
