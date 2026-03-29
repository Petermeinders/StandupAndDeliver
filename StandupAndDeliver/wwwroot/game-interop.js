window.gameInterop = {
    _visibilityHandler: null,
    _recognition: null,
    _recognitionActive: false,

    startSpeechRecognition: function (dotNetRef) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return false;

        const recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let finalTranscript = '';
        let sendTimer = null;

        recognition.onresult = function (event) {
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
            // Throttle sends to ~3 per second
            if (sendTimer) clearTimeout(sendTimer);
            sendTimer = setTimeout(function () {
                dotNetRef.invokeMethodAsync('OnTranscriptUpdate', full)
                    .catch(function (err) { console.error('[Transcript] invokeMethodAsync error:', err); });
            }, 300);
        };

        recognition.onerror = function (event) {
            console.warn('[Transcript] error:', event.error);
        };

        recognition.onend = function () {
            if (gameInterop._recognitionActive) {
                try { recognition.start(); } catch (e) {}
            }
        };

        gameInterop._recognition = recognition;
        gameInterop._recognitionActive = true;
        try {
            recognition.start();
        } catch (e) {
            return false;
        }
        return true;
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
