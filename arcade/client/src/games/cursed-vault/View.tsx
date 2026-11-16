import type { CursedVaultState, VaultCard } from '@arcade/shared';
import { VAULT_WIN_GOLD } from '@arcade/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/socket';
import { playSound } from '../../lib/sound';
import { WinnerScreen } from '../../shell/ui';
import type { GameViewProps } from '../registry';

const IMG: Record<VaultCard | 'Back', string> = { Gold: '/cursed-vault/coin.webp', Skull: '/cursed-vault/skull.webp', Back: '/cursed-vault/back.webp' };

function HandCard({ type, onClick, title }: { type: VaultCard; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className={`w-20 overflow-hidden rounded-xl shadow-lg ring-2 transition-transform hover:-translate-y-1.5 hover:scale-105 sm:w-24 ${type === 'Gold' ? 'ring-flame/70' : 'ring-purple-400/70'}`}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <img src={IMG[type]} alt="" className="block w-full" draggable={false} />
    </button>
  );
}

function Players({ state, me }: { state: CursedVaultState; me: string }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {state.players.map((p) => (
        <li key={p.name} className={`min-w-[6.5rem] rounded-2xl px-3 py-2 transition-all ${p.isEliminated ? 'bg-coal/40 opacity-50' : p.isCurrentPlayer ? 'bg-ember/20 ring-2 ring-ember' : 'bg-coal/80'}`}>
          <div className={`truncate text-sm font-semibold ${p.name === me ? 'text-flame' : ''}`}>
            {p.isEliminated && '💀 '}
            {p.name}
          </div>
          <div className="mt-1.5 flex gap-[3px]" aria-label={`${p.gold} of ${VAULT_WIN_GOLD} gold`}>
            {Array.from({ length: VAULT_WIN_GOLD }, (_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-full ${i < p.gold ? 'bg-flame' : 'bg-white/10'}`} />
            ))}
          </div>
          <div className="mt-1 text-xs text-smoke">{p.isEliminated ? 'out' : `${p.gold} gold`}{!p.isConnected && !p.isEliminated && !p.name.startsWith('🤖') ? ' · offline' : ''}</div>
        </li>
      ))}
    </ul>
  );
}

function Pile({ state }: { state: CursedVaultState }) {
  const g = state.activeGamble;
  const [shuffling, setShuffling] = useState(false);
  const seen = useRef(state.shuffleCount);

  useEffect(() => {
    if (state.shuffleCount === seen.current) return;
    seen.current = state.shuffleCount;
    playSound('hit');
    setShuffling(true);
    const t = setTimeout(() => setShuffling(false), 1600);
    return () => clearTimeout(t);
  }, [state.shuffleCount]);

  const flips = g?.flipsSoFar ?? 0;
  useEffect(() => {
    if (g?.lastFlippedCard === 'Gold' && flips > 0) playSound('gold');
  }, [flips, g?.lastFlippedCard]);

  return (
    <div className="flex items-end justify-center gap-5">
      <div className="text-center">
        <div className={`relative h-40 w-28 sm:h-48 sm:w-36 ${shuffling ? 'shake' : ''}`}>
          {state.pileCount === 0 ? (
            <div className="grid h-full w-full place-items-center rounded-xl border-2 border-dashed border-white/15 text-sm text-smoke">Empty vault</div>
          ) : (
            Array.from({ length: Math.min(state.pileCount, 5) }, (_, i) => (
              <img key={i} src={IMG.Back} alt="" className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-md" style={{ transform: `translate(${i * 3}px, ${-i * 3}px) rotate(${(i % 2 ? 1 : -1) * i * 0.8}deg)` }} draggable={false} />
            ))
          )}
        </div>
        <div className="mt-3 font-display text-lg text-flame">
          {state.pileCount} {state.pileCount === 1 ? 'card' : 'cards'} in the vault
        </div>
        <div className="h-5 text-sm font-semibold text-danger">{shuffling && 'Skull! The vault reshuffles'}</div>
      </div>

      {g && g.lastFlippedCard && (
        <div className="text-center">
          <img key={g.flipsSoFar} src={IMG[g.lastFlippedCard]} alt={g.lastFlippedCard} className="pop-in h-40 w-28 rounded-xl object-cover shadow-xl ring-2 ring-flame sm:h-48 sm:w-36" />
          <div className="mt-3 text-sm text-smoke">
            Flip {g.flipsSoFar} of {g.declared}
          </div>
          <div className="h-5" />
        </div>
      )}
    </div>
  );
}

function Actions({ state }: { state: CursedVaultState }) {
  const [count, setCount] = useState(1);
  const max = state.pileCount;
  const n = Math.min(Math.max(count, 1), Math.max(max, 1));
  const g = state.activeGamble;

  const playCard = (action: 'PlayCard' | 'PlayCardAfterGamble') => (type: VaultCard) => {
    playSound('click');
    void api.act(action, { type });
  };

  const cards = (action: 'PlayCard' | 'PlayCardAfterGamble') => (
    <div className="flex justify-center gap-4">
      {state.myGold > 0 && <HandCard type="Gold" onClick={() => playCard(action)('Gold')} title="Put a gold card in the vault" />}
      {state.myHasSkull && <HandCard type="Skull" onClick={() => playCard(action)('Skull')} title="Put your skull in the vault as a trap" />}
    </div>
  );

  if (!state.isMyTurn) {
    return (
      <div className="panel p-5 text-center text-smoke">
        {g ? (
          <>
            <span className="font-semibold text-ash">{g.playerName}</span> is gambling: {g.goldCollectedSoFar} gold from {g.flipsSoFar} of {g.declared} flips
          </>
        ) : (
          <>
            Waiting for <span className="font-semibold text-ash">{state.currentPlayerName}</span>…
          </>
        )}
      </div>
    );
  }

  if (state.awaitingMyCardPlay) {
    return (
      <div className="panel space-y-4 border-spark/40 p-5 text-center">
        <p>
          You took <span className="font-display text-xl text-flame">{g?.goldCollectedSoFar} gold</span>. Now pay the vault one card.
        </p>
        {cards('PlayCardAfterGamble')}
        <p className="text-xs text-smoke">Nobody sees which card you put in.</p>
      </div>
    );
  }

  if (g) {
    return (
      <div className="panel space-y-4 border-flame/40 p-5 text-center">
        <p>
          Flip {g.flipsSoFar + 1} of {g.declared} <span className="text-smoke">· {g.goldCollectedSoFar} gold so far</span>
        </p>
        <button className="btn btn-primary px-12 py-4 text-2xl" onClick={() => { playSound('flip'); void api.act('FlipCard'); }}>
          Flip a card
        </button>
      </div>
    );
  }

  return (
    <div className="panel space-y-5 p-5">
      {state.isRoundOne && <p className="text-center text-sm text-flame">Round 1: everyone seeds the vault. No gambling yet.</p>}
      <div className="grid gap-5 sm:grid-cols-2 sm:divide-x sm:divide-white/10">
        <div className="text-center">
          <p className="mb-3 text-sm font-semibold">Play a card into the vault</p>
          {cards('PlayCard')}
        </div>
        {!state.isRoundOne && max > 0 && (
          <div className="text-center sm:pl-5">
            <p className="mb-3 text-sm font-semibold">Or gamble on the vault</p>
            <div className="flex items-center justify-center gap-4">
              <button className="btn btn-quiet h-11 w-11 p-0 text-xl" onClick={() => setCount(n - 1)} disabled={n <= 1} aria-label="Fewer cards">
                −
              </button>
              <span className="w-10 font-display text-4xl" aria-live="polite">{n}</span>
              <button className="btn btn-quiet h-11 w-11 p-0 text-xl" onClick={() => setCount(n + 1)} disabled={n >= max} aria-label="More cards">
                +
              </button>
            </div>
            <p className="my-2 text-xs text-smoke">of {max} cards</p>
            <button className="btn w-full bg-purple-600 text-white shadow-[0_4px_0_#4c1d95] hover:brightness-110" onClick={() => { playSound('spell'); void api.act('StartGamble', { count: n }); }}>
              Gamble {n} {n === 1 ? 'card' : 'cards'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function lastTurnText(state: CursedVaultState): string | null {
  const t = state.lastTurn;
  if (!t) return null;
  switch (t.action) {
    case 'PlayedGold':
    case 'PlayedSkull': return `${t.playerName} slid a card into the vault.`;
    case 'GambledSuccess': return `${t.playerName} gambled and took ${t.goldGained} gold.`;
    case 'GambledSkullHit': return t.eliminated ? `${t.playerName} hit a skull with no skull to spare and is out!` : `${t.playerName} hit a skull and lost their spare.`;
  }
}

export default function CursedVaultView({ state, me }: GameViewProps<CursedVaultState>) {
  if (state.phase === 'GameOver') {
    const winner = state.players.find((p) => p.name === state.winnerName);
    return (
      <WinnerScreen
        title={state.winnerName === me ? 'The vault is yours!' : `${state.winnerName ?? 'Nobody'} wins`}
        subtitle={winner && winner.gold >= VAULT_WIN_GOLD ? `${winner.gold} gold collected` : 'Last one standing'}
      />
    );
  }
  const out = state.players.find((p) => p.name === me)?.isEliminated ?? true;

  return (
    <div className="screen-in mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col gap-5 px-4 pt-4 pb-6">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-display text-xl">Round {state.round}</span>
        <span className="text-right text-smoke" aria-live="polite">{lastTurnText(state)}</span>
      </div>
      <Players state={state} me={me} />
      <div className="flex flex-1 items-center justify-center py-2">
        <Pile state={state} />
      </div>
      {out ? <div className="panel p-5 text-center text-smoke">💀 You’re out. Watch how it ends.</div> : <Actions state={state} />}
      {!out && (
        <div className="flex items-center justify-center gap-4 text-sm text-smoke">
          <span>
            Your hand: <span className="font-display text-lg text-flame">{state.myGold}</span> gold
          </span>
          <span>{state.myHasSkull ? '💀 skull in hand' : 'no skull: the next one ends you'}</span>
        </div>
      )}
    </div>
  );
}
