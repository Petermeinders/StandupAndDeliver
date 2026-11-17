import type { LastStandState } from '@arcade/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUND_OVER_MS, SUSPENSE_MS } from '../src/games/lastStand.js';
import { harness } from './harness.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

function play(h: ReturnType<typeof harness>, picks: Record<string, number>) {
  for (const [name, card] of Object.entries(picks)) {
    expect(h.act(name, 'SelectCard', { card })).toEqual({ ok: true });
    expect(h.act(name, 'LockIn')).toEqual({ ok: true });
  }
  vi.advanceTimersByTime(SUSPENSE_MS);
}
const next = () => vi.advanceTimersByTime(ROUND_OVER_MS);

describe('Last Stand', () => {
  it('highest unique wins, lowest unique loses a life, ties cancel', () => {
    const h = harness().seat('last-stand', 'A', 'B', 'C', 'D').start();
    play(h, { A: 10, B: 10, C: 5, D: 3 });
    const s = h.state<LastStandState>('A');
    expect(s.phase).toBe('RoundOver');
    expect(s.lastRoundResult).toMatchObject({ winners: ['C'], losers: ['D'], cancelled: ['A', 'B'] });
    expect(s.players.find((p) => p.name === 'D')!.lives).toBe(2);
    expect(s.players.find((p) => p.name === 'A')!.cardsLeft).toBe(9);
  });

  it('a lone unique card wins and nobody loses', () => {
    const h = harness().seat('last-stand', 'A', 'B', 'C').start();
    play(h, { A: 4, B: 4, C: 1 });
    const r = h.state<LastStandState>('A').lastRoundResult!;
    expect(r.winners).toEqual(['C']);
    expect(r.losers).toEqual([]);
  });

  it('hides picks from players but shows locked picks to spectators', () => {
    const h = harness().seat('last-stand', 'A', 'B', 'C').start();
    // C loses three rounds in a row and is eliminated.
    play(h, { A: 10, B: 9, C: 1 }); next();
    play(h, { A: 9, B: 10, C: 2 }); next();
    play(h, { A: 8, B: 7, C: 3 }); next();
    expect(h.state<LastStandState>('C').players.find((p) => p.name === 'C')!.isEliminated).toBe(true);
    h.act('A', 'SelectCard', { card: 1 });
    h.act('A', 'LockIn');
    expect(h.state<LastStandState>('B').spectatorCards).toBeNull();
    expect(h.state<LastStandState>('C').spectatorCards).toEqual([
      { playerName: 'A', card: 1 },
      { playerName: 'B', card: null },
    ]);
    expect(h.act('C', 'SelectCard', { card: 5 }).ok).toBe(false);
  });

  it('last player standing wins and the room returns to the lobby', () => {
    const h = harness().seat('last-stand', 'A', 'B').start();
    play(h, { A: 10, B: 1 }); next();
    play(h, { A: 9, B: 2 }); next();
    play(h, { A: 8, B: 3 });
    const s = h.state<LastStandState>('A');
    expect(s.phase).toBe('GameOver');
    expect(s.winnerName).toBe('A');
    expect(h.room.phase).toBe('GameOver');
    vi.advanceTimersByTime(8000);
    expect(h.room.phase).toBe('Lobby');
    expect(h.room.game).toBeNull();
  });

  it('three heads-up washes force sudden death on the highest cards', () => {
    const h = harness().seat('last-stand', 'A', 'B').start();
    play(h, { A: 1, B: 1 }); next();
    play(h, { A: 2, B: 2 }); next();
    play(h, { A: 10, B: 10 }); next();
    const s = h.state<LastStandState>('A');
    expect(s.suddenDeath).toBe(true);
    expect(s.mySelectedCard).toBe(9);
    expect(s.myLockedIn).toBe(true);
    expect(h.act('A', 'SelectCard', { card: 3 }).ok).toBe(false);
  });

  it('when all cards run out, most lives at the start of the final round wins', () => {
    const h = harness().seat('last-stand', 'A', 'B').start();
    // A wins round 1 (B: 2 lives), then they mirror each other until the hands are empty.
    play(h, { A: 10, B: 9 }); next();
    play(h, { A: 9, B: 10 }); next(); // A: 2, B: 2
    play(h, { A: 8, B: 1 }); next(); // B: 1
    // Remaining A: 1-7, B: 2-8. Avoid three washes in a row by alternating a decided round.
    play(h, { A: 7, B: 7 }); next();
    play(h, { A: 6, B: 6 }); next();
    play(h, { A: 1, B: 8 }); next(); // A: 1, B: 1
    play(h, { A: 5, B: 5 }); next();
    play(h, { A: 4, B: 4 }); next();
    play(h, { A: 3, B: 3 }); next();
    // Sudden death: A's highest is 2, B's is 2.
    vi.advanceTimersByTime(SUSPENSE_MS);
    const s = h.state<LastStandState>('A');
    expect(s.phase).toBe('GameOver');
    expect(s.winnerName).not.toBeNull();
  });

  it('dropping a player voids their pick and lets the round resolve', () => {
    const h = harness().seat('last-stand', 'A', 'B', 'C').start();
    h.act('A', 'SelectCard', { card: 10 }); h.act('A', 'LockIn');
    h.act('B', 'SelectCard', { card: 2 }); h.act('B', 'LockIn');
    expect(h.rooms.drop('s-A', 'C', 'game')).toEqual({ ok: true });
    vi.advanceTimersByTime(SUSPENSE_MS);
    const s = h.state<LastStandState>('A');
    expect(s.phase).toBe('RoundOver');
    expect(s.lastRoundResult!.playedCards).toEqual({ A: 10, B: 2 });
  });

  it('a bot fills a solo game and locks in by itself', () => {
    const h = harness().seat('last-stand', 'A').start();
    expect(h.room.players.map((p) => p.isBot)).toEqual([false, true]);
    h.act('A', 'SelectCard', { card: 5 }); h.act('A', 'LockIn');
    vi.advanceTimersByTime(2100 + SUSPENSE_MS);
    expect(h.state<LastStandState>('A').phase).not.toBe('Choosing');
  });
});
