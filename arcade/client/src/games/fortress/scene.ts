import Phaser from 'phaser';
import { FORTRESS, FORTRESS_CASTLE_LEFT, FORTRESS_GROUND_Y, FORTRESS_SLING, type FortressState, type Result } from '@arcade/shared';
import { playSound } from '../../lib/sound';

export interface BattlefieldBridge {
  state(): FortressState;
  connected(): boolean;
  me: string;
  artillery: boolean;
  send(action: string, payload?: unknown): Promise<Result>;
  ready(): void;
}

type Sample = { x: number; y: number; time: number };

/** No client physics: the scene interpolates server snapshots and sends input intents. */
export function mountBattlefield(parent: HTMLElement, bridge: BattlefieldBridge) {
  const portrait = bridge.artillery;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const project = (x: number, y: number) => portrait ? { x: y, y: 800 - x } : { x, y };
  const unproject = (p: Phaser.Input.Pointer) => portrait ? { x: 800 - p.y, y: p.x } : { x: p.x, y: p.y };

  class Battlefield extends Phaser.Scene {
    private snapshot?: FortressState;
    private previous?: FortressState;
    private receivedAt = 0;
    private enemies = new Map<number, Phaser.GameObjects.Sprite>();
    private discs = new Map<number, Phaser.GameObjects.Arc>();
    private marks!: Phaser.GameObjects.Graphics;
    private aim!: Phaser.GameObjects.Graphics;
    private particles!: Phaser.GameObjects.Particles.ParticleEmitter;
    private held: number | null = null;
    private pointer: Phaser.Input.Pointer | null = null;
    private samples: Sample[] = [];
    private lastMove = 0;
    private dead = false;

    preload() {
      this.load.image('field', '/fortress/bg.jpg');
      this.load.image('castle', '/fortress/castle.webp');
      this.load.image('archer', '/fortress/archer.webp');
      this.load.spritesheet('walk', '/fortress/skeleton-walk.png', { frameWidth: 111, frameHeight: 184 });
      this.load.spritesheet('attack', '/fortress/skeleton-attack.png', { frameWidth: 180, frameHeight: 184 });
      this.load.spritesheet('sway', '/fortress/skeleton-sway.png', { frameWidth: 159, frameHeight: 177 });
    }

    create() {
      if (portrait) {
        this.add.rectangle(180, 400, 360, 800, 0x213830);
        const grid = this.add.graphics().lineStyle(1, 0xf1e7ea, 0.07);
        for (let y = 0; y < 800; y += 40) grid.lineBetween(0, y, 360, y);
        for (let x = 0; x < 360; x += 40) grid.lineBetween(x, 0, x, 800);
        const castle = project(680, 180);
        this.add.image(castle.x, castle.y, 'castle').setDisplaySize(230, 230).setAlpha(0.5);
        this.add.text(18, 20, 'ARTILLERY • TAP TO AIM', { fontSize: '17px', color: '#ffc247', fontFamily: 'sans-serif' });
      } else {
        this.add.image(400, 180, 'field').setDisplaySize(800, 360);
        this.add.rectangle(400, 180, 800, 360, 0x111824, 0.14);
        this.add.image(FORTRESS_CASTLE_LEFT + FORTRESS.castleDrawWidth / 2, FORTRESS_GROUND_Y + 10, 'castle')
          .setOrigin(0.5, 1).setDisplaySize(FORTRESS.castleDrawWidth, FORTRESS.castleDrawWidth);
        for (let i = 0; i < 3; i++) this.add.image(643 + i * 32, 164, 'archer').setDisplaySize(30, 30);
      }
      for (const [key, frameRate] of [['walk', 24], ['attack', 20], ['sway', 12]] as const) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(key), frameRate, repeat: -1 });
      }
      const spark = this.make.graphics({ x: 0, y: 0 });
      spark.fillStyle(0xffffff).fillCircle(4, 4, 4).generateTexture('spark', 8, 8).destroy();
      this.particles = this.add.particles(0, 0, 'spark', {
        emitting: false, lifespan: 420, speed: { min: 30, max: 120 }, scale: { start: 0.7, end: 0 },
        alpha: { start: 1, end: 0 }, tint: [0xffc247, 0xf1e7ea, 0xff7a1a],
      }).setDepth(1000);
      this.marks = this.add.graphics().setDepth(900);
      this.aim = this.add.graphics().setDepth(950);
      this.input.on('pointerdown', this.down, this);
      this.input.on('pointermove', this.move, this);
      this.input.on('pointerup', this.up, this);
      this.input.on('pointerupoutside', this.up, this);
      const cancel = () => this.cancelHold();
      const visibility = () => { if (document.hidden) cancel(); };
      window.addEventListener('blur', cancel);
      document.addEventListener('visibilitychange', visibility);
      this.game.canvas.addEventListener('pointercancel', cancel);
      this.events.once('shutdown', () => {
        this.cancelHold();
        this.dead = true;
        window.removeEventListener('blur', cancel);
        document.removeEventListener('visibilitychange', visibility);
        this.game.canvas.removeEventListener('pointercancel', cancel);
      });
      bridge.ready();
    }

    private canPlay() {
      const s = bridge.state();
      return bridge.connected() && s.phase === 'WavePlaying' && !s.isPaused && s.players.find(p => p.name === bridge.me)?.role !== 'spectator';
    }

    private down(p: Phaser.Input.Pointer) {
      if (!this.canPlay() || this.pointer) return;
      const pos = unproject(p);
      if (portrait) {
        this.pointer = p;
        return;
      }
      const nearest = bridge.state().enemies.filter(e => e.state === 'march' || e.state === 'attacking')
        .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))[0];
      if (!nearest || Math.hypot(nearest.x - pos.x, nearest.y - pos.y) > FORTRESS.grabRadius) return;
      this.held = nearest.id;
      this.pointer = p;
      this.samples = [{ ...pos, time: performance.now() }];
      void bridge.send('GrabEnemy', { id: nearest.id }).then(result => {
        if (!result.ok && !this.dead && this.held === nearest.id) this.cancelHold();
      });
    }

    private move(p: Phaser.Input.Pointer) {
      if (p !== this.pointer || this.held === null) return;
      const now = performance.now();
      this.samples.push({ ...unproject(p), time: now });
      this.samples = this.samples.filter(s => now - s.time < 120);
    }

    private up(p: Phaser.Input.Pointer) {
      if (p !== this.pointer) return;
      const pos = unproject(p);
      if (portrait && this.canPlay() && bridge.state().artilleryCooldown <= 0) {
        void bridge.send('FireSlingshot', { angle: Math.atan2(pos.y - FORTRESS_SLING.y, pos.x - FORTRESS_SLING.x), power: 1 });
        playSound('slam', 200);
      } else if (this.held !== null) {
        const now = performance.now();
        const sample = this.samples.find(s => now - s.time <= 120);
        const dt = sample ? Math.max(16, now - sample.time) / 1000 : 1;
        void bridge.send('MoveHeld', { id: this.held, ...pos });
        void bridge.send('ReleaseEnemy', { id: this.held, vx: sample ? (pos.x - sample.x) / dt : 0, vy: sample ? (pos.y - sample.y) / dt : 0 });
      }
      this.held = null;
      this.pointer = null;
      this.samples = [];
      this.aim.clear();
    }

    private cancelHold() {
      if (this.held !== null) void bridge.send('ReleaseEnemy', { id: this.held, vx: 0, vy: 0 });
      this.held = null;
      this.pointer = null;
      this.samples = [];
      this.aim?.clear();
    }

    update() {
      const now = performance.now();
      const s = bridge.state();
      if (!this.canPlay() && this.pointer) this.cancelHold();
      if (s !== this.snapshot) {
        this.previous = this.snapshot;
        this.snapshot = s;
        this.receivedAt = now;
        if (this.previous && s.fortressHp < this.previous.fortressHp) {
          if (!reducedMotion) this.cameras.main.shake(90, 0.002);
          playSound('hit', 500);
        }
        const living = new Set(s.enemies.map(e => e.id));
        for (const [id, sprite] of this.enemies) if (!living.has(id)) {
          if (s.phase === 'WavePlaying' && !reducedMotion) this.particles.explode(7, sprite.x, sprite.y);
          sprite.destroy();
          this.enemies.delete(id);
        }
      }
      const alpha = Math.min(1, (now - this.receivedAt) / FORTRESS.tickMs);
      const before = new Map(this.previous?.enemies.map(e => [e.id, e]));
      this.marks.clear();
      for (const e of s.enemies) {
        let sprite = this.enemies.get(e.id);
        if (!sprite) {
          sprite = this.add.sprite(0, 0, 'walk');
          this.enemies.set(e.id, sprite);
        }
        const prev = before.get(e.id) ?? e;
        let x = Phaser.Math.Linear(prev.x, e.x, alpha);
        let y = Phaser.Math.Linear(prev.y, e.y, alpha);
        if (this.held === e.id && this.pointer) {
          const pos = unproject(this.pointer);
          x = Phaser.Math.Clamp(pos.x, 0, 800);
          y = Phaser.Math.Clamp(pos.y, 0, 318);
          // Also heartbeat a stationary grab so a resting finger is not mistaken for a disconnect.
          if (now - this.lastMove >= FORTRESS.tickMs) {
            this.lastMove = now;
            void bridge.send('MoveHeld', { id: e.id, x, y });
          }
        }
        const p = project(x, y);
        const anim = e.state === 'attacking' ? 'attack' : e.state === 'march' ? 'walk' : 'sway';
        sprite.play(anim, true).setDisplaySize(anim === 'walk' ? 30 : 40, 48).setPosition(p.x, p.y - (portrait ? 0 : 6))
          .setRotation(Phaser.Math.Linear(prev.rotation, e.rotation, alpha)).setDepth(10 + y).setTint(e.type === 'runner' ? 0xffb378 : 0xffffff);
        if (s.isPaused || reducedMotion) sprite.anims.pause();
        else sprite.anims.resume();
        if (e.heldBy) this.marks.lineStyle(2, e.heldBy === bridge.me ? 0xffc247 : 0x4fd1b5).strokeCircle(p.x, p.y, 28);
        if (e.maxHp > 1) {
          this.marks.fillStyle(0x1b1320).fillRect(p.x - 14, p.y - 38, 28, 4);
          this.marks.fillStyle(0xff7a1a).fillRect(p.x - 14, p.y - 38, 28 * e.hp / e.maxHp, 4);
        }
      }
      const discIds = new Set(s.discs.map(d => d.id));
      for (const [id, disc] of this.discs) if (!discIds.has(id)) { disc.destroy(); this.discs.delete(id); }
      for (const d of s.discs) {
        const p = project(d.x, d.y);
        let disc = this.discs.get(d.id);
        if (!disc) { disc = this.add.circle(p.x, p.y, 7, 0xffc247).setStrokeStyle(2, 0xffffff).setDepth(800); this.discs.set(d.id, disc); }
        disc.setPosition(p.x, p.y);
      }
      if (portrait) {
        const sling = project(FORTRESS_SLING.x, FORTRESS_SLING.y);
        this.marks.lineStyle(3, s.artilleryCooldown > 0 ? 0xa8969f : 0xffc247).strokeCircle(sling.x, sling.y, 14);
        this.aim.clear();
        if (this.pointer) this.aim.lineStyle(2, 0xffc247, 0.7).lineBetween(sling.x, sling.y, this.pointer.x, this.pointer.y);
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO, parent, width: portrait ? 360 : 800, height: portrait ? 800 : 360,
    backgroundColor: '#213830', scene: Battlefield, banner: false, audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 2 }, render: { antialias: true },
  });
  const observer = new ResizeObserver(() => game.scale.refresh());
  observer.observe(parent);
  return () => { observer.disconnect(); game.destroy(true); };
}
