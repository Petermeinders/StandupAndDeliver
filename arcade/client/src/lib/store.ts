import type { GameId, RoomState } from '@arcade/shared';
import { useSyncExternalStore } from 'react';
import { storage, type Settings } from './storage';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'good';
  text: string;
}

export interface Reaction {
  id: number;
  name: string;
  emoji: string;
}

export interface AppState {
  conn: 'connecting' | 'online' | 'reconnecting';
  /** True while we're trying to get back into a remembered room on page load. */
  restoring: boolean;
  name: string;
  room: RoomState | null;
  game: { type: GameId; state: unknown } | null;
  timer: number | null;
  votes: { submitted: number; total: number } | null;
  reactions: Reaction[];
  transcript: string;
  toasts: Toast[];
  settings: Settings;
}

let state: AppState = {
  conn: 'connecting',
  restoring: !!storage.room(),
  name: storage.name(),
  room: null,
  game: null,
  timer: null,
  votes: null,
  reactions: [],
  transcript: '',
  toasts: [],
  settings: storage.settings(),
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select a slice of app state. Selectors must return a stored value, not a new object. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

let nextId = 1;

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = nextId++;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
}

export function addReaction(name: string, emoji: string): void {
  const id = nextId++;
  setState((s) => ({ reactions: [...s.reactions.slice(-11), { id, name, emoji }] }));
  setTimeout(() => setState((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })), 2000);
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch };
  storage.setSettings(settings);
  setState({ settings });
}
