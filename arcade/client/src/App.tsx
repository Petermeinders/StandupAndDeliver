import { Component, type ReactNode } from 'react';
import './lib/socket';
import { useStore } from './lib/store';
import { Home } from './shell/Home';
import { Room } from './shell/Room';
import { Toasts } from './shell/Toasts';

/** A crash in one screen shouldn't leave players staring at a blank page mid-game. */
class Recover extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-display text-3xl text-flame">Something broke on this screen</p>
          <p className="mt-2 text-smoke">Reload to get back to your room. Your seat is saved.</p>
          <button className="btn btn-primary mt-6" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const room = useStore((s) => s.room);
  const restoring = useStore((s) => s.restoring);

  return (
    <Recover>
      <Toasts />
      {room ? <Room room={room} /> : restoring ? <div className="grid min-h-dvh place-items-center text-smoke">Getting you back to your room…</div> : <Home />}
    </Recover>
  );
}
