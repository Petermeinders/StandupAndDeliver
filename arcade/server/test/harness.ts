import type { GameId } from '@arcade/shared';
import { GAME_MODULES } from '../src/games/registry.js';
import { RoomManager, type Transport } from '../src/rooms.js';

export interface Sent {
  to: string;
  event: string;
  payload: any;
}

/** A room manager wired to an in-memory transport, with one fake socket per player name. */
export function harness(rng: () => number = Math.random) {
  const sent: Sent[] = [];
  const transport: Transport = {
    toRoom: (code, event, payload) => void sent.push({ to: `room:${code}`, event, payload }),
    toSocket: (socketId, event, payload) => void sent.push({ to: socketId, event, payload }),
    join: () => {},
    leave: () => {},
  };
  const rooms = new RoomManager(transport, GAME_MODULES, { graceMs: 30_000, emptyRoomMs: 300_000, idleRoomMs: 7_200_000, lobbyReturnMs: 8_000 }, () => {}, rng);
  let code = '';

  const api = {
    rooms,
    sent,
    get code() {
      return code;
    },
    get room() {
      return rooms.getRoom(code)!;
    },
    /** First name creates the room, the rest join it. */
    seat(gameType: GameId, ...names: string[]) {
      for (const name of names) {
        const res = rooms.enter(`s-${name}`, `id-${name}-0000`, { name, gameType, code: code || undefined });
        if (!res.ok) throw new Error(res.error);
        code = res.roomCode;
      }
      return api;
    },
    start(settings: Record<string, unknown> = {}) {
      const res = rooms.start(`s-${api.room.players[0].name}`, settings);
      if (!res.ok) throw new Error(res.error);
      return api;
    },
    act: (name: string, action: string, payload?: unknown) => rooms.action(`s-${name}`, action, payload),
    /** Latest private game state sent to this player. */
    state<T = any>(name: string): T {
      for (let i = sent.length - 1; i >= 0; i--) {
        if (sent[i].to === `s-${name}` && sent[i].event === 'game:state') return sent[i].payload.state as T;
      }
      throw new Error(`no game state sent to ${name}`);
    },
  };
  return api;
}

/** Deterministic rng that replays a list of values, then repeats the last one. */
export function scripted(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
