import { FORTRESS_GATE_X, FORTRESS_GROUND_Y, FORTRESS_SLING, fortressUpgradeCost, type FortressState } from '@arcade/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FortressGame, waveConfig } from '../src/games/fortress.js';
import { harness } from './harness.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function setup(names = ['Ann'], mode = '10', artillery = false) {
  const h = harness(() => 0.2).seat('defend-fortress', ...names);
  if (artillery) h.rooms.setRole(`s-${names[0]}`, 'artillery');
  h.start({ gameMode: mode });
  const g = h.room.game as FortressGame;
  const state = () => { g.sync(); return h.state<FortressState>(names[0]); };
  const shop = () => { g.sim.enemies.splice(0); g.sim.setQueue(0); g.tick(); };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.tick(); };
  return { h, g, state, shop, tick };
}
const save = { schemaVersion: 1, gameType: 'defend-fortress', wave: 7, fortressHp: 64, fortressMaxHp: 130, gameMode: '50', gold: 900, castleUpgrades: { archer: 3, wall: 2 } };

describe('Fortress phase and tuning parity', () => {
  it.each(['10', '50', '100', 'endless'])('starts a %s run with starter archers', mode => {
    const { state } = setup(['Ann', 'Bo'], mode);
    expect(state()).toMatchObject({ phase: 'WavePlaying', gameMode: mode, wave: 1, victoryWave: mode === 'endless' ? 0 : Number(mode), enemiesRemaining: 40, castleUpgrades: { archer: 2 } });
  });

  it('preserves the wave table and extrapolates beyond ten', () => {
    expect(waveConfig(1)).toMatchObject({ queuePerPlayer: 20, onFieldCap: 12, spawnInterval: 1.2, enemyHp: 1 });
    expect(waveConfig(10)).toMatchObject({ queuePerPlayer: 60, onFieldCap: 50, spawnInterval: 0.65, enemyHp: 3 });
    expect(waveConfig(20)).toMatchObject({ queuePerPlayer: 100, onFieldCap: 80, enemyHp: 7 });
    expect(waveConfig(100).spawnInterval).toBe(0.2);
  });

  it('starts the next wave after everyone readies and the countdown finishes', () => {
    const { h, shop, state, tick } = setup(['Ann', 'Bo']);
    shop();
    expect(h.act('Ann', 'GrabEnemy', { id: 1 }).ok).toBe(false);
    h.act('Ann', 'ReadyForWave', { ready: true });
    expect(state().phase).toBe('Shop');
    h.act('Bo', 'ReadyForWave', { ready: true });
    expect(state().phase).toBe('Countdown');
    tick(61);
    expect(state()).toMatchObject({ phase: 'WavePlaying', wave: 2, enemiesRemaining: 48 });
  });

  it('allows only the host to force-start or pause, and freezes simulation while paused', () => {
    const { h, g, state, shop, tick } = setup(['Ann', 'Bo']);
    expect(h.act('Bo', 'TogglePause').ok).toBe(false);
    const e = g.sim.spawn({ x: 100 });
    h.act('Ann', 'GrabEnemy', { id: e.id });
    expect(h.act('Ann', 'TogglePause').ok).toBe(true);
    expect(e.heldBy).toBeNull();
    const x = e.x;
    tick(100);
    expect(e.x).toBe(x);
    expect(h.act('Bo', 'GrabEnemy', { id: e.id }).ok).toBe(false);
    h.act('Ann', 'TogglePause');
    shop();
    expect(h.act('Bo', 'StartNextWave').ok).toBe(false);
    expect(h.act('Ann', 'StartNextWave').ok).toBe(true);
    expect(state().phase).toBe('Countdown');
  });

  it('ends on zero health and wins at the selected wave target', () => {
    const lost = setup();
    lost.g.sim.setHp(0); lost.tick();
    expect(lost.state()).toMatchObject({ phase: 'GameOver', victory: false });
    expect(lost.h.room.phase).toBe('GameOver');
    const win = setup(); win.shop();
    win.h.act('Ann', 'ImportSave', { save: { ...save, wave: 9, gameMode: '10' } });
    win.h.act('Ann', 'StartNextWave'); win.tick(61); win.shop();
    expect(win.state()).toMatchObject({ phase: 'GameOver', victory: true, wave: 10 });
  });
});

describe('Fortress combat and economy', () => {
  it('owns grabs exclusively, clamps movement/velocity, and drops stale holds', () => {
    const { h, g, tick } = setup(['Ann', 'Bo']);
    const e = g.sim.spawn({ x: 100 });
    expect(h.act('Ann', 'GrabEnemy', { id: e.id }).ok).toBe(true);
    expect(h.act('Bo', 'GrabEnemy', { id: e.id }).ok).toBe(false);
    expect(h.act('Bo', 'MoveHeld', { id: e.id, x: 100, y: 100 }).ok).toBe(false);
    expect(h.act('Ann', 'MoveHeld', { id: e.id, x: Infinity, y: 1 }).ok).toBe(false);
    h.act('Ann', 'MoveHeld', { id: e.id, x: -100, y: 999 });
    expect(e.x).toBe(0); expect(e.y).toBe(FORTRESS_GROUND_Y - 6);
    expect(h.act('Ann', 'ReleaseEnemy', { id: e.id, vx: Infinity, vy: 0 }).ok).toBe(false);
    h.act('Ann', 'ReleaseEnemy', { id: e.id, vx: 9000, vy: -9000 });
    expect(e.vx).toBe(1600); expect(e.vy).toBe(-1600);
    const held = g.sim.spawn({ x: 200 });
    h.act('Ann', 'GrabEnemy', { id: held.id }); tick(51);
    expect(held.heldBy).toBeNull();
  });

  it('keeps high throws alive above the world and awards personal gold on landing', () => {
    const { g, tick } = setup();
    g.sim.setQueue(0); g.sim.seats.get('Ann')!.upgrades = {};
    const e = g.sim.spawn({ x: 200, y: 300, state: 'airborne', vx: 80, vy: -800, lastTouchedBy: 'Ann' });
    let above = false; let returning = false;
    for (let i = 0; i < 100 && g.sim.enemies.includes(e); i++) {
      tick(); if (e.y < 0) above = true; if (above && e.vy > 0) returning = true;
    }
    expect(above).toBe(true); expect(returning).toBe(true);
    expect(g.sim.enemies).not.toContain(e);
    expect(g.sim.seats.get('Ann')).toMatchObject({ kills: 1, gold: 5 });
  });

  it('marches in the grass band, attacks the wall, and introduces runners at wave four', () => {
    const { h, g, state, shop, tick } = setup();
    const e = g.sim.spawn({ x: FORTRESS_GATE_X - 1 }); tick(21);
    expect(e.state).toBe('attacking'); expect(state().fortressHp).toBeLessThan(100);
    expect(e.y).toBeGreaterThanOrEqual(270); expect(e.y).toBeLessThanOrEqual(318);
    shop(); h.act('Ann', 'ImportSave', { save: { ...save, wave: 3 } });
    h.act('Ann', 'StartNextWave'); tick(61);
    expect(g.sim.spawn().type).toBe('runner');
  });

  it('chips enemy HP with archers and splits auto-kill gold', () => {
    const { g, tick } = setup(['Ann', 'Bo']);
    g.sim.setQueue(0);
    g.sim.seats.get('Ann')!.upgrades = { archer: 10 };
    g.sim.seats.get('Bo')!.upgrades = {};
    const e = g.sim.spawn({ x: 200, hp: 2, maxHp: 2, marchSpeed: 0 });
    tick(5); expect(e.hp).toBe(1);
    tick(5); expect(g.sim.enemies).not.toContain(e);
    expect(g.sim.seats.get('Ann')!.gold).toBe(2); expect(g.sim.seats.get('Bo')!.gold).toBe(1);
  });

  it('handles 60 enemies and 500 archer tiers in a second of simulation', () => {
    const { g, tick } = setup(); g.sim.setQueue(0);
    for (let i = 0; i < 60; i++) g.sim.spawn({ x: i * 2, marchSpeed: 20 });
    g.sim.seats.get('Ann')!.upgrades = { archer: 500 };
    tick(20);
    expect(g.sim.enemies).toHaveLength(0);
    expect(g.sim.seats.get('Ann')!.gold).toBe(180);
  });

  it('gates purchases, scales prices, and applies walls and repairs', () => {
    const { h, g, shop, state } = setup();
    expect(h.act('Ann', 'PurchaseUpgrade', { upgradeId: 'archer' }).ok).toBe(false);
    shop(); const seat = g.sim.seats.get('Ann')!; seat.gold = 425;
    expect(fortressUpgradeCost('archer', 1)).toBe(150);
    expect(h.act('Ann', 'PurchaseUpgrade', { upgradeId: 'archer' }).ok).toBe(true);
    expect(h.act('Ann', 'PurchaseUpgrade', { upgradeId: 'wall' }).ok).toBe(true);
    expect(h.act('Ann', 'PurchaseUpgrade', { upgradeId: 'repair' }).ok).toBe(true);
    expect(state()).toMatchObject({ fortressHp: 115, fortressMaxHp: 115 });
    expect(seat.gold).toBe(0); expect(seat.upgrades.archer).toBe(2);
    expect(h.act('Ann', 'PurchaseUpgrade', { upgradeId: 'archer' }).ok).toBe(false);
  });

  it('engineers heal and mages cast a server-authoritative fireball with cooldown', () => {
    const { h, g, tick, state } = setup();
    g.sim.setHp(50); g.sim.seats.get('Ann')!.upgrades = { engineer: 1, wizard: 1 };
    const target = g.sim.spawn({ x: 100, hp: 6, maxHp: 6 });
    expect(h.act('Ann', 'CastWizardSpell').ok).toBe(true); expect(target.hp).toBe(1);
    expect(h.act('Ann', 'CastWizardSpell').ok).toBe(false);
    tick(20); expect(state().fortressHp).toBe(51);
  });

  it('reserves the artillery seat, fires discs and awards airborne combos', () => {
    const { h, g, tick, state } = setup(['Ann', 'Bo'], '10', true);
    expect(state().artilleryPlayerName).toBe('Ann');
    expect(h.act('Bo', 'FireSlingshot', { angle: 0, power: 1 }).ok).toBe(false);
    const air = g.sim.spawn({ x: FORTRESS_SLING.x, y: FORTRESS_SLING.y - 38, state: 'airborne', hp: 1, vy: -41 });
    const ground = g.sim.spawn({ x: air.x - 10, y: air.y, state: 'attacking', marchSpeed: 0 });
    // Disc moves 20 px upward; the target is high enough to avoid breaching the gate.
    expect(h.act('Ann', 'FireSlingshot', { angle: -Math.PI / 2, power: 1 }).ok).toBe(true);
    expect(h.act('Ann', 'FireSlingshot', { angle: -Math.PI / 2, power: 1 }).ok).toBe(false);
    tick();
    expect(g.sim.enemies).not.toContain(air); expect(g.sim.enemies).not.toContain(ground);
    expect(g.sim.seats.get('Ann')!.artilleryGold).toBe(15);
    expect(state().discs).toHaveLength(0);
  });
});

describe('Fortress membership and saves', () => {
  it('late arrivals spectate until shop; sitting out blocks actions; leaving removes their seat', () => {
    const { h, g, state, shop } = setup();
    h.seat('defend-fortress', 'Bo');
    expect(state().players.find(p => p.name === 'Bo')!.role).toBe('spectator');
    expect(h.act('Bo', 'TogglePause').ok).toBe(false);
    shop(); expect(state().players.find(p => p.name === 'Bo')!.role).toBe('flinger');
    h.rooms.sitOut('s-Bo');
    expect(h.act('Bo', 'ReadyForWave').ok).toBe(false);
    expect(h.act('Bo', 'VolunteerArtillery').ok).toBe(false);
    h.rooms.leave('s-Bo'); expect(g.sim.seats.has('Bo')).toBe(false);
    h.act('Ann', 'ReadyForWave'); expect(state().phase).toBe('Countdown');
  });

  it('releases a grab on disconnect and freezes when nobody is connected', () => {
    const { h, g, state } = setup();
    const e = g.sim.spawn({ x: 100 }); h.act('Ann', 'GrabEnemy', { id: e.id });
    h.rooms.disconnect('s-Ann'); expect(e.heldBy).toBeNull();
    const x = e.x; vi.advanceTimersByTime(5000); expect(e.x).toBe(x);
    expect(h.rooms.rejoin('s-Ann', 'id-Ann-0000', h.code).ok).toBe(true);
    vi.advanceTimersByTime(50); expect(e.x).toBeGreaterThan(x);
    expect(state().players[0].role).toBe('flinger');
  });

  it('honors host-only shop-only import, preserves other wallets, and clears readiness', () => {
    const { h, g, state, shop } = setup(['Ann', 'Bo']);
    expect(h.act('Ann', 'ImportSave', { save }).ok).toBe(false);
    shop(); h.act('Bo', 'ReadyForWave');
    expect(h.act('Bo', 'ImportSave', { save }).ok).toBe(false);
    expect(h.act('Ann', 'ImportSave', { save }).ok).toBe(true);
    expect(state()).toMatchObject({ wave: 7, fortressHp: 64, fortressMaxHp: 130, gameMode: '50' });
    expect(g.sim.seats.get('Ann')).toMatchObject({ gold: 900, upgrades: { archer: 3, wall: 2 } });
    expect(g.sim.seats.get('Bo')).toMatchObject({ gold: 0, ready: false, upgrades: { archer: 1 } });
  });

  it.each([{ schemaVersion: 2 }, { gameType: 'oneo' }, { wave: -1 }, { fortressHp: 9999 }, { fortressMaxHp: 0 }, { castleUpgrades: { archer: -5 } }, { castleUpgrades: [] }])('rejects malformed saves atomically: %j', bad => {
    const { h, state, shop } = setup(); shop(); const before = state();
    expect(h.act('Ann', 'ImportSave', { save: { ...save, ...bad } }).ok).toBe(false);
    expect(state()).toEqual(before);
  });
});
