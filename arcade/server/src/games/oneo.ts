import type { OneOCard, OneOColor, OneOState } from '@arcade/shared';
import { oneoCanPlay } from '@arcade/shared';
import type { GameContext, GameInstance, GameModule, Player } from './types.js';
import { fail, ok, shuffle } from './types.js';

const COLORS: OneOColor[] = ['Red', 'Green', 'Blue', 'Yellow'];
const HAND_SIZE = 7;

export function generateDeck(numbersOnly = false): OneOCard[] {
  const deck: OneOCard[] = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: id++, color, type: 'Number', value: 0 });
    for (let n = 0; n < 2; n++) {
      for (let v = 1; v <= 9; v++) deck.push({ id: id++, color, type: 'Number', value: v });
      if (!numbersOnly) {
        deck.push({ id: id++, color, type: 'Skip', value: 20 });
        deck.push({ id: id++, color, type: 'Reverse', value: 20 });
        deck.push({ id: id++, color, type: 'DrawTwo', value: 20 });
      }
    }
  }
  if (!numbersOnly) {
    for (let n = 0; n < 4; n++) {
      deck.push({ id: id++, color: 'Wild', type: 'Wild', value: 50 });
      deck.push({ id: id++, color: 'Wild', type: 'WildDrawFour', value: 50 });
    }
  }
  return deck;
}

const isWild = (c: OneOCard) => c.type === 'Wild' || c.type === 'WildDrawFour';

export function cardName(card: OneOCard): string {
  switch (card.type) {
    case 'Number': return `${card.color} ${card.value}`;
    case 'Skip': return `${card.color} Skip`;
    case 'Reverse': return `${card.color} Reverse`;
    case 'DrawTwo': return `${card.color} Draw Two`;
    case 'Wild': return 'Wild';
    case 'WildDrawFour': return 'Wild Draw Four';
  }
}

/** Higher is better. Holds the big hitters until an opponent is close to going out. */
export function botCardScore(card: OneOCard, hand: OneOCard[], currentColor: OneOColor, opponentHandSize: number): number {
  let score = 0;
  switch (card.type) {
    case 'WildDrawFour': score += opponentHandSize <= 4 ? 80 : 30; break;
    case 'DrawTwo': score += opponentHandSize <= 6 ? 60 : 25; break;
    case 'Skip': score += 40; break;
    case 'Reverse': score += 20; break;
    case 'Wild': score += 15; break;
    default: break;
  }
  if (card.color === currentColor) score += 10;
  score += hand.filter((c) => c.color === card.color).length * 3;
  if (card.type === 'Number') score += 5 - Math.min(Math.floor(card.value / 2), 5);
  if (opponentHandSize <= 2 && (card.type === 'DrawTwo' || card.type === 'WildDrawFour' || card.type === 'Skip')) score += 40;
  return score;
}

export function botChooseColor(hand: OneOCard[]): OneOColor {
  let best: OneOColor = 'Red';
  let bestCount = -1;
  for (const color of COLORS) {
    const count = hand.filter((c) => c.color === color).length;
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

function createOneO(ctx: GameContext, settings: Record<string, unknown>): GameInstance {
  const { room, rng } = ctx;
  const numbersOnly = settings.numbersOnly === true;
  /** Seat order, fixed at the deal. */
  const seats = room.players.map((p) => p.name);
  const hands = new Map<string, OneOCard[]>();
  const dropped = new Set<string>();
  let drawPile: OneOCard[] = [];
  const discard: OneOCard[] = [];
  let current = 0;
  let clockwise = true;
  let currentColor: OneOColor = 'Red';
  let winnerName: string | null = null;
  let lastAction: string | null = null;

  const top = () => discard[discard.length - 1];
  const playerAt = (i: number): Player | undefined => room.players.find((p) => p.name === seats[i]);

  function nextIndex(from = current): number {
    let i = from;
    for (let n = 0; n < seats.length; n++) {
      i = clockwise ? (i + 1) % seats.length : (i - 1 + seats.length) % seats.length;
      if (!dropped.has(seats[i])) return i;
    }
    return i;
  }

  function refillDrawPile(): void {
    if (drawPile.length > 0 || discard.length <= 1) return;
    const keep = discard.pop()!;
    drawPile = shuffle(discard.splice(0), rng);
    discard.push(keep);
  }

  function deal(name: string, count: number): void {
    for (let i = 0; i < count; i++) {
      refillDrawPile();
      const card = drawPile.shift();
      if (!card) break;
      hands.get(name)!.push(card);
    }
  }

  function view(player: Player): OneOState {
    const handCounts: Record<string, number> = {};
    for (const name of seats) handCounts[name] = hands.get(name)?.length ?? 0;
    return {
      phase: room.phase,
      myHand: hands.get(player.name) ?? [],
      topDiscard: top() ?? null,
      currentColor,
      currentPlayerName: seats[current] ?? '',
      drawPileCount: drawPile.length,
      handCounts,
      playerOrder: seats.filter((n) => !dropped.has(n)),
      clockwise,
      lastAction,
      winnerName,
    };
  }

  function broadcast(): void {
    for (const p of room.players) ctx.sendState(p, view(p));
  }

  function win(name: string | null, message: string): void {
    winnerName = name;
    lastAction = message;
    ctx.endGame();
    broadcast();
  }

  function playCard(player: Player, cardId: number, chosenColor: string | undefined) {
    if (room.phase !== 'Playing') return fail('Game not in progress.');
    if (seats[current] !== player.name) return fail('It is not your turn.');
    const hand = hands.get(player.name)!;
    const card = hand.find((c) => c.id === cardId);
    if (!card) return fail('Card not in your hand.');
    if (!oneoCanPlay(card, top(), currentColor)) return fail('That card cannot be played on the current discard.');
    if (isWild(card) && !COLORS.includes(chosenColor as OneOColor)) return fail('Must choose a color for wild card.');

    hand.splice(hand.indexOf(card), 1);
    discard.push(card);
    currentColor = isWild(card) ? (chosenColor as OneOColor) : card.color;

    if (hand.length === 0) {
      win(player.name, `${player.name} wins!`);
      return ok();
    }

    lastAction = `${player.name} played ${cardName(card)}`;
    let next = nextIndex();
    if (card.type === 'Skip') {
      lastAction += ' — next player skipped!';
      next = nextIndex(next);
    } else if (card.type === 'Reverse') {
      clockwise = !clockwise;
      next = seats.filter((n) => !dropped.has(n)).length === 2 ? current : nextIndex();
      lastAction += ' — direction reversed!';
    } else if (card.type === 'DrawTwo' || card.type === 'WildDrawFour') {
      const count = card.type === 'DrawTwo' ? 2 : 4;
      deal(seats[next], count);
      lastAction += ` — ${seats[next]} draws ${count} and is skipped!`;
      next = nextIndex(next);
    }
    current = next;
    broadcast();
    scheduleBot();
    return ok();
  }

  function drawCard(player: Player) {
    if (room.phase !== 'Playing') return fail('Game not in progress.');
    if (seats[current] !== player.name) return fail('It is not your turn.');
    refillDrawPile();
    const drawn = drawPile.shift();
    if (!drawn) return fail('Draw pile is empty.');
    hands.get(player.name)!.push(drawn);
    if (oneoCanPlay(drawn, top(), currentColor)) {
      lastAction = `${player.name} drew — may play the drawn card.`;
    } else {
      lastAction = `${player.name} drew — no play, turn passes.`;
      current = nextIndex();
    }
    broadcast();
    scheduleBot();
    return ok();
  }

  // ── Bot ──

  function scheduleBot(): void {
    if (room.phase !== 'Playing') return;
    const bot = playerAt(current);
    if (!bot?.isBot) return;
    ctx.after(1200 + rng() * 1200, () => botTurn(bot));
  }

  function botTurn(bot: Player): void {
    if (room.phase !== 'Playing' || seats[current] !== bot.name) return;
    const hand = hands.get(bot.name)!;
    const opponent = Math.min(99, ...room.players.filter((p) => !p.isBot).map((p) => hands.get(p.name)?.length ?? 99));
    const playable = hand.filter((c) => oneoCanPlay(c, top(), currentColor));
    if (playable.length) {
      const best = playable.reduce((a, b) => (botCardScore(b, hand, currentColor, opponent) > botCardScore(a, hand, currentColor, opponent) ? b : a));
      playCard(bot, best.id, isWild(best) ? botChooseColor(hand) : undefined);
      return;
    }
    drawCard(bot);
    // drawCard reschedules the bot when the drawn card is playable, which then plays it.
  }

  return {
    start() {
      drawPile = shuffle(generateDeck(numbersOnly), rng);
      for (const name of seats) hands.set(name, drawPile.splice(0, HAND_SIZE));

      let first = drawPile.shift()!;
      while (first.type === 'WildDrawFour') {
        drawPile.push(first);
        first = drawPile.shift()!;
      }
      discard.push(first);
      currentColor = first.color === 'Wild' ? 'Red' : first.color;

      const n = seats.length;
      if (first.type === 'Skip') current = 1 % n;
      else if (first.type === 'Reverse') {
        clockwise = false;
        current = (n - 1) % n;
      } else if (first.type === 'DrawTwo') {
        deal(seats[0], 2);
        current = 1 % n;
      }

      lastAction = `Game started! ${seats[current]} goes first.`;
      broadcast();
      scheduleBot();
    },

    sync: broadcast,

    action(player, action, payload) {
      const data = (payload ?? {}) as Record<string, unknown>;
      if (action === 'PlayCard') return playCard(player, Number(data.cardId), data.chosenColor as string | undefined);
      if (action === 'DrawCard') return drawCard(player);
      return fail(`Unknown OneO action: ${action}`);
    },

    onDropped(name) {
      if (room.phase !== 'Playing' || dropped.has(name) || !seats.includes(name)) return;
      dropped.add(name);
      const hand = hands.get(name) ?? [];
      hands.delete(name);
      // Their cards go back under the discard pile so the deck doesn't shrink.
      discard.unshift(...hand);
      lastAction = `${name} left the game.`;

      const remaining = seats.filter((n) => !dropped.has(n));
      if (remaining.length <= 1) {
        win(remaining[0] ?? null, remaining.length ? `${remaining[0]} wins — everyone else left!` : 'Game over — all players left.');
        return;
      }
      if (seats[current] === name) current = nextIndex();
      broadcast();
      scheduleBot();
    },
  };
}

export const oneo: GameModule = { id: 'oneo', minPlayers: 2, maxPlayers: 8, botName: '🤖 OneO Bot', create: createOneO };
