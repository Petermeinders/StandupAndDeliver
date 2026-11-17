import type { GameId, GamePhase, Result, ServerToClientEvents } from '@arcade/shared';

export interface Player {
  /** Stable per-browser token; identity survives reconnects. */
  id: string;
  name: string;
  socketId: string | null;
  isHost: boolean;
  isConnected: boolean;
  isBot: boolean;
  score: number;
  preferredRole: string | null;
  away: boolean;
}

export interface Room {
  code: string;
  gameType: GameId;
  phase: GamePhase;
  players: Player[];
  game: GameInstance | null;
  lastActivity: number;
}

type RoomEvent = Exclude<keyof ServerToClientEvents, 'room:state' | 'game:state' | 'room:removed'>;

export interface GameContext {
  room: Room;
  /** Random number in [0, 1). Injected so tests can script shuffles. */
  rng: () => number;
  /** Send `room:state` to everyone (roster, scores, phase). */
  broadcastRoom(): void;
  /** Send one player their private view of the game. No-op for bots and offline players. */
  sendState(player: Player, state: unknown, volatile?: boolean): void;
  /** Room-wide game event, optionally skipping one player. */
  emit<E extends RoomEvent>(event: E, payload: Parameters<ServerToClientEvents[E]>[0], except?: Player): void;
  /** Timer that is cancelled automatically when the game is disposed. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
  /** Mark the game over; the room returns to the lobby a few seconds later. */
  endGame(): void;
}

export interface GameInstance {
  start(): void;
  action(player: Player, action: string, payload: unknown): Result;
  /** Re-send current state (called after a player reconnects or the roster changes). */
  sync(): void;
  onDisconnected?(player: Player): void;
  onGraceExpired?(name: string, wasHost: boolean): void;
  /** Host removed this player from the game, or the player chose to sit out. */
  onDropped?(name: string): void;
  onJoined?(player: Player): void;
  /** Player permanently left the room; remove their seat and upgrades. */
  onLeft?(name: string): void;
}

export interface GameModule {
  id: GameId;
  minPlayers: number;
  maxPlayers: number;
  /** Name of the bot that fills a solo game, if the game has one. */
  botName?: string;
  /** Late joiners are allowed while a game is running. */
  midRunJoin?: boolean;
  create(ctx: GameContext, settings: Record<string, unknown>): GameInstance;
}

export const ok = (): Result => ({ ok: true });
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export const randInt = (rng: () => number, n: number) => Math.floor(rng() * n);
