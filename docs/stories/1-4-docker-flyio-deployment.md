# Story 1.4: Docker & Fly.io Deployment

Status: review

## Story

As a **developer**,
I want the application containerized and deployable to Fly.io,
So that local development uses `docker compose up` and production deployment works via `fly deploy`.

## Acceptance Criteria

1. Running `docker compose up` from the solution root builds and starts the app accessible at `http://localhost:8080` and `/health` returns `200 OK`.
2. The multi-stage `Dockerfile` at solution root produces a final image containing only the published application (no SDK, no source files).
3. `fly.toml` exists at solution root with correct app config for Fly.io deployment.
4. Environment variables override `appsettings.json` values at runtime.
5. `dotnet build` from solution root succeeds with 0 errors.

## Tasks / Subtasks

- [x] Task 1: Write multi-stage `Dockerfile` (AC: 1, 2, 4)
  - [x] Create `Dockerfile` at solution root with build + runtime stages
  - [x] Create `.dockerignore` to exclude `bin/`, `obj/`, `.git/`

- [x] Task 2: Write `docker-compose.yml` (AC: 1)
  - [x] Create `docker-compose.yml` at solution root mapping container port 8080 → host port 8080

- [x] Task 3: Write `fly.toml` (AC: 3)
  - [x] Create `fly.toml` at solution root with app name, port, and health check config

- [x] Task 4: Add `.gitignore` (AC: 5)
  - [x] Create `.gitignore` at solution root with standard .NET ignores

- [x] Task 5: Verify build (AC: 5)
  - [x] Run `dotnet build` from solution root — confirm 0 errors

## Dev Notes

### Solution Root Location

All files go in `C:\Users\peter\Github\StandupAndDeliver\StandupAndDeliver\` — this is the solution root containing `StandupAndDeliver.sln`.

### Multi-Stage `Dockerfile`

The build stage must copy the full solution (all 4 projects) before restoring, to satisfy project references. The publish target is the server project `StandupAndDeliver/StandupAndDeliver.csproj` — publishing it also pulls in the Blazor WASM client bundle via the `Microsoft.AspNetCore.Components.WebAssembly.Server` reference.

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy solution and all project files first for layer caching
COPY StandupAndDeliver.sln ./
COPY StandupAndDeliver/StandupAndDeliver.csproj StandupAndDeliver/
COPY StandupAndDeliver.Client/StandupAndDeliver.Client.csproj StandupAndDeliver.Client/
COPY StandupAndDeliver.Shared/StandupAndDeliver.Shared.csproj StandupAndDeliver.Shared/
COPY StandupAndDeliver.Tests/StandupAndDeliver.Tests.csproj StandupAndDeliver.Tests/
RUN dotnet restore

# Copy remaining source and publish
COPY . .
RUN dotnet publish StandupAndDeliver/StandupAndDeliver.csproj -c Release -o /app/publish --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "StandupAndDeliver.dll"]
```

### `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
```

### `fly.toml`

Fly.io uses port 8080 by default for .NET apps. The health check path matches Story 1.3's `/health` endpoint:

```toml
app = "standup-and-deliver"
primary_region = "syd"

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1

[checks]
  [checks.health]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"
    port = 8080
    timeout = "5s"
    type = "http"
```

### `.dockerignore`

```
**/bin/
**/obj/
**/.git/
**/.vs/
**/node_modules/
*.md
.gitignore
docker-compose*.yml
fly.toml
```

### `.gitignore`

Standard .NET gitignore covering `bin/`, `obj/`, `.vs/`, `*.user`, publish output, SQLite db file:

```
**/bin/
**/obj/
.vs/
*.user
*.suo
*.userosscache
*.sln.docstates
publish/
app.db
```

### Environment Variable Override

ASP.NET Core's configuration system automatically maps environment variables to `appsettings.json` values using double-underscore as separator. E.g. `ConnectionStrings__DefaultConnection=...` overrides `appsettings.json`'s `ConnectionStrings.DefaultConnection`. No code change needed — this is built into `WebApplication.CreateBuilder`.

### Port Note

Since .NET 8+, ASP.NET Core container images default to port 8080 (not 80). The `ENV ASPNETCORE_URLS=http://+:8080` in the Dockerfile makes this explicit.

### AC 1 Verification

AC 1 (docker compose up → localhost:8080 working) requires Docker to be installed and running. `dotnet build` (AC 5) is the CI-verifiable gate for this story. AC 1 is verified manually.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Template had already generated a good `.gitignore` — appended SQLite db entries (`app.db`, `app.db-shm`, `app.db-wal`) rather than replacing.
- `ASPNETCORE_URLS=http://+:8080` set explicitly in Dockerfile — since .NET 8+ the ASP.NET Core runtime image defaults to 8080, but explicit is clearer.

### Completion Notes List

- Multi-stage `Dockerfile` at solution root: SDK build stage → aspnet runtime stage; final image contains only published output
- `.dockerignore` excludes `bin/`, `obj/`, `.git/`, `.vs/` for clean context
- `docker-compose.yml` maps port 8080 → 8080 with `ASPNETCORE_ENVIRONMENT=Production`
- `fly.toml` configured for `standup-and-deliver` app, region `syd`, 512mb VM, health check at `/health`
- `.gitignore` extended with SQLite db file entries
- `dotnet build` — 0 errors, 0 warnings
- AC 1 (`docker compose up` → localhost:8080) requires Docker running — verified manually when Docker is available

### File List

- `StandupAndDeliver/Dockerfile` (new)
- `StandupAndDeliver/.dockerignore` (new)
- `StandupAndDeliver/docker-compose.yml` (new)
- `StandupAndDeliver/fly.toml` (new)
- `StandupAndDeliver/.gitignore` (modified — added SQLite db entries)
