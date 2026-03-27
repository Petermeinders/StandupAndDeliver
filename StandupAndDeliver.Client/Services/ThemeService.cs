using Microsoft.JSInterop;

namespace StandupAndDeliver.Client.Services;

public class ThemeService
{
    private readonly IJSRuntime _js;
    private const string StorageKey = "theme";
    private const string W95Class = "theme-w95";

    public bool IsW95 { get; private set; }
    public event Action? OnChange;

    public ThemeService(IJSRuntime js)
    {
        _js = js;
    }

    public async Task InitializeAsync()
    {
        var saved = await _js.InvokeAsync<string?>("localStorage.getItem", StorageKey);
        IsW95 = saved == "w95";
        await ApplyAsync();
    }

    public async Task ToggleAsync()
    {
        IsW95 = !IsW95;
        await _js.InvokeVoidAsync("localStorage.setItem", StorageKey, IsW95 ? "w95" : "default");
        await ApplyAsync();
        OnChange?.Invoke();
    }

    private async Task ApplyAsync()
    {
        if (IsW95)
            await _js.InvokeVoidAsync("document.body.classList.add", W95Class);
        else
            await _js.InvokeVoidAsync("document.body.classList.remove", W95Class);
    }
}
