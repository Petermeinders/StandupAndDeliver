import type { FortressEnemy, FortressGameMode, FortressPhase, FortressPlayer, FortressState } from '@arcade/shared';
import { FORTRESS, FORTRESS_GATE_X, FORTRESS_GROUND_Y, FORTRESS_SLING, FORTRESS_UPGRADES, fortressUpgradeCost } from '@arcade/shared';
import type { GameContext, GameInstance, GameModule, Player } from './types.js';
import { fail, ok } from './types.js';

// Tuning. Values are carried over unchanged from the .NET version.
export const TICK_SECONDS = FORTRESS.tickMs / 1000;
const START_HP = 100;
const BREACH_DAMAGE = 8;
const WALL_ATTACK_DPS = 3;
const GRAVITY = 820;
const HELD_STALE_SECONDS = 2.5;
const COUNTDOWN_SECONDS = 3;
const GOLD_PER_FLING_KILL = 5;
const GOLD_PER_AUTO_KILL = 3;
const GOLD_PER_ARTILLERY_KILL = 5;
const GOLD_PER_ARTILLERY_COMBO = 10;
const STAFF_UNITS_PER_TIER = 3;
const ENGINEER_HEAL_PER_UNIT = 0.45;
const WIZARD_COOLDOWN = 8;
const WIZARD_FIREBALL_DAMAGE = 5;
const SLING_COOLDOWN = 1.2;
const RUNNER_INTRO_WAVE = 4;
const GRASS_TOP = FORTRESS.worldHeight * 0.75;
const GRASS_BOTTOM = FORTRESS_GROUND_Y - 6;
const STAFF = ['archer', 'wizard', 'engineer'];
const AUTO_UNITS: Record<string, { shotsPerSecond: number; damage: number }> = {
  archer: { shotsPerSecond: 0.15, damage: 1 },
  soldier: { shotsPerSecond: 0.4, damage: 1 },
  ballista: { shotsPerSecond: 0.05, damage: 5 },
};

export interface WaveConfig {
  queuePerPlayer: number;
  onFieldCap: number;
  spawnInterval: number;
  speedMultiplier: number;
  enemyHp: number;
}

const WAVES: WaveConfig[] = [
  [20, 12, 1.2, 1.0, 1], [24, 16, 1.1, 1.05, 1], [28, 20, 1.0, 1.1, 1], [32, 24, 0.95, 1.15, 2], [36, 28, 0.9, 1.2, 2],
  [40, 32, 0.85, 1.25, 2], [44, 38, 0.8, 1.3, 2], [48, 44, 0.75, 1.35, 3], [52, 48, 0.7, 1.4, 3], [60, 50, 0.65, 1.5, 3],
].map(([queuePerPlayer, onFieldCap, spawnInterval, speedMultiplier, enemyHp]) => ({ queuePerPlayer, onFieldCap, spawnInterval, speedMultiplier, enemyHp }));

export function waveConfig(wave: number): WaveConfig {
  const w = Math.max(1, wave);
  if (w <= WAVES.length) return WAVES[w - 1];
  const over = w - WAVES.length;
  const last = WAVES[WAVES.length - 1];
  return {
    queuePerPlayer: last.queuePerPlayer + over * 4,
    onFieldCap: last.onFieldCap + over * 3,
    spawnInterval: Math.max(0.2, last.spawnInterval - over * 0.02),
    speedMultiplier: last.speedMultiplier + over * 0.02,
    enemyHp: 1 + Math.floor((w - 1) / 3),
  };
}

const victoryWave = (mode: FortressGameMode) => (mode === 'endless' ? 0 : Number(mode));
const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

interface Enemy extends FortressEnemy {
  vx: number;
  vy: number;
  marchSpeed: number;
  wobble: number;
  spin: number;
  lastTouchedBy: string | null;
  heldAge: number;
  attackAcc: number;
}

interface Disc {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bouncesLeft: number;
  life: number;
  firedBy: string;
}

interface Seat {
  kills: number;
  breaches: number;
  flings: number;
  gold: number;
  artilleryGold: number;
  spectator: boolean;
  ready: boolean;
  upgrades: Record<string, number>;
}

const newSeat = (spectator = false): Seat => ({ kills: 0, breaches: 0, flings: 0, gold: 0, artilleryGold: 0, spectator, ready: false, upgrades: { archer: 1 } });

export interface FortressGame extends GameInstance {
  /** Advance the simulation by one tick. The game loop calls this; tests call it directly. */
  tick(): void;
  /** Test access to the live simulation. */
  readonly sim: { enemies: Enemy[]; seats: Map<string, Seat>; setHp(hp: number): void; setQueue(n: number): void; spawn(partial?: Partial<Enemy>): Enemy };
}

function createFortress(ctx: GameContext, settings: Record<string, unknown>): FortressGame {
  const { room, rng } = ctx;
  let gameMode: FortressGameMode = ['10', '50', '100', 'endless'].includes(String(settings.gameMode)) ? (String(settings.gameMode) as FortressGameMode) : '10';
  let phase: FortressPhase = 'WavePlaying';
  let hp = START_HP;
  let maxHp = START_HP;
  let wave = 1;
  let toSpawn = 0;
  let spawnTimer = 0;
  let countdown = 0;
  let paused = false;
  let pausedBy: string | null = null;
  let resultMessage: string | null = null;
  let victory = false;
  let nextEnemyId = 1;
  let nextDiscId = 1;
  let artillery: string | null = room.players.find((p) => p.preferredRole === 'artillery')?.name ?? null;
  let artilleryCooldown = 0;
  let wizardCooldown = 0;
  let healAcc = 0;
  const fireAcc: Record<string, number> = { archer: 0, soldier: 0, ballista: 0 };
  let enemies: Enemy[] = [];
  let discs: Disc[] = [];
  const seats = new Map<string, Seat>(room.players.filter((p) => !p.isBot).map((p) => [p.name, newSeat()]));

  const activeNames = () => [...seats].filter(([, s]) => !s.spectator).map(([n]) => n);
  const aggregate = (id: string) => [...seats.values()].reduce((n, s) => n + (s.upgrades[id] ?? 0), 0);
  const unitCount = (id: string) => aggregate(id) * (STAFF.includes(id) ? STAFF_UNITS_PER_TIER : 1);
  const grounded = (e: Enemy) => e.state === 'march' || e.state === 'attacking';

  // ── View ──

  function view(): FortressState {
    const players: FortressPlayer[] = room.players
      .filter((p) => !p.isBot)
      .map((p) => {
        const s = seats.get(p.name) ?? newSeat(true);
        return {
          name: p.name, kills: s.kills, breaches: s.breaches, flings: s.flings, gold: s.gold, artilleryGold: s.artilleryGold,
          isConnected: p.isConnected, ready: s.ready,
          role: s.spectator ? 'spectator' : p.name === artillery ? 'artillery' : 'flinger',
          upgrades: { ...s.upgrades },
        };
      });
    return {
      phase, gameMode, fortressHp: hp, fortressMaxHp: maxHp, wave, victoryWave: victoryWave(gameMode),
      enemiesRemaining: toSpawn + enemies.length,
      countdownRemaining: countdown,
      enemies: enemies.map((e) => ({ id: e.id, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10, state: e.state, heldBy: e.heldBy, rotation: Math.round(e.rotation * 100) / 100, hp: e.hp, maxHp: e.maxHp, type: e.type })),
      discs: discs.map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y) })),
      players,
      castleUpgrades: Object.fromEntries(FORTRESS_UPGRADES.filter((u) => !u.artillery).map((u) => [u.id, aggregate(u.id)])),
      artilleryPlayerName: artillery,
      artilleryCooldown: Math.round(artilleryCooldown * 10) / 10,
      wizardCooldown: Math.round(wizardCooldown * 10) / 10,
      isPaused: paused, pausedBy, resultMessage, victory,
    };
  }

  function broadcast(volatile = false): void {
    const state = view();
    for (const p of room.players) ctx.sendState(p, state, volatile);
  }

  // ── Wave flow ──

  function beginWave(n: number): void {
    wave = n;
    toSpawn = waveConfig(n).queuePerPlayer * Math.max(1, activeNames().length);
    spawnTimer = 0;
    phase = 'WavePlaying';
    resultMessage = null;
    paused = false;
    pausedBy = null;
    discs = [];
    artilleryCooldown = 0;
  }

  function beginCountdown(): void {
    phase = 'Countdown';
    countdown = COUNTDOWN_SECONDS;
  }

  function finish(message: string, won: boolean): void {
    resultMessage = message;
    victory = won;
    phase = 'GameOver';
    enemies = [];
    discs = [];
    ctx.endGame();
  }

  function checkEnd(): void {
    if (hp <= 0) return finish(`The fortress fell on wave ${wave}.`, false);
    if (toSpawn + enemies.length > 0) return;
    const goal = victoryWave(gameMode);
    if (goal > 0 && wave >= goal) return finish(`Victory! The fortress held for ${wave} waves.`, true);
    resultMessage = `Wave ${wave} repelled!`;
    phase = 'Shop';
    for (const s of seats.values()) {
      s.ready = false;
      s.spectator = false;
    }
    // Anyone who sat out is still on the bench until they come back.
    for (const p of room.players) if (p.away && seats.has(p.name)) seats.get(p.name)!.spectator = true;
  }

  // ── Combat helpers ──

  function releaseHold(e: Enemy): void {
    e.heldBy = null;
    e.heldAge = 0;
    e.state = 'march';
    e.marchSpeed = 40 + rng() * 25;
    e.vx = e.vy = e.rotation = e.spin = 0;
  }

  function splitGold(total: number): void {
    const names = activeNames();
    if (!names.length) return;
    const share = Math.floor(total / names.length);
    const remainder = total % names.length;
    names.forEach((n, i) => (seats.get(n)!.gold += share + (i < remainder ? 1 : 0)));
  }

  function eliminate(e: Enemy, breach: boolean, creditedTo: string | null): void {
    enemies = enemies.filter((x) => x !== e);
    e.hp = 0;
    if (breach) {
      hp = Math.max(0, hp - BREACH_DAMAGE);
      const s = creditedTo ? seats.get(creditedTo) : undefined;
      if (s) s.breaches++;
      return;
    }
    if (!creditedTo) return;
    if (creditedTo.startsWith('castle:')) return splitGold(GOLD_PER_AUTO_KILL);
    const killer = seats.get(creditedTo);
    if (killer) {
      killer.kills++;
      killer.gold += GOLD_PER_FLING_KILL;
    }
  }

  function damage(e: Enemy, amount: number, creditedTo: string | null): void {
    e.hp -= amount;
    if (e.hp <= 0) eliminate(e, false, creditedTo);
  }

  const frontEnemy = (): Enemy | undefined =>
    enemies.filter(grounded).sort((a, b) => Number(b.state === 'attacking') - Number(a.state === 'attacking') || b.x - a.x)[0];

  function spawn(partial: Partial<Enemy> = {}): Enemy {
    const cfg = waveConfig(wave);
    const runner = wave >= RUNNER_INTRO_WAVE && rng() < 0.25;
    const enemyHp = runner ? Math.max(1, cfg.enemyHp - 1) : cfg.enemyHp;
    const e: Enemy = {
      id: nextEnemyId++, x: -20, y: GRASS_TOP + rng() * (GRASS_BOTTOM - GRASS_TOP), state: 'march', heldBy: null, rotation: 0,
      hp: enemyHp, maxHp: enemyHp, type: runner ? 'runner' : 'grunt',
      vx: 0, vy: 0, marchSpeed: (55 + rng() * 35) * (runner ? 1.6 : 1) * cfg.speedMultiplier, wobble: rng() * Math.PI * 2,
      spin: 0, lastTouchedBy: null, heldAge: 0, attackAcc: 0,
      ...partial,
    };
    enemies.push(e);
    return e;
  }

  // ── Simulation ──

  function simulateAirborne(e: Enemy, dt: number): void {
    e.vy += GRAVITY * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.rotation += e.spin;

    // A flung body bowls over the first walker it hits hard enough.
    const speed = Math.hypot(e.vx, e.vy);
    if (speed > 180) {
      const hit = enemies.find((o) => o !== e && grounded(o) && Math.hypot(o.x - e.x, o.y - e.y) < 28);
      if (hit) {
        eliminate(hit, false, e.lastTouchedBy);
        e.vx *= 0.55;
        e.vy *= 0.55;
      }
    }

    // Thrown off either side of the world. High arcs above the top are fine: gravity brings them back.
    if (e.x < -40 || e.x > FORTRESS.worldWidth + 40) return eliminate(e, false, e.lastTouchedBy);

    const feetY = e.y + 18;
    if (feetY >= FORTRESS_GROUND_Y && e.vy > 0) {
      const impact = Math.hypot(e.vx, e.vy);
      if (impact > 220) return eliminate(e, false, e.lastTouchedBy);
      e.y = FORTRESS_GROUND_Y - 18;
      e.vy = -impact * 0.35;
      e.vx *= 0.6;
      if (Math.abs(e.vy) < 60) {
        e.state = 'march';
        e.marchSpeed = Math.max(30, Math.abs(e.vx) * 0.5);
        e.vx = e.vy = e.rotation = e.spin = 0;
      }
    }
    // Dropped at the gate near ground level: that's a breach. Arcing over the castle is not.
    if (enemies.includes(e) && e.x >= FORTRESS_GATE_X && e.y + 18 >= FORTRESS_GROUND_Y - 8) eliminate(e, true, e.lastTouchedBy);
  }

  function simulateDiscs(dt: number): void {
    artilleryCooldown = Math.max(0, artilleryCooldown - dt);
    for (const d of [...discs]) {
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.life <= 0 || d.bouncesLeft <= 0) {
        discs = discs.filter((x) => x !== d);
        continue;
      }
      if (d.x < 0 || d.x > FORTRESS.worldWidth) {
        d.vx = -d.vx;
        d.x = clamp(d.x, 0, FORTRESS.worldWidth);
        d.bouncesLeft--;
      }
      if (d.y < 0 || d.y > FORTRESS.worldHeight) {
        d.vy = -d.vy;
        d.y = clamp(d.y, 0, FORTRESS.worldHeight);
        d.bouncesLeft--;
      }
      const hit = enemies.find((e) => e.state !== 'held' && Math.hypot(e.x - d.x, e.y - d.y) < 20);
      if (!hit) continue;
      const shooter = seats.get(d.firedBy);
      if (hit.state === 'airborne') {
        // Combo: the flying enemy slams down and takes its neighbours with it.
        const radius = 30 + (shooter?.upgrades.sling_splash ?? 0) * 15;
        const { x, y } = hit;
        eliminate(hit, false, d.firedBy);
        for (const near of enemies.filter((e) => grounded(e) && Math.hypot(e.x - x, e.y - y) < radius)) eliminate(near, false, d.firedBy);
        if (shooter) shooter.artilleryGold += GOLD_PER_ARTILLERY_COMBO;
      } else {
        damage(hit, 3 + (shooter?.upgrades.sling_power ?? 0) * 2, d.firedBy);
      }
      if (shooter && hit.hp <= 0) shooter.artilleryGold += GOLD_PER_ARTILLERY_KILL;
      discs = discs.filter((x) => x !== d);
    }
  }

  function simulate(): void {
    const dt = TICK_SECONDS;
    const cfg = waveConfig(wave);
    spawnTimer += dt;
    if (toSpawn > 0 && enemies.length < cfg.onFieldCap && spawnTimer >= cfg.spawnInterval) {
      spawnTimer = 0;
      toSpawn--;
      spawn();
    }

    for (const e of [...enemies]) {
      if (!enemies.includes(e)) continue;
      if (e.state === 'held') {
        // A grab with no movement for a while is a stuck finger or a dropped connection.
        e.heldAge += dt;
        if (e.heldAge >= HELD_STALE_SECONDS) releaseHold(e);
      } else if (e.state === 'march') {
        e.x += e.marchSpeed * dt;
        e.wobble += dt * 4;
        e.y = clamp(e.y + Math.sin(e.wobble) * 0.4, GRASS_TOP, GRASS_BOTTOM);
        if (e.x >= FORTRESS_GATE_X) {
          e.x = FORTRESS_GATE_X;
          e.state = 'attacking';
        }
      } else if (e.state === 'airborne') {
        simulateAirborne(e, dt);
      } else {
        e.attackAcc += WALL_ATTACK_DPS * dt;
        while (e.attackAcc >= 1 && hp > 0) {
          e.attackAcc -= 1;
          hp--;
        }
      }
    }

    for (const [id, unit] of Object.entries(AUTO_UNITS)) {
      const count = unitCount(id);
      if (count <= 0) continue;
      fireAcc[id] += count * unit.shotsPerSecond * dt;
      while (fireAcc[id] >= 1) {
        fireAcc[id] -= 1;
        const target = frontEnemy();
        if (!target) break;
        damage(target, unit.damage, `castle:${id}`);
      }
    }

    const engineers = unitCount('engineer');
    if (engineers > 0 && hp < maxHp) {
      healAcc += engineers * ENGINEER_HEAL_PER_UNIT * dt;
      while (healAcc >= 1 && hp < maxHp) {
        healAcc -= 1;
        hp++;
      }
    }
    wizardCooldown = Math.max(0, wizardCooldown - dt);
    simulateDiscs(dt);
  }

  function tick(): void {
    const previousPhase = phase;
    if (phase === 'Countdown') {
      countdown -= TICK_SECONDS;
      if (countdown <= 0) beginWave(wave + 1);
    } else if (phase === 'WavePlaying' && !paused) {
      simulate();
      checkEnd();
    } else {
      return; // Shop and pause change only through actions, which broadcast themselves.
    }
    broadcast(previousPhase === phase && phase === 'WavePlaying');
  }

  function loop(): void {
    ctx.after(FORTRESS.tickMs, () => {
      if (phase === 'GameOver') return;
      // Nobody watching: hold the wave instead of letting the fortress fall to an empty room.
      if (room.players.some((p) => p.isConnected)) {
        room.lastActivity = Date.now();
        tick();
      }
      loop();
    });
  }

  function bench(name: string): void {
    for (const e of enemies) if (e.heldBy === name) releaseHold(e);
    const seat = seats.get(name);
    if (seat) seat.spectator = true;
    if (artillery === name) artillery = null;
    if (phase === 'Shop' && activeNames().length && activeNames().every((n) => seats.get(n)!.ready)) beginCountdown();
    broadcast();
  }

  // ── Actions ──

  function act(player: Player, action: string, data: Record<string, unknown>) {
    if (phase === 'GameOver') return fail('Game is over.');
    const seat = seats.get(player.name);
    if (!seat) return fail('Player not found.');
    if (player.away) return fail('You are sitting out the rest of this game.');
    if (seat.spectator) return fail('Spectators can play at the next shop.');
    const num = (k: string) => Number(data[k]);
    const inCombat = () => (phase !== 'WavePlaying' ? fail('Not in combat.') : paused ? fail('Game is paused.') : null);
    const held = () => enemies.find((e) => e.id === num('id') && e.heldBy === player.name);

    switch (action) {
      case 'GrabEnemy': {
        const blocked = inCombat();
        if (blocked) return blocked;
        if (seat.spectator) return fail("Spectators can't play until the next shop.");
        if (artillery === player.name) return fail('Artillery fires the slingshot instead.');
        const e = enemies.find((x) => x.id === num('id'));
        if (!e) return fail('Enemy not found.');
        if (!grounded(e)) return fail('Enemy not available.');
        for (const other of enemies) if (other.heldBy === player.name) releaseHold(other);
        e.state = 'held';
        e.heldBy = e.lastTouchedBy = player.name;
        e.vx = e.vy = e.heldAge = 0;
        return ok();
      }
      case 'MoveHeld': {
        const e = inCombat() ? null : held();
        if (!e || !Number.isFinite(num('x')) || !Number.isFinite(num('y'))) return fail('Not holding this enemy.');
        e.x = clamp(num('x'), 0, FORTRESS.worldWidth);
        // Lifting is allowed; only the floor is solid.
        e.y = clamp(num('y'), 0, GRASS_BOTTOM);
        e.heldAge = 0;
        return ok();
      }
      case 'ReleaseEnemy': {
        const e = inCombat() ? null : held();
        if (!e) return fail('Not holding this enemy.');
        if (!Number.isFinite(num('vx')) || !Number.isFinite(num('vy'))) return fail('Invalid throw.');
        const vx = clamp(num('vx'), -1600, 1600);
        const vy = clamp(num('vy') || 0, -1600, 1600);
        e.heldBy = null;
        e.heldAge = 0;
        if (Math.hypot(vx, vy) < 80) {
          e.state = 'march';
          e.marchSpeed = 40 + rng() * 25;
          e.vx = e.vy = 0;
          e.y = clamp(e.y, GRASS_TOP, GRASS_BOTTOM);
        } else {
          e.state = 'airborne';
          e.vx = vx;
          e.vy = vy;
          e.spin = vx * 0.004;
          seat.flings++;
        }
        return ok();
      }
      case 'FireSlingshot': {
        const blocked = inCombat();
        if (blocked) return blocked;
        if (artillery !== player.name) return fail("You don't hold the artillery seat.");
        if (artilleryCooldown > 0) return fail('Slingshot is still reloading.');
        const angle = num('angle');
        if (!Number.isFinite(angle) || !Number.isFinite(num('power'))) return fail('Invalid aim.');
        const speed = (400 + (seat.upgrades.sling_power ?? 0) * 60) * clamp(num('power') || 0, 0.2, 1);
        discs.push({ id: nextDiscId++, x: FORTRESS_SLING.x, y: FORTRESS_SLING.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, bouncesLeft: 6, life: 4, firedBy: player.name });
        artilleryCooldown = Math.max(0.25, SLING_COOLDOWN - (seat.upgrades.sling_reload ?? 0) * 0.08);
        return ok();
      }
      case 'CastWizardSpell': {
        const blocked = inCombat();
        if (blocked) return blocked;
        if (seat.spectator) return fail("Spectators can't cast spells until the next shop.");
        if (aggregate('wizard') <= 0) return fail('No mage hired.');
        if (wizardCooldown > 0) return fail('Spell is still recharging.');
        const target = frontEnemy();
        if (!target) return fail('No valid target.');
        damage(target, WIZARD_FIREBALL_DAMAGE, 'castle:wizard');
        wizardCooldown = WIZARD_COOLDOWN / Math.max(1, aggregate('wizard'));
        return ok();
      }
      case 'TogglePause':
        if (!player.isHost) return fail('Only the host can pause.');
        if (phase !== 'WavePlaying') return fail('Can only pause during combat.');
        if (seat.spectator) return fail("Spectators can't pause.");
        paused = !paused;
        pausedBy = paused ? player.name : null;
        if (paused) for (const e of enemies) if (e.heldBy) releaseHold(e);
        broadcast();
        return ok();

      case 'PurchaseUpgrade': {
        if (phase !== 'Shop') return fail('Shop is not open.');
        const upgrade = FORTRESS_UPGRADES.find((u) => u.id === data.upgradeId);
        if (!upgrade) return fail('Unknown upgrade.');
        const tier = seat.upgrades[upgrade.id] ?? 0;
        const cost = fortressUpgradeCost(upgrade.id, tier);
        if (upgrade.artillery) {
          if (seat.artilleryGold < cost) return fail('Not enough artillery gold.');
          seat.artilleryGold -= cost;
        } else {
          if (seat.gold < cost) return fail('Not enough gold.');
          if (upgrade.id === 'repair' && hp >= maxHp) return fail('The walls are already at full strength.');
          seat.gold -= cost;
          if (upgrade.id === 'wall') maxHp += 15;
          if (upgrade.id === 'repair') hp = Math.min(maxHp, hp + 15);
        }
        seat.upgrades = { ...seat.upgrades, [upgrade.id]: tier + 1 };
        broadcast();
        return ok();
      }
      case 'ReadyForWave':
        if (phase !== 'Shop') return fail('Not in shop.');
        seat.ready = typeof data.ready === 'boolean' ? data.ready : !seat.ready;
        if (activeNames().length && activeNames().every((n) => seats.get(n)!.ready)) beginCountdown();
        broadcast();
        return ok();

      case 'StartNextWave':
        if (phase !== 'Shop') return fail('Not in shop.');
        if (!player.isHost) return fail('Only the host can force-start the next wave.');
        beginCountdown();
        broadcast();
        return ok();

      case 'VolunteerArtillery':
        if (phase !== 'Shop') return fail('Can only volunteer in the shop.');
        if (artillery && artillery !== player.name) return fail(`${artillery} already holds the artillery seat.`);
        artillery = artillery === player.name ? null : player.name;
        broadcast();
        return ok();

      case 'ImportSave': {
        if (phase !== 'Shop') return fail('Import is only allowed in the shop.');
        if (!player.isHost) return fail('Only the host can import a save.');
        const save = data.save as Record<string, unknown> | undefined;
        if (!save || typeof save !== 'object') return fail('Save file is not valid.');
        if (save.schemaVersion !== 1) return fail('Unsupported save schema version.');
        if (save.gameType !== 'defend-fortress') return fail('Save file is for a different game.');
        const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : NaN);
        const [w, mhp, chp] = [int(save.wave), int(save.fortressMaxHp), int(save.fortressHp)];
        if (!(w >= 1 && w <= 100_000)) return fail('Invalid wave number in save.');
        if (!(mhp >= 1 && mhp <= 1_000_000)) return fail('Invalid fortressMaxHp in save.');
        if (!(chp >= 0 && chp <= mhp)) return fail('Invalid fortressHp in save.');
        if (save.castleUpgrades !== undefined && (!save.castleUpgrades || typeof save.castleUpgrades !== 'object' || Array.isArray(save.castleUpgrades))) return fail('Invalid upgrades in save.');
        const upgrades: Record<string, number> = {};
        for (const [id, tier] of Object.entries((save.castleUpgrades as Record<string, unknown>) ?? {})) {
          if (!FORTRESS_UPGRADES.some((u) => u.id === id && !u.artillery)) continue;
          if (!(int(tier) >= 0 && int(tier) <= 10_000)) return fail(`Invalid tier for upgrade '${id}' in save.`);
          upgrades[id] = int(tier);
        }
        wave = w;
        maxHp = mhp;
        hp = chp;
        if (['10', '50', '100', 'endless'].includes(String(save.gameMode))) gameMode = String(save.gameMode) as FortressGameMode;
        seat.gold = int(save.gold) >= 0 ? Math.min(int(save.gold), 100_000_000) : 0;
        seat.upgrades = upgrades;
        for (const s of seats.values()) s.ready = false;
        wizardCooldown = 0;
        resultMessage = `Save loaded: wave ${wave} cleared.`;
        broadcast();
        return ok();
      }
      default:
        return fail(`Unknown action: ${action}`);
    }
  }

  return {
    start() {
      beginWave(1);
      broadcast();
      loop();
    },
    sync: broadcast,
    action: (player, action, payload) => act(player, action, (payload ?? {}) as Record<string, unknown>),
    tick,
    onDisconnected(player) {
      for (const e of enemies) if (e.heldBy === player.name) releaseHold(e);
    },
    onDropped: bench,
    onLeft(name) {
      bench(name);
      seats.delete(name);
    },
    onJoined(player) {
      // Mid-wave arrivals watch until the next shop; arriving between waves, they're straight in.
      if (!seats.has(player.name)) seats.set(player.name, newSeat(phase !== 'Shop'));
    },
    sim: {
      get enemies() {
        return enemies;
      },
      seats,
      setHp: (v) => void (hp = v),
      setQueue: (n) => void (toSpawn = n),
      spawn,
    },
  };
}

export const fortress: GameModule = { id: 'defend-fortress', minPlayers: 1, maxPlayers: 4, midRunJoin: true, create: createFortress };
