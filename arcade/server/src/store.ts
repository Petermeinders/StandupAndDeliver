import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
const ACTIVE_WINDOW_MS = 30 * 60_000;

/** name → last time we saw them do something. Enough for the "players online" stat. */
const recentPlayers = new Map<string, number>();

async function append(file: string, record: unknown): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(path.join(DATA_DIR, file), JSON.stringify(record) + '\n');
  } catch (err) {
    console.warn(`[store] could not write ${file}:`, (err as Error).message);
  }
}

export function logEvent(event: string, gameType: string, roomCode: string, playerName: string, playerCount: number): void {
  if (playerName) recentPlayers.set(playerName, Date.now());
  void append('events.jsonl', { at: new Date().toISOString(), event, gameType, roomCode, playerName, playerCount });
}

export function activePlayers(): { uniquePlayers: number; windowMinutes: number } {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [name, at] of recentPlayers) if (at < cutoff) recentPlayers.delete(name);
  return { uniquePlayers: recentPlayers.size, windowMinutes: ACTIVE_WINDOW_MS / 60_000 };
}

export async function saveFeedback(message: string): Promise<void> {
  await append('feedback.jsonl', { at: new Date().toISOString(), message });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO;
  const from = process.env.FEEDBACK_FROM;
  if (!key || !to || !from) {
    console.log('[feedback] saved; email not configured');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'New Fireside Arcade feedback',
        text: `New feedback received:\n\n${message}\n\nSubmitted: ${new Date().toISOString()}`,
      }),
    });
    if (!res.ok) console.warn('[feedback] Resend returned', res.status);
  } catch (err) {
    console.warn('[feedback] email failed:', (err as Error).message);
  }
}
