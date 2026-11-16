import type { RoomState } from '@arcade/shared';
import { useState } from 'react';
import { gameById } from '../games/registry';
import { api } from '../lib/socket';
import { toast, updateSettings, useStore } from '../lib/store';
import { Modal, Toggle } from './ui';

export function Header({ room, me }: { room: RoomState; me: string }) {
  const [open, setOpen] = useState(false);
  const sound = useStore((s) => s.settings.sound);
  const game = gameById(room.gameType);
  const self = room.players.find((p) => p.name === me);
  const hostHere = room.players.some((p) => p.isHost && p.isConnected);
  const playing = room.phase === 'Playing';

  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const res = await p;
    if (!res.ok && res.error) toast(res.error, 'error');
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/5 bg-night/85 px-4 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight">{game?.name ?? 'Fireside Arcade'}</div>
          <div className="text-xs text-smoke">
            Room <span className="font-bold tracking-wider text-flame">{room.roomCode}</span>
          </div>
        </div>
        <button className="btn btn-quiet px-3 py-2 text-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <span aria-hidden="true">☰</span> {room.players.filter((p) => !p.isBot).length} in room
        </button>
      </header>

      {open && (
        <Modal title={`Room ${room.roomCode}`} onClose={() => setOpen(false)}>
          <ul className="mb-5 space-y-2">
            {room.players.map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-xl bg-night/50 px-3 py-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.isConnected || p.isBot ? 'bg-spark' : 'bg-smoke/40'}`} title={p.isConnected || p.isBot ? 'Connected' : 'Disconnected'} />
                <span className={`min-w-0 flex-1 truncate ${p.isConnected || p.isBot ? '' : 'text-smoke'}`}>
                  {p.name}
                  {p.name === me && <span className="text-smoke"> (you)</span>}
                  {p.away && <span className="text-smoke"> · sitting out</span>}
                </span>
                {p.isHost && <span className="rounded-full bg-flame px-2 py-0.5 text-xs font-bold text-night">Host</span>}
                {p.name !== me && !p.isBot && (self?.isHost || (playing && p.isHost && p.away)) && (
                  <span className="flex gap-1">
                    {playing && !p.away && (
                      <button className="btn btn-quiet px-2.5 py-1.5 text-xs" onClick={() => run(api.drop(p.name, 'game'))}>
                        Bench
                      </button>
                    )}
                    {self?.isHost && (
                      <button className="btn btn-quiet px-2.5 py-1.5 text-xs text-danger" onClick={() => run(api.drop(p.name, 'room'))}>
                        Remove
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {!hostHere && !self?.isHost && (
            <button className="btn btn-quiet mb-3 w-full" onClick={() => run(api.claimHost())}>
              The host is gone. Become host
            </button>
          )}

          <Toggle label="Sound effects" checked={sound} onChange={(v) => updateSettings({ sound: v })} />

          {game && (
            <div className="mt-4">
              <game.HowToPlay />
            </div>
          )}

          <div className="mt-4 grid gap-2">
            {playing && self && !self.away && (
              <button className="btn btn-quiet w-full" onClick={() => { void run(api.sitOut()); setOpen(false); }}>
                Sit out the rest of this game
              </button>
            )}
            <button className="btn btn-quiet w-full text-danger" onClick={() => void api.leaveRoom()}>
              Leave room
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
