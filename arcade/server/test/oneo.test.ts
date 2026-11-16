import type { OneOCard, OneOState } from '@arcade/shared';
import { oneoCanPlay } from '@arcade/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeck } from '../src/games/oneo.js';
import { harness } from './harness.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const card = (color: OneOCard['color'], type: OneOCard['type'], value = 0): OneOCard => ({ id: 0, color, type, value });

describe('OneO deck and legality', () => {
  it('builds a 108-card deck, or 76 with numbers only', () => {
    expect(generateDeck()).toHaveLength(108);
    const plain = generateDeck(true);
    expect(plain).toHaveLength(76);
    expect(plain.every((c) => c.type === 'Number')).toBe(true);
    expect(new Set(generateDeck().map((c) => c.id)).size).toBe(108);
  });

  it('matches by colour, number, special type, or wild', () => {
    const top = card('Red', 'Number', 7);
    expect(oneoCanPlay(card('Red', 'Number', 2), top, 'Red')).toBe(true);
    expect(oneoCanPlay(card('Blue', 'Number', 7), top, 'Red')).toBe(true);
    expect(oneoCanPlay(card('Blue', 'Number', 3), top, 'Red')).toBe(false);
    expect(oneoCanPlay(card('Wild', 'WildDrawFour', 50), top, 'Red')).toBe(true);
    expect(oneoCanPlay(card('Blue', 'Skip', 20), card('Red', 'Skip', 20), 'Red')).toBe(true);
    // After a wild, the chosen colour is what counts.
    expect(oneoCanPlay(card('Green', 'Number', 1), card('Wild', 'Wild', 50), 'Green')).toBe(true);
    expect(oneoCanPlay(card('Red', 'Number', 1), card('Wild', 'Wild', 50), 'Green')).toBe(false);
  });
});

describe('OneO play', () => {
  it('deals seven each and keeps hands private', () => {
    const h = harness().seat('oneo', 'A', 'B', 'C').start({ numbersOnly: true });
    const a = h.state<OneOState>('A');
    expect(a.myHand).toHaveLength(7);
    expect(a.handCounts).toEqual({ A: 7, B: 7, C: 7 });
    expect(a.drawPileCount).toBe(76 - 21 - 1);
    expect(a.currentPlayerName).toBe('A');
    expect(h.state<OneOState>('B').myHand).not.toEqual(a.myHand);
  });

  it('rejects out-of-turn and illegal plays; drawing passes or keeps the turn', () => {
    const h = harness().seat('oneo', 'A', 'B').start({ numbersOnly: true });
    const b = h.state<OneOState>('B');
    expect(h.act('B', 'PlayCard', { cardId: b.myHand[0].id })).toMatchObject({ ok: false });
    const a = h.state<OneOState>('A');
    const bad = a.myHand.find((c) => !oneoCanPlay(c, a.topDiscard!, a.currentColor));
    if (bad) expect(h.act('A', 'PlayCard', { cardId: bad.id })).toMatchObject({ ok: false });
    expect(h.act('A', 'DrawCard')).toEqual({ ok: true });
    const after = h.state<OneOState>('A');
    expect(after.myHand).toHaveLength(8);
    const drawn = after.myHand[7];
    expect(after.currentPlayerName).toBe(oneoCanPlay(drawn, after.topDiscard!, after.currentColor) ? 'A' : 'B');
  });

  it('plays a full game against the bot to a winner', () => {
    const h = harness().seat('oneo', 'A').start();
    expect(h.room.players[1].isBot).toBe(true);
    for (let turn = 0; turn < 2000 && h.room.phase === 'Playing'; turn++) {
      const s = h.state<OneOState>('A');
      if (s.currentPlayerName === 'A') {
        const playable = s.myHand.find((c) => oneoCanPlay(c, s.topDiscard!, s.currentColor));
        const res = playable
          ? h.act('A', 'PlayCard', { cardId: playable.id, chosenColor: 'Blue' })
          : h.act('A', 'DrawCard');
        expect(res).toEqual({ ok: true });
      } else {
        vi.advanceTimersByTime(2500);
      }
    }
    const end = h.state<OneOState>('A');
    expect(h.room.phase).toBe('GameOver');
    expect(end.winnerName).toBeTruthy();
    expect(end.handCounts[end.winnerName!]).toBe(0);
  });

  it('dropping down to one player ends the game', () => {
    const h = harness().seat('oneo', 'A', 'B', 'C').start();
    h.rooms.drop('s-A', 'B', 'game');
    expect(h.state<OneOState>('A').playerOrder).toEqual(['A', 'C']);
    h.rooms.drop('s-A', 'C', 'game');
    expect(h.state<OneOState>('A').winnerName).toBe('A');
    expect(h.room.phase).toBe('GameOver');
  });
});
