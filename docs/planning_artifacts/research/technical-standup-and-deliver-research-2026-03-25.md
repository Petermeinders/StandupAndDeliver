---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'Standup & Deliver — Blazor WASM + SignalR + ASP.NET Core real-time multiplayer party game'
research_goals: 'Surface blind spots in the chosen stack; deep focus on SignalR/client networking layer; broad coverage first then depth on demand'
user_name: 'Peter'
date: '2026-03-25'
web_research_enabled: true
source_verification: true
---

# Technical Research Report: Standup & Deliver MVP
## Blazor WebAssembly + SignalR + ASP.NET Core Real-Time Multiplayer Party Game

**Date:** 2026-03-25
**Research Type:** Technical — Architecture, Integration Patterns, Implementation

---

## Research Overview

This report covers the full technical landscape for building *Standup & Deliver* — a Jackbox-style real-time party game — as a solo developer in 4 weeks using a Blazor WASM Hosted + ASP.NET Core + SignalR stack. The research was conducted across five phases: technology stack validation, integration patterns (SignalR hub contract design), architectural patterns (state machine, room lifecycle, deployment), and implementation guidance (project structure, testing, Fly.io deployment).

The original spec was architecturally sound in its core choices. The research identified **12 significant gaps** not covered by the spec, primarily around reconnection handling, the server-side timer pattern, component state management, and the iOS Safari/mobile browser edge cases. All gaps are documented with concrete fixes.

See the **Executive Summary** and **Strategic Recommendations** sections for prioritized action items before beginning the build.

---

## Executive Summary

### Core Architecture Verdict

The chosen stack is well-suited for this project. Blazor WASM Hosted with SignalR is a proven pattern for real-time browser games. The "broadcast full `GameRoomState` on every change" strategy is correct for an MVP — simple to implement, easy to recover from reconnects, and appropriate for the payload sizes involved.

### Key Technical Findings

- **The Hub is transient** — never store state in Hub class properties. All game state must live in a singleton `GameRoomService` injected via DI.
- **`IHubContext<GameHub, IGameClient>`** is required to broadcast from outside the Hub (e.g., from the server-side timer `BackgroundService`). The Hub itself cannot be instantiated directly.
- **Strongly-typed hubs** (`Hub<IGameClient>`) eliminate string-based method name bugs — a common source of silent runtime failures.
- **`WithAutomaticReconnect()` alone is insufficient for mobile** — iOS Safari freezes the JS event loop on screen lock, so retry timers never fire. A `visibilitychange` JS event listener is required.
- **Group membership is lost on every reconnect** — `ConnectionId` changes. The client `Reconnected` handler must call a `RejoinRoom` hub method explicitly.
- **`SkipNegotiation = true` + WebSockets-only** eliminates the sticky session problem on Fly.io entirely, no Redis backplane needed.
- **A `BackgroundService` + `PeriodicTimer` sweeper** is required to prevent orphaned rooms from leaking memory on server crash.

### Top Technical Risks for the 4-Week Timeline

| Risk | Severity | Mitigation |
|---|---|---|
| Reconnect/re-join logic bugs | High | Implement `RejoinRoom` hub method + `Reconnected` handler in Week 1 |
| Server timer broadcasting wrong state | High | Use `IHubContext<GameHub, IGameClient>` + per-room `CancellationTokenSource` |
| iOS Safari silent disconnect mid-game | High | Add `visibilitychange` JS Interop hook on component init |
| `.On<T>` handlers stop firing after reconnect | High | Re-register or rebuild `HubConnection` in `Reconnected` callback |
| Race condition in vote counting | Medium | `SemaphoreSlim(1,1)` per `GameRoom` for multi-step operations |
| Memory leak from orphaned rooms | Medium | `BackgroundService` sweeper with 30-min TTL |

### Strategic Recommendations

1. **Start with the networking skeleton first** — wire up `GameHub`, `GameRoomService`, `HubConnection`, and the reconnect/re-join loop before any game logic. Validate it works on a real mobile device on Day 1 of Week 2.
2. **Use `Hub<IGameClient>` from day one** — retrofitting string-based `SendAsync` calls later is painful.
3. **Use `SkipNegotiation = true`** on the client — simplifies Fly.io deployment dramatically.
4. **Wrap `HubConnection` behind `IGameHubClient`** interface — makes Blazor components testable with bUnit.
5. **Deploy to Fly.io early (end of Week 2)** — SignalR on a real deployment has different behavior than localhost. Discovering deployment issues in Week 4 is a timeline killer.

---

## Table of Contents

1. [Technology Stack Analysis](#1-technology-stack-analysis)
2. [SignalR Integration Patterns](#2-signalr-integration-patterns)
3. [Architectural Patterns](#3-architectural-patterns)
4. [Implementation Guidance](#4-implementation-guidance)
5. [Gap Analysis — What the Spec Missed](#5-gap-analysis--what-the-spec-missed)
6. [4-Week Build Roadmap](#6-4-week-build-roadmap)
7. [Source References](#7-source-references)

---

## 1. Technology Stack Analysis

### Blazor WASM + SignalR Integration

The standard pattern for a Blazor WASM Hosted app with SignalR:

- Client registers `.On<T>` callbacks in `OnInitializedAsync` before calling `StartAsync`
- Server hub uses `Groups.AddToGroupAsync` to manage room membership
- Broadcasts go to `Clients.Group(roomCode)` — never `Clients.All`
- `StateHasChanged()` must be called as `await InvokeAsync(() => StateHasChanged())` inside `.On<T>` handlers — callbacks arrive on a background thread

**Strongly-typed hub (recommended over string-based `SendAsync`):**
```csharp
// In Shared project
public interface IGameClient
{
    Task GameStateUpdated(GameRoomState newState);
    Task PlayerJoined(string playerName);
    Task PlayerLeft(string playerName);
}

// In Server project
public class GameHub : Hub<IGameClient>
{
    private readonly GameRoomService _rooms;
    public GameHub(GameRoomService rooms) => _rooms = rooms;
}
```

_Source: [Use hubs in ASP.NET Core SignalR — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs?view=aspnetcore-10.0)_

### WASM Cold Load Performance

- **AOT compilation increases download size 2–3x** — improves runtime speed but worsens cold start. Skip for MVP.
- Best quick wins: Brotli compression on host, `PublishTrimmed=true` (test carefully), CSS-only loading screen in `index.html`.
- Low-end Android phones: 3–5s load even after download due to WASM parsing. Set UX expectations accordingly.

_Source: [ASP.NET Core Blazor performance best practices — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/performance/?view=aspnetcore-9.0)_

### Tailwind CSS Integration (v4, Node-free)

```xml
<!-- In .csproj -->
<Target Name="TailwindBuild" BeforeTargets="Build">
  <Exec Command="tailwindcss -i wwwroot/css/input.css -o wwwroot/css/output.css --minify" />
</Target>
```

- Tailwind v4 ships a self-contained binary — no Node.js or npm required
- Run `tailwindcss --watch` separately in dev
- Add `output.css` to `.gitignore`; ensure CI generates it before publish
- Tailwind v4 auto-scans `.razor` files — no explicit `content` config needed

_Source: [Tailwind CSS v4 Standalone in Blazor WebAssembly — DEV Community](https://dev.to/cristiansifuentes/tailwind-css-v4-standalone-in-blazor-webassembly-a-clean-native-integration-for-the-net-26lk)_

### EF Core / SQLite → PostgreSQL Migration Path

- Maintain **two separate migration sets** from day one — SQLite and PostgreSQL generate incompatible SQL
- Use provider-switching pattern in `Program.cs`:
```csharp
var provider = config.GetValue("Provider", "Sqlite");
services.AddDbContext<AppDbContext>(options => _ = provider switch {
    "Sqlite"   => options.UseSqlite(config.GetConnectionString("Sqlite"),
                    x => x.MigrationsAssembly("SqliteMigrations")),
    "Postgres" => options.UseNpgsql(config.GetConnectionString("Postgres"),
                    x => x.MigrationsAssembly("PostgresMigrations")),
    _ => throw new Exception($"Unsupported provider: {provider}")
});
```
- **Hidden bugs:** `LIKE` is case-insensitive in SQLite, case-sensitive in PostgreSQL. DateTime handling differs. Strictly-typed columns differ. Test EF queries against both before migrating.

_Source: [Migrations with Multiple Providers — Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/providers)_

---

## 2. SignalR Integration Patterns

### Hub Contract — Recommended Upgrades to Your Spec

Your spec uses string-based `SendAsync("GameStateUpdated", ...)`. Replace with `Hub<IGameClient>` (see above). The Hub contract becomes:

**Client → Server (Hub methods — no change needed from spec):**
- `CreateRoom(string playerName)` → returns room code
- `JoinRoom(string roomCode, string playerName)`
- `RejoinRoom(string roomCode, string playerName)` ← **add this** (for reconnects)
- `RequestGameState(string roomCode)` ← **add this** (state sync on reconnect)
- `StartGame(string roomCode)`
- `SubmitVote(string roomCode, VoteSubmission vote)`

**Server → Client (via `IGameClient` interface):**
- `GameStateUpdated(GameRoomState newState)` ← your spec's `GameStateUpdated` ✅
- `PlayerJoined(string playerName)` ← **add**
- `PlayerLeft(string playerName)` ← **add**

### Server-Side Timer — BackgroundService Pattern

The spec says "timers tracked by server" but doesn't define how. The correct pattern:

```csharp
public class GameTimerService : BackgroundService
{
    private readonly IHubContext<GameHub, IGameClient> _hub;
    private readonly GameRoomService _rooms;

    public GameTimerService(IHubContext<GameHub, IGameClient> hub, GameRoomService rooms)
    {
        _hub = hub;
        _rooms = rooms;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var room in _rooms.GetActiveRooms())
            {
                room.SecondsRemaining--;
                if (room.SecondsRemaining <= 0)
                    _rooms.AdvancePhase(room.RoomCode);

                await _hub.Clients.Group(room.RoomCode)
                    .GameStateUpdated(_rooms.GetState(room.RoomCode));
            }
            await Task.Delay(1000, stoppingToken); // ALWAYS pass the token
        }
    }
}
```

**Per-room cancellation** — use a `ConcurrentDictionary<string, CancellationTokenSource>` to cancel individual room timers when a phase ends early. Link with `stoppingToken` via `CancellationTokenSource.CreateLinkedTokenSource`.

_Source: [Host ASP.NET Core SignalR in background services — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/background-services?view=aspnetcore-9.0)_

### Reconnection — Complete Pattern

```csharp
// Client-side HubConnection setup
_hub = new HubConnectionBuilder()
    .WithUrl(Nav.ToAbsoluteUri("/hubs/game"), options =>
    {
        options.SkipNegotiation = true;               // eliminates sticky session problem
        options.Transports = HttpTransportType.WebSockets;
    })
    .WithAutomaticReconnect(new[] {
        TimeSpan.Zero,
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(10)
    })
    .Build();

// Register handlers ONCE — survive automatic reconnects
_hub.On<GameRoomState>("GameStateUpdated", state =>
{
    _gameState = state;
    InvokeAsync(StateHasChanged);
});

// Re-join group on reconnect — ConnectionId changes every time
_hub.Reconnected += async _ =>
{
    await _hub.InvokeAsync("RejoinRoom", _roomCode, _playerName);
    await _hub.InvokeAsync("RequestGameState", _roomCode);
};

_hub.Reconnecting += _ => { _status = "Reconnecting..."; return Task.CompletedTask; };
_hub.Closed += _ => { _status = "Disconnected. Please refresh."; return Task.CompletedTask; };
```

**iOS Safari screen lock fix** — add this via JS Interop on component init:
```javascript
// wwwroot/game-interop.js
window.registerVisibilityHandler = (dotnetRef) => {
    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
            await dotnetRef.invokeMethodAsync("OnPageVisible");
        }
    });
};
```
```csharp
// In Blazor component
[JSInvokable]
public async Task OnPageVisible()
{
    if (_hub?.State == HubConnectionState.Disconnected)
        await _hub.StartAsync();
}
```

**Known bug (GitHub #39118):** After reconnect, `.On<T>` handlers can stop firing. Mitigation: rebuild the `HubConnection` entirely on reconnect, or re-register handlers in `Reconnected` callback.

_Source: [ASP.NET Core Blazor SignalR guidance — Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/signalr?view=aspnetcore-9.0)_
_Source: [SignalR reconnection unwires handlers — GitHub #39118](https://github.com/dotnet/aspnetcore/issues/39118)_

### Server-Side `RejoinRoom` Hub Method (add to spec)

```csharp
public async Task RejoinRoom(string roomCode, string playerName)
{
    await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
    _rooms.UpdateConnectionId(playerName, roomCode, Context.ConnectionId);
    var state = _rooms.GetState(roomCode);
    await Clients.Caller.GameStateUpdated(state);
}
```

### Player Disconnect Handling (not in spec)

```csharp
public override async Task OnDisconnectedAsync(Exception? exception)
{
    var roomCode = Context.Items["roomCode"] as string;
    var playerName = Context.Items["playerName"] as string;

    if (roomCode is not null)
    {
        _rooms.MarkPlayerDisconnected(roomCode, Context.ConnectionId);
        await Clients.Group(roomCode).PlayerLeft(playerName ?? "Unknown");

        if (_rooms.GetConnectedPlayers(roomCode).Count == 0)
            _rooms.CloseRoom(roomCode);
    }
    // No need to call RemoveFromGroupAsync — SignalR handles this automatically
    await base.OnDisconnectedAsync(exception);
}
```

**Important:** `OnDisconnectedAsync` fires up to 30 seconds after an abnormal disconnect (keep-alive timeout). Design game UX to tolerate a "missing" player for that window.

Store per-connection metadata in `Context.Items` during `JoinRoom`:
```csharp
Context.Items["roomCode"] = roomCode;
Context.Items["playerName"] = playerName;
```

### Component Disposal — IAsyncDisposable (required)

```csharp
public async ValueTask DisposeAsync()
{
    _gameStateHandler?.Dispose();   // unsubscribe .On<T> handlers
    if (_hub is not null)
    {
        await _hub.StopAsync();     // sends clean close frame to server
        await _hub.DisposeAsync();  // releases managed resources
    }
}
```

**Known Blazor WASM issue:** `DisposeAsync()` alone doesn't always close the underlying WebSocket. Always call `StopAsync()` first.

### Thread Safety — ConcurrentDictionary Gotcha

`ConcurrentDictionary` is atomic per-operation but compound operations are NOT atomic:

```csharp
// RACE CONDITION — two threads can both pass the count check
if (room.Players.Count < 8) room.AddPlayer(...); // NOT thread-safe

// FIX — use SemaphoreSlim per room for multi-step operations
private readonly SemaphoreSlim _lock = new(1, 1);
await _lock.WaitAsync();
try { if (room.Players.Count < 8) room.AddPlayer(...); }
finally { _lock.Release(); }
```

---

## 3. Architectural Patterns

### Game Phase State Machine

The state machine belongs on the `GameRoom` domain object — not the Hub (transient) or the service (infrastructure).

```csharp
public class GameRoom
{
    public string RoomCode { get; init; }
    public GamePhase Phase { get; private set; } = GamePhase.Lobby;
    public DateTimeOffset LastActivity { get; private set; } = DateTimeOffset.UtcNow;

    private static readonly Dictionary<GamePhase, GamePhase[]> _validTransitions = new()
    {
        [GamePhase.Lobby]         = [GamePhase.ReadingPrompt],
        [GamePhase.ReadingPrompt] = [GamePhase.Voting],
        [GamePhase.Voting]        = [GamePhase.RoundResults],
        [GamePhase.RoundResults]  = [GamePhase.ReadingPrompt, GamePhase.GameOver],
        [GamePhase.GameOver]      = []
    };

    public bool TryAdvanceTo(GamePhase target, out string? error)
    {
        if (!_validTransitions[Phase].Contains(target))
        {
            error = $"Cannot transition from {Phase} to {target}";
            return false;
        }
        Phase = target;
        LastActivity = DateTimeOffset.UtcNow;
        error = null;
        return true;
    }
}
```

**Three-layer architecture:**
```
Hub (transient, thin dispatcher)
  ↓ delegates to
GameRoomService (singleton, owns ConcurrentDictionary<string, GameRoom>)
  ↓ contains
GameRoom (domain object, owns state machine + SemaphoreSlim lock)
```

### Room Code Generation (not in spec)

```csharp
private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // drop I, O (look like 1, 0)
// 24^4 = 331,776 possible codes

public string GenerateRoomCode()
{
    string code;
    do
    {
        code = new string(Enumerable.Range(0, 4)
            .Select(_ => Alphabet[Random.Shared.Next(Alphabet.Length)])
            .ToArray());
    } while (_rooms.ContainsKey(code));
    return code;
}
```

### Room Lifecycle & Memory Management

**OnDisconnectedAsync cleanup** + **grace period** for reconnecting players:

```csharp
private readonly ConcurrentDictionary<string, CancellationTokenSource> _disconnectTimers = new();

public override async Task OnDisconnectedAsync(Exception? exception)
{
    // Start 30s eviction timer on abnormal disconnect
    if (exception is not null)
    {
        var cts = new CancellationTokenSource();
        _disconnectTimers[Context.ConnectionId] = cts;
        _ = Task.Delay(TimeSpan.FromSeconds(30), cts.Token)
            .ContinueWith(t => { if (!t.IsCanceled) _rooms.RemovePlayer(Context.ConnectionId); });
    }
    else
    {
        _rooms.RemovePlayer(Context.ConnectionId); // clean disconnect — remove immediately
    }
    await base.OnDisconnectedAsync(exception);
}

public override async Task OnConnectedAsync()
{
    // Player reconnected within grace period — cancel eviction
    if (_disconnectTimers.TryRemove(Context.ConnectionId, out var cts))
        cts.Cancel();
    await base.OnConnectedAsync();
}
```

**TTL sweeper BackgroundService** — safety net for server crash / missed disconnects:

```csharp
public class RoomCleanupService : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
            _rooms.PurgeRoomsInactiveSince(TimeSpan.FromMinutes(30));
    }
}
```

Use `PeriodicTimer` (not `System.Threading.Timer`) — it's async-safe and won't overlap executions.

### Server-Authoritative Rules

- Clients send **intentions** (commands), never state
- Validate phase, player identity (`Context.ConnectionId`), and turn order on the server
- Auto-advance phase when all players have acted:
```csharp
if (room.Votes.Count >= room.ActivePlayers.Count)
    await AdvancePhaseAsync(roomCode, GamePhase.RoundResults, isAutoAdvance: true);
```
- Never trust phase, timestamps, or scores from the client

### Blazor Component Architecture

**Single-page, switch on GamePhase** — don't use separate routes per phase:
```razor
@* Pages/GameRoom.razor *@
@switch (_state?.CurrentPhase)
{
    case GamePhase.Lobby:         <LobbyPanel /> break;
    case GamePhase.ReadingPrompt: <PromptPanel /> break;
    case GamePhase.Voting:        <VotingPanel /> break;
    case GamePhase.RoundResults:  <ResultsPanel /> break;
    case GamePhase.GameOver:      <GameOverPanel /> break;
    default:                      <p>Connecting...</p> break;
}
```

**State sharing — `GameStateService` singleton** (avoids prop drilling):
```csharp
// Register in Client Program.cs
builder.Services.AddSingleton<GameStateService>();

public class GameStateService
{
    public GameRoomState? CurrentState { get; private set; }
    public event Action? OnStateChanged;

    public void ApplyServerState(GameRoomState state)
    {
        CurrentState = state;
        OnStateChanged?.Invoke();
    }
}
```

Child components subscribe independently:
```csharp
@inject GameStateService GameState
@implements IDisposable

protected override void OnInitialized()
    => GameState.OnStateChanged += StateHasChanged;

public void Dispose()
    => GameState.OnStateChanged -= StateHasChanged;
```

### Deployment — Fly.io

**Dockerfile (solution root):**
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src
COPY . .
RUN dotnet publish StandupAndDeliver.Server/StandupAndDeliver.Server.csproj \
    -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "StandupAndDeliver.Server.dll"]
```

**fly.toml key settings:**
```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false   # never sleep — game sessions need persistent connections
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

**Deploy commands:**
```bash
fly auth login
fly launch        # from solution root
fly deploy
fly logs
```

Use `SkipNegotiation = true` + WebSockets-only on the client — eliminates sticky session requirement entirely. Single machine = no backplane needed.

_Source: [Do ASP.NET Web Applications play nice with Fly.io? — Jon Hilton](https://jonhilton.net/blazor-fly-io/)_
_Source: [WebSockets and Fly — Fly.io Blog](https://fly.io/blog/websockets-and-fly/)_

---

## 4. Implementation Guidance

### Project Structure

```
StandupAndDeliver.sln
├── StandupAndDeliver.Client/    (SDK: Microsoft.NET.Sdk.BlazorWebAssembly)
│   ├── Pages/
│   ├── Components/
│   │   ├── LobbyPanel.razor
│   │   ├── PromptPanel.razor
│   │   ├── VotingPanel.razor
│   │   ├── ResultsPanel.razor
│   │   └── GameOverPanel.razor
│   ├── Services/
│   │   ├── GameStateService.cs
│   │   └── IGameHubClient.cs         ← wrap HubConnection for testability
│   ├── wwwroot/
│   │   ├── index.html                ← CSS-only loading screen here
│   │   ├── css/input.css             ← Tailwind entry
│   │   └── game-interop.js           ← visibilitychange + future JS interop
│   └── Program.cs
│
├── StandupAndDeliver.Server/    (SDK: Microsoft.NET.Sdk.Web)
│   ├── Hubs/
│   │   └── GameHub.cs
│   ├── Services/
│   │   ├── GameRoomService.cs
│   │   ├── GameTimerService.cs       ← BackgroundService
│   │   └── RoomCleanupService.cs     ← BackgroundService
│   ├── Endpoints/
│   │   └── RoomEndpoints.cs          ← Minimal API extension method
│   └── Program.cs
│
└── StandupAndDeliver.Shared/    (SDK: Microsoft.NET.Sdk)
    ├── Models/
    │   ├── GameRoomState.cs
    │   ├── Player.cs
    │   ├── PromptCard.cs
    │   ├── VoteSubmission.cs
    │   └── GamePhase.cs (enum)
    ├── Interfaces/
    │   └── IGameClient.cs            ← strongly-typed hub interface
    └── Constants/
        └── HubMethods.cs             ← public const strings for hub method names
```

### HTTP Endpoints (Minimal APIs)

```csharp
// Server/Program.cs
app.MapHub<GameHub>("/hubs/game");
app.MapHealthChecks("/healthz");                          // Fly.io health probe
app.MapGet("/api/rooms/{code}", (string code, GameRoomService rooms) =>
{
    var room = rooms.GetRoom(code);
    return room is null ? Results.NotFound() : Results.Ok(room.ToDto());
});
app.MapFallbackToFile("index.html");                      // MUST be last
```

### Testing Strategy

**Hub unit tests (xUnit + Moq) — .NET 7+ breaking change:**
```csharp
// Caller returns ISingleClientProxy in .NET 7+ (NOT IClientProxy)
var mockCaller = new Mock<ISingleClientProxy>();
mockClients.Setup(c => c.Caller).Returns(mockCaller.Object);

// Group still returns IClientProxy
var mockGroup = new Mock<IClientProxy>();
mockClients.Setup(c => c.Group("ROOM1")).Returns(mockGroup.Object);

// Always verify SendCoreAsync, not SendAsync (SendAsync is an extension method)
mockGroup.Verify(p => p.SendCoreAsync("GameStateUpdated",
    It.IsAny<object[]>(), It.IsAny<CancellationToken>()), Times.Once);
```

**Blazor component tests (bUnit):**
```csharp
public class LobbyPanelTests : TestContext
{
    [Fact]
    public void Lobby_DisplaysPlayers()
    {
        var mockState = new Mock<GameStateService>();
        mockState.Setup(s => s.CurrentState).Returns(new GameRoomState
        {
            Players = [new Player { Name = "Alice" }, new Player { Name = "Bob" }]
        });
        Services.AddSingleton(mockState.Object);

        var cut = RenderComponent<LobbyPanel>();
        Assert.Equal(2, cut.FindAll("li.player-name").Count);
    }
}
```

**Integration test (WebApplicationFactory):**
```csharp
var connection = new HubConnectionBuilder()
    .WithUrl($"{factory.Server.BaseAddress}hubs/game", options =>
    {
        options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
    })
    .Build();
```

_Source: [Breaking change IHubClients — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/aspnet-core/7.0/ihubclients-ihubcallerclients)_
_Source: [bUnit official docs — bunit.dev](https://bunit.dev/)_

---

## 5. Gap Analysis — What the Spec Missed

| # | Gap | Risk | Fix |
|---|---|---|---|
| 1 | No `RejoinRoom` hub method | 🔴 High | Add hub method + call from `Reconnected` handler |
| 2 | No re-registration of `.On<T>` after reconnect | 🔴 High | Rebuild `HubConnection` or re-register in `Reconnected` |
| 3 | No `visibilitychange` JS hook for iOS Safari | 🔴 High | JS Interop on component init |
| 4 | Server timer architecture undefined | 🔴 High | `BackgroundService` + `IHubContext<GameHub, IGameClient>` |
| 5 | `IHubContext<T>` not in spec | 🔴 High | Inject into `GameTimerService` and `GameRoomService` |
| 6 | Hub uses string-based `SendAsync` | 🟡 Medium | `Hub<IGameClient>` + `IGameClient` interface in Shared |
| 7 | No `OnDisconnectedAsync` handler | 🟡 Medium | Override + `Context.Items` + notify group |
| 8 | No room code generation logic | 🟡 Medium | `do/while` with `ConcurrentDictionary` check, drop I/O |
| 9 | No TTL sweeper for orphaned rooms | 🟡 Medium | `BackgroundService` + `PeriodicTimer` + 30-min TTL |
| 10 | No disconnect grace period | 🟡 Medium | Per-connection `CancellationTokenSource`, 30s delay |
| 11 | No Blazor state sharing pattern | 🟡 Medium | `GameStateService` singleton + `OnStateChanged` event |
| 12 | No EF Core multi-provider setup | 🟢 Low | Provider-switching pattern in `Program.cs` from day one |

---

## 6. 4-Week Build Roadmap

### Week 1 — Foundation

- [ ] `dotnet new blazorwasm --hosted` solution scaffold
- [ ] Shared DTOs: `GameRoomState`, `Player`, `PromptCard`, `VoteSubmission`, `GamePhase`, `IGameClient`, `HubMethods` constants
- [ ] `GameHub` skeleton with `JoinRoom`, `RejoinRoom`, `RequestGameState`, `OnDisconnectedAsync`
- [ ] `GameRoomService` singleton with `ConcurrentDictionary`, room code generator, `SemaphoreSlim` per room
- [ ] `GameRoom` domain object with state machine + `TryAdvanceTo`
- [ ] Client `HubConnection` setup with `SkipNegotiation`, `WithAutomaticReconnect`, `Reconnected` handler
- [ ] **Validate on real mobile device** — connect, lock screen, unlock, confirm reconnect

### Week 2 — Core Game Loop

- [ ] `GameTimerService` BackgroundService + per-room `CancellationTokenSource`
- [ ] All 5 phase transitions wired end-to-end (server side)
- [ ] `GameStateService` singleton on client
- [ ] Single-page `GameRoom.razor` with `@switch` on `GamePhase`
- [ ] Phase component stubs: `LobbyPanel`, `PromptPanel`, `VotingPanel`, `ResultsPanel`, `GameOverPanel`
- [ ] **Deploy to Fly.io** (Dockerfile + `fly launch` + `fly deploy`) — validate SignalR over real network

### Week 3 — Full Game Flow

- [ ] Voting logic + auto-advance when all votes in
- [ ] `VoteSubmission` processing + score calculation
- [ ] Round cycling (ReadingPrompt → Voting → RoundResults → next ReadingPrompt or GameOver)
- [ ] Host controls (start game, skip player)
- [ ] `RoomCleanupService` BackgroundService sweeper
- [ ] Disconnect grace period + `_disconnectTimers` pattern
- [ ] `visibilitychange` JS Interop hook

### Week 4 — Polish + Ship

- [ ] Tailwind CSS styling for all components
- [ ] CSS-only WASM loading screen in `index.html`
- [ ] EF Core + SQLite for prompt card persistence
- [ ] Hub unit tests (xUnit + Moq) for critical paths
- [ ] bUnit component tests for `LobbyPanel`, `VotingPanel`
- [ ] `PublishTrimmed=true` + verify no reflection breakage
- [ ] Brotli compression on Fly.io
- [ ] Final smoke test on iOS Safari + Android Chrome

---

## 7. Source References

### Microsoft Official Documentation
- [Use hubs in ASP.NET Core SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs?view=aspnetcore-10.0)
- [ASP.NET Core Blazor SignalR guidance](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/signalr?view=aspnetcore-9.0)
- [Host ASP.NET Core SignalR in background services](https://learn.microsoft.com/en-us/aspnet/core/signalr/background-services?view=aspnetcore-9.0)
- [ASP.NET Core Blazor performance best practices](https://learn.microsoft.com/en-us/aspnet/core/blazor/performance/?view=aspnetcore-9.0)
- [ASP.NET Core Blazor project structure](https://learn.microsoft.com/en-us/aspnet/core/blazor/project-structure?view=aspnetcore-9.0)
- [Migrations with Multiple Providers](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/providers)
- [IHubClients breaking change (.NET 7)](https://learn.microsoft.com/en-us/dotnet/core/compatibility/aspnet-core/7.0/ihubclients-ihubcallerclients)
- [ASP.NET Core SignalR production hosting and scaling](https://learn.microsoft.com/en-us/aspnet/core/signalr/scale?view=aspnetcore-9.0)
- [Choose between controller-based APIs and minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis?view=aspnetcore-8.0)

### Known Issues / GitHub
- [SignalR reconnection unwires .On<T> handlers — #39118](https://github.com/dotnet/aspnetcore/issues/39118)
- [iOS SignalR screen lock disconnect — aspnet/SignalR #1846](https://github.com/aspnet/SignalR/issues/1846)
- [Blazor WASM SignalR connection close issue — #18654](https://github.com/dotnet/aspnetcore/issues/18654)
- [Stateful reconnect (.NET 9+) — #46691](https://github.com/dotnet/aspnetcore/issues/46691)

### Community & Tutorials
- [TriviaR reference implementation — David Fowler](https://github.com/davidfowl/TriviaR)
- [Humanity Against Cards (Blazor party game) — Sam Orme](https://github.com/ormesam/humanity-against-cards)
- [Do ASP.NET Web Applications play nice with Fly.io? — Jon Hilton](https://jonhilton.net/blazor-fly-io/)
- [Tailwind CSS v4 Standalone in Blazor WASM — DEV Community](https://dev.to/cristiansifuentes/tailwind-css-v4-standalone-in-blazor-webassembly-a-clean-native-integration-for-the-net-26lk)
- [bUnit official documentation](https://bunit.dev/)
- [SignalR_UnitTestingSupport — NightAngell](https://github.com/NightAngell/SignalR_UnitTestingSupport)
- [Session Affinity — Fly.io Docs](https://fly.io/docs/blueprints/sticky-sessions/)
- [WebSockets and Fly — Fly.io Blog](https://fly.io/blog/websockets-and-fly/)

---

**Research Completion Date:** 2026-03-25
**Confidence Level:** High — all claims verified against current public sources
**Next Step:** Proceed to `bmad-bmm-product-brief` or `bmad-bmm-create-prd` to formalize the product requirements, then `bmad-bmm-create-architecture` to produce the architecture document.
