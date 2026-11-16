import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { playSound } from '../lib/sound';

export interface CarouselItem {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  cover: string | null;
  preview: string | null;
  external?: boolean;
  disabled?: boolean;
  badge?: string;
}

const PREVIEW_DELAY_MS = 600;
const SWIPE_PX = 48;

/** Gameplay clip that fades in over the cover once the card has been selected for a moment. */
function Preview({ src, active }: { src: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);
  const [format, setFormat] = useState<'webm' | 'mp4'>('webm');

  useEffect(() => {
    const video = ref.current;
    if (!video || missing) return;
    if (!active) {
      setPlaying(false);
      const t = setTimeout(() => video.pause(), 600);
      return () => clearTimeout(t);
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => {
      video.currentTime = 0;
      video.play().catch(() => {});
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [active, missing, format]);

  if (missing) return null;
  return (
    <video
      ref={ref}
      src={`${src}.${format}`}
      className={`game-card-media game-card-preview ${playing ? 'is-playing' : ''}`}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      onPlaying={() => { if (active) setPlaying(true); else ref.current?.pause(); }}
      onError={() => {
        setPlaying(false);
        if (format === 'webm') setFormat('mp4');
        else setMissing(true);
      }}
    />
  );
}

/** Stand-in cover for games that don't have art yet. */
function Poster({ item }: { item: CarouselItem }) {
  return (
    <div className="game-card-media flex flex-col items-center justify-center gap-3 bg-[radial-gradient(120%_80%_at_50%_15%,#5b2333_0%,#2a1f30_55%,#17101b_100%)] pb-16">
      <span className="text-7xl drop-shadow-[0_8px_18px_rgba(0,0,0,0.5)]" aria-hidden="true">
        {item.icon}
      </span>
      <span className="px-4 text-center font-display text-4xl leading-none text-flame [text-shadow:0_3px_0_#7a2c0a]">{item.name}</span>
    </div>
  );
}

export function Carousel({ items, focusedId, onFocus, lockedId }: { items: CarouselItem[]; focusedId: string; onFocus: (id: string) => void; lockedId?: string | null }) {
  const index = Math.max(0, items.findIndex((i) => i.id === focusedId));
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const swiped = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [offset, setOffset] = useState(0);

  // Measure instead of assuming card sizes, so CSS alone controls the layout.
  useEffect(() => {
    const measure = () => {
      const card = trackRef.current?.children[index] as HTMLElement | undefined;
      const first = trackRef.current?.children[0] as HTMLElement | undefined;
      if (card && first) setOffset(card.offsetLeft - first.offsetLeft);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [index, items.length]);

  const go = (next: number) => {
    if (next < 0 || next >= items.length || next === index) return;
    if (lockedId && items[next].id !== lockedId) return;
    playSound('menu');
    onFocus(items[next].id);
  };

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
      d.moved = true;
      setDragX(dx);
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragX(0);
    if (!d?.moved) return;
    // The click that follows this pointerup belongs to the swipe, not to the card under it.
    swiped.current = true;
    setTimeout(() => (swiped.current = false), 0);
    const dx = e.clientX - d.x;
    if (Math.abs(dx) >= SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div
      className="carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label="Games"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(index - 1);
        if (e.key === 'ArrowRight') go(index + 1);
      }}
    >
      <div className="carousel-viewport" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerUp}>
        <div ref={trackRef} className={`carousel-track ${dragX ? 'is-dragging' : ''}`} style={{ transform: `translateX(${-offset + dragX}px)` }}>
          {items.map((item, i) => {
            const active = i === index;
            const locked = !!lockedId && item.id !== lockedId;
            return (
              <button
                key={item.id}
                type="button"
                className={`game-card ${active ? 'is-active' : ''} ${item.external ? 'is-external' : ''}`}
                style={{ '--distance': Math.min(Math.abs(i - index), 3), '--side': Math.sign(i - index) } as React.CSSProperties}
                aria-label={`${item.name}. ${item.tagline}`}
                aria-current={active || undefined}
                disabled={locked}
                onClick={() => !swiped.current && go(i)}
              >
                <div className="game-card-face">
                  {item.cover ? <img className="game-card-media" src={item.cover} alt="" loading={Math.abs(i - index) > 1 ? 'lazy' : 'eager'} draggable={false} /> : <Poster item={item} />}
                  {item.preview && <Preview src={item.preview} active={active} />}
                  <div className="game-card-caption">
                    {item.cover && <div className="font-display text-xl leading-tight">{item.name}</div>}
                    <div className="mt-1 text-sm leading-snug text-ash/75">{item.tagline}</div>
                    {item.badge && <div className={`mt-2 text-xs font-bold ${item.external ? 'text-spark' : 'text-flame'}`}>{item.badge}</div>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button type="button" className="btn btn-quiet h-10 w-10 rounded-full p-0" onClick={() => go(index - 1)} disabled={index === 0 || !!lockedId} aria-label="Previous game">
          ‹
        </button>
        <div className="flex items-center gap-2">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`h-2 rounded-full transition-all ${i === index ? `w-6 ${item.external ? 'bg-spark' : 'bg-ember'}` : 'w-2 bg-white/25 hover:bg-white/45'}`}
              aria-label={item.name}
              aria-current={i === index || undefined}
              disabled={!!lockedId && item.id !== lockedId}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button type="button" className="btn btn-quiet h-10 w-10 rounded-full p-0" onClick={() => go(index + 1)} disabled={index >= items.length - 1 || !!lockedId} aria-label="Next game">
          ›
        </button>
      </div>
    </div>
  );
}
