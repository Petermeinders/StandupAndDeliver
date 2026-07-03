using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

public class SettingsService
{
    private readonly IJSRuntime _js;
    private const string MicKey = "setting_mic";
    private const string StickyKey = "setting_sticky_header";
    private const string ExperimentalGamesKeySuffix = "setting_experimental_games";

    public bool MicEnabled { get; private set; } = false; // off by default
    public bool StickyHeader { get; private set; } = true; // sticky by default
    public bool ExperimentalGamesEnabled { get; private set; } = false; // off by default

    public event Action? OnChange;

    public SettingsService(IJSRuntime js)
    {
        _js = js;
    }

    public async Task InitializeAsync()
    {
        var mic = await _js.InvokeAsync<string?>("localStorage.getItem", MicKey);
        MicEnabled = mic == "true";
        var sticky = await _js.InvokeAsync<string?>("localStorage.getItem", StickyKey);
        StickyHeader = sticky != "false"; // default true unless explicitly false

        var experimentalGames = await _js.InvokeAsync<string?>("localStorage.getItem", await ExperimentalGamesKeyAsync());
        ExperimentalGamesEnabled = experimentalGames == "true";
    }

    public async Task SetMicEnabledAsync(bool value)
    {
        MicEnabled = value;
        await _js.InvokeVoidAsync("localStorage.setItem", MicKey, value ? "true" : "false");
        OnChange?.Invoke();
    }

    public async Task SetStickyHeaderAsync(bool value)
    {
        StickyHeader = value;
        await _js.InvokeVoidAsync("localStorage.setItem", StickyKey, value ? "true" : "false");
        OnChange?.Invoke();
    }

    public async Task SetExperimentalGamesEnabledAsync(bool value)
    {
        ExperimentalGamesEnabled = value;
        await _js.InvokeVoidAsync("localStorage.setItem", await ExperimentalGamesKeyAsync(), value ? "true" : "false");
        OnChange?.Invoke();
    }

    /// <summary>Namespaced by the player's saved name ("sad_name") rather than a flat global key —
    /// this is the setting the "tied to their name" ask was about, so two people sharing a browser
    /// under different names each keep their own choice. Read fresh (not cached) each time in case
    /// the name changes mid-session; falls back to a shared bucket before any name is set.</summary>
    private async Task<string> ExperimentalGamesKeyAsync()
    {
        var name = await _js.InvokeAsync<string?>("localStorage.getItem", "sad_name");
        var safe = string.IsNullOrWhiteSpace(name) ? "anon" : name.Trim().ToLowerInvariant();
        return $"{ExperimentalGamesKeySuffix}__{safe}";
    }
}
