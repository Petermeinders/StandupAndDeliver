import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from './harness.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('rooms', () => {
  it('creates, joins, rejects duplicate names and full rooms', () => {
    const h = harness().seat('oneo', 'Ann', 'Bo');
    expect(h.code).toMatch(/^[A-Z]{4}$/);
    expect(h.room.players.map((p) => [p.name, p.isHost])).toEqual([['Ann', true], ['Bo', false]]);
    expect(h.rooms.enter('s-x', 'id-x-000000', { name: 'ann', gameType: 'oneo', code: h.code })).toMatchObject({ ok: false });
    expect(h.rooms.enter('s-y', 'id-y-000000', { name: '  ', gameType: 'oneo', code: h.code })).toMatchObject({ ok: false });
    for (let i = 0; i < 6; i++) h.rooms.enter(`s-p${i}`, `id-p${i}-00000`, { name: `P${i}`, gameType: 'oneo', code: h.code });
    expect(h.rooms.enter('s-z', 'id-z-000000', { name: 'Zed', gameType: 'oneo', code: h.code })).toMatchObject({ ok: false, error: 'Room is full (max 8 players).' });
  });

  it('uses a requested code and fun names', () => {
    const h = harness();
    expect(h.rooms.enter('s1', 'id-1-000000', { name: 'A', gameType: 'standup', code: 'pizza' })).toMatchObject({ ok: true, roomCode: 'PIZZA', created: true });
    const fun = h.rooms.enter('s2', 'id-2-000000', { name: 'B', gameType: 'standup', funName: true });
    expect(fun.ok && fun.roomCode.length).toBeGreaterThan(4);
    // Entering another room leaves the first.
    expect(h.rooms.getRoom('PIZZA')).toBeDefined();
    h.rooms.enter('s1', 'id-1-000000', { name: 'A', gameType: 'standup' });
    expect(h.rooms.getRoom('PIZZA')).toBeUndefined();
  });

  it('keeps a seat through a reconnect and frees it after the grace period in the lobby', () => {
    const h = harness().seat('oneo', 'Ann', 'Bo');
    h.rooms.disconnect('s-Bo');
    expect(h.room.players[1].isConnected).toBe(false);
    expect(h.rooms.rejoin('s-Bo2', 'id-Bo-0000', h.code)).toEqual({ ok: true });
    expect(h.room.players[1]).toMatchObject({ isConnected: true, socketId: 's-Bo2' });
    h.rooms.disconnect('s-Bo2');
    vi.advanceTimersByTime(30_000);
    expect(h.room.players.map((p) => p.name)).toEqual(['Ann']);
    expect(h.rooms.rejoin('s-Bo3', 'id-Bo-0000', h.code)).toMatchObject({ ok: false });
  });

  it('passes the host badge on when the host leaves, and closes empty rooms', () => {
    const h = harness().seat('oneo', 'Ann', 'Bo');
    h.rooms.leave('s-Ann');
    expect(h.room.players).toMatchObject([{ name: 'Bo', isHost: true }]);
    h.rooms.leave('s-Bo');
    expect(h.rooms.getRoom(h.code)).toBeUndefined();
  });

  it('lets someone claim host only when the host is gone', () => {
    const h = harness().seat('standup', 'Ann', 'Bo').start();
    expect(h.rooms.claimHost('s-Bo')).toMatchObject({ ok: false });
    h.rooms.disconnect('s-Ann');
    expect(h.rooms.claimHost('s-Bo')).toEqual({ ok: true });
    expect(h.room.players.map((p) => p.isHost)).toEqual([false, true]);
  });

  it('blocks late joiners and non-host starts; host can switch game in the lobby', () => {
    const h = harness().seat('oneo', 'Ann', 'Bo');
    expect(h.rooms.start('s-Bo')).toMatchObject({ ok: false });
    expect(h.rooms.setGame('s-Bo', 'last-stand')).toMatchObject({ ok: false });
    expect(h.rooms.setGame('s-Ann', 'last-stand')).toEqual({ ok: true });
    expect(h.room.gameType).toBe('last-stand');
    h.start();
    expect(h.rooms.enter('s-c', 'id-c-000000', { name: 'Cy', gameType: 'oneo', code: h.code })).toMatchObject({ ok: false, error: 'That game has already started.' });
    expect(h.rooms.setGame('s-Ann', 'oneo')).toMatchObject({ ok: false });
  });

  it('removes a dropped player and tells them', () => {
    const h = harness().seat('oneo', 'Ann', 'Bo', 'Cy');
    expect(h.rooms.drop('s-Bo', 'Cy', 'room')).toMatchObject({ ok: false });
    expect(h.rooms.drop('s-Ann', 'Cy', 'room')).toEqual({ ok: true });
    expect(h.room.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
    expect(h.sent.some((m) => m.to === 's-Cy' && m.event === 'room:removed')).toBe(true);
  });

  it('expires rooms with nobody connected, and idle rooms on sweep', () => {
    const h = harness().seat('standup', 'Ann', 'Bo').start();
    h.rooms.disconnect('s-Ann');
    h.rooms.disconnect('s-Bo');
    vi.advanceTimersByTime(5 * 60_000);
    expect(h.rooms.getRoom(h.code)).toBeUndefined();

    const h2 = harness().seat('standup', 'Ann');
    expect(h2.rooms.sweep(Date.now() + 3 * 60 * 60_000)).toBe(1);
  });
});
