using Microsoft.Playwright;

namespace StandupAndDeliver.E2ETests;

/// <summary>
/// Launches one Chromium instance for the whole test collection. Launching a fresh browser per
/// test was the main cause of flaky timeouts here originally: a Debug Blazor WASM build is large
/// and uncompressed, and a brand-new browser process has no HTTP cache, so every test was
/// cold-downloading the entire framework bundle from scratch.
///
/// Headless Chromium hangs navigating this specific app (confirmed via direct A/B testing —
/// SAD_E2E_HEADLESS=1 hangs indefinitely on the very first navigation; headed passes 6/6 in ~14s,
/// repeatably). Root cause not fully isolated, but the effect is reproducible and one-directional,
/// so headed is the default here rather than something you have to remember to opt into.
/// Set SAD_E2E_HEADLESS=1 to force headless anyway (e.g. once CI infra with a virtual display is
/// set up) — expect it to hang until that's investigated further.
///
/// Sandboxed-environment escape hatch: if the SAD_E2E_CDP_ENDPOINT environment variable is set
/// (e.g. "http://127.0.0.1:9333"), we connect to an already-running Chrome over CDP instead of
/// launching one ourselves. This is only needed in environments where a browser spawned as a
/// grandchild of the test-runner process (dotnet test -> Playwright driver -> chrome) is denied
/// network access by process-tree-based sandboxing.
/// </summary>
public sealed class BrowserFixture : IAsyncLifetime
{
    private const string CdpEndpointEnvVar = "SAD_E2E_CDP_ENDPOINT";
    private const string HeadlessEnvVar = "SAD_E2E_HEADLESS";

    public IPlaywright Playwright { get; private set; } = null!;
    public IBrowser Browser { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        Playwright = await Microsoft.Playwright.Playwright.CreateAsync();

        var cdpEndpoint = Environment.GetEnvironmentVariable(CdpEndpointEnvVar);
        if (!string.IsNullOrWhiteSpace(cdpEndpoint))
        {
            Browser = await Playwright.Chromium.ConnectOverCDPAsync(cdpEndpoint);
            return;
        }

        var headless = Environment.GetEnvironmentVariable(HeadlessEnvVar) == "1";
        Browser = await Playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = headless,
            SlowMo = headless ? 0 : 100
        });
    }

    public async Task DisposeAsync()
    {
        await Browser.CloseAsync();
        Playwright.Dispose();
    }
}
