using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.JSInterop;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Client.Services;

public sealed class VisibilityInterop : IAsyncDisposable
{
    private readonly IJSRuntime _js;
    private readonly HubConnection _hub;
    private readonly GameStateService _gameState;
    private DotNetObjectReference<VisibilityInterop>? _selfRef;

    public VisibilityInterop(IJSRuntime js, HubConnection hub, GameStateService gameState)
    {
        _js = js;
        _hub = hub;
        _gameState = gameState;
    }

    public async Task RegisterAsync()
    {
        _selfRef = DotNetObjectReference.Create(this);
        await _js.InvokeVoidAsync("gameInterop.registerVisibilityChange", _selfRef);
    }

    [JSInvokable]
    public async Task OnVisibilityRestored()
    {
        if (_hub.State is HubConnectionState.Disconnected or HubConnectionState.Reconnecting)
        {
            try
            {
                if (_hub.State == HubConnectionState.Disconnected)
                    await _hub.StartAsync();

                if (_gameState.State is not null && _gameState.PlayerName is not null)
                    await _hub.InvokeAsync<HubResult>("RejoinRoom", _gameState.State.RoomCode, _gameState.PlayerName);
            }
            catch
            {
                // Reconnect attempt failed — SignalR's own retry policy will continue
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _js.InvokeVoidAsync("gameInterop.unregisterVisibilityChange");
        _selfRef?.Dispose();
    }
}
