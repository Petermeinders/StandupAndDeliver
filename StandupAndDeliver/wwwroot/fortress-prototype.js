// Shared-enemy sync prototype — server authoritative positions, 20 Hz snapshots.
const FORTRESS_GRAB_RADIUS = 48;

window.fortressInterop = {
    _games: {},

    start(canvasId, dotNetRef, playerName) {
        this.stop(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return false;

        const ctx = canvas.getContext('2d');
        const FLING_SCALE = 1.35;

        const game = {
            canvas,
            ctx,
            dotNetRef,
            playerName,
            running: true,
            enemies: [],
            splats: [],
            worldW: 800,
            worldH: 360,
            lastFrame: performance.now(),
            rafId: 0,
            localHeldId: null,
            pendingGrabId: null,
            pendingRelease: null,
            dragTrail: [],
            pointerId: null,
            lastMoveSent: 0,
            interpolate: false,
            serverEnemies: [],
            interpFrom: new Map(),
            interpStart: 0,
        };

        const groundWorldY = () => game.worldH - 36;

        const resize = () => {
            const parent = canvas.parentElement;
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width));
            const h = Math.max(1, Math.floor(rect.height));
            if (w === canvas.width && h === canvas.height) return;
            canvas.width = w;
            canvas.height = h;
        };
        resize();
        game.resize = resize;
        window.addEventListener('resize', resize);
        requestAnimationFrame(resize);

        const toWorld = (cx, cy) => ({
            x: (cx / canvas.width) * game.worldW,
            y: (cy / canvas.height) * game.worldH,
        });

        const toCanvas = (wx, wy) => ({
            x: (wx / game.worldW) * canvas.width,
            y: (wy / game.worldH) * canvas.height,
        });

        const canvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
        };

        const findGrabTarget = (cx, cy) => {
            let best = null;
            let bestDist = FORTRESS_GRAB_RADIUS;
            for (const enemy of game.serverEnemies) {
                if (enemy.state !== 'march') continue;
                const p = toCanvas(enemy.x, enemy.y);
                const d = Math.hypot(p.x - cx, p.y - cy);
                if (d < bestDist) {
                    bestDist = d;
                    best = enemy;
                }
            }
            return best;
        };

        const sendAction = (action, payload) =>
            game.dotNetRef.invokeMethodAsync('OnFortressAction', action, JSON.stringify(payload))
                .then(ok => ok === true)
                .catch(() => false);

        const computeReleaseVelocity = (trail) => {
            const scaleX = game.worldW / canvas.width;
            const scaleY = game.worldH / canvas.height;
            if (trail.length >= 2) {
                const a = trail[0];
                const b = trail[trail.length - 1];
                const dt = Math.max(0.016, (b.t - a.t) / 1000);
                return {
                    vx: ((b.x - a.x) / dt) * FLING_SCALE * scaleX,
                    vy: ((b.y - a.y) / dt) * FLING_SCALE * scaleY,
                };
            }
            return {
                vx: -280 - Math.random() * 80,
                vy: -320 - Math.random() * 60,
            };
        };

        const releaseHeld = (id, trail) => {
            const { vx, vy } = computeReleaseVelocity(trail);
            sendAction('ReleaseEnemy', { id, vx, vy });
            if (game.localHeldId === id) game.localHeldId = null;
            if (game.pendingGrabId === id) game.pendingGrabId = null;
            game.pendingRelease = null;
        };

        const flushPendingRelease = () => {
            if (!game.pendingRelease) return;
            const { id, trail } = game.pendingRelease;
            if (game.localHeldId === id) {
                releaseHeld(id, trail);
            }
        };

        const onGrabConfirmed = (id, ok) => {
            if (game.pendingGrabId !== id) return;
            if (!ok) {
                game.pendingGrabId = null;
                game.pendingRelease = null;
                return;
            }
            game.localHeldId = id;
            game.pendingGrabId = null;
            flushPendingRelease();
        };

        const onPointerDown = (e) => {
            if (game.localHeldId !== null || game.pendingGrabId !== null) return;
            const { x, y } = canvasPos(e);
            const target = findGrabTarget(x, y);
            if (!target) return;

            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            game.pointerId = e.pointerId;
            game.pendingGrabId = target.id;
            game.dragTrail = [{ x, y, t: performance.now() }];

            sendAction('GrabEnemy', { id: target.id }).then(ok => onGrabConfirmed(target.id, ok));
        };

        const onPointerMove = (e) => {
            const activeId = game.localHeldId ?? game.pendingGrabId;
            if (activeId === null || e.pointerId !== game.pointerId) return;
            e.preventDefault();
            const { x, y } = canvasPos(e);
            const now = performance.now();
            game.dragTrail.push({ x, y, t: now });
            if (game.dragTrail.length > 8) game.dragTrail.shift();

            if (game.localHeldId === null) return;
            if (now - game.lastMoveSent < 40) return;
            game.lastMoveSent = now;
            const w = toWorld(x, y);
            sendAction('MoveHeld', { id: game.localHeldId, x: w.x, y: w.y });
        };

        const onPointerUp = (e) => {
            const grabId = game.pendingGrabId;
            const heldId = game.localHeldId;
            if ((grabId === null && heldId === null) || e.pointerId !== game.pointerId) return;
            e.preventDefault();
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            game.pointerId = null;

            const trail = game.dragTrail;
            game.dragTrail = [];
            const id = heldId ?? grabId;

            if (heldId === null && grabId !== null) {
                game.pendingRelease = { id: grabId, trail: [...trail] };
                return;
            }

            releaseHeld(id, trail);
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        game._listeners = [
            ['pointerdown', onPointerDown],
            ['pointermove', onPointerMove],
            ['pointerup', onPointerUp],
            ['pointercancel', onPointerUp],
        ];

        game.applySnapshot = function (enemies, worldW, worldH) {
            const prev = new Map(this.serverEnemies.map(e => [e.id, e]));
            this.worldW = worldW || 800;
            this.worldH = worldH || 360;

            for (const next of enemies) {
                const old = prev.get(next.id);
                if (old && old.state !== 'airborne' && next.state === 'airborne') {
                    // airborne transition — track for splat on removal
                }
                prev.delete(next.id);
            }

            for (const [id, removed] of prev) {
                if (removed.state === 'airborne' || removed.state === 'held') {
                    const p = toCanvas(removed.x, removed.y);
                    this.splats.push({
                        x: p.x, y: p.y, life: 0.35, maxLife: 0.35, scale: 1.2,
                    });
                }
            }

            const nextEnemies = enemies.map(e => ({
                id: e.id ?? e.Id,
                x: e.x ?? e.X,
                y: e.y ?? e.Y,
                vx: e.vx ?? e.Vx ?? 0,
                vy: e.vy ?? e.Vy ?? 0,
                state: (e.state ?? e.State ?? 'march').toLowerCase(),
                heldBy: e.heldBy ?? e.HeldBy ?? null,
                rotation: e.rotation ?? e.Rotation ?? 0,
            }));

            if (this.interpolate) {
                this.interpFrom = new Map(this.serverEnemies.map(e => [e.id, { x: e.x, y: e.y, rotation: e.rotation }]));
                this.interpStart = performance.now();
            }

            this.serverEnemies = nextEnemies;

            if (this.localHeldId !== null && !this.serverEnemies.some(e => e.id === this.localHeldId && e.heldBy === this.playerName)) {
                this.localHeldId = null;
            }
            this.syncPendingGrabFromServer?.();
        };

        game.syncPendingGrabFromServer = () => {
            if (game.pendingGrabId === null) return;
            const pending = game.serverEnemies.find(e => e.id === game.pendingGrabId);
            if (!pending) return;
            if (pending.state === 'held' && pending.heldBy === game.playerName) {
                game.localHeldId = game.pendingGrabId;
                game.pendingGrabId = null;
                flushPendingRelease();
            } else if (pending.state === 'held' && pending.heldBy !== game.playerName) {
                game.pendingGrabId = null;
                game.pendingRelease = null;
            }
        };

        game.loop = (now) => {
            if (!game.running) return;
            const dt = Math.min(0.05, (now - game.lastFrame) / 1000);
            game.lastFrame = now;

            for (const splat of game.splats) splat.life -= dt;
            game.splats = game.splats.filter(s => s.life > 0);

            const castleX = (game.worldW - 48) / game.worldW * canvas.width;
            const gy = groundWorldY() / game.worldH * canvas.height;
            drawFrame(game, castleX, gy);
            game.rafId = requestAnimationFrame(game.loop);
        };

        this._games[canvasId] = game;
        game.rafId = requestAnimationFrame(game.loop);
        return true;
    },

    syncState(canvasId, enemiesJson, worldW, worldH) {
        const game = this._games[canvasId];
        if (!game) return;
        try {
            const enemies = JSON.parse(enemiesJson);
            game.applySnapshot(enemies, worldW, worldH);
        } catch (_) {}
    },

    setInterpolation(canvasId, enabled) {
        const game = this._games[canvasId];
        if (!game) return;
        game.interpolate = !!enabled;
        if (game.interpolate) {
            game.interpFrom = new Map(game.serverEnemies.map(e => [e.id, { x: e.x, y: e.y, rotation: e.rotation }]));
            game.interpStart = performance.now();
        }
    },

    stop(canvasId) {
        const game = this._games[canvasId];
        if (!game) return;
        game.running = false;
        cancelAnimationFrame(game.rafId);
        if (game.resize) window.removeEventListener('resize', game.resize);
        if (game._listeners) {
            for (const [evt, fn] of game._listeners) {
                game.canvas.removeEventListener(evt, fn);
            }
        }
        delete this._games[canvasId];
    }
};

const INTERP_MS = 50; // match server tick

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function getDisplayEnemies(game, now) {
    if (!game.interpolate || game.serverEnemies.length === 0) {
        return game.serverEnemies;
    }

    const t = Math.min(1, Math.max(0, (now - game.interpStart) / INTERP_MS));
    return game.serverEnemies.map(e => {
        const from = game.interpFrom.get(e.id);
        if (!from) return e;
        return {
            ...e,
            x: lerp(from.x, e.x, t),
            y: lerp(from.y, e.y, t),
            rotation: lerpAngle(from.rotation, e.rotation, t),
        };
    });
}

function drawFrame(game, castleX, groundY) {
    const { ctx, canvas, splats, playerName } = game;
    const now = performance.now();
    const enemies = getDisplayEnemies(game, now);
    const w = canvas.width;
    const h = canvas.height;
    const toCanvas = (wx, wy) => ({
        x: (wx / game.worldW) * w,
        y: (wy / game.worldH) * h,
    });

    ctx.fillStyle = '#1a1410';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#3d2f1f';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.strokeStyle = '#5c4a32';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    drawCastle(ctx, castleX, groundY);

    for (const e of enemies) {
        const p = toCanvas(e.x, e.y);
        const isHeld = e.heldBy === playerName;
        const isOtherHeld = e.heldBy && e.heldBy !== playerName;
        drawStickEnemy(ctx, p.x, p.y, e.state, e.rotation, isHeld, isOtherHeld);
    }

    for (const splat of splats) drawSplat(ctx, splat);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px sans-serif';
    const modeLabel = game.interpolate
        ? 'Smooth interpolation (50 ms blend between server ticks)'
        : 'Snap mode — raw server positions (lag visible)';
    ctx.fillText(modeLabel, 12, 20);
}

function drawCastle(ctx, x, groundY) {
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(x, groundY - 90, 36, 90);
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(x - 8, groundY - 70, 52, 12);
    ctx.fillRect(x - 8, groundY - 45, 52, 12);
    ctx.fillStyle = '#9ca3af';
    for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 4 + i * 12, groundY - 102, 8, 12);
    }
}

function drawStickEnemy(ctx, x, y, state, rotation, isHeld, isOtherHeld) {
    ctx.save();
    ctx.translate(x, y);
    if (state === 'airborne') ctx.rotate(rotation);

    let color = '#fbbf24';
    if (isHeld) color = '#fde68a';
    else if (isOtherHeld) color = '#a78bfa';
    else if (state === 'airborne') color = '#f59e0b';

    ctx.strokeStyle = color;
    ctx.lineWidth = isHeld || isOtherHeld ? 3 : 2.5;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(0, -22, 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(0, 2);
    ctx.stroke();

    ctx.beginPath();
    if (state === 'march') {
        ctx.moveTo(-10, -8);
        ctx.lineTo(10, -2);
    } else {
        ctx.moveTo(-14, -12);
        ctx.lineTo(14, 4);
        ctx.moveTo(-12, 2);
        ctx.lineTo(12, -10);
    }
    ctx.stroke();

    ctx.beginPath();
    if (state === 'march') {
        ctx.moveTo(0, 2);
        ctx.lineTo(-8, 18);
        ctx.moveTo(0, 2);
        ctx.lineTo(8, 18);
    } else {
        ctx.moveTo(0, 2);
        ctx.lineTo(-12, 20);
        ctx.moveTo(0, 2);
        ctx.lineTo(10, 16);
    }
    ctx.stroke();

    ctx.restore();
}

function drawSplat(ctx, splat) {
    const t = splat.life / splat.maxLife;
    const alpha = t * 0.85;
    const r = 14 * splat.scale * (1 + (1 - t) * 0.6);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.ellipse(splat.x, splat.y, r * 1.3, r * 0.55, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}
