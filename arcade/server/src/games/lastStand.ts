import type { LastStandPlayer, LastStandRoundResult, LastStandState } from '@arcade/shared';
import { LAST_STAND_LIVES } from '@arcade/shared';
import type { GameContext, GameInstance, GameModule, Player } from './types.js';
import { fail, ok, randInt } from './types.js';

export const SUSPENSE_MS = 1500;
export const ROUND_OVER_MS = 5000;
const TIES_FOR_SUDDEN_DEATH = 3;

function createLastStand(ctx: GameContext): GameInstance {
  const { room, rng } = ctx;
  const order = room.players.map((p) => p.name);
  const hands = new Map<string, number[]>(order.map((n) => [n, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]));
  const lives = new Map<string, number>(order.map((n) => [n, LAST_STAND_LIVES]));
  const selected = new Map<string, number | null>(order.map((n) => [n, null]));
  const lockedIn = new Set<string>();
  const eliminated = new Set<string>();
  let phase: LastStandState['phase'] = 'Choosing';
  let round = 1;
  let lastResult: LastStandRoundResult | null = null;
  let winnerName: string | null = null;
  let headsUpTies = 0;
  let suddenDeath = false;
  let revealPending = false;

  const active = () => order.filter((n) => !eliminated.has(n));
  const allLocked = () => active().length > 0 && active().every((n) => lockedIn.has(n));

  function view(player: Player): LastStandState {
    const players: LastStandPlayer[] = order.map((name) => ({
      name,
      lives: lives.get(name) ?? 0,
      cardsLeft: hands.get(name)?.length ?? 0,
      isEliminated: eliminated.has(name),
      isConnected: room.players.find((p) => p.name === name)?.isConnected ?? false,
      hasLockedIn: lockedIn.has(name),
    }));
    const spectating = eliminated.has(player.name) || !order.includes(player.name);
    return {
      phase,
      round,
      myHand: hands.get(player.name) ?? [],
      mySelectedCard: selected.get(player.name) ?? null,
      myLockedIn: lockedIn.has(player.name),
      lockedInCount: lockedIn.size,
      activeCount: active().length,
      suddenDeath,
      players,
      lastRoundResult: phase === 'Choosing' && !suddenDeath ? null : lastResult,
      winnerName,
      spectatorCards:
        spectating && phase === 'Choosing'
          ? active().map((n) => ({ playerName: n, card: lockedIn.has(n) ? selected.get(n) ?? null : null }))
          : null,
    };
  }

  function broadcast(): void {
    for (const p of room.players) ctx.sendState(p, view(p));
  }

  function scheduleReveal(): void {
    if (revealPending) return;
    revealPending = true;
    ctx.after(SUSPENSE_MS, () => {
      revealPending = false;
      if (phase === 'Choosing' && allLocked()) resolveRound();
    });
  }

  function mostLives(livesAtStart: Map<string, number>, candidates: string[]): string | null {
    return [...candidates].sort((a, b) => (livesAtStart.get(b) ?? 0) - (livesAtStart.get(a) ?? 0))[0] ?? null;
  }

  function endGame(): void {
    phase = 'GameOver';
    ctx.endGame();
    broadcast();
  }

  function resolveRound(): void {
    const played: Record<string, number> = {};
    for (const n of active()) {
      const card = selected.get(n);
      if (card != null) played[n] = card;
    }
    const livesAtStart = new Map(lives);

    const counts = new Map<number, number>();
    for (const v of Object.values(played)) counts.set(v, (counts.get(v) ?? 0) + 1);
    const names = Object.keys(played);
    const cancelled = names.filter((n) => counts.get(played[n])! > 1);
    const unique = names.filter((n) => counts.get(played[n]) === 1);

    let winners: string[] = [];
    let losers: string[] = [];
    if (unique.length) {
      const max = Math.max(...unique.map((n) => played[n]));
      const min = Math.min(...unique.map((n) => played[n]));
      winners = unique.filter((n) => played[n] === max);
      // A lone unique card is both highest and lowest: surviving beats being punished.
      losers = max === min ? [] : unique.filter((n) => played[n] === min);
    }

    const out: string[] = [];
    for (const loser of losers) {
      lives.set(loser, lives.get(loser)! - 1);
      if (lives.get(loser)! <= 0) {
        eliminated.add(loser);
        out.push(loser);
      }
    }

    for (const [name, card] of Object.entries(played)) {
      const hand = hands.get(name)!;
      hand.splice(hand.indexOf(card), 1);
    }
    for (const n of order) selected.set(n, null);
    lockedIn.clear();

    const after = active();
    const wash = names.length === 2 && cancelled.length === 2 && after.length === 2;
    headsUpTies = wash ? headsUpTies + 1 : 0;

    lastResult = { playedCards: played, winners, losers, cancelled, livesAfter: Object.fromEntries(lives), eliminated: out };

    if (after.length <= 1) {
      winnerName = after[0] ?? mostLives(livesAtStart, names);
      endGame();
      return;
    }
    if (after.every((n) => hands.get(n)!.length === 0)) {
      winnerName = mostLives(livesAtStart, after);
      endGame();
      return;
    }

    phase = 'RoundOver';
    broadcast();
    ctx.after(ROUND_OVER_MS, startNextRound);
  }

  function startNextRound(): void {
    if (phase !== 'RoundOver') return;
    round++;
    phase = 'Choosing';
    suddenDeath = headsUpTies >= TIES_FOR_SUDDEN_DEATH && active().length === 2;
    if (suddenDeath) {
      for (const n of active()) {
        selected.set(n, Math.max(...hands.get(n)!));
        lockedIn.add(n);
      }
      broadcast();
      scheduleReveal();
      return;
    }
    broadcast();
    scheduleBots();
  }

  function scheduleBots(): void {
    for (const bot of room.players.filter((p) => p.isBot && !eliminated.has(p.name))) {
      const forRound = round;
      ctx.after(800 + rng() * 1200, () => {
        if (phase !== 'Choosing' || round !== forRound || lockedIn.has(bot.name) || eliminated.has(bot.name)) return;
        const hand = hands.get(bot.name)!;
        if (!hand.length) return;
        selected.set(bot.name, hand[randInt(rng, hand.length)]);
        lockedIn.add(bot.name);
        broadcast();
        if (allLocked()) scheduleReveal();
      });
    }
  }

  function leave(name: string): void {
    if (phase === 'GameOver' || !order.includes(name) || eliminated.has(name)) return;
    eliminated.add(name);
    selected.set(name, null);
    lockedIn.delete(name);
    const left = active();
    if (left.length <= 1) {
      winnerName = left[0] ?? null;
      endGame();
      return;
    }
    broadcast();
    if (phase === 'Choosing' && allLocked()) scheduleReveal();
  }

  return {
    start() {
      broadcast();
      scheduleBots();
    },
    sync: broadcast,
    action(player, action, payload) {
      const data = (payload ?? {}) as Record<string, unknown>;
      if (action !== 'SelectCard' && action !== 'LockIn') return fail(`Unknown action: ${action}`);
      if (phase !== 'Choosing') return fail('Not in the choosing phase.');
      if (!order.includes(player.name) || eliminated.has(player.name)) return fail('You are eliminated.');

      if (action === 'SelectCard') {
        if (suddenDeath) return fail('Sudden death — your card is forced.');
        if (lockedIn.has(player.name)) return fail('You are already locked in.');
        const card = Number(data.card);
        if (!hands.get(player.name)!.includes(card)) return fail('That card is not in your hand.');
        selected.set(player.name, card);
        ctx.sendState(player, view(player));
        return ok();
      }

      if (selected.get(player.name) == null) return fail('Select a card first.');
      if (lockedIn.has(player.name)) return fail('You are already locked in.');
      lockedIn.add(player.name);
      broadcast();
      if (allLocked()) scheduleReveal();
      return ok();
    },
    onDisconnected: broadcast,
    onGraceExpired: leave,
    onDropped: leave,
  };
}

export const lastStand: GameModule = { id: 'last-stand', minPlayers: 2, maxPlayers: 8, botName: '🤖 Stand Bot', create: (ctx) => createLastStand(ctx) };
