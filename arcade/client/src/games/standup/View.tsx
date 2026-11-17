import type { PromptCardView, StandupState } from '@arcade/shared';
import { STANDUP_REACTIONS } from '@arcade/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/socket';
import { playSound } from '../../lib/sound';
import { speechSupported, startSpeech } from '../../lib/speech';
import { useStore } from '../../lib/store';
import { WinnerScreen } from '../../shell/ui';
import type { GameViewProps } from '../registry';

function Scoreboard({ room, me }: Pick<GameViewProps, 'room' | 'me'>) {
  const ranked = [...room.players].filter((p) => !p.isBot).sort((a, b) => b.score - a.score);
  return (
    <ol className="panel mt-6 w-full divide-y divide-white/5 text-left">
      {ranked.map((p, i) => (
        <li key={p.name} className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-5 text-sm text-smoke">{i + 1}</span>
          <span className={`flex-1 truncate ${p.name === me ? 'font-semibold text-flame' : ''} ${p.isConnected ? '' : 'text-smoke'}`}>{p.name}</span>
          <span className="font-display text-lg">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

function PromptCard({ card, flipped, onFlip }: { card: PromptCardView | null; flipped: boolean; onFlip?: () => void }) {
  return (
    <div className="flip-scene mx-auto w-full max-w-xs">
      <div className={`flip-inner aspect-[3/4] ${flipped ? 'is-flipped' : ''}`}>
        <button
          type="button"
          className="flip-face flex flex-col items-center justify-center gap-3 rounded-3xl border-4 border-flame bg-[repeating-linear-gradient(135deg,#3a2c41_0_14px,#33263a_14px_28px)] shadow-[0_0_40px_rgba(255,194,71,0.25)]"
          onClick={onFlip}
          disabled={!onFlip || flipped}
          tabIndex={flipped ? -1 : 0}
        >
          <span className="text-6xl" aria-hidden="true">🎤</span>
          <span className="font-display text-2xl text-flame">Tap to flip</span>
          <span className="text-sm text-smoke">Your 60 seconds start when you do</span>
        </button>
        <div className="flip-face is-back flex flex-col items-center justify-center gap-5 rounded-3xl border-4 border-flame bg-ash p-6 text-center text-night shadow-[0_0_40px_rgba(255,194,71,0.25)]">
          <p className="text-sm font-semibold text-night/60">What you actually did yesterday</p>
          <p className="font-display text-2xl leading-snug">{card?.text}</p>
          {card && (
            <div>
              <p className="mb-2 text-xs font-semibold text-night/60">Words that might help</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {card.buzzwords.map((w) => (
                  <span key={w} className="rounded-full bg-night px-3 py-1 text-sm font-semibold text-flame">{w}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Clock({ seconds, paused }: { seconds: number | null; paused: boolean }) {
  if (seconds === null) return null;
  const tone = seconds <= 10 ? 'text-danger' : seconds <= 20 ? 'text-ember' : 'text-flame';
  return (
    <div className="text-center" role="timer" aria-label={`${seconds} seconds left`}>
      <span className={`font-display text-7xl tabular-nums ${tone}`}>{seconds}</span>
      <span className="ml-2 text-smoke">{paused ? 'paused' : 'sec'}</span>
    </div>
  );
}

function Reactions() {
  const reactions = useStore((s) => s.reactions);
  return (
    <div className="pointer-events-none relative mx-auto h-10 w-full max-w-xs" aria-hidden="true">
      {reactions.map((r, i) => (
        <span key={r.id} className="float-up absolute bottom-0 flex items-center gap-1 text-3xl" style={{ left: `${10 + ((r.id * 37 + i * 11) % 70)}%` }}>
          {r.emoji}
          <span className="rounded-full bg-night/80 px-2 text-xs text-smoke">{r.name}</span>
        </span>
      ))}
    </div>
  );
}

function Speaker({ state, isHost }: { state: StandupState; isHost: boolean }) {
  const timer = useStore((s) => s.timer);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const lastSent = useRef(0);

  // Speech-to-text runs only while the card is face up and the clock is going.
  const live = state.cardFlipped && !state.paused;
  useEffect(() => {
    if (!live || !speechSupported()) return;
    return startSpeech((t) => {
      setText(t);
      const now = Date.now();
      if (now - lastSent.current > 400) {
        lastSent.current = now;
        void api.act('SendTranscript', { text: t.slice(-2000) }, true);
      }
    }, setListening);
  }, [live]);

  const flip = () => {
    playSound('flip');
    void api.act('FlipCard');
  };

  return (
    <div className="space-y-5">
      <p className="text-center font-display text-2xl text-flame">You’re up</p>
      {state.cardFlipped ? <Clock seconds={timer ?? state.secondsRemaining} paused={state.paused} /> : <p className="text-center text-smoke">Flip your card to see what you did yesterday, then sell it.</p>}
      <PromptCard card={state.card} flipped={state.cardFlipped} onFlip={flip} />
      {state.cardFlipped && (
        <>
          <Reactions />
          {(text || listening) && (
            <div className="panel p-4 text-sm">
              <p className="mb-1 text-xs text-smoke">{listening ? '🎙 Everyone can read this as you speak' : 'Transcript'}</p>
              <p className="leading-relaxed">{text || 'Listening…'}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button className="btn btn-quiet flex-1" onClick={() => void api.act(state.paused ? 'ResumeTurn' : 'PauseTurn')}>
              {state.paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-primary flex-1" onClick={() => void api.act('EndTurn')}>
              I’m done
            </button>
          </div>
        </>
      )}
      {isHost && !state.cardFlipped && (
        <button className="btn btn-ghost w-full text-sm" onClick={() => void api.act('SkipTurn')}>
          Skip my turn
        </button>
      )}
    </div>
  );
}

function Listener({ state, isHost }: { state: StandupState; isHost: boolean }) {
  const timer = useStore((s) => s.timer);
  const transcript = useStore((s) => s.transcript);
  return (
    <div className="space-y-5 text-center">
      <p className="text-smoke">On stage</p>
      <p className="-mt-3 font-display text-4xl text-flame">{state.activePlayerName}</p>
      {state.cardFlipped ? (
        <>
          <Clock seconds={timer ?? state.secondsRemaining} paused={state.paused} />
          <Reactions />
          <div className="flex justify-center gap-2">
            {STANDUP_REACTIONS.map((emoji) => (
              <button key={emoji} className="btn btn-quiet h-14 w-14 p-0 text-2xl" onClick={() => void api.act('SendReaction', { emoji }, true)} aria-label={`React ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
          {transcript && (
            <div className="panel p-4 text-left text-sm">
              <p className="mb-1 text-xs text-smoke">🎙 Live transcript</p>
              <p className="leading-relaxed">{transcript}</p>
            </div>
          )}
          <p className="text-sm text-smoke">Listen closely. You’ll rate how impressive it sounded.</p>
        </>
      ) : (
        <p className="text-smoke">Waiting for {state.activePlayerName} to flip their card…</p>
      )}
      {isHost && (
        <button className="btn btn-ghost w-full text-sm" onClick={() => void api.act('SkipTurn')}>
          Host: skip {state.activePlayerName}’s turn
        </button>
      )}
    </div>
  );
}

const RATING_WORDS = ['', 'Did nothing', 'Meh', 'Solid', 'Promotion-worthy', 'CEO material'];

function Voting({ state, isSpeaker }: { state: StandupState; isSpeaker: boolean }) {
  const votes = useStore((s) => s.votes);
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);
  const submitted = votes?.submitted ?? state.votesSubmitted;
  const total = votes?.total ?? state.votesTotal;

  const submit = async () => {
    const res = await api.act('SubmitImpressiveness', { rating });
    if (res.ok) {
      playSound('confirm');
      setSent(true);
    }
  };

  return (
    <div className="space-y-5 text-center">
      <p className="font-display text-3xl text-flame">{isSpeaker ? 'The room is judging you' : `How impressive was ${state.activePlayerName}?`}</p>
      {state.lastTranscript && (
        <div className="panel p-4 text-left text-sm">
          <p className="mb-1 text-xs text-smoke">What they said</p>
          <p className="leading-relaxed">{state.lastTranscript}</p>
        </div>
      )}
      {!isSpeaker && !sent && (
        <>
          <div className="flex justify-center gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={rating === n}
                className={`h-14 w-14 rounded-2xl font-display text-2xl transition-all ${rating === n ? 'scale-110 bg-ember text-night' : 'bg-char text-ash hover:bg-[#4a3953]'}`}
                onClick={() => { setRating(n); playSound('click'); }}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="h-5 text-smoke">{RATING_WORDS[rating]}</p>
          <button className="btn btn-primary w-full py-4 text-lg" disabled={!rating} onClick={submit}>
            Submit rating
          </button>
        </>
      )}
      {sent && <p className="font-semibold text-spark">Rating submitted.</p>}
      <p className="text-sm text-smoke">
        {submitted} of {total} ratings in
      </p>
    </div>
  );
}

function Results({ state, isHost }: { state: StandupState; isHost: boolean }) {
  const r = state.lastTurnResult;
  if (!r) return null;
  return (
    <div className="space-y-5 text-center">
      <p className="text-smoke">{r.activePlayerName}’s card said</p>
      <div className="pop-in mx-auto max-w-xs rounded-3xl border-4 border-flame bg-ash p-6 text-night">
        <p className="font-display text-2xl leading-snug">{r.card.text}</p>
      </div>
      <div>
        <p className="font-display text-6xl text-flame">+{r.turnScore}</p>
        <p className="text-smoke">{r.impressionScore > 0 ? `Average rating ${r.impressionScore.toFixed(1)} out of 5` : 'Nobody rated this one'}</p>
      </div>
      {state.lastTranscript && (
        <div className="panel p-4 text-left text-sm">
          <p className="mb-1 text-xs text-smoke">What they said</p>
          <p className="leading-relaxed">{state.lastTranscript}</p>
        </div>
      )}
      {isHost ? (
        <button className="btn btn-primary w-full py-4 text-lg" onClick={() => void api.act('AdvanceTurn')}>
          Next speaker
        </button>
      ) : (
        <p className="text-sm text-smoke">Waiting for the host to continue…</p>
      )}
    </div>
  );
}

export default function StandupView({ state, room, me }: GameViewProps<StandupState>) {
  const isHost = room.players.some((p) => p.name === me && p.isHost);
  const isSpeaker = state.activePlayerName === me;

  if (room.phase === 'GameOver') {
    const top = [...room.players].sort((a, b) => b.score - a.score)[0];
    return (
      <WinnerScreen title={top ? `${top.name} wins` : 'Meeting adjourned'} subtitle={top ? `${top.score} points of pure corporate nonsense` : undefined}>
        <div className="w-full max-w-sm">
          <Scoreboard room={room} me={me} />
        </div>
      </WinnerScreen>
    );
  }

  // Remount per speaker and phase so local UI state (rating, transcript) never leaks between turns.
  const key = `${state.activePlayerName}-${state.subPhase}`;
  return (
    <div className="screen-in mx-auto max-w-md px-5 pt-6 pb-16" key={key}>
      {state.subPhase === 'SpeakerTurn' && (isSpeaker ? <Speaker state={state} isHost={isHost} /> : <Listener state={state} isHost={isHost} />)}
      {state.subPhase === 'Voting' && <Voting state={state} isSpeaker={isSpeaker} />}
      {state.subPhase === 'Results' && <Results state={state} isHost={isHost} />}
      <Scoreboard room={room} me={me} />
    </div>
  );
}
