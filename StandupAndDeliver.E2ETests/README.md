# StandupAndDeliver.E2ETests

Playwright-driven browser tests against the real running app (Kestrel + SignalR + Blazor WASM) —
not an in-memory `TestServer`, since SignalR's transport negotiation doesn't reliably work there.

## Running

```
dotnet test StandupAndDeliver.E2ETests
```

This runs **headed** by default (a visible Chrome window pops up and drives itself) — see
"Headless hangs" below for why. `ServerFixture` boots the real server as a subprocess on
`http://127.0.0.1:5299` (deliberately not `--no-build`, since a stale/mismatched build can leave the
Blazor static-asset manifest pointing at files that don't exist on disk — that surfaced as
`blazor.web.js` 500ing and the WASM app never booting). `BrowserFixture` launches one Chromium for
the whole run and shares it across tests — launching a fresh browser per test was an earlier cause
of widespread timeouts, since a Debug WASM build is large/uncompressed and a brand-new browser has
no HTTP cache.

Server stdout/stderr (including per-request logging) is written to
`%TEMP%\sad-e2e-server.log` every run — check there first if a test hangs or fails oddly.

## Headless Chromium hangs on this app — confirmed, not fully root-caused

Running with `SAD_E2E_HEADLESS=1` reproducibly hangs on the very first page navigation (sometimes
the second) — the browser tab's address bar updates but the page never finishes loading, the tab
title never leaves "about:blank", and it eventually times out. This was verified by direct
side-by-side comparison on the same machine: headless → hangs every time; headed → all 6 tests pass
in ~14 seconds, every time. Things ruled out along the way:

- Not a build/static-asset problem (fixed separately — see above — and confirmed via server logs
  showing fast, successful responses).
- Not a `WaitUntilState` issue (`load` vs `domcontentloaded` vs `commit` all hang identically).
- Not the shared-browser/page-lifecycle pattern — refactoring to create/close a page per test
  (matching a known-working reference test) made no difference.
- Not viewport size, not retry logic, not `IAsyncLifetime` timing.

The actual root cause (something headless Chromium does differently during Blazor WASM bootstrap
or first paint that this app depends on) hasn't been isolated. Given this is low priority for now,
**headed is the default** so `dotnet test` just works without anyone needing to know this history.

```
# Force headless anyway (will hang until this is root-caused further):
$env:SAD_E2E_HEADLESS = "1"
dotnet test StandupAndDeliver.E2ETests
```

If this becomes higher priority later (e.g. wiring these into CI, where headed mode needs a virtual
display like Xvfb), the next useful experiment is bisecting *what* headless does differently —
worth checking `chrome://gpu`-equivalent flags, `--headless=new` vs classic headless explicitly, and
whether disabling compositing/canvas acceleration in headed mode reproduces the hang (which would
point at a GPU/compositor difference rather than a networking one).

## What's covered (`DefendFortressUiTests.cs`)

Regression coverage for the bugs we actually hit while building the Fortress Artillery view:

- Lobby shows the artillery-seat picker and reflects who's claimed it.
- Lobby's game-mode `<select>` has all four modes.
- The top-down artillery view renders with a **real height** (regression test for the
  `flex-1` + `h-full` bug — Tailwind's `flex-1` sets `flex-basis: 0%`, which took priority over an
  inline `height: 55vh` in a flex column, collapsing the view to 0px) and shows the castle + at
  least one enemy/disc dot.
- The artillery player does **not** see the flinger-only "rotate to landscape" overlay (regression
  test for the bug where that overlay had no role exception and covered the artillery player's
  correctly-oriented screen).
- A non-artillery player sees the side canvas, not the top-down view.
- Dragging on the artillery view and releasing fires the slingshot (asserted via the "reloading Xs"
  cooldown indicator appearing).

## Sandboxed/CI environments: CDP escape hatch

If browser navigation hangs indefinitely regardless of URL, in a way unrelated to app behavior, in
some *other* environment, that one may be blocking network access for a browser process spawned as
a grandchild of the test runner (`dotnet test` → Playwright's Node driver → chrome). Workaround:
launch Chrome yourself with a remote-debugging port, then point `BrowserFixture` at it:

```bash
CHROME=".../ms-playwright/chromium-*/chrome-win64/chrome.exe"
"$CHROME" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9333 \
    --user-data-dir=/tmp/some-profile-dir about:blank &

SAD_E2E_CDP_ENDPOINT=http://127.0.0.1:9333 dotnet test StandupAndDeliver.E2ETests
```

Normal developer machines and ordinary CI runners should never need `SAD_E2E_CDP_ENDPOINT`.
