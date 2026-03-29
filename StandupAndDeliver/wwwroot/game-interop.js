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

            let finalTranscript = '';
            let sendTimer = null;

            recognition.onresult = function (event) {
                try {
                    let interim = '';
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript + ' ';
                        } else {
                            interim += event.results[i][0].transcript;
                        }
                    }
                    const full = (finalTranscript + interim).trim();
                    console.log('[Transcript] result:', full);
                    if (sendTimer) clearTimeout(sendTimer);
                    sendTimer = setTimeout(function () {
                        if (!gameInterop._recognitionActive) return;
                        dotNetRef.invokeMethodAsync('OnTranscriptUpdate', full)
                            .catch(function (err) { console.warn('[Transcript] invokeMethodAsync error:', err); });
                    }, 300);
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
                if (gameInterop._recognitionActive) {
                    try { recognition.start(); } catch (e) {
                        console.warn('[Transcript] restart failed:', e);
                    }
                }
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
