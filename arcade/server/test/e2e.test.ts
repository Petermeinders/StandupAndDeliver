// Real sockets against the real server: checks the wire protocol, not just the rules.
import type { ClientToServerEvents, LastStandState, OneOState, RoomState, ServerToClientEvents } from '@arcade/shared';
import { oneoCanPlay } from '@arcade/shared';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAME_MODULES } from '../src/games/registry.js';
import { createApp } from '../src/http.js';
import { RoomManager, type Transport } from '../src/rooms.js';
import { attachHandlers, createSocketServer } from '../src/sockets.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { room?: RoomState; game?: any };

let http: Server;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  let live: Transport | null = null;
  const rooms = new RoomManager(
    { toRoom: (...a) => live?.toRoom(...a), toSocket: (...a) => live?.toSocket(...a), join: (...a) => live?.join(...a), leave: (...a) => live?.leave(...a) },
    GAME_MODULES,
    { graceMs: 30_000, emptyRoomMs: 300_000, idleRoomMs: 7_200_000, lobbyReturnMs: 300 },
  );
  http = createServer(createApp(rooms, '/nonexistent'));
  const s = createSocketServer(http);
  live = s.transport;
  attachHandlers(s.io, rooms);
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(() => {
  for (const c of clients) c.close();
  http.close();
});

async function connect(id: string): Promise<Client> {
  const c: Client = io(url, { auth: { playerId: `player-${id}-0000` }, transports: ['websocket'], forceNew: true });
  clients.push(c);
  c.on('room:state', (r) => (c.room = r));
  c.on('game:state', (m) => (c.game = m.state));
  await new Promise<void>((r) => c.on('connect', () => r()));
  return c;
}

const call = (c: Client, event: string, ...args: unknown[]) => new Promise<any>((resolve) => (c.emit as any)(event, ...args, resolve));

async function until(check: () => boolean, ms = 6000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for state');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('over real sockets', () => {
  it('serves room info and health over HTTP', async () => {
    const a = await connect('http');
    const res = await call(a, 'room:enter', { name: 'Ann', gameType: 'oneo' });
    expect(res).toMatchObject({ ok: true, created: true });
    const info = await (await fetch(`${url}/api/rooms/${res.roomCode.toLowerCase()}`)).json();
    expect(info).toMatchObject({ roomCode: res.roomCode, gameType: 'oneo', phase: 'Lobby', players: [{ name: 'Ann', isHost: true }] });
    expect((await fetch(`${url}/api/rooms/NOPE`)).status).toBe(404);
    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ ok: true });
  });

  it('two players play a Last Stand round with private hands', async () => {
    const [a, b] = [await connect('a'), await connect('b')];
    const { roomCode } = await call(a, 'room:enter', { name: 'Ann', gameType: 'last-stand' });
    expect(await call(b, 'room:enter', { name: 'Bo', gameType: 'standup', code: roomCode })).toMatchObject({ ok: true, created: false });
    await until(() => b.room?.players.length === 2);
    expect(b.room!.gameType).toBe('last-stand');

    expect(await call(b, 'game:start', {})).toMatchObject({ ok: false });
    expect(await call(a, 'game:start', {})).toEqual({ ok: true });
    await until(() => !!a.game && !!b.game);

    await call(a, 'game:action', { action: 'SelectCard', payload: { card: 9 } });
    await until(() => (a.game as LastStandState).mySelectedCard === 9);
    expect((b.game as LastStandState).mySelectedCard).toBeNull();
    await call(a, 'game:action', { action: 'LockIn' });
    await call(b, 'game:action', { action: 'SelectCard', payload: { card: 2 } });
    await call(b, 'game:action', { action: 'LockIn' });
    await until(() => (a.game as LastStandState).phase === 'RoundOver');
    expect((b.game as LastStandState).lastRoundResult).toMatchObject({ winners: ['Ann'], losers: ['Bo'], playedCards: { Ann: 9, Bo: 2 } });
  });

  it('a dropped connection can rejoin and gets its hand back', async () => {
    const [a, b] = [await connect('c'), await connect('d')];
    const { roomCode } = await call(a, 'room:enter', { name: 'Cy', gameType: 'oneo' });
    await call(b, 'room:enter', { name: 'Di', gameType: 'oneo', code: roomCode });
    await call(a, 'game:start', { settings: { numbersOnly: true } });
    await until(() => !!b.game);
    const hand = (b.game as OneOState).myHand;
    expect(hand).toHaveLength(7);

    b.close();
    await until(() => a.room!.players[1].isConnected === false);
    const b2 = await connect('d');
    expect(await call(b2, 'room:rejoin', { code: roomCode })).toEqual({ ok: true });
    await until(() => !!b2.game && a.room!.players[1].isConnected);
    expect((b2.game as OneOState).myHand).toEqual(hand);

    const stranger = await connect('e');
    expect(await call(stranger, 'room:rejoin', { code: roomCode })).toMatchObject({ ok: false });
    expect(await call(stranger, 'game:action', { action: 'DrawCard' })).toMatchObject({ ok: false });
  });

  it('streams Fortress ticks, enforces roles, and restores a disconnected flinger', async () => {
    const [a, b] = [await connect('fort-a'), await connect('fort-b')];
    const { roomCode } = await call(a, 'room:enter', { name: 'Ash', gameType: 'defend-fortress' });
    await call(b, 'room:enter', { name: 'Birch', gameType: 'defend-fortress', code: roomCode });
    await call(b, 'room:setRole', { role: 'artillery' });
    await call(a, 'game:start', { settings: { gameMode: '50' } });
    await until(() => a.game?.enemies.length > 0 && b.game?.enemies.length > 0);
    expect(a.game).toMatchObject({ gameMode: '50', artilleryPlayerName: 'Birch' });
    const id = a.game.enemies[0].id;
    expect(await call(b, 'game:action', { action: 'GrabEnemy', payload: { id } })).toMatchObject({ ok: false });
    expect(await call(a, 'game:action', { action: 'GrabEnemy', payload: { id } })).toMatchObject({ ok: true });
    await until(() => b.game.enemies.some((e: any) => e.id === id && e.heldBy === 'Ash'));
    a.close();
    await until(() => b.game.enemies.some((e: any) => e.id === id && !e.heldBy));
    const rejoined = await connect('fort-a');
    expect(await call(rejoined, 'room:rejoin', { code: roomCode })).toEqual({ ok: true });
    await until(() => !!rejoined.game);
    expect(rejoined.game.players.find((p: any) => p.name === 'Ash').role).toBe('flinger');
    expect(await call(rejoined, 'game:action', { action: 'TogglePause' })).toEqual({ ok: true });
    await until(() => b.game.isPaused);
    const frozen = b.game.enemies;
    await new Promise(r => setTimeout(r, 150));
    expect(b.game.enemies).toEqual(frozen);
  });

  it('plays OneO to the end and returns to the lobby', async () => {
    const [a, b] = [await connect('f'), await connect('g')];
    const { roomCode } = await call(a, 'room:enter', { name: 'Fay', gameType: 'oneo' });
    await call(b, 'room:enter', { name: 'Gus', gameType: 'oneo', code: roomCode });
    await call(a, 'game:start', {});
    await until(() => !!a.game && !!b.game);

    for (let i = 0; i < 3000 && a.room!.phase === 'Playing'; i++) {
      const who = (a.game as OneOState).currentPlayerName === 'Fay' ? a : b;
      const s = who.game as OneOState;
      const card = s.myHand.find((c) => oneoCanPlay(c, s.topDiscard!, s.currentColor));
      const res = card
        ? await call(who, 'game:action', { action: 'PlayCard', payload: { cardId: card.id, chosenColor: 'Green' } })
        : await call(who, 'game:action', { action: 'DrawCard' });
      expect(res).toEqual({ ok: true });
      // Acks can arrive before the broadcast; let both views settle on the same turn.
      await until(() => a.room!.phase !== 'Playing' || (a.game as OneOState).lastAction === (b.game as OneOState).lastAction);
    }
    expect(a.room!.phase).toBe('GameOver');
    await until(() => !!(b.game as OneOState).winnerName);
    expect((b.game as OneOState).winnerName).toMatch(/Fay|Gus/);
    await until(() => a.room!.phase === 'Lobby');
    expect(a.room!.players.map((p) => p.name)).toEqual(['Fay', 'Gus']);
  }, 30_000);
});
