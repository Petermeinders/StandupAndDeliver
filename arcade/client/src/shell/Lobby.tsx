import type { RoomState } from '@arcade/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { GAMES, gameById } from '../games/registry';
import { api } from '../lib/socket';
import { playSound } from '../lib/sound';
import { toast, updateSettings, useStore } from '../lib/store';
import { Toggle } from './ui';

export function Lobby({ room, me }: { room: RoomState; me: string }) {
  const settings = useStore((s) => s.settings);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const game = gameById(room.gameType);
  const isHost = room.players.some((p) => p.name === me && p.isHost);
  const joinUrl = `${location.origin}/?join=${room.roomCode}`;
  const humans = room.players.filter((p) => !p.isBot);

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: '#1b1320', light: '#f1e7ea' } }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Fireside Arcade', text: `Join my ${game?.name ?? 'game'} room`, url: joinUrl });
        return;
      }
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed, or clipboard blocked: the link is still on screen to copy by hand.
    }
  };

  const start = async () => {
    setStarting(true);
    playSound('confirm');
    const res = await api.startGame(game?.startSettings?.(settings));
    if (!res.ok) toast(res.error, 'error');
    setStarting(false);
  };

  return (
    <div className="screen-in mx-auto max-w-md px-5 pt-6 pb-16">
      <div className="mb-6 flex items-center gap-4">
        {game?.cover ? (
          <img src={game.cover} alt="" className="h-28 w-[4.7rem] shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/10" />
        ) : (
          <div className="grid h-28 w-[4.7rem] shrink-0 place-items-center rounded-xl bg-coal text-4xl ring-1 ring-white/10">{game?.icon}</div>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-tight">{game?.name}</h1>
          <p className="mt-1 text-sm text-smoke">{game?.tagline}</p>
        </div>
      </div>

      <section className="panel mb-4 flex items-center gap-4 p-4">
        {qr && <img src={qr} alt={`QR code to join room ${room.roomCode}`} className="h-28 w-28 shrink-0 rounded-lg" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-smoke">Friends join with this code</p>
          <p className="truncate font-display text-4xl tracking-widest text-flame" data-room-code={room.roomCode}>{room.roomCode}</p>
          <button className="btn btn-quiet mt-2 w-full px-3 py-2 text-sm" onClick={share}>
            {copied ? 'Link copied' : 'Share invite link'}
          </button>
        </div>
      </section>

      <section className="panel mb-4 p-4">
        <h2 className="mb-3 font-semibold">In the room ({humans.length})</h2>
        <ul className="flex flex-wrap gap-2">
          {humans.map((p) => (
            <li key={p.name} className={`pop-in flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2.5 text-sm ${p.name === me ? 'bg-ember/20 ring-1 ring-ember/60' : 'bg-night/60'}`}>
              <span className={`h-2 w-2 rounded-full ${p.isConnected ? 'bg-spark' : 'bg-smoke/40'}`} />
              <span className={p.isConnected ? '' : 'text-smoke'}>{p.name}</span>
              {p.isHost && <span className="text-xs font-bold text-flame">host</span>}
            </li>
          ))}
        </ul>
        {humans.length === 1 && game && <p className="mt-3 text-sm text-smoke">{game.soloNote}</p>}
      </section>

      {isHost && (
        <section className="panel mb-4 p-4">
          <label className="block">
            <span className="mb-1 block font-semibold">Game</span>
            <select className="field" value={room.gameType} onChange={async (e) => { const res = await api.setGame(e.target.value as RoomState['gameType']); if (!res.ok) toast(res.error, 'error'); }}>
              {GAMES.filter((g) => !g.experimental || settings.experimental || g.id === room.gameType).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {room.gameType === 'defend-fortress' && <label className="mt-3 block"><span className="mb-1 block font-semibold">Run length</span>
            <select className="field" value={settings.fortressMode} onChange={e => updateSettings({ fortressMode: e.target.value as typeof settings.fortressMode })}>
              <option value="10">10 waves</option><option value="50">50 waves</option><option value="100">100 waves</option><option value="endless">Endless</option>
            </select></label>}
          {room.gameType === 'oneo' && (
            <div className="mt-2">
              <Toggle label="Numbers only" hint="No Skip, Reverse, Draw Two or Wild cards." checked={settings.oneoNumbersOnly} onChange={(oneoNumbersOnly) => updateSettings({ oneoNumbersOnly })} />
            </div>
          )}
        </section>
      )}

      {room.gameType === 'defend-fortress' && <section className="panel mb-4 p-4">
        <h2 className="font-semibold">Your role</h2><p className="my-2 text-sm text-smoke">Fling skeletons, or take the one artillery seat to fire discs.</p>
        <button className="btn btn-quiet w-full" disabled={room.players.some(p => p.name !== me && p.preferredRole === 'artillery')} onClick={async () => {
          const selected = room.players.find(p => p.name === me)?.preferredRole === 'artillery';
          const res = await api.setRole(selected ? null : 'artillery');
          if (!res.ok) toast(res.error, 'error');
        }}>{room.players.find(p => p.name === me)?.preferredRole === 'artillery' ? 'Artillery selected · Switch to flinger' : room.players.some(p => p.preferredRole === 'artillery') ? 'Artillery seat taken · You are a flinger' : 'Take artillery seat'}</button>
      </section>}

      {isHost ? (
        <button className="btn btn-primary w-full py-4 text-xl" onClick={start} disabled={starting}>
          {starting ? 'Starting…' : 'Start game'}
        </button>
      ) : (
        <p className="py-4 text-center text-smoke">Waiting for the host to start the game…</p>
      )}

      <div className="mt-6">{game && <game.HowToPlay />}</div>
    </div>
  );
}
