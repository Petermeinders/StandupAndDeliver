import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RoomManager } from './rooms.js';
import { activePlayers, saveFeedback } from './store.js';

const MAX_FEEDBACK_PER_HOUR = 5;
const feedbackLog = new Map<string, number[]>();

export function createApp(rooms: RoomManager, clientDir: string): Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.roomCount() });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const info = rooms.roomInfo(req.params.code);
    if (!info) res.status(404).json({ error: 'Room not found.' });
    else res.json(info);
  });

  app.get('/api/stats/active-players', (_req, res) => {
    res.json(activePlayers());
  });

  app.post('/api/feedback', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 2000) {
      res.status(400).json({ error: 'Write a message of up to 2000 characters.' });
      return;
    }
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (feedbackLog.get(ip) ?? []).filter((t) => now - t < 60 * 60_000);
    if (recent.length >= MAX_FEEDBACK_PER_HOUR) {
      res.status(429).json({ error: 'Too many messages. Try again in an hour.' });
      return;
    }
    recent.push(now);
    feedbackLog.set(ip, recent);
    await saveFeedback(message);
    res.json({ ok: true });
  });

  if (existsSync(clientDir)) {
    app.use('/assets', express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(clientDir, { maxAge: '1h' }));
    // Single-page app: any other GET gets the shell.
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }
  return app;
}
