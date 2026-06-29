namespace StandupAndDeliver.Client.Services;

public enum ToastLevel { Info, Success, Warning, Error }

public record ToastMessage(Guid Id, string Text, ToastLevel Level, int DurationMs = 3500);

public record ActivityEntry(DateTime At, string Text, ToastLevel Level, string? Category = null);

public class ToastService
{
    private readonly List<ToastMessage> _toasts = [];
    private readonly List<ActivityEntry> _log = [];

    public IReadOnlyList<ToastMessage> Toasts => _toasts;
    public IReadOnlyList<ActivityEntry> Log => _log;

    public event Action? OnChange;
    public event Action? OnLogChange;

    public void Show(string text, ToastLevel level = ToastLevel.Info, int durationMs = 3500)
    {
        var toast = new ToastMessage(Guid.NewGuid(), text, level, durationMs);
        _toasts.Add(toast);
        AddLog(text, level);
        OnChange?.Invoke();
        _ = DismissAfterAsync(toast, durationMs);
    }

    public void Success(string text) => Show(text, ToastLevel.Success);
    public void Error(string text, int durationMs = 5000) => Show(text, ToastLevel.Error, durationMs);
    public void Warn(string text) => Show(text, ToastLevel.Warning, 4500);
    public void Info(string text) => Show(text, ToastLevel.Info);

    // Log an event without showing a toast (e.g., room joined, game started)
    public void LogEvent(string text, string category, ToastLevel level = ToastLevel.Info)
    {
        AddLog(text, level, category);
    }

    public void ClearLog()
    {
        _log.Clear();
        OnLogChange?.Invoke();
    }

    public void Dismiss(Guid id)
    {
        _toasts.RemoveAll(t => t.Id == id);
        OnChange?.Invoke();
    }

    private void AddLog(string text, ToastLevel level, string? category = null)
    {
        _log.Insert(0, new ActivityEntry(DateTime.Now, text, level, category));
        // Keep last 200 entries
        if (_log.Count > 200) _log.RemoveAt(_log.Count - 1);
        OnLogChange?.Invoke();
    }

    private async Task DismissAfterAsync(ToastMessage toast, int ms)
    {
        await Task.Delay(ms);
        Dismiss(toast.Id);
    }
}
