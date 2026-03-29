window.gameInterop = {
    _visibilityHandler: null,
    _recognition: null,
    _recognitionActive: false,

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

            // confirmedText  = all text from fully-closed sessions (never re-processed)
            // sessionFinal   = final results within the CURRENT session only
            // Both reset correctly on restart so re-recognized audio never duplicates
            let confirmedText = '';
            let sessionFinal = '';
            let lastSentText = '';
            let sendTimer = null;
            let restartTimer = null;

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
                            sessionFinal += event.results[i][0].transcript + ' ';
                        } else {
                            interim = event.results[i][0].transcript;
                        }
                    }
                    const full = (confirmedText + sessionFinal + interim).trim();
                    sendFull(full);
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
                confirmedText = (confirmedText + sessionFinal).trimEnd();
                if (confirmedText) confirmedText += ' ';
                sessionFinal = '';
                // Delay restart to reduce bing frequency on mobile
                if (restartTimer) clearTimeout(restartTimer);
                restartTimer = setTimeout(function () {
                    if (!gameInterop._recognitionActive) return;
                    try { recognition.start(); } catch (e) {
                        console.warn('[Transcript] restart failed:', e);
                    }
                }, 1500);
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
    }
};
