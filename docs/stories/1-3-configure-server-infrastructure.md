# Story 1.3: Configure Server Infrastructure

Status: review

## Story

As a **developer**,
I want the ASP.NET Core server configured with SignalR, Serilog, and a health check endpoint,
So that the real-time hub, structured logging, and liveness probe are ready for all subsequent stories.

## Acceptance Criteria

1. A client connecting to `/gamehub` is accepted via SignalR with `SkipNegotiation = true` and WebSocket-only transport.
2. HTTP long-polling and Server-Sent Events transports are explicitly disabled in `Program.cs`.
3. Any log event is written to the console in Serilog structured format (level, timestamp, message).
4. A GET request to `/health` returns `200 OK` with body `Healthy`.
5. `dotnet build` from solution root succeeds with 0 errors.

## Tasks / Subtasks

- [x] Task 1: Add NuGet packages (AC: 1, 3)
  - [x] Add `Microsoft.AspNetCore.SignalR` (included in ASP.NET Core meta-package — verify no explicit add needed)
  - [x] Add `Serilog.AspNetCore` package to server project

- [x] Task 2: Create placeholder `GameHub` (AC: 1, 2)
  - [x] Create `StandupAndDeliver/Hubs/GameHub.cs` as `Hub<IGameClient>` with no methods yet

- [x] Task 3: Configure `Program.cs` (AC: 1, 2, 3, 4)
  - [x] Replace builder logging with `UseSerilog()` console sink
  - [x] Register SignalR services
  - [x] Register health check services
  - [x] Map `/gamehub` with WebSocket-only transport + `SkipNegotiation`
  - [x] Map `/health` endpoint
  - [x] Keep existing Blazor WASM hosting wiring intact

- [x] Task 4: Verify build (AC: 5)
  - [x] Run `dotnet build` from solution root — confirm 0 errors

## Dev Notes

### NuGet Packages Required

`Serilog.AspNetCore` is the only explicit package addition. SignalR is part of `Microsoft.AspNetCore.App` framework reference and needs no separate package on the server.

```bash
dotnet add StandupAndDeliver/StandupAndDeliver.csproj package Serilog.AspNetCore
```

### Placeholder `GameHub`

Only a stub is needed now — hub methods come in later stories. Must inherit `Hub<IGameClient>` (not `Hub`) to establish the strongly-typed pattern from day one:

```csharp
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Hubs;

public class GameHub : Hub<IGameClient>
{
}
```

### `Program.cs` — Complete Target State

Keep all existing Blazor WASM hosting code. Add SignalR, Serilog, and health checks around it:

```csharp
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.SignalR;
using Serilog;
using StandupAndDeliver.Client.Pages;
using StandupAndDeliver.Components;
using StandupAndDeliver.Hubs;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
    configuration.WriteTo.Console());

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveWebAssemblyComponents();

builder.Services.AddSignalR();
builder.Services.AddHealthChecks();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseWebAssemblyDebugging();
}
else
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(StandupAndDeliver.Client._Imports).Assembly);

app.MapHub<GameHub>("/gamehub", options =>
{
    options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.WebSockets;
});

app.MapHealthChecks("/health");

app.Run();
```

### Why WebSocket-Only Transport

`SkipNegotiation = true` is a **client-side** setting (set in `HubConnectionBuilder` in the Blazor client — Story 7). The server side enforces WebSocket-only by setting `options.Transports = HttpTransportType.WebSockets` on `MapHub`. Together they eliminate the HTTP negotiation request, which is what makes Fly.io sticky sessions unnecessary.

### Serilog Bootstrap Logger

The `Log.Logger = new LoggerConfiguration()...CreateBootstrapLogger()` call before `WebApplication.CreateBuilder` ensures log events during startup (before the DI container is built) are captured. Without it, early startup exceptions are lost.

### Health Check Response

`MapHealthChecks("/health")` with no custom options returns `200 OK` with plain-text body `Healthy` by default — exactly what Fly.io's liveness probe expects.

### Architecture Guardrails

- Long-polling and SSE are disabled server-side by setting `Transports = HttpTransportType.WebSockets` — do not leave other transports enabled
- Use `Hub<IGameClient>` not `Hub` — even for the empty stub
- Do NOT add `app.UseRouting()` manually — `MapHub` and `MapHealthChecks` use endpoint routing which is implicit in .NET 6+

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `Serilog.AspNetCore 10.0.0` installed (matches .NET 10 target framework).
- `HttpTransportType.WebSockets` is in `Microsoft.AspNetCore.Http.Connections` namespace — required using added.

### Completion Notes List

- `Serilog.AspNetCore 10.0.0` added to server `.csproj`
- Bootstrap logger created before `WebApplication.CreateBuilder` to capture startup-phase log events
- `builder.Host.UseSerilog(...)` replaces default .NET logging with Serilog console sink
- `GameHub : Hub<IGameClient>` stub created in `Hubs/` — no methods yet, strongly-typed from day one
- `MapHub<GameHub>("/gamehub")` with `Transports = HttpTransportType.WebSockets` — long-polling and SSE disabled
- `MapHealthChecks("/health")` — returns `200 OK` / `Healthy` by default
- All existing Blazor WASM hosting wiring preserved
- `dotnet build` — 0 errors, 0 warnings

### File List

- `StandupAndDeliver/StandupAndDeliver/Program.cs` (modified)
- `StandupAndDeliver/StandupAndDeliver/Hubs/GameHub.cs` (new)
- `StandupAndDeliver/StandupAndDeliver/StandupAndDeliver.csproj` (modified — Serilog.AspNetCore added)
