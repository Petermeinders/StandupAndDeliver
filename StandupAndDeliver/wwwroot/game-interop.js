window.gameInterop = {
    _visibilityHandler: null,

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
