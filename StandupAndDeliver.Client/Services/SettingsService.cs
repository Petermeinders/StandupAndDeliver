using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

public class SettingsService
{
    private readonly IJSRuntime _js;
    private const string MicKey = "setting_mic";

    public bool MicEnabled { get; private set; } = false; // off by default

    public event Action? OnChange;

    public SettingsService(IJSRuntime js)
    {
        _js = js;
    }

    public async Task InitializeAsync()
    {
        var saved = await _js.InvokeAsync<string?>("localStorage.getItem", MicKey);
        MicEnabled = saved == "true";
    }

    public async Task SetMicEnabledAsync(bool value)
    {
        MicEnabled = value;
        await _js.InvokeVoidAsync("localStorage.setItem", MicKey, value ? "true" : "false");
        OnChange?.Invoke();
    }
}
