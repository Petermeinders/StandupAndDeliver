// ── Audio ────────────────────────────────────────────────────────────────────
const _audio = (() => {
    const SFX = {
        flip:    'audio/sfx/flip.ogg',
        confirm: 'audio/sfx/confirm-click.mp3',
        slam:    'audio/sfx/slam.mp3',
        menu:    'audio/sfx/menu.ogg',
        spell:   'audio/sfx/spell.ogg',
        gold:    'audio/sfx/gold.ogg',
        levelup: 'audio/sfx/levelup.ogg',
        hit:     'audio/sfx/hit.mp3',
    };

    let _ctx = null;
    let _buffers = {};
    let _ready = false;
    let _vol = 0.6;
    // Raw ArrayBuffers fetched before AudioContext exists (no user gesture needed for fetch)
    const _raw = {};

    // Kick off fetches immediately so bytes are ready before first click
    (async () => {
        for (const [key, path] of Object.entries(SFX)) {
            try {
                const res = await fetch(path);
                if (res.ok) _raw[key] = await res.arrayBuffer();
            } catch (_) {}
        }
    })();

    async function _unlock() {
        if (_ctx) return;
        try {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Decode whatever raw bytes have arrived (most will be ready by now)
            for (const [key, raw] of Object.entries(_raw)) {
                try {
                    // slice() copies the buffer — decodeAudioData transfers/neuters the original
                    _buffers[key] = await _ctx.decodeAudioData(raw.slice(0));
                } catch (_) {}
            }
            _ready = true;
        } catch (_) {}
    }

    document.addEventListener('touchstart', _unlock, { once: true });
    document.addEventListener('click',      _unlock, { once: true });

    function play(key) {
        if (!_ready || !_ctx || !_buffers[key]) return;
        try {
            const src = _ctx.createBufferSource();
            src.buffer = _buffers[key];
            const gain = _ctx.createGain();
            gain.gain.value = _vol;
            src.connect(gain);
            gain.connect(_ctx.destination);
            src.start();
        } catch (_) {}
    }

    return { play };
})();

window.gameInterop = {
    _visibilityHandler: null,
    _recognition: null,
    _recognitionActive: false,

    playSound: function (key) {
        _audio.play(key);
    },

    startSpeechRecognition: function (dotNetRef) {
        try {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                console.log('[Transcript] SpeechRecognition not supported on this browser.');
                return false;
            }

            const recognition = new SR();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            // confirmedText = locked-in text from all closed sessions (never re-processed)
            // sessionFinals = sparse array indexed by result index for the current session
            //   Using an array means re-firing the same index just overwrites — no duplication
            let confirmedText = '';
            let sessionFinals = [];
            let lastSentText = '';
            let sendTimer = null;
            let restartTimer = null;

            function buildFull(interim) {
                const parts = [confirmedText.trim()]
                    .concat(sessionFinals.filter(Boolean).map(function (s) { return s.trim(); }))
                    .concat(interim ? [interim.trim()] : [])
                    .filter(Boolean);
                return parts.join(' ');
            }

            function sendFull(full) {
                if (full === lastSentText) return;
                if (sendTimer) clearTimeout(sendTimer);
                sendTimer = setTimeout(function () {
                    if (!gameInterop._recognitionActive) return;
                    lastSentText = full;
                    dotNetRef.invokeMethodAsync('OnTranscriptUpdate', full)
                        .catch(function (err) { console.warn('[Transcript] invokeMethodAsync error:', err); });
                }, 300);
            }

            recognition.onresult = function (event) {
                try {
                    let interim = '';
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        if (event.results[i].isFinal) {
                            var next = event.results[i][0].transcript.trim();
                            var prev = sessionFinals.filter(Boolean).map(function (s) { return s.trim(); }).join(' ');
                            if (prev.length > 0 && next.toLowerCase().startsWith(prev.toLowerCase())) {
                                // Android cumulative mode: each final contains ALL text since session start.
                                // Collapse to a single entry to avoid joining duplicates.
                                sessionFinals = [next];
                            } else {
                                // Desktop incremental mode: each final is only the new words.
                                sessionFinals[i] = next;
                            }
                        } else {
                            interim = event.results[i][0].transcript;
                        }
                    }
                    sendFull(buildFull(interim));
                } catch (e) {
                    console.warn('[Transcript] onresult error:', e);
                }
            };

            recognition.onerror = function (event) {
                console.warn('[Transcript] recognition error:', event.error);
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    gameInterop._recognitionActive = false;
                }
            };

            recognition.onend = function () {
                if (!gameInterop._recognitionActive) return;
                // Lock in this session's finals before restarting
                var sessionText = sessionFinals.filter(Boolean).map(function (s) { return s.trim(); }).join(' ');
                confirmedText = [confirmedText.trim(), sessionText].filter(Boolean).join(' ');
                if (confirmedText) confirmedText += ' ';
                sessionFinals = [];
                // Restart as fast as possible to minimise the gap where words get missed.
                // A small delay (100ms) avoids "already started" errors from rapid stop/start.
                if (restartTimer) clearTimeout(restartTimer);
                restartTimer = setTimeout(function () {
                    if (!gameInterop._recognitionActive) return;
                    try { recognition.start(); } catch (e) {
                        console.warn('[Transcript] restart failed:', e);
                    }
                }, 100);
            };

            gameInterop._recognition = recognition;
            gameInterop._recognitionActive = true;
            recognition.start();
            return true;
        } catch (e) {
            console.warn('[Transcript] startSpeechRecognition failed:', e);
            gameInterop._recognitionActive = false;
            gameInterop._recognition = null;
            return false;
        }
    },

    stopSpeechRecognition: function () {
        gameInterop._recognitionActive = false;
        if (gameInterop._recognition) {
            try { gameInterop._recognition.stop(); } catch (e) {}
            gameInterop._recognition = null;
        }
    },


    isSpeechRecognitionSupported: function () {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    registerVisibilityChange: function (dotNetRef) {
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
        }
        this._visibilityHandler = function () {
            if (document.visibilityState === 'visible') {
                dotNetRef.invokeMethodAsync('OnVisibilityRestored');
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    },

    unregisterVisibilityChange: function () {
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    },

    peekScroll: function (elementId) {
        var el = document.getElementById(elementId);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    _deferredInstallPrompt: null,

    wireInstallNudge: function () {
        // Already running as a standalone PWA — hide entirely
        if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

        var nudge      = document.getElementById('pwa-install-nudge');
        var btn        = document.getElementById('pwa-install-btn');
        var iosTip     = document.getElementById('pwa-ios-tip');

        if (!nudge || !btn) return;

        var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
            nudge.classList.remove('pwa-hidden');
            btn.addEventListener('click', function () {
                if (iosTip) iosTip.classList.toggle('pwa-hidden');
            });
            return;
        }

        // Android / Chrome / Edge / Windows — wait for the browser prompt
        window.addEventListener('beforeinstallprompt', function (e) {
            e.preventDefault();
            gameInterop._deferredInstallPrompt = e;
            nudge.classList.remove('pwa-hidden');
        });

        btn.addEventListener('click', async function () {
            if (!gameInterop._deferredInstallPrompt) return;
            gameInterop._deferredInstallPrompt.prompt();
            await gameInterop._deferredInstallPrompt.userChoice;
            gameInterop._deferredInstallPrompt = null;
            nudge.classList.add('pwa-hidden');
        });
    }
};
