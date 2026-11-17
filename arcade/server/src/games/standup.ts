import type { PromptCardView, StandupState, StandupSubPhase, TurnResult } from '@arcade/shared';
import { STANDUP_REACTIONS } from '@arcade/shared';
import { ADJECTIVES, NOUNS, VERBS } from '../data/buzzwords.js';
import { PROMPT_CARDS } from '../data/promptCards.js';
import type { GameContext, GameInstance, GameModule, Player } from './types.js';
import { fail, ok, randInt } from './types.js';

export const TURN_SECONDS = 60;
export const VOTING_SECONDS = 30;

function createStandup(ctx: GameContext): GameInstance {
  const { room, rng } = ctx;
  /** Speaking order is fixed at the start so roster changes can't shift whose turn it is. */
  const order = room.players.filter((p) => !p.isBot).map((p) => p.name);
  let speakerIndex = 0;
  let subPhase: StandupSubPhase = 'SpeakerTurn';
  const usedCards = new Set<number>();
  let card: PromptCardView | null = null;
  let cardFlipped = false;
  let transcript = '';
  let ratings = new Map<string, number>();
  let lastResult: TurnResult | null = null;
  let secondsLeft: number | null = null;
  let paused = false;
  let cancelTick: (() => void) | null = null;
  let cancelVote: (() => void) | null = null;

  const find = (name: string | undefined): Player | undefined => room.players.find((p) => p.name === name);
  const speaker = (): Player | undefined => find(order[speakerIndex]);
  const present = (p: Player | undefined): p is Player => !!p && p.isConnected && !p.away;
  const listeners = () => room.players.filter((p) => present(p) && !p.isBot && p.name !== order[speakerIndex]);

  function view(player: Player): StandupState {
    const isSpeaker = player.name === order[speakerIndex];
    const showTranscript = subPhase !== 'SpeakerTurn';
    return {
      subPhase,
      activePlayerName: order[speakerIndex] ?? null,
      card: subPhase === 'Results' || (isSpeaker && subPhase === 'SpeakerTurn') ? card : null,
      cardFlipped,
      paused,
      secondsRemaining: subPhase === 'SpeakerTurn' ? secondsLeft : null,
      votesSubmitted: ratings.size,
      votesTotal: listeners().length,
      lastTurnResult: subPhase === 'Results' ? lastResult : null,
      lastTranscript: showTranscript ? transcript : null,
    };
  }

  function broadcast(): void {
    for (const p of room.players) ctx.sendState(p, view(p));
  }

  function stopClock(): void {
    cancelTick?.();
    cancelTick = null;
  }

  function runClock(): void {
    stopClock();
    cancelTick = ctx.after(1000, () => {
      if (secondsLeft === null) return;
      secondsLeft--;
      ctx.emit('timer:tick', secondsLeft);
      if (secondsLeft <= 0) toVoting();
      else runClock();
    });
  }

  function drawCard(): PromptCardView | null {
    const free = PROMPT_CARDS.map((_, i) => i).filter((i) => !usedCards.has(i));
    if (!free.length) return null;
    const id = free[randInt(rng, free.length)];
    usedCards.add(id);
    return {
      text: PROMPT_CARDS[id],
      buzzwords: [VERBS[randInt(rng, VERBS.length)], ADJECTIVES[randInt(rng, ADJECTIVES.length)], NOUNS[randInt(rng, NOUNS.length)]],
    };
  }

  function startTurn(): void {
    stopClock();
    cancelVote?.();
    // Skip anyone who can't take the stage so the game never waits on an empty chair.
    while (speakerIndex < order.length && !present(speaker())) speakerIndex++;
    const next = speakerIndex < order.length ? drawCard() : null;
    if (!next) {
      finish();
      return;
    }
    card = next;
    ratings = new Map();
    transcript = '';
    cardFlipped = false;
    paused = false;
    secondsLeft = null;
    lastResult = null;
    subPhase = 'SpeakerTurn';
    ctx.broadcastRoom();
    broadcast();
  }

  function finish(): void {
    stopClock();
    cancelVote?.();
    ctx.endGame();
  }

  function toVoting(): void {
    if (subPhase !== 'SpeakerTurn') return;
    stopClock();
    paused = false;
    secondsLeft = null;
    subPhase = 'Voting';
    broadcast();
    if (!listeners().length) {
      toResults();
      return;
    }
    cancelVote = ctx.after(VOTING_SECONDS * 1000, toResults);
  }

  function toResults(): void {
    if (subPhase !== 'Voting') return;
    cancelVote?.();
    cancelVote = null;
    const values = [...ratings.values()];
    const impression = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
    const turnScore = Math.round(impression * 10);
    const who = speaker();
    if (who) who.score += turnScore;
    lastResult = { activePlayerName: order[speakerIndex], card: card!, impressionScore: impression, turnScore };
    subPhase = 'Results';
    ctx.broadcastRoom();
    broadcast();
  }

  function advance(): void {
    speakerIndex++;
    if (speakerIndex >= order.length) finish();
    else startTurn();
  }

  /** The named player can no longer take part: keep the turn flow moving. */
  function playerGone(name: string, wasHost: boolean): void {
    if (room.phase !== 'Playing') return;
    if (subPhase === 'SpeakerTurn' && order[speakerIndex] === name) toVoting();
    else if (subPhase === 'Voting') checkVotes();
    else if (subPhase === 'Results' && wasHost) advance();
    else broadcast();
  }

  function checkVotes(): void {
    const eligible = listeners();
    ctx.emit('vote:count', { submitted: ratings.size, total: eligible.length });
    if (eligible.every((p) => ratings.has(p.name))) toResults();
    else broadcast();
  }

  const isSpeaker = (p: Player) => p.name === order[speakerIndex];

  return {
    start: startTurn,
    sync: broadcast,

    action(player, action, payload) {
      const data = (payload ?? {}) as Record<string, unknown>;
      switch (action) {
        case 'FlipCard':
          if (subPhase !== 'SpeakerTurn') return fail('No active turn.');
          if (!isSpeaker(player)) return fail('Only the active speaker can flip the card.');
          if (cardFlipped) return ok();
          cardFlipped = true;
          secondsLeft = TURN_SECONDS;
          broadcast();
          ctx.emit('timer:tick', secondsLeft);
          runClock();
          return ok();

        case 'EndTurn':
          if (subPhase !== 'SpeakerTurn') return fail('No active turn.');
          if (!isSpeaker(player)) return fail('Only the active speaker can end their turn.');
          toVoting();
          return ok();

        case 'SkipTurn':
          if (!player.isHost) return fail('Only the host can skip a turn.');
          if (subPhase !== 'SpeakerTurn') return fail('No active speaker turn to skip.');
          toVoting();
          return ok();

        case 'PauseTurn':
          if (subPhase !== 'SpeakerTurn' || !cardFlipped) return fail('No active turn.');
          if (!isSpeaker(player)) return fail('Only the active speaker can pause.');
          if (paused) return fail('Already paused.');
          paused = true;
          stopClock();
          broadcast();
          return ok();

        case 'ResumeTurn':
          if (subPhase !== 'SpeakerTurn') return fail('No active turn.');
          if (!isSpeaker(player)) return fail('Only the active speaker can resume.');
          if (!paused) return fail('Not paused.');
          paused = false;
          broadcast();
          runClock();
          return ok();

        case 'SubmitImpressiveness': {
          if (subPhase !== 'Voting') return fail('Not in voting phase.');
          const rating = Number(data.rating);
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('Rating must be between 1 and 5.');
          if (isSpeaker(player)) return fail('The active speaker cannot rate their own performance.');
          if (ratings.has(player.name)) return fail('You have already submitted your rating.');
          ratings.set(player.name, rating);
          checkVotes();
          return ok();
        }

        case 'AdvanceTurn':
          if (!player.isHost) return fail('Only the host can advance the turn.');
          if (subPhase !== 'Results') return fail('Game is not in Results phase.');
          advance();
          return ok();

        case 'SendTranscript': {
          const text = typeof data.text === 'string' ? data.text : '';
          if (subPhase !== 'SpeakerTurn' || !isSpeaker(player) || !text || text.length > 2000) return ok();
          transcript = text;
          ctx.emit('transcript', text, player);
          return ok();
        }

        case 'SendReaction': {
          const emoji = String(data.emoji ?? '');
          if (subPhase !== 'SpeakerTurn' || isSpeaker(player)) return ok();
          if (!(STANDUP_REACTIONS as readonly string[]).includes(emoji)) return ok();
          ctx.emit('reaction', { name: player.name, emoji });
          return ok();
        }

        default:
          return fail(`Unknown action: ${action}`);
      }
    },

    onDisconnected: () => {
      if (subPhase === 'Voting') checkVotes();
      else broadcast();
    },
    onGraceExpired: (name, wasHost) => playerGone(name, wasHost),
    onDropped: (name) => playerGone(name, find(name)?.isHost ?? false),
  };
}

export const standup: GameModule = { id: 'standup', minPlayers: 1, maxPlayers: 8, create: (ctx) => createStandup(ctx) };
