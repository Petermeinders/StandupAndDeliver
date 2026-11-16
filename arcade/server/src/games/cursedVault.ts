import type { CursedVaultState, VaultCard, VaultLastTurn, VaultPlayer } from '@arcade/shared';
import { VAULT_WIN_GOLD } from '@arcade/shared';
import type { GameContext, GameInstance, GameModule, Player } from './types.js';
import { fail, ok, randInt, shuffle } from './types.js';

interface Hand {
  gold: number;
  hasSkull: boolean;
}

interface Gamble {
  declared: number;
  flipped: VaultCard[];
  awaitingCardPlay: boolean;
}

const handEmpty = (h: Hand) => h.gold === 0 && !h.hasSkull;

function createCursedVault(ctx: GameContext): GameInstance {
  const { room, rng } = ctx;
  const order = room.players.map((p) => p.name);
  const hands = new Map<string, Hand>(order.map((n) => [n, { gold: 5, hasSkull: true }]));
  const eliminated = new Set<string>();
  let pile: VaultCard[] = [];
  let round = 1;
  let current = 0;
  let gamble: Gamble | null = null;
  let lastTurn: VaultLastTurn | null = null;
  let winnerName: string | null = null;
  let shuffleCount = 0;

  const currentName = () => order[current] ?? '';
  const goldFlipped = (g: Gamble) => g.flipped.filter((c) => c === 'Gold').length;

  function view(player: Player): CursedVaultState {
    const hand = hands.get(player.name) ?? { gold: 0, hasSkull: false };
    const mine = player.name === currentName();
    const players: VaultPlayer[] = order.map((name) => ({
      name,
      gold: hands.get(name)?.gold ?? 0,
      isEliminated: eliminated.has(name),
      isConnected: room.players.find((p) => p.name === name)?.isConnected ?? false,
      isCurrentPlayer: name === currentName(),
    }));
    return {
      phase: room.phase === 'GameOver' ? 'GameOver' : 'Playing',
      round,
      currentPlayerName: currentName(),
      myGold: hand.gold,
      myHasSkull: hand.hasSkull,
      pileCount: pile.length,
      isMyTurn: mine,
      isRoundOne: round === 1,
      awaitingMyCardPlay: mine && gamble?.awaitingCardPlay === true,
      activeGamble: gamble && {
        playerName: currentName(),
        declared: gamble.declared,
        flipsSoFar: gamble.flipped.length,
        goldCollectedSoFar: goldFlipped(gamble),
        lastFlippedCard: gamble.flipped[gamble.flipped.length - 1] ?? null,
      },
      players,
      lastTurn,
      winnerName,
      shuffleCount,
    };
  }

  function broadcast(): void {
    for (const p of room.players) ctx.sendState(p, view(p));
  }

  function advanceTurn(): void {
    const total = order.length;
    const start = current;
    for (let i = 1; i <= total; i++) {
      const next = (start + i) % total;
      const name = order[next];
      if (eliminated.has(name)) continue;
      // Nothing to play and nothing to gamble on: this seat has no move.
      if (handEmpty(hands.get(name)!) && pile.length === 0) continue;
      if (next <= start) round++;
      current = next;
      return;
    }
  }

  function eliminate(name: string): void {
    eliminated.add(name);
    // The hand is trashed, not added to the pile.
    const hand = hands.get(name);
    if (hand) {
      hand.gold = 0;
      hand.hasSkull = false;
    }
  }

  function checkLastStanding(): boolean {
    if (room.phase !== 'Playing') return true;
    const alive = order.filter((n) => !eliminated.has(n));
    if (alive.length > 1) return false;
    winnerName = alive[0] ?? null;
    gamble = null;
    ctx.endGame();
    return true;
  }

  function putInPile(name: string, type: unknown) {
    const hand = hands.get(name)!;
    if (type === 'Skull') {
      if (!hand.hasSkull) return fail("You don't have a skull.");
      hand.hasSkull = false;
      pile.push('Skull');
    } else {
      if (hand.gold <= 0) return fail("You don't have any gold.");
      hand.gold--;
      pile.push('Gold');
    }
    return ok();
  }

  function playCard(player: Player, type: unknown) {
    if (room.phase !== 'Playing') return fail('Game not in progress.');
    if (player.name !== currentName()) return fail('Not your turn.');
    if (gamble) return fail(gamble.awaitingCardPlay ? 'Finish your gamble by playing a card.' : 'A gamble is in progress.');
    const res = putInPile(player.name, type);
    if (!res.ok) return res;
    lastTurn = { playerName: player.name, action: type === 'Skull' ? 'PlayedSkull' : 'PlayedGold', goldGained: 0, skullLost: false, eliminated: false };
    advanceTurn();
    broadcast();
    scheduleBot();
    return ok();
  }

  function startGamble(player: Player, rawCount: unknown) {
    if (room.phase !== 'Playing') return fail('Game not in progress.');
    if (player.name !== currentName()) return fail('Not your turn.');
    if (round === 1) return fail('No gambling in round 1.');
    if (gamble) return fail('A gamble is already in progress.');
    if (pile.length === 0) return fail('The pile is empty.');
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 1 || count > pile.length) return fail(`Count must be between 1 and ${pile.length}.`);
    gamble = { declared: count, flipped: [], awaitingCardPlay: false };
    broadcast();
    return ok();
  }

  function flipCard(player: Player) {
    if (room.phase !== 'Playing') return fail('Game not in progress.');
    if (player.name !== currentName()) return fail('Not your turn.');
    if (!gamble || gamble.awaitingCardPlay) return fail('No active gamble.');
    if (pile.length === 0) return fail('Pile is empty.');

    const [drawn] = pile.splice(randInt(rng, pile.length), 1);
    gamble.flipped.push(drawn);
    const hand = hands.get(player.name)!;

    if (drawn === 'Skull') {
      // Everything flipped this gamble goes back, skull included.
      pile.push(...gamble.flipped);
      shuffle(pile, rng);
      shuffleCount++;
      const out = !hand.hasSkull;
      if (out) eliminate(player.name);
      else hand.hasSkull = false;
      lastTurn = { playerName: player.name, action: 'GambledSkullHit', goldGained: 0, skullLost: !out, eliminated: out };
      gamble = null;
      if (!checkLastStanding()) advanceTurn();
      broadcast();
      scheduleBot();
      return ok();
    }

    hand.gold++;
    const collected = goldFlipped(gamble);
    if (hand.gold >= VAULT_WIN_GOLD) {
      winnerName = player.name;
      lastTurn = { playerName: player.name, action: 'GambledSuccess', goldGained: collected, skullLost: false, eliminated: false };
      gamble = null;
      ctx.endGame();
      broadcast();
      return ok();
    }
    if (collected >= gamble.declared) {
      lastTurn = { playerName: player.name, action: 'GambledSuccess', goldGained: collected, skullLost: false, eliminated: false };
      if (handEmpty(hand)) {
        // Nothing left to pay the vault with; the turn just passes.
        gamble = null;
        advanceTurn();
      } else {
        gamble.awaitingCardPlay = true;
      }
    }
    broadcast();
    scheduleBot();
    return ok();
  }

  function playCardAfterGamble(player: Player, type: unknown) {
    if (player.name !== currentName()) return fail('Not your turn.');
    if (!gamble?.awaitingCardPlay) return fail('Not awaiting card play.');
    const res = putInPile(player.name, type);
    if (!res.ok) return res;
    gamble = null;
    advanceTurn();
    broadcast();
    scheduleBot();
    return ok();
  }

  // ── Bot ──

  function scheduleBot(): void {
    if (room.phase !== 'Playing') return;
    const bot = room.players.find((p) => p.name === currentName());
    if (!bot?.isBot) return;
    const flipping = gamble && !gamble.awaitingCardPlay;
    ctx.after(flipping ? 800 + rng() * 600 : 1000 + rng() * 1000, () => botTurn(bot));
  }

  function botGambleCount(hand: Hand): number {
    if (pile.length <= 2) return 0;
    const appetite = hand.gold <= 2 ? 0.7 : hand.gold <= 5 ? 0.4 : hand.gold >= 8 ? 0.6 : 0.45;
    if (rng() > appetite) return 0;
    const max = Math.min(pile.length, hand.gold >= 8 ? 5 : 3);
    return Math.min(pile.length, Math.max(1, 1 + Math.floor(rng() * rng() * max)));
  }

  function botTurn(bot: Player): void {
    if (room.phase !== 'Playing' || currentName() !== bot.name) return;
    const hand = hands.get(bot.name)!;
    const safeCard = hand.gold > 0 ? 'Gold' : 'Skull';
    if (gamble?.awaitingCardPlay) {
      playCardAfterGamble(bot, safeCard);
      return;
    }
    if (gamble) {
      flipCard(bot);
      return;
    }
    const count = round === 1 || handEmpty(hand) && pile.length === 0 ? 0 : botGambleCount(hand);
    if (count > 0 || handEmpty(hand)) {
      startGamble(bot, Math.max(1, count));
      scheduleBot();
    } else {
      playCard(bot, safeCard);
    }
  }

  function leave(name: string): void {
    if (room.phase !== 'Playing' || !order.includes(name) || eliminated.has(name)) return;
    const wasCurrent = currentName() === name;
    eliminate(name);
    if (wasCurrent && gamble) {
      pile.push(...gamble.flipped.filter((c) => c === 'Skull'));
      gamble = null;
    }
    if (!checkLastStanding() && wasCurrent) advanceTurn();
    broadcast();
    scheduleBot();
  }

  return {
    start() {
      broadcast();
      scheduleBot();
    },
    sync: broadcast,
    action(player, action, payload) {
      const data = (payload ?? {}) as Record<string, unknown>;
      switch (action) {
        case 'PlayCard': return playCard(player, data.type);
        case 'StartGamble': return startGamble(player, data.count);
        case 'FlipCard': return flipCard(player);
        case 'PlayCardAfterGamble': return playCardAfterGamble(player, data.type);
        default: return fail(`Unknown action: ${action}`);
      }
    },
    onDisconnected: broadcast,
    onGraceExpired: leave,
    onDropped: leave,
  };
}

export const cursedVault: GameModule = { id: 'cursed-vault', minPlayers: 2, maxPlayers: 8, botName: '🤖 Vault Bot', create: (ctx) => createCursedVault(ctx) };
