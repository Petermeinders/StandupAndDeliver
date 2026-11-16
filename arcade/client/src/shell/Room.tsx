import type { RoomState } from '@arcade/shared';
import { Suspense, useEffect } from 'react';
import { gameById } from '../games/registry';
import { useStore } from '../lib/store';
import { Header } from './Header';
import { Lobby } from './Lobby';

const Waiting = ({ text }: { text: string }) => <div className="grid min-h-[60dvh] place-items-center p-6 text-smoke">{text}</div>;

export function Room({ room }: { room: RoomState }) {
  const me = useStore((s) => s.name);
  const game = useStore((s) => s.game);
  const conn = useStore((s) => s.conn);
  const entry = gameById(room.gameType);
  const View = entry?.View;

  // Each screen starts at the top, whatever was scrolled before.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [room.phase, room.gameType]);

  return (
    <div className="relative min-h-dvh">
      <Header room={room} me={me} />
      {conn !== 'online' && (
        <div className="sticky top-[3.4rem] z-30 bg-flame py-1.5 text-center text-sm font-bold text-night" role="status">
          Reconnecting…
        </div>
      )}
      {room.phase === 'Lobby' ? (
        <Lobby room={room} me={me} />
      ) : View && game && game.type === room.gameType ? (
        <Suspense fallback={<Waiting text="Loading the game…" />}>
          <View state={game.state} room={room} me={me} />
        </Suspense>
      ) : (
        <Waiting text="Setting up the table…" />
      )}
    </div>
  );
}
