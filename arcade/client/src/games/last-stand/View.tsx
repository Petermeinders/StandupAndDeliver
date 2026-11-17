import type { LastStandState } from '@arcade/shared';
import { LAST_STAND_LIVES } from '@arcade/shared';
import { useEffect, useRef } from 'react';
import { api } from '../../lib/socket';
import { playSound } from '../../lib/sound';
import { WinnerScreen } from '../../shell/ui';
import type { GameViewProps } from '../registry';

function Table({ state, me }: { state: LastStandState; me: string }) {
  const r = state.phase === 'RoundOver' ? state.lastRoundResult : null;
  return (
    <ul className="flex flex-wrap justify-center gap-3">
      {state.players.map((p) => {
        const revealed = r?.playedCards[p.name];
        const peek = state.spectatorCards?.find((s) => s.playerName === p.name)?.card;
        const won = r?.winners.includes(p.name);
        const lost = r?.losers.includes(p.name);
        const tied = r?.cancelled.includes(p.name);
        const slot =
          revealed != null
            ? won
              ? 'border-flame bg-flame/15 text-flame shadow-[0_0_24px_rgba(255,194,71,0.4)] -translate-y-1.5'
              : lost
                ? 'border-danger bg-danger/15 text-danger'
                : tied
                  ? 'border-white/20 bg-night text-smoke line-through'
                  : 'border-white/30 bg-char'
            : peek != null
              ? 'border-purple-400 bg-purple-500/10 text-purple-200'
              : p.hasLockedIn
                ? 'border-spark bg-spark/10 text-spark'
                : 'border-white/15 bg-coal text-smoke';
        return (
          <li key={p.name} className={`flex w-[5.5rem] flex-col items-center gap-1.5 ${p.isEliminated ? 'opacity-40' : ''}`}>
            <span className={`max-w-full truncate text-sm font-semibold ${p.name === me ? 'text-flame' : ''}`}>{p.name}</span>
            <span className="text-sm tracking-tight" aria-label={`${p.lives} lives`}>
              {Array.from({ length: LAST_STAND_LIVES }, (_, i) => (
                <span key={i} className={i < p.lives ? '' : 'opacity-25 grayscale'}>❤️</span>
              ))}
            </span>
            <div key={`${state.round}-${revealed ?? 'x'}`} className={`grid h-24 w-16 place-items-center rounded-xl border-2 font-display text-4xl transition-all duration-300 ${slot} ${revealed != null ? 'pop-in' : ''}`}>
              {p.isEliminated ? '💀' : revealed ?? peek ?? (p.hasLockedIn ? '✓' : '?')}
            </div>
            <span className="text-xs text-smoke">
              {p.cardsLeft} cards{!p.isConnected && !p.isEliminated && !p.name.startsWith('🤖') ? ' · offline' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Summary({ state }: { state: LastStandState }) {
  const r = state.lastRoundResult;
  if (state.phase !== 'RoundOver' || !r) return <div className="min-h-[4.5rem]" />;
  return (
    <div className="pop-in min-h-[4.5rem] space-y-1 text-center" aria-live="polite">
      {r.winners.length > 0 && <p className="font-semibold text-flame">{r.winners.join(', ')} took the round</p>}
      {r.losers.length > 0 && <p className="font-semibold text-danger">{r.losers.join(', ')} lost a life</p>}
      {r.cancelled.length > 0 && <p className="text-smoke">{r.cancelled.join(' and ')} matched and cancelled out</p>}
      {!r.winners.length && !r.losers.length && <p className="text-smoke">A complete wash. Nobody wins, nobody loses.</p>}
      {r.eliminated.length > 0 && <p className="font-display text-xl text-danger">{r.eliminated.join(', ')} is out!</p>}
    </div>
  );
}

export default function LastStandView({ state, me }: GameViewProps<LastStandState>) {
  const self = state.players.find((p) => p.name === me);
  const active = !!self && !self.isEliminated;
  const choosing = state.phase === 'Choosing';
  const locked = state.myLockedIn || state.suddenDeath;

  const phase = useRef(state.phase);
  useEffect(() => {
    if (phase.current !== 'RoundOver' && state.phase === 'RoundOver') playSound(state.lastRoundResult?.losers.includes(me) ? 'hit' : 'slam');
    phase.current = state.phase;
  }, [state.phase, state.lastRoundResult, me]);

  if (state.phase === 'GameOver') {
    return <WinnerScreen title={state.winnerName === me ? 'Last one standing!' : `${state.winnerName ?? 'Nobody'} wins`} subtitle={`After ${state.round} rounds`} />;
  }

  return (
    <div className="screen-in mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col gap-5 px-4 pt-4 pb-6">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-display text-xl">Round {state.round}</span>
        {state.suddenDeath ? (
          <span className="font-display text-lg text-danger">Sudden death: highest cards forced</span>
        ) : (
          choosing && (
            <span className="text-smoke">
              {state.lockedInCount} of {state.activeCount} locked in
            </span>
          )
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center gap-5">
        <Table state={state} me={me} />
        <Summary state={state} />
      </div>

      {active ? (
        <div className="space-y-4">
          <p className="text-center text-sm text-smoke">
            {state.phase === 'RoundOver' ? 'Next round in a moment…' : state.suddenDeath ? 'Your highest card is played for you.' : state.myLockedIn ? 'Locked in. Waiting for the others…' : 'Pick a card. Highest unique wins, lowest unique loses a life.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {state.myHand.map((card) => {
              const picked = state.mySelectedCard === card;
              return (
                <button
                  key={card}
                  type="button"
                  className={`h-[4.5rem] w-12 rounded-xl border-2 font-display text-2xl transition-all sm:h-20 sm:w-14 sm:text-3xl ${
                    picked ? '-translate-y-2 border-flame bg-flame text-night shadow-[0_8px_20px_rgba(255,194,71,0.35)]' : 'border-white/15 bg-ash text-night hover:-translate-y-1'
                  } ${!choosing || locked ? (picked ? '' : 'opacity-40') : ''}`}
                  disabled={!choosing || locked}
                  aria-pressed={picked}
                  onClick={() => { playSound('click'); void api.act('SelectCard', { card }); }}
                >
                  {card}
                </button>
              );
            })}
          </div>
          {choosing && !state.suddenDeath && (
            <button
              className={`btn w-full py-4 text-lg ${state.myLockedIn ? 'bg-spark/20 text-spark' : 'btn-primary'}`}
              disabled={state.myLockedIn || state.mySelectedCard == null}
              onClick={() => { playSound('confirm'); void api.act('LockIn'); }}
            >
              {state.myLockedIn ? 'Locked in' : state.mySelectedCard == null ? 'Pick a card to lock in' : `Lock in ${state.mySelectedCard}`}
            </button>
          )}
        </div>
      ) : (
        <div className="panel p-5 text-center text-smoke">💀 You’re out. You can see each pick as it’s locked in.</div>
      )}
    </div>
  );
}
