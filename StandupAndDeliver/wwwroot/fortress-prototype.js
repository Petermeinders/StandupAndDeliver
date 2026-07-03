// Shared-enemy sync prototype — server authoritative positions, 20 Hz snapshots.
const FORTRESS_GRAB_RADIUS = 48;

// PTF-1.8/3.7 bug fix: CSS alone (`hover: none`/`pointer: coarse`) can't reliably tell a phone
// apart from a touchscreen laptop — many Windows hybrid devices report coarse/no-hover even with
// a mouse attached and no touch happening, which was showing the "rotate your device" overlay on
// desktop. Epic §15's own spec calls for a UA hint alongside the pointer check, so we do that in
// JS and toggle a class on <html> that the CSS gates on instead of the raw media features.
(function detectMobileForFortressOrientationGate() {
    const mobileUaPattern = /Android|iPhone|iPad|iPod|Mobi/i;
    const isTouchCapable = matchMedia('(hover: none) and (pointer: coarse)').matches;

    const apply = () => {
        const isMobile = mobileUaPattern.test(navigator.userAgent) && isTouchCapable;
        document.documentElement.classList.toggle('fortress-is-mobile', isMobile);
    };

    apply();
    window.addEventListener('resize', apply);
})();

// PTF sprite assets — real skeleton art supplied 2026-07-01, replacing the stick-figure placeholder.
//
// `ctx.drawImage(gifImg, ...)` on a canvas always paints the GIF's *current displayed frame* — but an
// off-screen/near-invisible `<img>` (tiny, -9999px, opacity 0.01) turned out to still get treated as
// "not actually visible" by Chromium and gets its GIF animation paused entirely, so every enemy froze
// on frame 1. There's no reliable "please keep animating this off-screen" DOM trick, so instead we
// decode the GIF's frames ourselves and drive the frame timing in the render loop — the canvas draw
// no longer depends on the browser's own GIF playback at all.
//
// This first shipped using the `ImageDecoder` API, which fixed it on desktop Chrome/Edge — but Edge
// on mobile (iOS) runs on Apple's WebKit engine (Apple's App Store rules force every iOS browser onto
// WebKit, regardless of brand), and WebKit doesn't implement `ImageDecoder` at all, so mobile Edge
// silently fell back to a static single frame. Rather than depend on any browser-specific decode API,
// `decodeGifFrames` below parses the GIF89a format by hand (LZW decompression + per-frame disposal-
// method compositing), so animation works identically everywhere.
const FORTRESS_SPRITES = {
    walk: 'fortress/skeleton-walk.gif',
    attack: 'fortress/skeleton-attack.gif',
    sway: 'fortress/skeleton-sway.gif',
};

// { frames: [{ bitmap, durationMs }], totalDurationMs } once decoded, or a plain <img> as a
// single-frame fallback (still loading / decode failure).
const fortressSpriteImages = {};
for (const key of Object.keys(FORTRESS_SPRITES)) {
    fortressSpriteImages[key] = new Image();
}

async function loadFortressSprite(key, src) {
    try {
        const buf = await (await fetch(src)).arrayBuffer();
        const frames = decodeGifFrames(buf);
        fortressSpriteImages[key] = {
            frames,
            totalDurationMs: frames.reduce((sum, f) => sum + f.durationMs, 0),
        };
    } catch (_) {
        fortressSpriteImages[key].src = src; // static-frame fallback
    }
}

for (const [key, src] of Object.entries(FORTRESS_SPRITES)) {
    loadFortressSprite(key, src);
}

// ── Minimal GIF89a decoder: LZW decompression + disposal-method frame compositing ──
// Returns [{ bitmap: <canvas>, durationMs }]. `bitmap` is a fully-composited, standalone canvas
// per frame (not just the frame's own sub-rectangle), ready to hand straight to `drawImage`.
function decodeGifFrames(buf) {
    const data = new Uint8Array(buf);
    let p = 6; // skip "GIF87a"/"GIF89a" signature
    const readByte = () => data[p++];
    const readShort = () => { const v = data[p] | (data[p + 1] << 8); p += 2; return v; };
    const readColorTable = (size) => { const t = data.slice(p, p + size * 3); p += size * 3; return t; };
    const skipSubBlocks = () => { while (true) { const n = readByte(); if (!n) break; p += n; } };

    const width = readShort();
    const height = readShort();
    const packed = readByte();
    const gct = (packed & 0x80) ? readColorTable(2 << (packed & 0x07)) : null;
    p += 2; // background color index, pixel aspect ratio

    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;
    const cctx = composite.getContext('2d');

    const frames = [];
    let gce = null; // pending graphic control extension for the next image block
    let savedForRestore = null;
    let prevDisposal = 0;
    let prevRect = null;

    while (p < data.length) {
        const blockType = readByte();
        if (blockType === 0x21) {
            const label = readByte();
            if (label === 0xF9) {
                readByte(); // block size (4)
                const flags = readByte();
                const delay = readShort();
                const transparentIndex = readByte();
                readByte(); // terminator
                gce = {
                    disposal: (flags >> 2) & 0x07,
                    transparentIndex: (flags & 0x01) ? transparentIndex : null,
                    delayMs: delay * 10,
                };
            } else {
                skipSubBlocks();
            }
        } else if (blockType === 0x2C) {
            const left = readShort(), top = readShort(), w = readShort(), h = readShort();
            const packedImg = readByte();
            const interlace = (packedImg & 0x40) !== 0;
            const colorTable = (packedImg & 0x80) ? readColorTable(2 << (packedImg & 0x07)) : gct;

            const minCodeSize = readByte();
            const subBlocks = [];
            while (true) {
                const n = readByte();
                if (!n) break;
                subBlocks.push(data.slice(p, p + n));
                p += n;
            }
            const compressed = new Uint8Array(subBlocks.reduce((s, b) => s + b.length, 0));
            let off = 0;
            for (const b of subBlocks) { compressed.set(b, off); off += b.length; }
            const indices = lzwDecodeGif(compressed, minCodeSize, w * h);

            if (prevDisposal === 2 && prevRect) {
                cctx.clearRect(prevRect.left, prevRect.top, prevRect.w, prevRect.h);
            } else if (prevDisposal === 3 && savedForRestore) {
                cctx.putImageData(savedForRestore, 0, 0);
            }

            const disposal = gce?.disposal ?? 0;
            if (disposal === 3) savedForRestore = cctx.getImageData(0, 0, width, height);

            const imgData = indicesToImageData(indices, w, h, colorTable, gce?.transparentIndex ?? null, interlace);
            const temp = document.createElement('canvas');
            temp.width = w;
            temp.height = h;
            temp.getContext('2d').putImageData(imgData, 0, 0);
            cctx.drawImage(temp, left, top);

            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = width;
            frameCanvas.height = height;
            frameCanvas.getContext('2d').drawImage(composite, 0, 0);
            frames.push({ bitmap: frameCanvas, durationMs: gce && gce.delayMs > 0 ? gce.delayMs : 100 });

            prevDisposal = disposal;
            prevRect = { left, top, w, h };
            gce = null;
        } else if (blockType === 0x3B || Number.isNaN(blockType)) {
            break; // trailer / end of data
        } else {
            break; // unknown block — stop rather than risk mis-parsing the rest
        }
    }

    return frames.length > 0 ? frames : [{ bitmap: composite, durationMs: 100 }];
}

function lzwDecodeGif(data, minCodeSize, pixelCount) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize, dict;
    const resetDict = () => {
        dict = [];
        for (let i = 0; i < clearCode; i++) dict[i] = [i];
        dict[clearCode] = [];
        dict[eoiCode] = [];
        codeSize = minCodeSize + 1;
    };
    resetDict();

    const output = new Uint8Array(pixelCount);
    let outPos = 0;
    let bitBuffer = 0, bitCount = 0, bytePos = 0, prev = null;

    const readCode = () => {
        while (bitCount < codeSize) {
            if (bytePos >= data.length) return eoiCode;
            bitBuffer |= data[bytePos++] << bitCount;
            bitCount += 8;
        }
        const code = bitBuffer & ((1 << codeSize) - 1);
        bitBuffer >>= codeSize;
        bitCount -= codeSize;
        return code;
    };

    while (outPos < pixelCount) {
        const code = readCode();
        if (code === clearCode) { resetDict(); prev = null; continue; }
        if (code === eoiCode) break;

        let entry;
        if (code < dict.length && dict[code]) entry = dict[code];
        else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
        else break;

        for (let i = 0; i < entry.length && outPos < pixelCount; i++) output[outPos++] = entry[i];

        if (prev) {
            dict.push(prev.concat([entry[0]]));
            if (dict.length >= (1 << codeSize) && codeSize < 12) codeSize++;
        }
        prev = entry;
    }
    return output;
}

function indicesToImageData(indices, w, h, colorTable, transparentIndex, interlace) {
    const imgData = new ImageData(w, h);
    const px = imgData.data;
    const rowOrder = interlace ? interlacedRowOrder(h) : null;
    for (let row = 0; row < h; row++) {
        const destRow = interlace ? rowOrder[row] : row;
        for (let col = 0; col < w; col++) {
            const idx = indices[row * w + col];
            const destPos = (destRow * w + col) * 4;
            if (idx === transparentIndex || !colorTable) {
                px[destPos + 3] = 0;
            } else {
                px[destPos] = colorTable[idx * 3];
                px[destPos + 1] = colorTable[idx * 3 + 1];
                px[destPos + 2] = colorTable[idx * 3 + 2];
                px[destPos + 3] = 255;
            }
        }
    }
    return imgData;
}

function interlacedRowOrder(h) {
    const order = [];
    for (let y = 0; y < h; y += 8) order.push(y);
    for (let y = 4; y < h; y += 8) order.push(y);
    for (let y = 2; y < h; y += 4) order.push(y);
    for (let y = 1; y < h; y += 2) order.push(y);
    return order;
}

// Real landscape backdrop supplied 2026-07-02, replacing the flat gradient placeholder.
const fortressLandscapeBg = new Image();
fortressLandscapeBg.src = 'fortress/landscape-bg.jpg';

function currentFortressSpriteFrame(sprite, nowMs) {
    if (!sprite) return null;
    if (sprite instanceof HTMLImageElement) {
        return sprite.complete && sprite.naturalWidth > 0 ? sprite : null;
    }
    if (!sprite.frames || sprite.frames.length === 0 || sprite.totalDurationMs <= 0) return null;
    let t = nowMs % sprite.totalDurationMs;
    for (const frame of sprite.frames) {
        if (t < frame.durationMs) return frame.bitmap;
        t -= frame.durationMs;
    }
    return sprite.frames[sprite.frames.length - 1].bitmap;
}

window.fortressInterop = {
    _games: {},

    _isMobile() {
        return document.documentElement.classList.contains('fortress-is-mobile');
    },

    _isLandscape() {
        return window.matchMedia('(orientation: landscape)').matches;
    },

    async _tryLockLandscape() {
        try {
            await screen.orientation?.lock?.('landscape');
        } catch (_) { /* iOS Safari tab — overlay handles it */ }
    },

    _unlockOrientation() {
        try {
            screen.orientation?.unlock?.();
        } catch (_) {}
    },

    _getCombatShell(canvas) {
        return document.getElementById('fortress-combat-shell')
            || canvas?.closest('.fortress-combat-shell');
    },

    enterCombatFullscreen(canvasId) {
        const game = this._games[canvasId];
        if (!game || game._combatFullscreen) return;

        const shell = this._getCombatShell(game.canvas);
        if (!shell) return;

        game._combatShell = shell;
        game._combatFullscreen = true;
        shell.classList.add('fortress-combat-fullscreen');
        document.documentElement.classList.add('fortress-combat-active');

        const onLayoutChange = () => {
            game.resize?.();
            // Exit native FS if something re-entered it — only the combat shell may be fullscreen,
            // which hides AppHeader (a sibling outside the shell). CSS .fortress-combat-fullscreen
            // handles layout; native FS is intentionally not used on mobile anymore.
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl && (fsEl === shell || shell.contains(fsEl))) {
                const exit = document.exitFullscreen
                    || document.webkitExitFullscreen
                    || document.msExitFullscreen;
                if (exit) Promise.resolve(exit.call(document)).catch(() => {});
            }
            if (this._isMobile() && this._isLandscape()) {
                this._tryLockLandscape();
            }
        };
        game._layoutHandler = onLayoutChange;
        window.addEventListener('resize', onLayoutChange);
        window.addEventListener('orientationchange', onLayoutChange);
        document.addEventListener('fullscreenchange', onLayoutChange);

        if (this._isMobile() && this._isLandscape()) {
            this._tryLockLandscape();
        }

        requestAnimationFrame(onLayoutChange);
    },

    exitCombatFullscreen(canvasId) {
        const game = this._games[canvasId];
        if (!game || !game._combatFullscreen) return;

        if (game._layoutHandler) {
            window.removeEventListener('resize', game._layoutHandler);
            window.removeEventListener('orientationchange', game._layoutHandler);
            document.removeEventListener('fullscreenchange', game._layoutHandler);
            game._layoutHandler = null;
        }

        if (game._combatShell) {
            game._combatShell.classList.remove('fortress-combat-fullscreen');
        }
        document.documentElement.classList.remove('fortress-combat-active');
        game._combatFullscreen = false;
        game._combatShell = null;

        this._unlockOrientation();

        if (document.fullscreenElement || document.webkitFullscreenElement) {
            const exit = document.exitFullscreen
                || document.webkitExitFullscreen
                || document.msExitFullscreen;
            if (exit) Promise.resolve(exit.call(document)).catch(() => {});
        }
    },

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
                if (enemy.state !== 'march' && enemy.state !== 'attacking') continue;
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
            if (game.paused) return;
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
        this.enterCombatFullscreen(canvasId);
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

    setPaused(canvasId, paused) {
        const game = this._games[canvasId];
        if (!game) return;
        game.paused = !!paused;
        if (game.canvas) {
            game.canvas.style.pointerEvents = paused ? 'none' : 'auto';
        }
    },

    stop(canvasId) {
        this.exitCombatFullscreen(canvasId);
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
    },

    /// PTF-2.1: client-side save export — server state is already synced to this client,
    /// so exporting just serializes it to a file rather than round-tripping to the server.
    downloadJson(filename, jsonContent) {
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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

    drawSkyAndGround(ctx, w, h, groundY);

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

/** Landscape backdrop — draws the real cartoon sky/hills/grass art (cover-fit, cropped to the
 *  canvas aspect ratio) once loaded; falls back to the old gradient placeholder until then. */
function drawSkyAndGround(ctx, w, h, groundY) {
    if (fortressLandscapeBg.complete && fortressLandscapeBg.naturalWidth > 0) {
        drawCoverFit(ctx, fortressLandscapeBg, w, h);
        return;
    }

    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#5fa8e0');
    sky.addColorStop(1, '#bfe4f5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, groundY);

    const blendHeight = Math.max(6, groundY * 0.03);
    const ground = ctx.createLinearGradient(0, groundY - blendHeight, 0, h);
    ground.addColorStop(0, '#bfe4f5'); // matches sky horizon color for a soft blend
    ground.addColorStop(0.35, '#6fbf4f');
    ground.addColorStop(1, '#4a9c3a');
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundY - blendHeight, w, h - groundY + blendHeight);
}

/** Draws `img` scaled+cropped to fill the target w×h exactly (CSS `background-size: cover` semantics). */
function drawCoverFit(ctx, img, w, h) {
    const srcRatio = img.naturalWidth / img.naturalHeight;
    const dstRatio = w / h;
    let sx, sy, sw, sh;
    if (srcRatio > dstRatio) {
        sh = img.naturalHeight;
        sw = sh * dstRatio;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
    } else {
        sw = img.naturalWidth;
        sh = sw / dstRatio;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
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
    const spriteKey = state === 'march' ? 'walk' : state === 'attacking' ? 'attack' : 'sway';
    const frame = currentFortressSpriteFrame(fortressSpriteImages[spriteKey], performance.now());

    if (frame) {
        drawSpriteEnemy(ctx, frame, x, y, state, rotation, isHeld, isOtherHeld);
        return;
    }

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

/** Draws the real skeleton GIF sprites in place of the stick figure. `walk` faces right in the
 *  source art, matching march direction (spawn at x=-20, castle on the right) — no mirroring
 *  needed. `sway` is a front-facing pose used for both held (player drag) and airborne (flung/
 *  artillery-target) states; a held/other-held tint still applies as a translucent color wash so
 *  players can tell "mine" from "someone else's" at a glance. */
function drawSpriteEnemy(ctx, sprite, x, y, state, rotation, isHeld, isOtherHeld) {
    // `sprite` is either an ImageBitmap (decoded GIF frame — has width/height) or an HTMLImageElement
    // fallback (has naturalWidth/naturalHeight instead).
    const srcH = sprite.naturalHeight ?? sprite.height;
    const srcW = sprite.naturalWidth ?? sprite.width;
    const targetH = 44;
    const scale = targetH / srcH;
    const w = srcW * scale;
    const h = targetH;

    ctx.save();
    ctx.translate(x, y);
    if (state === 'airborne') ctx.rotate(rotation);

    ctx.drawImage(sprite, -w / 2, -h + 4, w, h);

    if (isHeld || isOtherHeld) {
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = isHeld ? '#fde68a' : '#a78bfa';
        ctx.fillRect(-w / 2, -h + 4, w, h);
    }

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
