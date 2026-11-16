import type { GameId, RoomState } from '@arcade/shared';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Settings } from '../lib/storage';
import { FortressHowTo, LastStandHowTo, OneOHowTo, StandupHowTo, VaultHowTo } from './howto';

export interface GameViewProps<S = unknown> {
  state: S;
  room: RoomState;
  /** This player's name in the room. */
  me: string;
}

export interface GameEntry {
  id: GameId;
  name: string;
  tagline: string;
  icon: string;
  cover: string | null;
  /** Looping gameplay clip shown on the selected card (base path, without extension). */
  preview: string | null;
  players: string;
  /** What happens when someone starts the game alone. */
  soloNote: string;
  experimental?: boolean;
  View: LazyExoticComponent<ComponentType<GameViewProps<any>>>;
  HowToPlay: ComponentType;
  /** Settings sent with game:start, built from this device's saved preferences. */
  startSettings?: (s: Settings) => Record<string, unknown>;
}

export const GAMES: GameEntry[] = [
  {
    id: 'standup',
    name: 'Standup & Deliver',
    tagline: 'Make a boring day at the office sound heroic',
    icon: '🎤',
    cover: '/covers/standup-v2.webp',
    preview: '/previews/standup',
    players: '2–8 players',
    soloNote: 'Best with three or more. You can start alone to see how it works.',
    View: lazy(() => import('./standup/View')),
    HowToPlay: StandupHowTo,
  },
  {
    id: 'oneo',
    name: 'OneO',
    tagline: 'Match colors and numbers, empty your hand',
    icon: '🃏',
    cover: '/covers/oneo.jpg',
    preview: '/previews/oneo',
    players: '1–8 players',
    soloNote: 'Start alone and a bot takes the other seat.',
    View: lazy(() => import('./oneo/View')),
    HowToPlay: OneOHowTo,
    startSettings: (s) => ({ numbersOnly: s.oneoNumbersOnly }),
  },
  {
    id: 'cursed-vault',
    name: 'Cursed Vault',
    tagline: 'How much will you risk for the treasure?',
    icon: '💀',
    cover: '/covers/cursed-vault.webp',
    preview: '/previews/cursed-vault',
    players: '1–8 players',
    soloNote: 'Start alone and a bot takes the other seat.',
    View: lazy(() => import('./cursed-vault/View')),
    HowToPlay: VaultHowTo,
  },
  {
    id: 'last-stand',
    name: 'Last Stand',
    tagline: 'Play high, don’t be lowest, outlast everyone',
    icon: '🗡️',
    cover: '/covers/last-stand.webp',
    preview: '/previews/last-stand',
    players: '1–8 players',
    soloNote: 'Start alone and a bot takes the other seat.',
    View: lazy(() => import('./last-stand/View')),
    HowToPlay: LastStandHowTo,
  },
  {
    id: 'defend-fortress', name: 'Protect Thy Fortress', tagline: 'Grab the horde. Fling together. Hold the walls.',
    icon: '🏰', cover: '/covers/fortress.webp', preview: '/previews/defend-fortress',
    players: '1–4 players', soloNote: 'Defend alone or invite friends. One optional artillery seat.', experimental: true,
    View: lazy(() => import('./fortress/View')), HowToPlay: FortressHowTo,
    startSettings: s => ({ gameMode: s.fortressMode }),
  },
];

export interface ExternalGame {
  id: string;
  name: string;
  tagline: string;
  cover: string;
  url: string;
  about: string;
}

export const EXTERNAL_GAMES: ExternalGame[] = [
  {
    id: 'crypt-sweepers',
    name: 'Crypt Sweepers',
    tagline: 'Every tile a treasure. Every step a death sentence.',
    cover: '/covers/crypt-sweepers.jpg',
    url: 'https://crypt-sweepers.com',
    about: 'A single-player dungeon crawler built on Minesweeper logic. Use the numbers around you to work out which tiles hide treasure and which hide traps before you step.',
  },
  {
    id: 'spellbound',
    name: 'Spellbound Academy Survival',
    tagline: 'Cast spells, dodge the horde, survive the night.',
    cover: '/covers/spellbound.webp',
    url: 'https://spellbound.firesidearcade.com',
    about: 'A single-player survival game: pick your spells, keep moving, and last as long as you can against the horde.',
  },
];

export const gameById = (id: string | undefined | null): GameEntry | undefined => GAMES.find((g) => g.id === id);
