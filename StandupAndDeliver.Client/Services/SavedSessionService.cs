using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

/// <summary>
/// Persists room/name in localStorage so the home screen can offer "resume" after a full reload.
/// Cleared when the session ends or the player leaves so stale codes are not shown.
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

    public async ValueTask ClearAsync()
    {
        try
        {
            await js.InvokeVoidAsync("localStorage.removeItem", "sad_room");
            await js.InvokeVoidAsync("localStorage.removeItem", "sad_name");
        }
        catch { /* non-critical */ }
    }
}
