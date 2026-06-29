using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

public class SettingsService
{
    private readonly IJSRuntime _js;
    private const string MicKey = "setting_mic";
    private const string StickyKey = "setting_sticky_header";

    public bool MicEnabled { get; private set; } = false; // off by default
    public bool StickyHeader { get; private set; } = true; // sticky by default

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
}
