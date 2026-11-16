import { getState } from './store';

const FILES = {
  menu: '/sfx/menu.ogg',
  confirm: '/sfx/confirm-click.mp3',
  click: '/sfx/confirm-click.mp3',
  flip: '/sfx/flip.ogg',
  gold: '/sfx/gold.ogg',
  hit: '/sfx/hit.mp3',
  slam: '/sfx/slam.mp3',
  levelup: '/sfx/levelup.ogg',
  spell: '/sfx/spell.ogg',
} as const;

export type SoundKey = keyof typeof FILES;

const VOLUME: Partial<Record<SoundKey, number>> = { menu: 0.35, click: 0.4, confirm: 0.5 };

const cache = new Map<SoundKey, HTMLAudioElement>();
const lastPlayed = new Map<SoundKey, number>();

export function playSound(key: SoundKey, minGapMs = 60): void {
  if (!getState().settings.sound) return;
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? 0) < minGapMs) return;
  lastPlayed.set(key, now);
  let base = cache.get(key);
  if (!base) {
    base = new Audio(FILES[key]);
    base.preload = 'auto';
    cache.set(key, base);
  }
  // Clone so quick repeats overlap instead of cutting each other off.
  const node = base.cloneNode() as HTMLAudioElement;
  node.volume = VOLUME[key] ?? 0.6;
  // Browsers reject play() until the first tap; that's fine, the sound is just skipped.
  node.play().catch(() => {});
}
