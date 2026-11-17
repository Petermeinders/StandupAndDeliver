import type { GameId, RoomInfo } from '@arcade/shared';
import { useEffect, useMemo, useState } from 'react';
import { EXTERNAL_GAMES, GAMES, gameById } from '../games/registry';
import { api } from '../lib/socket';
import { playSound } from '../lib/sound';
import { toast, updateSettings, useStore } from '../lib/store';
import { Carousel, type CarouselItem } from './Carousel';
import { Feedback } from './Feedback';
import { NameDialog } from './NameDialog';
import { Accordion, Toggle } from './ui';

function inviteCode(): string | null {
  const code = new URLSearchParams(location.search).get('join');
  return code ? code.trim().toUpperCase() : null;
}

export function clearInviteFromUrl(): void {
  const params = new URLSearchParams(location.search);
  if (!params.has('join') && !params.has('game')) return;
  params.delete('join');
  params.delete('game');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
}

export function Home() {
  const settings = useStore((s) => s.settings);
  const linkedGame = new URLSearchParams(location.search).get('game');
  const [focusedId, setFocusedId] = useState<string>(() => new URLSearchParams(location.search).get('game') ?? GAMES[0].id);
  const [dialog, setDialog] = useState<'play' | 'join' | null>(null);
  const [invite, setInvite] = useState<RoomInfo | null>(null);

  const items = useMemo<CarouselItem[]>(
    () => [
      ...GAMES.filter((g) => !g.experimental || settings.experimental || g.id === linkedGame || g.id === invite?.gameType).map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, icon: g.icon, cover: g.cover, preview: g.preview, badge: g.players })),
      ...EXTERNAL_GAMES.map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, icon: '🎮', cover: g.cover, preview: null, external: true, badge: 'Single player' })),
    ],
    [settings.experimental, linkedGame, invite?.gameType],
  );

  const game = gameById(focusedId);
  const external = EXTERNAL_GAMES.find((g) => g.id === focusedId);
  const backdrop = game?.cover ?? external?.cover ?? null;

  // Arriving by invite link: look the room up, then ask for a name.
  useEffect(() => {
    const code = inviteCode();
    if (!code) return;
    let cancelled = false;
    fetch(`/api/rooms/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<RoomInfo>) : null))
      .then((info) => {
        if (cancelled) return;
        if (!info) {
          toast(`Room ${code} has closed. Start a new one below.`, 'error');
          clearInviteFromUrl();
          return;
        }
        setInvite(info);
        setFocusedId(info.gameType);
        setDialog('join');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const enter = async (name: string, code: string | undefined, funName: boolean): Promise<string | null> => {
    const gameType = (invite?.gameType ?? game?.id ?? 'standup') as GameId;
    const res = await api.enterRoom(name, gameType, code, funName);
    if (!res.ok) return res.error;
    playSound('confirm');
    clearInviteFromUrl();
    return null;
  };

  return (
    <div className="relative min-h-dvh">
      {[...GAMES, ...EXTERNAL_GAMES].filter((g) => g.cover).map((g) => (
        <div key={g.id} className={`backdrop ${g.cover === backdrop ? 'is-on' : ''}`} style={{ backgroundImage: `url(${g.cover})` }} />
      ))}
      <div className="backdrop-shade" />

      <main className="relative z-10 mx-auto flex max-w-lg flex-col px-5 pt-8 pb-16">
        <header className="mb-2 text-center">
          <h1 className="font-display text-5xl leading-none text-flame [text-shadow:0_4px_0_#8a3a08,0_10px_30px_rgba(255,122,26,0.35)] sm:text-6xl">Fireside Arcade</h1>
          <p className="mt-3 text-smoke">Party games for the people in the room. Pick one, share the code, play on your phones.</p>
        </header>

        <div className="relative left-1/2 w-screen -translate-x-1/2">
          <Carousel items={items} focusedId={focusedId} onFocus={setFocusedId} lockedId={invite?.gameType} />
        </div>

        <div className="mt-6" key={focusedId}>
          {game && (
            <>
              <button className="btn btn-primary mb-2 w-full py-4 text-xl" onClick={() => setDialog('play')}>
                Play {game.name}
              </button>
              <button className="btn btn-ghost mb-5 w-full text-sm" onClick={() => setDialog('join')}>
                Have a room code? Join friends
              </button>
              <p className="mb-4 text-center text-sm text-smoke">{game.soloNote}</p>
              <game.HowToPlay />
            </>
          )}
          {external && (
            <>
              <a className="btn mb-4 w-full bg-spark py-4 text-xl text-[#06231d] shadow-[0_4px_0_#1f8a73]" href={external.url} target="_blank" rel="noopener noreferrer">
                Play {external.name}
              </a>
              <p className="mb-4 text-center text-sm text-smoke">Opens {new URL(external.url).host} in a new tab.</p>
              <Accordion title="About this game" open>
                <p>{external.about}</p>
              </Accordion>
            </>
          )}
        </div>

        <Accordion title="Settings" tone="ash">
          <Toggle label="Sound effects" checked={settings.sound} onChange={(sound) => updateSettings({ sound })} />
          <Toggle label="Show experimental games" hint="Unfinished games that may break." checked={settings.experimental} onChange={(experimental) => updateSettings({ experimental })} />
        </Accordion>
        <Feedback />
      </main>

      {dialog && (
        <NameDialog
          invite={invite}
          joining={dialog === 'join'}
          gameName={game?.name ?? 'a game'}
          onClose={() => {
            setDialog(null);
            if (invite) {
              setInvite(null);
              clearInviteFromUrl();
            }
          }}
          onSubmit={enter}
        />
      )}
    </div>
  );
}
