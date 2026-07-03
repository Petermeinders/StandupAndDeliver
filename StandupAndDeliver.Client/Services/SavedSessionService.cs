using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

/// <summary>
/// Persists room/name in localStorage so the home screen can offer "resume" after a full reload.
/// The room code is cleared whenever the player deliberately leaves a room (or a rejoin fails) so
/// stale codes are not shown — but the player's name is a separate, longer-lived value: once set it
/// should stick around until they explicitly change it (re-typed in "Start Here"), the browser's
/// storage is cleared, or the server restarts and the old room stops existing. It must survive
/// "Leave Room" / "Leave Game" / a failed rejoin, so those flows call <see cref="ClearAsync"/>
/// (room only), never touch "sad_name" directly.
/// </summary>
public class SavedSessionService(IJSRuntime js)
{
    public async ValueTask SaveAsync(string roomCode, string playerName)
    {
        try
        {
            await js.InvokeVoidAsync("localStorage.setItem", "sad_room", roomCode);
            await js.InvokeVoidAsync("localStorage.setItem", "sad_name", playerName);
        }
        catch { /* non-critical */ }
    }

    /// <summary>Forgets the saved room only — the player's name is left alone.</summary>
    public async ValueTask ClearAsync()
    {
        try
        {
            await js.InvokeVoidAsync("localStorage.removeItem", "sad_room");
        }
        catch { /* non-critical */ }
    }
}
