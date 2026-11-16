import type { StandupState } from '@arcade/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_SECONDS, VOTING_SECONDS } from '../src/games/standup.js';
import { harness } from './harness.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const st = (h: ReturnType<typeof harness>, n: string) => h.state<StandupState>(n);

describe('Standup & Deliver', () => {
  it('only the speaker sees the card, and the clock starts on flip', () => {
    const h = harness().seat('standup', 'A', 'B', 'C').start();
    expect(st(h, 'A')).toMatchObject({ subPhase: 'SpeakerTurn', activePlayerName: 'A', cardFlipped: false, secondsRemaining: null });
    expect(st(h, 'A').card!.text).toBeTruthy();
    expect(st(h, 'A').card!.buzzwords).toHaveLength(3);
    expect(st(h, 'B').card).toBeNull();
    expect(h.act('B', 'FlipCard')).toMatchObject({ ok: false });
    expect(h.act('A', 'FlipCard')).toEqual({ ok: true });
    vi.advanceTimersByTime(3000);
    const ticks = h.sent.filter((m) => m.event === 'timer:tick').map((m) => m.payload);
    expect(ticks.slice(-1)[0]).toBe(TURN_SECONDS - 3);
  });

  it('pause holds the clock; running out moves to voting', () => {
    const h = harness().seat('standup', 'A', 'B').start();
    h.act('A', 'FlipCard');
    vi.advanceTimersByTime(5000);
    expect(h.act('A', 'PauseTurn')).toEqual({ ok: true });
    vi.advanceTimersByTime(20_000);
    expect(st(h, 'A')).toMatchObject({ paused: true, secondsRemaining: TURN_SECONDS - 5 });
    h.act('A', 'ResumeTurn');
    vi.advanceTimersByTime((TURN_SECONDS - 5) * 1000);
    expect(st(h, 'B').subPhase).toBe('Voting');
  });

  it('scores the average rating times ten and reveals the card', () => {
    const h = harness().seat('standup', 'A', 'B', 'C').start();
    h.act('A', 'FlipCard');
    h.act('A', 'SendTranscript', { text: 'I synergized the water cooler.' });
    h.act('A', 'EndTurn');
    expect(st(h, 'B')).toMatchObject({ subPhase: 'Voting', votesTotal: 2, lastTranscript: 'I synergized the water cooler.' });
    expect(h.act('A', 'SubmitImpressiveness', { rating: 5 })).toMatchObject({ ok: false });
    expect(h.act('B', 'SubmitImpressiveness', { rating: 9 })).toMatchObject({ ok: false });
    h.act('B', 'SubmitImpressiveness', { rating: 4 });
    expect(h.act('B', 'SubmitImpressiveness', { rating: 1 })).toMatchObject({ ok: false });
    h.act('C', 'SubmitImpressiveness', { rating: 3 });
    const s = st(h, 'C');
    expect(s.subPhase).toBe('Results');
    expect(s.lastTurnResult).toMatchObject({ activePlayerName: 'A', impressionScore: 3.5, turnScore: 35 });
    expect(s.card).not.toBeNull();
    expect(h.room.players[0].score).toBe(35);
  });

  it('voting times out, the host advances, and the game ends after the last speaker', () => {
    const h = harness().seat('standup', 'A', 'B').start();
    h.act('A', 'FlipCard');
    h.act('A', 'EndTurn');
    vi.advanceTimersByTime(VOTING_SECONDS * 1000);
    expect(st(h, 'A')).toMatchObject({ subPhase: 'Results' });
    expect(st(h, 'A').lastTurnResult!.turnScore).toBe(0);
    expect(h.act('B', 'AdvanceTurn')).toMatchObject({ ok: false });
    h.act('A', 'AdvanceTurn');
    expect(st(h, 'A')).toMatchObject({ subPhase: 'SpeakerTurn', activePlayerName: 'B' });
    expect(h.act('A', 'SkipTurn')).toEqual({ ok: true });
    h.act('A', 'SubmitImpressiveness', { rating: 5 });
    h.act('A', 'AdvanceTurn');
    expect(h.room.phase).toBe('GameOver');
    expect(h.room.players.map((p) => p.score)).toEqual([0, 50]);
  });

  it('skips a speaker who has left the room', () => {
    const h = harness().seat('standup', 'A', 'B', 'C').start();
    h.rooms.leave('s-B');
    h.act('A', 'FlipCard');
    h.act('A', 'EndTurn');
    h.act('C', 'SubmitImpressiveness', { rating: 2 });
    h.act('A', 'AdvanceTurn');
    expect(st(h, 'A').activePlayerName).toBe('C');
  });
});
