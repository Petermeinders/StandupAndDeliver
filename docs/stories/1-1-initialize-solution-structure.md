# Story 1.1: Initialize Solution Structure

Status: review

## Story

As a **developer**,
I want a 4-project .NET 10 solution initialized with correct references,
so that all subsequent development has a consistent, buildable foundation.

## Acceptance Criteria

1. Running `dotnet build` from solution root succeeds with 0 errors across all 4 projects.
2. Project references are correct: `StandupAndDeliver` (server) → `StandupAndDeliver.Shared`; `StandupAndDeliver.Client` (WASM) → `StandupAndDeliver.Shared`; `StandupAndDeliver.Tests` → both `StandupAndDeliver` and `StandupAndDeliver.Client`.
3. The following 4 projects exist in the solution: `StandupAndDeliver` (ASP.NET Core host), `StandupAndDeliver.Client` (Blazor WASM), `StandupAndDeliver.Shared` (class library), `StandupAndDeliver.Tests` (xUnit).
4. The folder structure under each project matches the architecture spec (Controllers/, Hubs/, Services/, Data/, wwwroot/ for server; Pages/, Components/, Services/, Interop/, wwwroot/ for client; DTOs/, Interfaces/, Enums/ for shared; Hubs/, Services/, Integration/, Components/ for tests).
5. `dotnet test` runs (0 tests is acceptable) without build errors.

## Tasks / Subtasks

- [x] Task 1: Create solution and server+client Blazor projects (AC: 1, 3)
  - [x] Run `dotnet new sln -n StandupAndDeliver` at solution root
  - [x] Run `dotnet new blazor --interactivity WebAssembly -n StandupAndDeliver -o StandupAndDeliver --framework net10.0`
  - [x] Run `dotnet sln add StandupAndDeliver/StandupAndDeliver.csproj`
  - [x] Run `dotnet sln add StandupAndDeliver.Client/StandupAndDeliver.Client.csproj`

- [x] Task 2: Create Shared class library and Tests project (AC: 3)
  - [x] Run `dotnet new classlib -n StandupAndDeliver.Shared -f net10.0`
  - [x] Run `dotnet sln add StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj`
  - [x] Run `dotnet new xunit -n StandupAndDeliver.Tests -f net10.0`
  - [x] Run `dotnet sln add StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj`

- [x] Task 3: Wire up project references (AC: 2)
  - [x] Run `dotnet add StandupAndDeliver/StandupAndDeliver.csproj reference StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj`
  - [x] Run `dotnet add StandupAndDeliver.Client/StandupAndDeliver.Client.csproj reference StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj`
  - [x] Run `dotnet add StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj reference StandupAndDeliver/StandupAndDeliver.csproj`
  - [x] Run `dotnet add StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj reference StandupAndDeliver.Client/StandupAndDeliver.Client.csproj`

- [x] Task 4: Create required folder structure (AC: 4)
  - [x] Server: create `Controllers/`, `Hubs/`, `Services/`, `Data/` folders (with `.gitkeep` or placeholder files)
  - [x] Client: verify `Pages/`, `Components/` exist; create `Services/`, `Interop/` folders
  - [x] Shared: create `DTOs/`, `Interfaces/`, `Enums/` folders
  - [x] Tests: create `Hubs/`, `Services/`, `Integration/`, `Components/` folders

- [x] Task 5: Verify build and tests pass (AC: 1, 5)
  - [x] Run `dotnet build` from solution root — confirm 0 errors
  - [x] Run `dotnet test` from solution root — confirm no build errors (0 tests acceptable)

## Dev Notes

### Critical: Template Command Change in .NET 8+

**`dotnet new blazorwasm --hosted` was removed in .NET 8.** Do NOT use it. The modern replacement is:

```bash
dotnet new blazor --interactivity WebAssembly -n StandupAndDeliver -o StandupAndDeliver --framework net10.0
```

This produces a **2-project output** (`StandupAndDeliver/` server + `StandupAndDeliver.Client/` WASM client) in the `StandupAndDeliver/` output folder. The Shared library must be created separately as shown in Task 2.

**Working directory matters:** Run all `dotnet new` commands from the solution root (the directory containing `StandupAndDeliver.sln`). The `blazor --interactivity WebAssembly` command outputs to `-o StandupAndDeliver` relative to your working directory.

### Resulting Directory Layout

After all tasks complete, the solution root should look like:

```
StandupAndDeliver/                       ← solution root
├── StandupAndDeliver.sln
├── StandupAndDeliver/                   ← server project
│   ├── StandupAndDeliver.csproj
│   ├── Program.cs
│   ├── Controllers/
│   ├── Hubs/
│   ├── Services/
│   ├── Data/
│   └── wwwroot/
├── StandupAndDeliver.Client/            ← WASM client project
│   ├── StandupAndDeliver.Client.csproj
│   ├── Program.cs
│   ├── Pages/
│   ├── Components/
│   ├── Services/
│   ├── Interop/
│   └── wwwroot/
├── StandupAndDeliver.Shared/            ← shared class library
│   ├── StandupAndDeliver.Shared.csproj
│   ├── DTOs/
│   ├── Interfaces/
│   └── Enums/
└── StandupAndDeliver.Tests/             ← xUnit test project
    ├── StandupAndDeliver.Tests.csproj
    ├── Hubs/
    ├── Services/
    ├── Integration/
    └── Components/
```

### What the `blazor --interactivity WebAssembly` Template Generates

The template creates boilerplate Blazor components (Counter, Weather, etc.) and a default layout. **Do not delete these yet** — they confirm the template ran correctly and the project builds. They will be replaced in later stories. The key outputs to verify:
- `StandupAndDeliver/Program.cs` — server entry point with Blazor WASM hosting configured
- `StandupAndDeliver.Client/Program.cs` — WASM client entry point
- `StandupAndDeliver.Client/wwwroot/index.html` — WASM bootstrap shell (keep this)

### Project Reference Validation

After Task 3, open each `.csproj` and confirm `<ProjectReference>` elements are present:

```xml
<!-- StandupAndDeliver.csproj must contain -->
<ProjectReference Include="..\StandupAndDeliver.Shared\StandupAndDeliver.Shared.csproj" />

<!-- StandupAndDeliver.Client.csproj must contain -->
<ProjectReference Include="..\StandupAndDeliver.Shared\StandupAndDeliver.Shared.csproj" />

<!-- StandupAndDeliver.Tests.csproj must contain both -->
<ProjectReference Include="..\StandupAndDeliver\StandupAndDeliver.csproj" />
<ProjectReference Include="..\StandupAndDeliver.Client\StandupAndDeliver.Client.csproj" />
```

### Placeholder Files for Empty Folders

Git does not track empty directories. Use `.gitkeep` files or placeholder `_placeholder.txt` files in each new empty folder so the structure is preserved when committed:

```bash
touch StandupAndDeliver/Controllers/.gitkeep
touch StandupAndDeliver/Hubs/.gitkeep
# etc.
```

Alternatively, add a simple `README.md` in each folder noting its intended contents.

### No Code Changes to Existing Template Files

This story is **structure only**. Do not modify `Program.cs`, add NuGet packages, configure SignalR, or implement any logic. Those are Story 1.2 and beyond. The goal is a clean scaffold that builds and tests pass.

### .NET Version Verification

Confirm .NET 10 SDK is installed before starting:

```bash
dotnet --version   # must be 10.x.x
dotnet --list-sdks # should show net10.0 available
```

If only .NET 8 or 9 is installed, the `--framework net10.0` flag will fail.

### Testing Framework Note

The `dotnet new xunit` template adds `xunit`, `xunit.runner.visualstudio`, and `Microsoft.NET.Test.Sdk` by default. No additional packages needed for this story. The Tests project will have no test classes yet — that is expected and `dotnet test` will report "No test matches the given testcase filter".

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `dotnet new sln` in .NET 10 creates `.slnx` format by default; the `blazor --interactivity WebAssembly` template creates a classic `.sln`. Removed the stray outer `.slnx` and used the template's `.sln` as the solution file.
- Solution root is `C:\Users\peter\Github\StandupAndDeliver\StandupAndDeliver\` (the template outputs a nested subfolder matching `-n StandupAndDeliver`).

### Completion Notes List

- Solution created at `C:\Users\peter\Github\StandupAndDeliver\StandupAndDeliver\`
- All 4 projects scaffolded: server (ASP.NET Core Blazor host), client (Blazor WASM), shared (class library), tests (xUnit)
- All project references wired: Server→Shared, Client→Shared, Tests→Server+Client. Server also references Client (Blazor hosting requirement).
- All architecture-spec folder stubs created with `.gitkeep` files
- `dotnet build` — 0 errors, 0 warnings, all 4 projects
- `dotnet test` — 1 passed (xUnit template default test), 0 failed

### File List

- `StandupAndDeliver/StandupAndDeliver.sln`
- `StandupAndDeliver/StandupAndDeliver/StandupAndDeliver.csproj`
- `StandupAndDeliver/StandupAndDeliver/Controllers/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver/Hubs/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver/Services/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver/Data/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Client/StandupAndDeliver.Client.csproj`
- `StandupAndDeliver/StandupAndDeliver.Client/Services/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Client/Interop/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Client/Components/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj`
- `StandupAndDeliver/StandupAndDeliver.Shared/DTOs/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Shared/Interfaces/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Shared/Enums/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj`
- `StandupAndDeliver/StandupAndDeliver.Tests/Hubs/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Tests/Services/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Tests/Integration/.gitkeep`
- `StandupAndDeliver/StandupAndDeliver.Tests/Components/.gitkeep`
