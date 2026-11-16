import type { RoomInfo } from '@arcade/shared';
import { useState, type FormEvent } from 'react';
import { gameById } from '../games/registry';
import { getState } from '../lib/store';
import { Modal } from './ui';

export interface NameDialogProps {
  /** Set when the visitor arrived through an invite link. */
  invite?: RoomInfo | null;
  /** Start in "join a friend's room" mode. */
  joining?: boolean;
  gameName: string;
  onClose: () => void;
  onSubmit: (name: string, code: string | undefined, funName: boolean) => Promise<string | null>;
}

export function NameDialog({ invite, joining = false, gameName, onClose, onSubmit }: NameDialogProps) {
  const [name, setName] = useState(getState().name);
  const [code, setCode] = useState(invite?.roomCode ?? '');
  const [mode, setMode] = useState<'create' | 'join'>(invite || joining ? 'join' : 'create');
  const [funName, setFunName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your name first.');
    if (mode === 'join' && !code.trim()) return setError('Enter the room code your friend gave you.');
    setBusy(true);
    setError(await onSubmit(name, mode === 'join' ? code : undefined, funName));
    setBusy(false);
  };

  const inviteGame = invite && gameById(invite.gameType);

  return (
    <Modal title={invite ? 'Join the room' : mode === 'join' ? 'Join friends' : `Play ${gameName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {invite && (
          <div className="rounded-xl bg-night/60 p-4 text-sm">
            <p>
              Room <span className="font-display text-lg tracking-wider text-flame">{invite.roomCode}</span>
              {inviteGame && <> is playing {inviteGame.name}.</>}
            </p>
            <p className="mt-1 text-smoke">In the room: {invite.players.map((p) => p.name).join(', ') || 'nobody yet'}</p>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Your name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus autoComplete="nickname" placeholder="What should we call you?" />
        </label>

        {mode === 'join' && !invite && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Room code</span>
            <input className="field font-display text-xl tracking-widest uppercase" value={code} onChange={(e) => setCode(e.target.value)} maxLength={24} autoCapitalize="characters" autoComplete="off" placeholder="ABCD" />
          </label>
        )}

        {mode === 'create' && (
          <label className="flex cursor-pointer items-center gap-3 text-sm text-smoke">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-ember)]" checked={funName} onChange={(e) => setFunName(e.target.checked)} />
            Use a silly room name instead of a 4-letter code
          </label>
        )}

        {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}

        <button className="btn btn-primary w-full py-4 text-lg" disabled={busy}>
          {busy ? 'One moment…' : mode === 'join' ? 'Join room' : 'Create room'}
        </button>

        {!invite && (
          <button type="button" className="btn btn-ghost w-full text-sm" onClick={() => { setMode(mode === 'join' ? 'create' : 'join'); setError(null); }}>
            {mode === 'join' ? 'Start a new room instead' : 'Have a room code? Join friends'}
          </button>
        )}
      </form>
    </Modal>
  );
}
