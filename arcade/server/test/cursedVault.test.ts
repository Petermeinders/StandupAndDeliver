import type { CursedVaultState } from '@arcade/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from './harness.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const st = (h: ReturnType<typeof harness>, n: string) => h.state<CursedVaultState>(n);

describe('Cursed Vault', () => {
  it('round 1 only allows playing a card', () => {
    const h = harness().seat('cursed-vault', 'A', 'B').start();
    expect(st(h, 'A')).toMatchObject({ myGold: 5, myHasSkull: true, isRoundOne: true, isMyTurn: true });
    expect(h.act('A', 'StartGamble', { count: 1 })).toMatchObject({ ok: false });
    expect(h.act('B', 'PlayCard', { type: 'Gold' })).toMatchObject({ ok: false });
    expect(h.act('A', 'PlayCard', { type: 'Gold' })).toEqual({ ok: true });
    expect(h.act('B', 'PlayCard', { type: 'Gold' })).toEqual({ ok: true });
    expect(st(h, 'A')).toMatchObject({ round: 2, pileCount: 2, myGold: 4, isMyTurn: true });
  });

  it('a clean gamble collects gold, then requires a card back into the pile', () => {
    const h = harness().seat('cursed-vault', 'A', 'B').start();
    h.act('A', 'PlayCard', { type: 'Gold' });
    h.act('B', 'PlayCard', { type: 'Gold' });
    expect(h.act('A', 'StartGamble', { count: 3 })).toMatchObject({ ok: false });
    expect(h.act('A', 'StartGamble', { count: 2 })).toEqual({ ok: true });
    expect(h.act('A', 'PlayCard', { type: 'Gold' })).toMatchObject({ ok: false });
    h.act('A', 'FlipCard');
    expect(st(h, 'B').activeGamble).toMatchObject({ playerName: 'A', flipsSoFar: 1, goldCollectedSoFar: 1, lastFlippedCard: 'Gold' });
    h.act('A', 'FlipCard');
    expect(st(h, 'A')).toMatchObject({ myGold: 6, pileCount: 0, awaitingMyCardPlay: true });
    expect(h.act('A', 'FlipCard')).toMatchObject({ ok: false });
    expect(h.act('A', 'PlayCardAfterGamble', { type: 'Skull' })).toEqual({ ok: true });
    expect(st(h, 'A')).toMatchObject({ myGold: 6, myHasSkull: false, pileCount: 1, isMyTurn: false, activeGamble: null });
  });

  it('a skull costs the hand skull first, then eliminates', () => {
    const h = harness().seat('cursed-vault', 'A', 'B', 'C').start();
    for (const n of ['A', 'B', 'C']) h.act(n, 'PlayCard', { type: 'Skull' });
    // Pile is three skulls: any flip is a hit.
    h.act('A', 'StartGamble', { count: 1 });
    h.act('A', 'FlipCard');
    // A had already played their skull, so this hit eliminates them.
    let s = st(h, 'A');
    expect(s.players.find((p) => p.name === 'A')).toMatchObject({ isEliminated: true, gold: 0 });
    expect(s.lastTurn).toMatchObject({ playerName: 'A', action: 'GambledSkullHit', eliminated: true });
    expect(s.pileCount).toBe(3);
    expect(s.shuffleCount).toBe(1);
    expect(s.currentPlayerName).toBe('B');
    h.act('B', 'StartGamble', { count: 1 });
    h.act('B', 'FlipCard');
    s = st(h, 'C');
    expect(s.winnerName).toBe('C');
    expect(s.phase).toBe('GameOver');
  });

  it('keeps a spare life when the skull is still in hand', () => {
    const h = harness().seat('cursed-vault', 'A', 'B').start();
    h.act('A', 'PlayCard', { type: 'Gold' });
    h.act('B', 'PlayCard', { type: 'Skull' });
    h.act('A', 'PlayCard', { type: 'Gold' });
    h.act('B', 'PlayCard', { type: 'Gold' });
    // Pile: G S G G. Gamble for everything; the skull must turn up within four flips.
    h.act('A', 'StartGamble', { count: 4 });
    let flips = 0;
    while (st(h, 'A').activeGamble && flips++ < 4) h.act('A', 'FlipCard');
    const s = st(h, 'A');
    expect(s.lastTurn).toMatchObject({ action: 'GambledSkullHit', skullLost: true, eliminated: false });
    expect(s.myHasSkull).toBe(false);
    expect(s.myGold).toBe(3 + (flips - 1));
    // Flipped gold is banked *and* shuffled back with the skull, so the pile is whole again.
    expect(s.pileCount).toBe(4);
    expect(s.isMyTurn).toBe(false);
  });

  it('ten gold wins immediately', () => {
    const h = harness().seat('cursed-vault', 'A', 'B').start();
    h.act('A', 'PlayCard', { type: 'Gold' });
    h.act('B', 'PlayCard', { type: 'Gold' });
    // The pile only ever holds gold: A takes two and pays one back, B keeps feeding it.
    for (let turn = 0; turn < 4; turn++) {
      h.act('A', 'StartGamble', { count: 2 });
      h.act('A', 'FlipCard');
      h.act('A', 'FlipCard');
      h.act('A', 'PlayCardAfterGamble', { type: 'Gold' });
      h.act('B', 'PlayCard', { type: 'Gold' });
    }
    expect(st(h, 'A').myGold).toBe(8);
    h.act('A', 'StartGamble', { count: 2 });
    h.act('A', 'FlipCard');
    h.act('A', 'FlipCard');
    expect(st(h, 'B')).toMatchObject({ phase: 'GameOver', winnerName: 'A', activeGamble: null });
    expect(h.room.phase).toBe('GameOver');
  });

  it('plays against the bot without stalling', () => {
    const h = harness().seat('cursed-vault', 'A').start();
    for (let i = 0; i < 400 && h.room.phase === 'Playing'; i++) {
      const s = st(h, 'A');
      if (!s.isMyTurn) { vi.advanceTimersByTime(2100); continue; }
      if (s.awaitingMyCardPlay) h.act('A', 'PlayCardAfterGamble', { type: s.myGold ? 'Gold' : 'Skull' });
      else if (s.activeGamble) h.act('A', 'FlipCard');
      else if (!s.isRoundOne && s.pileCount > 0) h.act('A', 'StartGamble', { count: 1 });
      else h.act('A', 'PlayCard', { type: s.myGold ? 'Gold' : 'Skull' });
    }
    expect(h.room.phase).toBe('GameOver');
    expect(st(h, 'A').winnerName).toBeTruthy();
  });
});
