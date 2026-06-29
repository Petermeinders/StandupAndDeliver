using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.Components;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Client.Services;

/// Singleton hub connection shared across all pages and the persistent header.
public sealed class HubService : IAsyncDisposable
{
    private HubConnection? _hub;
    private readonly NavigationManager _nav;

    // ── Events (subscribe from components, unsubscribe in Dispose) ────────────
    public event Func<GameStateDto, Task>? OnGameState;
    public event Func<string, string, Task>? OnGameSpecificState;
    public event Func<int, Task>? OnTimerTick;
    public event Func<int, int, Task>? OnVoteCount;
    public event Func<string, string, Task>? OnReaction;
    public event Func<string, Task>? OnTranscript;
    public event Action? OnReconnecting;
    public event Action? OnReconnected;
    public event Action? OnClosed;

    public HubConnectionState ConnectionState => _hub?.State ?? HubConnectionState.Disconnected;
    public bool IsConnected => _hub?.State == HubConnectionState.Connected;

    /// Exposed so VisibilityInterop can register on the raw connection.
    public HubConnection? Connection => _hub;

    public HubService(NavigationManager nav)
    {
        _nav = nav;
    }

    public async Task EnsureConnectedAsync()
    {
        if (_hub is { State: HubConnectionState.Connected or HubConnectionState.Connecting or HubConnectionState.Reconnecting })
            return;

        if (_hub is not null)
            await _hub.DisposeAsync();

        _hub = new HubConnectionBuilder()
            .WithUrl(_nav.ToAbsoluteUri("/gamehub"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
            })
            .WithAutomaticReconnect([TimeSpan.Zero, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10)])
            .Build();

        _hub.On<GameStateDto>("ReceiveGameState",
            state => OnGameState?.Invoke(state) ?? Task.CompletedTask);

        _hub.On<string, string>("ReceiveGameSpecificState",
            (gameType, json) => OnGameSpecificState?.Invoke(gameType, json) ?? Task.CompletedTask);

        _hub.On<int>("ReceiveTimerTick",
            seconds => OnTimerTick?.Invoke(seconds) ?? Task.CompletedTask);

        _hub.On<int, int>("ReceiveVoteCount",
            (submitted, total) => OnVoteCount?.Invoke(submitted, total) ?? Task.CompletedTask);

        _hub.On<string, string>("ReceiveReaction",
            (name, emoji) => OnReaction?.Invoke(name, emoji) ?? Task.CompletedTask);

        _hub.On<string>("ReceiveTranscript",
            text => OnTranscript?.Invoke(text) ?? Task.CompletedTask);

        _hub.Reconnecting += _ => { OnReconnecting?.Invoke(); return Task.CompletedTask; };
        _hub.Reconnected += _ => { OnReconnected?.Invoke(); return Task.CompletedTask; };
        _hub.Closed += _ => { OnClosed?.Invoke(); return Task.CompletedTask; };

        await _hub.StartAsync();
    }

    // ── Hub method wrappers ───────────────────────────────────────────────────

    public async Task<HubResult> CreateOrJoinAsync(string? code, string playerName, string gameType, bool useFunName)
        => await Invoke("CreateOrJoinRoom", code ?? "", playerName, gameType, useFunName);

    public async Task<HubResult> JoinAsync(string code, string playerName)
        => await Invoke("JoinRoom", code, playerName);

    public async Task<HubResult> RejoinAsync(string code, string playerName)
        => await Invoke("RejoinRoom", code, playerName);

    public async Task<HubResult> StartGameAsync(string? settingsJson = null)
        => await Invoke("StartGame", settingsJson);

    public async Task<HubResult> GameActionAsync(string action, string? payload = null)
        => await Invoke("GameAction", action, payload);

    public async Task<HubResult> PromoteToHostAsync()
        => await Invoke("PromoteToHost");

    public async Task LeaveRoomGroupAsync(string roomCode)
    {
        if (_hub is { State: HubConnectionState.Connected })
            await _hub.InvokeAsync("LeaveRoomGroup", roomCode);
    }

    private async Task<HubResult> Invoke(string method, params object?[] args)
    {
        if (_hub is null || _hub.State != HubConnectionState.Connected)
            return new HubResult(false, "Not connected.");
        try
        {
            return await _hub.InvokeCoreAsync<HubResult>(method, args);
        }
        catch (Exception ex)
        {
            return new HubResult(false, ex.Message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_hub is not null)
            await _hub.DisposeAsync();
    }
}
