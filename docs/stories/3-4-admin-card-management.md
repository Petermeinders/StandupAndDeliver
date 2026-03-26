# Story 3.4: Admin Prompt Card Management

## Status: Done

## Story
As an **administrator**, I want to add, view, and remove prompt cards via a protected admin endpoint, so that I can curate the card deck without modifying the database directly.

## Acceptance Criteria
- `GET /admin/cards` with valid credentials returns JSON list of all cards (id, text, isActive) with 200 OK.
- `POST /admin/cards` with `{ "text": "..." }` inserts a new card and returns 201 Created.
- `DELETE /admin/cards/{id}` soft-deletes (sets `IsActive = false`) and returns 204 No Content.
- Any `/admin/*` request without valid credentials returns 401 Unauthorized with `WWW-Authenticate: Basic` header.
- Credentials read from env vars `ADMIN_USERNAME` / `ADMIN_PASSWORD` (not hardcoded).

## Implementation Notes
- `AdminCardEndpoints.cs` in `StandupAndDeliver/Endpoints/`
- HTTP Basic auth via `IEndpointFilter` (`BasicAuthFilter` inner class)
- `PromptCardService` handles all DB operations
- Registered via `app.MapAdminCardEndpoints()` in `Program.cs`
