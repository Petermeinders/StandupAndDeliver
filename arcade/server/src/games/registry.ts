import type { GameId } from '@arcade/shared';
import { cursedVault } from './cursedVault.js';
import { fortress } from './fortress.js';
import { lastStand } from './lastStand.js';
import { oneo } from './oneo.js';
import { standup } from './standup.js';
import type { GameModule } from './types.js';

export const GAME_MODULES = new Map<GameId, GameModule>([standup, oneo, cursedVault, lastStand, fortress].map((m) => [m.id, m]));
