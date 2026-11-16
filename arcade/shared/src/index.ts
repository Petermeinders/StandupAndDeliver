// Contracts shared by the server and the client.

export type GamePhase = 'Lobby' | 'Playing' | 'GameOver';

export type GameId = 'standup' | 'oneo' | 'cursed-vault' | 'last-stand' | 'defend-fortress';

export const GAME_IDS: GameId[] = ['standup', 'oneo', 'cursed-vault', 'last-stand', 'defend-fortress'];

export interface PlayerView {
  name: string;
  score: number;
  isHost: boolean;
  isConnected: boolean;
  isBot: boolean;
  /** Lobby-time seat preference (e.g. "artillery" in Protect Thy Fortress). */
  preferredRole: string | null;
  /** Chose "Leave game": still in the room, but sitting this game out. */
  away: boolean;
}

export interface RoomState {
  phase: GamePhase;
  roomCode: string;
  gameType: GameId;
  players: PlayerView[];
}

export interface RoomInfo {
  roomCode: string;
  gameType: GameId;
  phase: GamePhase;
  players: { name: string; isHost: boolean; isConnected: boolean }[];
}

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

// ── Socket protocol ─────────────────────────────────────────────────────────

type Ack<T = unknown> = (result: Result<T>) => void;

export interface ClientToServerEvents {
  /** Create a room, or join one if `code` names an existing room. */
  'room:enter': (
    req: { name: string; gameType: GameId; code?: string; funName?: boolean },
    ack: Ack<{ roomCode: string; created: boolean }>,
  ) => void;
  /** Re-attach this device to a room it was already in. */
  'room:rejoin': (req: { code: string }, ack: Ack) => void;
  'room:leave': (ack: Ack) => void;
  /** Host only, lobby only: switch which game the room will play. */
  'room:setGame': (req: { gameType: GameId }, ack: Ack) => void;
  'room:setRole': (req: { role: string | null }, ack: Ack) => void;
  'room:claimHost': (ack: Ack) => void;
  'room:drop': (req: { name: string; scope: 'game' | 'room' }, ack: Ack) => void;
  'game:start': (req: { settings?: Record<string, unknown> }, ack: Ack) => void;
  'game:action': (req: { action: string; payload?: unknown }, ack: Ack) => void;
  /** Sit out the current game without leaving the room. */
  'game:sitOut': (ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'game:state': (msg: { gameType: GameId; state: unknown }) => void;
  'room:removed': (msg: { reason: string }) => void;
  'timer:tick': (secondsRemaining: number) => void;
  'vote:count': (msg: { submitted: number; total: number }) => void;
  reaction: (msg: { name: string; emoji: string }) => void;
  transcript: (text: string) => void;
}

// ── Standup & Deliver ───────────────────────────────────────────────────────

export type StandupSubPhase = 'SpeakerTurn' | 'Voting' | 'Results';

export interface PromptCardView {
  text: string;
  /** Three buzzwords the speaker can lean on: verb, adjective, noun. */
  buzzwords: [string, string, string];
}

export interface TurnResult {
  activePlayerName: string;
  card: PromptCardView;
  impressionScore: number;
  turnScore: number;
}

export interface StandupState {
  subPhase: StandupSubPhase;
  activePlayerName: string | null;
  /** Only sent to the speaker during their turn, and to everyone in Results. */
  card: PromptCardView | null;
  cardFlipped: boolean;
  paused: boolean;
  secondsRemaining: number | null;
  votesSubmitted: number;
  votesTotal: number;
  lastTurnResult: TurnResult | null;
  lastTranscript: string | null;
}

export const STANDUP_REACTIONS = ['👏', '😂', '🔥', '🤔', '💀'] as const;

// ── OneO ────────────────────────────────────────────────────────────────────

export type OneOColor = 'Red' | 'Green' | 'Blue' | 'Yellow' | 'Wild';
export type OneOCardType = 'Number' | 'Skip' | 'Reverse' | 'DrawTwo' | 'Wild' | 'WildDrawFour';

export interface OneOCard {
  id: number;
  color: OneOColor;
  type: OneOCardType;
  value: number;
}

export interface OneOState {
  phase: GamePhase;
  myHand: OneOCard[];
  topDiscard: OneOCard | null;
  currentColor: OneOColor;
  currentPlayerName: string;
  drawPileCount: number;
  handCounts: Record<string, number>;
  /** Seat order, skipping dropped players. */
  playerOrder: string[];
  clockwise: boolean;
  lastAction: string | null;
  winnerName: string | null;
}

export function oneoCanPlay(card: OneOCard, top: OneOCard, currentColor: OneOColor): boolean {
  if (card.type === 'Wild' || card.type === 'WildDrawFour') return true;
  if (card.color === currentColor) return true;
  if (card.type === top.type && card.type !== 'Number') return true;
  if (card.type === 'Number' && top.type === 'Number' && card.value === top.value) return true;
  return false;
}

// ── Cursed Vault ────────────────────────────────────────────────────────────

export type VaultCard = 'Gold' | 'Skull';

export interface VaultPlayer {
  name: string;
  gold: number;
  isEliminated: boolean;
  isConnected: boolean;
  isCurrentPlayer: boolean;
}

export interface VaultGamble {
  playerName: string;
  declared: number;
  flipsSoFar: number;
  goldCollectedSoFar: number;
  lastFlippedCard: VaultCard | null;
}

export interface VaultLastTurn {
  playerName: string;
  action: 'PlayedGold' | 'PlayedSkull' | 'GambledSuccess' | 'GambledSkullHit';
  goldGained: number;
  skullLost: boolean;
  eliminated: boolean;
}

export interface CursedVaultState {
  phase: 'Playing' | 'GameOver';
  round: number;
  currentPlayerName: string;
  myGold: number;
  myHasSkull: boolean;
  pileCount: number;
  isMyTurn: boolean;
  isRoundOne: boolean;
  awaitingMyCardPlay: boolean;
  activeGamble: VaultGamble | null;
  players: VaultPlayer[];
  lastTurn: VaultLastTurn | null;
  winnerName: string | null;
  /** Bumps every time the pile is reshuffled, so clients can animate it once. */
  shuffleCount: number;
}

export const VAULT_WIN_GOLD = 10;

// ── Last Stand ──────────────────────────────────────────────────────────────

export interface LastStandPlayer {
  name: string;
  lives: number;
  cardsLeft: number;
  isEliminated: boolean;
  isConnected: boolean;
  hasLockedIn: boolean;
}

export interface LastStandRoundResult {
  playedCards: Record<string, number>;
  winners: string[];
  losers: string[];
  cancelled: string[];
  livesAfter: Record<string, number>;
  eliminated: string[];
}

export interface LastStandState {
  phase: 'Choosing' | 'RoundOver' | 'GameOver';
  round: number;
  myHand: number[];
  mySelectedCard: number | null;
  myLockedIn: boolean;
  lockedInCount: number;
  activeCount: number;
  suddenDeath: boolean;
  players: LastStandPlayer[];
  lastRoundResult: LastStandRoundResult | null;
  winnerName: string | null;
  /** Only for spectators while choosing: each active player's card once locked in. */
  spectatorCards: { playerName: string; card: number | null }[] | null;
}

export const LAST_STAND_LIVES = 3;

// ── Protect Thy Fortress ────────────────────────────────────────────────────

export const FORTRESS = {
  worldWidth: 800,
  worldHeight: 360,
  groundOffset: 36,
  castleDrawWidth: 301,
  castleRightInset: -33,
  castleGateInsetFromLeft: 55,
  grabRadius: 48,
  tickMs: 50,
} as const;

/** Left edge of the castle sprite, and the X where marchers stop and attack. */
export const FORTRESS_CASTLE_LEFT = FORTRESS.worldWidth - FORTRESS.castleRightInset - FORTRESS.castleDrawWidth;
export const FORTRESS_GATE_X = FORTRESS_CASTLE_LEFT + FORTRESS.castleGateInsetFromLeft;
export const FORTRESS_GROUND_Y = FORTRESS.worldHeight - FORTRESS.groundOffset;
/** Where slingshot discs leave the castle. */
export const FORTRESS_SLING = { x: FORTRESS_CASTLE_LEFT + FORTRESS.castleDrawWidth * 0.55, y: FORTRESS_GROUND_Y };

export type FortressPhase = 'WavePlaying' | 'Shop' | 'Countdown' | 'GameOver';
export type FortressGameMode = '10' | '50' | '100' | 'endless';
export type FortressEnemyState = 'march' | 'attacking' | 'held' | 'airborne';

export interface FortressEnemy {
  id: number;
  x: number;
  y: number;
  state: FortressEnemyState;
  heldBy: string | null;
  rotation: number;
  hp: number;
  maxHp: number;
  type: 'grunt' | 'runner';
}

export interface FortressDisc {
  id: number;
  x: number;
  y: number;
}

export interface FortressPlayer {
  name: string;
  kills: number;
  breaches: number;
  flings: number;
  gold: number;
  artilleryGold: number;
  isConnected: boolean;
  ready: boolean;
  role: 'flinger' | 'artillery' | 'spectator';
  upgrades: Record<string, number>;
}

export interface FortressState {
  phase: FortressPhase;
  gameMode: FortressGameMode;
  fortressHp: number;
  fortressMaxHp: number;
  wave: number;
  /** 0 in endless mode. */
  victoryWave: number;
  enemiesRemaining: number;
  countdownRemaining: number;
  enemies: FortressEnemy[];
  discs: FortressDisc[];
  players: FortressPlayer[];
  /** Upgrade tiers summed across all players: what the castle actually has. */
  castleUpgrades: Record<string, number>;
  artilleryPlayerName: string | null;
  artilleryCooldown: number;
  wizardCooldown: number;
  isPaused: boolean;
  pausedBy: string | null;
  resultMessage: string | null;
  victory: boolean;
}

export interface FortressUpgrade {
  id: string;
  name: string;
  blurb: string;
  baseCost: number;
  /** Bought with artillery gold instead of regular gold. */
  artillery?: boolean;
}

export const FORTRESS_UPGRADES: FortressUpgrade[] = [
  { id: 'archer', name: 'Archers', blurb: 'Pick off the front of the line', baseCost: 100 },
  { id: 'soldier', name: 'Soldiers', blurb: 'Fast, light attacks at the gate', baseCost: 150 },
  { id: 'ballista', name: 'Ballista', blurb: 'Slow, heavy bolts', baseCost: 300 },
  { id: 'wizard', name: 'Mage', blurb: 'Unlocks the fireball; more mages recharge it faster', baseCost: 150 },
  { id: 'engineer', name: 'Engineers', blurb: 'Repair the walls during a wave', baseCost: 125 },
  { id: 'wall', name: 'Thicker walls', blurb: '+15 max fortress HP', baseCost: 200 },
  { id: 'repair', name: 'Repair now', blurb: 'Restore 15 fortress HP', baseCost: 75 },
  { id: 'sling_power', name: 'Sling power', blurb: 'Faster, harder-hitting discs', baseCost: 80, artillery: true },
  { id: 'sling_reload', name: 'Quick reload', blurb: 'Shorter slingshot cooldown', baseCost: 100, artillery: true },
  { id: 'sling_splash', name: 'Bigger combos', blurb: 'Wider blast when you hit a flying enemy', baseCost: 150, artillery: true },
];

export const fortressUpgradeCost = (id: string, currentTier: number): number =>
  Math.ceil((FORTRESS_UPGRADES.find((u) => u.id === id)?.baseCost ?? 100) * (1 + 0.5 * currentTier));
