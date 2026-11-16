import type { OneOCard, OneOColor, OneOState } from '@arcade/shared';
import { oneoCanPlay } from '@arcade/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/socket';
import { playSound } from '../../lib/sound';
import { Modal, WinnerScreen } from '../../shell/ui';
import type { GameViewProps } from '../registry';

const HEX: Record<OneOColor, string> = { Red: '#e23d43', Green: '#2fa457', Blue: '#2f74e0', Yellow: '#f0b414', Wild: '#221a27' };
const WILD_GRADIENT = `conic-gradient(${HEX.Red} 0 25%, ${HEX.Blue} 0 50%, ${HEX.Green} 0 75%, ${HEX.Yellow} 0)`;

function glyph(card: OneOCard): string {
  switch (card.type) {
    case 'Number': return String(card.value);
    case 'Skip': return '⊘';
    case 'Reverse': return '⇄';
    case 'DrawTwo': return '+2';
    case 'Wild': return '★';
    case 'WildDrawFour': return '+4';
  }
}

function label(card: OneOCard): string {
  const names = { Number: String(card.value), Skip: 'Skip', Reverse: 'Reverse', DrawTwo: 'Draw Two', Wild: 'Wild', WildDrawFour: 'Wild Draw Four' };
  return card.color === 'Wild' ? names[card.type] : `${card.color} ${names[card.type]}`;
}

/** A card face. Size it by setting width and font-size on the wrapper via `className`. */
export function CardFace({ card, className = '', ...rest }: { card: OneOCard; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const wild = card.color === 'Wild';
  const g = glyph(card);
  return (
    <button type="button" className={`pcard ${className}`} style={{ background: HEX[card.color] }} aria-label={label(card)} {...rest}>
      <span className="pcard-oval" style={wild ? { background: WILD_GRADIENT } : undefined} />
      <span className="pcard-glyph" style={{ color: wild ? '#fff' : HEX[card.color], fontSize: g.length > 1 ? '0.8em' : '1em', WebkitTextStroke: wild ? '0' : undefined }}>
        {g}
      </span>
      <span className="pcard-corner top-[6%] left-[9%]">{g}</span>
      <span className="pcard-corner right-[9%] bottom-[6%] rotate-180">{g}</span>
    </button>
  );
}

function Opponents({ state, room, me }: GameViewProps<OneOState>) {
  const others = state.playerOrder.filter((n) => n !== me);
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {others.map((name) => {
        const turn = state.currentPlayerName === name && state.phase === 'Playing';
        const online = room.players.find((p) => p.name === name)?.isConnected ?? true;
        const bot = room.players.find((p) => p.name === name)?.isBot;
        const count = state.handCounts[name] ?? 0;
        return (
          <li key={name} className={`rounded-2xl px-3 py-2 text-center transition-all ${turn ? 'bg-ember/20 ring-2 ring-ember' : 'bg-coal/80'}`}>
            <div className={`max-w-[7rem] truncate text-sm font-semibold ${online || bot ? '' : 'text-smoke'}`}>{name}</div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <span className="relative inline-block h-6 w-4 rounded-[3px] bg-[url(/cards/back.webp)] bg-cover ring-1 ring-white/40" />
              <span className={`font-display text-lg ${count === 1 ? 'text-danger' : ''}`}>{count}</span>
            </div>
            {count === 1 && <div className="text-xs font-bold text-danger">One left!</div>}
            {!online && !bot && <div className="text-xs text-smoke">offline</div>}
          </li>
        );
      })}
    </ul>
  );
}

export default function OneOView(props: GameViewProps<OneOState>) {
  const { state, me } = props;
  const [wild, setWild] = useState<OneOCard | null>(null);
  const myTurn = state.currentPlayerName === me && state.phase === 'Playing';
  const playing = state.playerOrder.includes(me);
  const top = state.topDiscard;

  // A soft cue when the turn comes round to you.
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) playSound('menu');
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  if (state.phase === 'GameOver') {
    return <WinnerScreen title={state.winnerName === me ? 'You win!' : `${state.winnerName ?? 'Nobody'} wins`} subtitle={state.lastAction ?? undefined} />;
  }

  const play = (card: OneOCard, chosenColor?: OneOColor) => {
    if (!myTurn) return;
    if ((card.type === 'Wild' || card.type === 'WildDrawFour') && !chosenColor) return setWild(card);
    playSound('flip');
    setWild(null);
    void api.act('PlayCard', { cardId: card.id, chosenColor });
  };

  const hand = [...state.myHand].sort((a, b) => a.color.localeCompare(b.color) || a.value - b.value);
  const canPlayAny = !!top && hand.some((c) => oneoCanPlay(c, top, state.currentColor));

  return (
    <div className="screen-in mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col gap-5 px-4 pt-4 pb-6">
      <Opponents {...props} />

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="flex items-center justify-center gap-6">
          <div className="text-center">
            <button
              type="button"
              className={`pcard w-24 bg-[url(/cards/back.webp)] bg-cover sm:w-28 ${myTurn ? 'is-playable ring-4 ring-flame/70' : ''}`}
              onClick={() => { playSound('click'); void api.act('DrawCard'); }}
              disabled={!myTurn}
              aria-label={`Draw a card. ${state.drawPileCount} left`}
            />
            <div className="mt-2 text-xs text-smoke">Draw · {state.drawPileCount}</div>
          </div>
          <div className="text-center">
            {top && <CardFace key={top.id} card={top} className="pop-in w-24 text-6xl sm:w-28 sm:text-7xl" disabled tabIndex={-1} />}
            <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-smoke">
              <span className="h-3 w-3 rounded-full ring-1 ring-white/50" style={{ background: HEX[state.currentColor] }} />
              {state.currentColor} {state.clockwise ? '↻' : '↺'}
            </div>
          </div>
        </div>
        <p className="min-h-5 text-center text-sm text-smoke" aria-live="polite">{state.lastAction}</p>
      </div>

      <div>
        <p className={`mb-2 text-center font-display text-xl ${myTurn ? 'text-flame' : 'text-smoke'}`}>
          {!playing ? 'You’re watching this game' : myTurn ? (canPlayAny ? 'Your turn' : 'Your turn: nothing fits, draw a card') : `${state.currentPlayerName}’s turn`}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {hand.map((card) => {
            const ok = myTurn && !!top && oneoCanPlay(card, top, state.currentColor);
            return <CardFace key={card.id} card={card} className={`deal-in w-[3.6rem] text-4xl sm:w-20 sm:text-5xl ${ok ? 'is-playable' : myTurn ? 'is-dim' : ''}`} disabled={!ok} onClick={() => play(card)} />;
          })}
        </div>
      </div>

      {wild && (
        <Modal title="Choose a color" onClose={() => setWild(null)}>
          <div className="grid grid-cols-2 gap-3">
            {(['Red', 'Blue', 'Green', 'Yellow'] as OneOColor[]).map((c) => (
              <button key={c} className="btn h-20 text-lg text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]" style={{ background: HEX[c] }} onClick={() => play(wild, c)}>
                {c}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
