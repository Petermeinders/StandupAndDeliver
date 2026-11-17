import type { GameId, PlayerView, Result, RoomInfo, RoomState, ServerToClientEvents } from '@arcade/shared';
import { GAME_IDS } from '@arcade/shared';
import { FUN_ROOM_NAMES } from './data/funRoomNames.js';
import type { GameContext, GameModule, Player, Room } from './games/types.js';
import { fail, ok } from './games/types.js';

/** How the room manager talks to sockets. Swapped for a recorder in tests. */
export interface Transport {
  toRoom<E extends keyof ServerToClientEvents>(code: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0], exceptSocketId?: string | null): void;
  toSocket<E extends keyof ServerToClientEvents>(socketId: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0], volatile?: boolean): void;
  join(socketId: string, code: string): void;
  leave(socketId: string, code: string): void;
}

export interface Timings {
  graceMs: number;
  emptyRoomMs: number;
  idleRoomMs: number;
  lobbyReturnMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  graceMs: 30_000,
  emptyRoomMs: 5 * 60_000,
  idleRoomMs: 2 * 60 * 60_000,
  lobbyReturnMs: 8_000,
};

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_NAME = 20;

export type EventLogger = (event: string, gameType: string, roomCode: string, playerName: string, playerCount: number) => void;

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** socketId → where that socket currently sits. */
  private seats = new Map<string, { code: string; playerId: string }>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimers = new Map<string, NodeJS.Timeout>();
  private gameTimers = new Map<string, Set<NodeJS.Timeout>>();

  constructor(
    private transport: Transport,
    private modules: Map<GameId, GameModule>,
    private timings: Timings = DEFAULT_TIMINGS,
    private logEvent: EventLogger = () => {},
    private rng: () => number = Math.random,
  ) {}

  // ── Queries ───────────────────────────────────────────────────────────────

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  roomInfo(code: string): RoomInfo | null {
    const room = this.getRoom(code);
    if (!room) return null;
    return {
      roomCode: room.code,
      gameType: room.gameType,
      phase: room.phase,
      players: room.players.filter((p) => !p.isBot).map((p) => ({ name: p.name, isHost: p.isHost, isConnected: p.isConnected })),
    };
  }

  roomCount(): number {
    return this.rooms.size;
  }

  private seated(socketId: string): { room: Room; player: Player } | null {
    const seat = this.seats.get(socketId);
    if (!seat) return null;
    const room = this.rooms.get(seat.code);
    const player = room?.players.find((p) => p.id === seat.playerId);
    return room && player ? { room, player } : null;
  }

  static view(room: Room): RoomState {
    return {
      phase: room.phase,
      roomCode: room.code,
      gameType: room.gameType,
      players: room.players.map(
        (p): PlayerView => ({
          name: p.name,
          score: p.score,
          isHost: p.isHost,
          isConnected: p.isConnected,
          isBot: p.isBot,
          preferredRole: p.preferredRole,
          away: p.away,
        }),
      ),
    };
  }

  private broadcast(room: Room): void {
    this.transport.toRoom(room.code, 'room:state', RoomManager.view(room));
  }

  // ── Enter / rejoin / leave ────────────────────────────────────────────────

  enter(
    socketId: string,
    playerId: string,
    req: { name: string; gameType: GameId; code?: string; funName?: boolean },
  ): Result<{ roomCode: string; created: boolean }> {
    const name = (req.name ?? '').trim().slice(0, MAX_NAME);
    if (!name) return fail('Enter your name first.');
    const gameType = GAME_IDS.includes(req.gameType) && this.modules.has(req.gameType) ? req.gameType : 'standup';

    let code = (req.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    if (!code) code = req.funName ? this.funCode() : this.randomCode();

    const existing = this.rooms.get(code);
    const current = this.seated(socketId);
    if (current && current.room !== existing) this.removePlayer(current.room, current.player, socketId);

    if (existing) {
      const mine = existing.players.find((p) => p.id === playerId);
      if (mine) {
        this.attach(existing, mine, socketId);
        return { ok: true, roomCode: code, created: false };
      }
      const mod = this.modules.get(existing.gameType)!;
      if (existing.phase !== 'Lobby' && !mod.midRunJoin) return fail('That game has already started.');
      if (existing.players.filter((p) => !p.isBot).length >= mod.maxPlayers) return fail(`Room is full (max ${mod.maxPlayers} players).`);
      if (existing.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail('That name is already taken in this room.');

      const player = this.newPlayer(playerId, name, socketId, false);
      existing.players.push(player);
      this.seat(existing, player, socketId);
      this.logEvent('PlayerJoined', existing.gameType, code, name, existing.players.length);
      this.broadcast(existing);
      if (existing.phase !== 'Lobby') {
        existing.game?.onJoined?.(player);
        existing.game?.sync();
      }
      return { ok: true, roomCode: code, created: false };
    }

    const room: Room = { code, gameType, phase: 'Lobby', players: [], game: null, lastActivity: Date.now() };
    const host = this.newPlayer(playerId, name, socketId, true);
    room.players.push(host);
    this.rooms.set(code, room);
    this.seat(room, host, socketId);
    this.logEvent('RoomCreated', gameType, code, name, 1);
    this.broadcast(room);
    return { ok: true, roomCode: code, created: true };
  }

  rejoin(socketId: string, playerId: string, code: string): Result {
    const room = this.getRoom(code);
    if (!room) return fail('That room has closed.');
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return fail("You're no longer in that room.");
    const current = this.seated(socketId);
    if (current && current.room !== room) this.removePlayer(current.room, current.player, socketId);
    this.attach(room, player, socketId);
    return ok();
  }

  /** Bind a socket to an existing player (reconnect, reload, second tab). */
  private attach(room: Room, player: Player, socketId: string): void {
    if (player.socketId && player.socketId !== socketId) {
      this.transport.leave(player.socketId, room.code);
      this.seats.delete(player.socketId);
    }
    player.away = false;
    this.seat(room, player, socketId);
    this.cancelGrace(room.code, player.name);
    this.broadcast(room);
    room.game?.sync();
  }

  private seat(room: Room, player: Player, socketId: string): void {
    player.socketId = socketId;
    player.isConnected = true;
    room.lastActivity = Date.now();
    this.seats.set(socketId, { code: room.code, playerId: player.id });
    this.transport.join(socketId, room.code);
    this.cancelEmptyTimer(room.code);
  }

  leave(socketId: string): Result {
    const s = this.seated(socketId);
    if (!s) return ok();
    this.logEvent('PlayerLeftRoom', s.room.gameType, s.room.code, s.player.name, s.room.players.length - 1);
    this.removePlayer(s.room, s.player, socketId);
    return ok();
  }

  disconnect(socketId: string): void {
    const s = this.seated(socketId);
    this.seats.delete(socketId);
    if (!s || s.player.socketId !== socketId) return;
    const { room, player } = s;
    player.isConnected = false;
    player.socketId = null;
    room.lastActivity = Date.now();
    this.broadcast(room);
    room.game?.onDisconnected?.(player);

    const key = `${room.code}:${player.name}`;
    this.cancelGrace(room.code, player.name);
    this.graceTimers.set(
      key,
      setTimeout(() => {
        this.graceTimers.delete(key);
        if (this.rooms.get(room.code) !== room || player.isConnected || !room.players.includes(player)) return;
        if (room.phase === 'Lobby') {
          // Nothing to come back to yet: free the seat (and the host badge).
          this.removePlayer(room, player, null);
        } else {
          room.game?.onGraceExpired?.(player.name, player.isHost);
          if (this.rooms.get(room.code) === room) this.broadcast(room);
        }
      }, this.timings.graceMs),
    );

    if (!room.players.some((p) => p.isConnected && !p.isBot)) this.startEmptyTimer(room);
  }

  /** Take a player out of the room entirely. */
  private removePlayer(room: Room, player: Player, socketId: string | null): void {
    this.cancelGrace(room.code, player.name);
    const sid = socketId ?? player.socketId;
    if (sid) {
      this.transport.leave(sid, room.code);
      this.seats.delete(sid);
    }
    if (room.phase === 'Playing') {
      const game = room.game;
      if (game?.onLeft) game.onLeft(player.name);
      else game?.onDropped?.(player.name);
    }
    const wasHost = player.isHost;
    room.players = room.players.filter((p) => p !== player);
    room.lastActivity = Date.now();

    if (!room.players.some((p) => p.isConnected && !p.isBot)) {
      if (!room.players.some((p) => !p.isBot)) this.closeRoom(room);
      else this.startEmptyTimer(room);
      return;
    }
    if (wasHost) {
      const next = room.players.find((p) => p.isConnected && !p.isBot);
      if (next) next.isHost = true;
    }
    this.broadcast(room);
    if (room.phase !== 'Lobby') room.game?.sync();
  }

  // ── Lobby controls ────────────────────────────────────────────────────────

  setGame(socketId: string, gameType: GameId): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    if (!s.player.isHost) return fail('Only the host can change the game.');
    if (s.room.phase !== 'Lobby') return fail('Finish this game first.');
    const mod = this.modules.get(gameType);
    if (!mod) return fail('Unknown game.');
    if (s.room.players.length > mod.maxPlayers) return fail(`That game takes at most ${mod.maxPlayers} players.`);
    s.room.gameType = gameType;
    for (const p of s.room.players) p.preferredRole = null;
    this.broadcast(s.room);
    return ok();
  }

  setRole(socketId: string, role: string | null): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    if (s.room.phase !== 'Lobby') return fail('Game already started.');
    const wanted = role && role.trim() ? role.trim().slice(0, 24) : null;
    if (wanted && s.room.players.some((p) => p !== s.player && p.preferredRole === wanted)) return fail('Someone else already holds that seat.');
    s.player.preferredRole = wanted;
    this.broadcast(s.room);
    return ok();
  }

  claimHost(socketId: string): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    if (s.room.players.some((p) => p.isHost && p.isConnected && !p.isBot)) return fail('The host is still connected.');
    for (const p of s.room.players) p.isHost = false;
    s.player.isHost = true;
    this.logEvent('HostPromoted', s.room.gameType, s.room.code, s.player.name, s.room.players.length);
    this.broadcast(s.room);
    return ok();
  }

  drop(socketId: string, targetName: string, scope: 'game' | 'room'): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    const { room, player: caller } = s;
    const target = room.players.find((p) => p.name === targetName);
    if (!target) return fail("That player isn't in this room.");
    if (target === caller) return fail("You can't drop yourself.");
    const allowed = caller.isHost || (scope === 'game' && target.isHost && target.away);
    if (!allowed) return fail('Only the host can drop players.');

    this.logEvent('PlayerDropped', room.gameType, room.code, target.name, room.players.length);
    if (scope === 'room') {
      if (target.isBot) return fail("Bots leave when the game ends.");
      if (target.socketId) this.transport.toSocket(target.socketId, 'room:removed', { reason: 'The host removed you from the room.' });
      this.removePlayer(room, target, null);
      return ok();
    }
    target.away = true;
    this.broadcast(room);
    if (room.phase === 'Playing') room.game?.onDropped?.(target.name);
    return ok();
  }

  sitOut(socketId: string): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    s.player.away = true;
    s.room.lastActivity = Date.now();
    this.broadcast(s.room);
    if (s.room.phase === 'Playing') s.room.game?.onDropped?.(s.player.name);
    return ok();
  }

  // ── Game lifecycle ────────────────────────────────────────────────────────

  start(socketId: string, settings: Record<string, unknown> = {}): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    const { room, player } = s;
    if (!player.isHost) return fail('Only the host can start the game.');
    if (room.phase !== 'Lobby') return fail('Game already started.');
    const mod = this.modules.get(room.gameType);
    if (!mod) return fail('Unknown game.');

    room.players = room.players.filter((p) => !p.isBot);
    for (const p of room.players) {
      p.score = 0;
      p.away = false;
    }
    const humans = room.players.filter((p) => p.isConnected);
    if (humans.length === 1 && mod.botName) {
      room.players.push({
        id: `bot-${room.code}`, name: mod.botName, socketId: null, isHost: false, isConnected: false,
        isBot: true, score: 0, preferredRole: null, away: false,
      });
    }
    if (room.players.length < mod.minPlayers) return fail(`This game needs at least ${mod.minPlayers} players.`);

    room.phase = 'Playing';
    room.lastActivity = Date.now();
    this.disposeGame(room);
    try {
      room.game = mod.create(this.contextFor(room), settings ?? {});
      this.broadcast(room);
      room.game.start();
    } catch (err) {
      console.error(`[${room.code}] start failed`, err);
      this.returnToLobby(room);
      return fail('The game failed to start.');
    }
    this.logEvent('GameStarted', room.gameType, room.code, player.name, humans.length);
    return ok();
  }

  action(socketId: string, action: string, payload: unknown): Result {
    const s = this.seated(socketId);
    if (!s) return fail('Room not found.');
    if (!s.room.game) return fail('No game in progress.');
    s.room.lastActivity = Date.now();
    try {
      return s.room.game.action(s.player, String(action), payload ?? {});
    } catch (err) {
      console.error(`[${s.room.code}] action ${action} failed`, err);
      return fail('Something went wrong with that move.');
    }
  }

  private contextFor(room: Room): GameContext {
    const timers = new Set<NodeJS.Timeout>();
    this.gameTimers.set(room.code, timers);
    const alive = () => this.rooms.get(room.code) === room && this.gameTimers.get(room.code) === timers;
    return {
      room,
      rng: this.rng,
      broadcastRoom: () => this.broadcast(room),
      sendState: (player, state, volatile = false) => {
        if (player.socketId && player.isConnected) this.transport.toSocket(player.socketId, 'game:state', { gameType: room.gameType, state }, volatile);
      },
      emit: (event, payload, except) => this.transport.toRoom(room.code, event, payload, except?.socketId),
      after: (ms, fn) => {
        const t = setTimeout(() => {
          timers.delete(t);
          if (!alive()) return;
          try {
            fn();
          } catch (err) {
            console.error(`[${room.code}] timer failed`, err);
          }
        }, ms);
        timers.add(t);
        return () => {
          clearTimeout(t);
          timers.delete(t);
        };
      },
      endGame: () => {
        if (room.phase === 'GameOver') return;
        room.phase = 'GameOver';
        room.lastActivity = Date.now();
        this.broadcast(room);
        const t = setTimeout(() => {
          timers.delete(t);
          if (alive()) this.returnToLobby(room);
        }, this.timings.lobbyReturnMs);
        timers.add(t);
      },
    };
  }

  private returnToLobby(room: Room): void {
    this.disposeGame(room);
    room.phase = 'Lobby';
    room.lastActivity = Date.now();
    room.players = room.players.filter((p) => !p.isBot && (p.isConnected || this.graceTimers.has(`${room.code}:${p.name}`)));
    for (const p of room.players) p.away = false;
    if (!room.players.some((p) => p.isHost)) {
      const next = room.players.find((p) => p.isConnected);
      if (next) next.isHost = true;
    }
    if (!room.players.length) return this.closeRoom(room);
    this.broadcast(room);
  }

  private disposeGame(room: Room): void {
    const timers = this.gameTimers.get(room.code);
    if (timers) for (const t of timers) clearTimeout(t);
    this.gameTimers.delete(room.code);
    room.game = null;
  }

  // ── Housekeeping ──────────────────────────────────────────────────────────

  private closeRoom(room: Room): void {
    this.disposeGame(room);
    this.cancelEmptyTimer(room.code);
    for (const p of room.players) {
      this.cancelGrace(room.code, p.name);
      if (p.socketId) this.seats.delete(p.socketId);
    }
    this.rooms.delete(room.code);
  }

  private startEmptyTimer(room: Room): void {
    this.cancelEmptyTimer(room.code);
    this.emptyTimers.set(
      room.code,
      setTimeout(() => {
        this.emptyTimers.delete(room.code);
        if (this.rooms.get(room.code) === room && !room.players.some((p) => p.isConnected && !p.isBot)) this.closeRoom(room);
      }, this.timings.emptyRoomMs),
    );
  }

  private cancelEmptyTimer(code: string): void {
    const t = this.emptyTimers.get(code);
    if (t) clearTimeout(t);
    this.emptyTimers.delete(code);
  }

  private cancelGrace(code: string, name: string): void {
    const key = `${code}:${name}`;
    const t = this.graceTimers.get(key);
    if (t) clearTimeout(t);
    this.graceTimers.delete(key);
  }

  /** Remove rooms nobody has touched for a long time. Call on an interval. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivity > this.timings.idleRoomMs) {
        this.closeRoom(room);
        removed++;
      }
    }
    return removed;
  }

  private newPlayer(id: string, name: string, socketId: string, isHost: boolean): Player {
    return { id, name, socketId, isHost, isConnected: true, isBot: false, score: 0, preferredRole: null, away: false };
  }

  private funCode(): string {
    const free = FUN_ROOM_NAMES.map((n) => n.toUpperCase()).filter((n) => !this.rooms.has(n));
    return free.length ? free[Math.floor(Math.random() * free.length)] : this.randomCode();
  }

  private randomCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
