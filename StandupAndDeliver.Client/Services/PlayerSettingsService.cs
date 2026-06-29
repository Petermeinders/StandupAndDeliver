using Microsoft.JSInterop;
using System.Text.Json;

namespace StandupAndDeliver.Client.Services;

public class PlayerSettingsService
{
    private readonly IJSRuntime _js;
    private const string StorageKey = "sad_game_settings";

    public PlayerSettingsService(IJSRuntime js)
    {
        _js = js;
    }

    // ── OneO ─────────────────────────────────────────────────────────────────

    public bool OneONumbersOnly { get; private set; }

    public async Task LoadAsync()
    {
        try
        {
            var json = await _js.InvokeAsync<string?>("localStorage.getItem", StorageKey);
            if (json is not null)
            {
                var doc = JsonDocument.Parse(json).RootElement;
                if (doc.TryGetProperty("OneO", out var oneO) &&
                    oneO.TryGetProperty("NumbersOnly", out var no))
                    OneONumbersOnly = no.GetBoolean();
            }
        }
        catch { }
    }

    public async Task SetOneONumbersOnlyAsync(bool value)
    {
        OneONumbersOnly = value;
        try { await SaveAsync(); } catch { }
        OnChange?.Invoke();
    }

    public string GetOneOSettingsJson()
        => JsonSerializer.Serialize(new { NumbersOnly = OneONumbersOnly });

    public event Action? OnChange;

    private async Task SaveAsync()
    {
        var payload = new { OneO = new { NumbersOnly = OneONumbersOnly } };
        await _js.InvokeVoidAsync("localStorage.setItem", StorageKey,
            JsonSerializer.Serialize(payload));
    }
}
