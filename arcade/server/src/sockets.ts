import type { ClientToServerEvents, Result, ServerToClientEvents } from '@arcade/shared';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { RoomManager, Transport } from './rooms.js';

export type ArcadeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function createSocketServer(http: HttpServer): { io: ArcadeServer; transport: Transport } {
  const io: ArcadeServer = new Server(http, {
    // Phones lock their screens mid-game; be patient before declaring them gone.
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 64 * 1024,
  });
  const transport: Transport = {
    toRoom(code, event, payload, exceptSocketId) {
      const target = exceptSocketId ? io.to(code).except(exceptSocketId) : io.to(code);
      (target.emit as (e: string, p: unknown) => void)(event, payload);
    },
    toSocket(socketId, event, payload, volatile = false) {
      const target = volatile ? io.to(socketId).volatile : io.to(socketId);
      (target.emit as (e: string, p: unknown) => void)(event, payload);
    },
    join: (socketId, code) => void io.sockets.sockets.get(socketId)?.join(code),
    leave: (socketId, code) => void io.sockets.sockets.get(socketId)?.leave(code),
  };
  return { io, transport };
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);

export function attachHandlers(io: ArcadeServer, rooms: RoomManager): void {
  io.on('connection', (socket) => {
    const playerId = isId(socket.handshake.auth?.playerId) ? socket.handshake.auth.playerId : randomUUID();

    /** Wrap a handler so a thrown error or a missing ack can never take the socket down. */
    const safe = <T>(fn: () => Result<T>, ack: unknown) => {
      let result: Result<T>;
      try {
        result = fn();
      } catch (err) {
        console.error('[socket] handler failed', err);
        result = { ok: false, error: 'Something went wrong.' };
      }
      if (typeof ack === 'function') ack(result);
    };

    socket.on('room:enter', (req, ack) => safe(() => rooms.enter(socket.id, playerId, req ?? ({} as never)), ack));
    socket.on('room:rejoin', (req, ack) => safe(() => rooms.rejoin(socket.id, playerId, String(req?.code ?? '')), ack));
    socket.on('room:leave', (ack) => safe(() => rooms.leave(socket.id), ack));
    socket.on('room:setGame', (req, ack) => safe(() => rooms.setGame(socket.id, req?.gameType), ack));
    socket.on('room:setRole', (req, ack) => safe(() => rooms.setRole(socket.id, req?.role ?? null), ack));
    socket.on('room:claimHost', (ack) => safe(() => rooms.claimHost(socket.id), ack));
    socket.on('room:drop', (req, ack) => safe(() => rooms.drop(socket.id, String(req?.name ?? ''), req?.scope === 'room' ? 'room' : 'game'), ack));
    socket.on('game:start', (req, ack) => safe(() => rooms.start(socket.id, req?.settings), ack));
    socket.on('game:action', (req, ack) => safe(() => rooms.action(socket.id, String(req?.action ?? ''), req?.payload), ack));
    socket.on('game:sitOut', (ack) => safe(() => rooms.sitOut(socket.id), ack));
    socket.on('disconnect', () => rooms.disconnect(socket.id));
  });
}
