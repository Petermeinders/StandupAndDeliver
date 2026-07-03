using Microsoft.Playwright;

namespace StandupAndDeliver.E2ETests;

/// <summary>
/// Playwright coverage for defend-fortress UI regressions we've actually hit:
/// the artillery-view sizing bug, the mis-scoped rotate overlay, and the lobby seat picker.
/// Each test boots a fresh room against the real running server (see <see cref="ServerFixture"/>).
///
/// Deliberately does NOT use IAsyncLifetime for page setup/teardown — each test creates and
/// disposes its own page inline (via <c>await using</c>), mirroring the one pattern that has
/// proven reliable here (<see cref="DiagnosticTests"/>).
/// </summary>
[Collection("Server collection")]
public class DefendFortressUiTests
{
    private const int NavTimeoutMs = 30000;

    private readonly ServerFixture _server;
    private readonly BrowserFixture _browserFixture;

    public DefendFortressUiTests(ServerFixture server, BrowserFixture browserFixture)
    {
        _server = server;
        _browserFixture = browserFixture;
    }

    /// <summary>Sets the player name, opens a fresh defend-fortress lobby, and returns once the
    /// lobby's "Players" card is visible (i.e. SignalR connected and platform state arrived).</summary>
    private static async Task OpenFreshLobbyAsync(IPage page, string baseUrl, string playerName)
    {
        await page.GotoAsync(baseUrl, new PageGotoOptions { Timeout = NavTimeoutMs, WaitUntil = WaitUntilState.DOMContentLoaded });
        await page.EvaluateAsync("name => localStorage.setItem('sad_name', name)", playerName);
        await page.GotoAsync($"{baseUrl}/room?action=create&game=defend-fortress", new PageGotoOptions { Timeout = NavTimeoutMs, WaitUntil = WaitUntilState.DOMContentLoaded });
        await page.GetByText("Players (").WaitForAsync(new LocatorWaitForOptions { Timeout = 15000 });
    }

    private static async Task CheckArtilleryVolunteerBoxAsync(IPage page)
    {
        var checkbox = page.GetByRole(AriaRole.Checkbox, new PageGetByRoleOptions { Name = "Start wave 1 as Artillery" });
        await checkbox.WaitForAsync();
        await checkbox.CheckAsync();
    }

    private static async Task StartGameAsync(IPage page)
    {
        await page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Start Game" }).ClickAsync();
    }

    [Fact]
    public async Task Lobby_ShowsArtillerySeatPicker_AndReflectsClaimant()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Alice");

        await page.GetByText("Artillery seat").WaitForAsync();
        await CheckArtilleryVolunteerBoxAsync(page);

        await page.GetByText("Alice will start as Artillery.").WaitForAsync(new LocatorWaitForOptions { Timeout = 5000 });
    }

    [Fact]
    public async Task Lobby_GameModeSelector_HasAllFourModes()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Bob");

        var select = page.Locator("select").First;
        var optionValues = await select.Locator("option").AllInnerTextsAsync();

        Assert.Contains("10 Waves", optionValues);
        Assert.Contains("50 Waves", optionValues);
        Assert.Contains("100 Waves", optionValues);
        Assert.Contains("Endless Survival", optionValues);
    }

    [Fact]
    public async Task ArtilleryView_RendersWithNonZeroHeight_AndCastlePlusEnemyDots()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());
        await page.SetViewportSizeAsync(1000, 900);

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Carol");
        await CheckArtilleryVolunteerBoxAsync(page);
        await StartGameAsync(page);

        var gate = page.Locator(".fortress-artillery-gate");
        await gate.WaitForAsync(new LocatorWaitForOptions { Timeout = 15000 });

        var box = await gate.BoundingBoxAsync();
        Assert.NotNull(box);
        Assert.True(box!.Height > 100, $"Expected the artillery view to have a real height, got {box.Height}px.");
        Assert.True(box.Width > 100, $"Expected the artillery view to have a real width, got {box.Width}px.");

        // Castle anchor should always render regardless of wave state.
        await gate.GetByText("🏰").WaitForAsync(new LocatorWaitForOptions { Timeout = 5000 });

        // Enemy dots should appear once the wave has had a moment to spawn some.
        await page.WaitForTimeoutAsync(2000);
        var dotCount = await gate.Locator("div.absolute.rounded-full").CountAsync();
        Assert.True(dotCount > 0, "Expected at least one enemy/disc dot to have rendered by now.");
    }

    [Fact]
    public async Task ArtilleryView_DoesNotShowTheLandscapeRotateOverlay()
    {
        // Regression test for the bug where the flinger-only "rotate to landscape" overlay
        // rendered unconditionally and covered the (correctly-oriented) artillery player's view.
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Dave");
        await CheckArtilleryVolunteerBoxAsync(page);
        await StartGameAsync(page);

        await page.Locator(".fortress-artillery-gate").WaitForAsync(new LocatorWaitForOptions { Timeout = 15000 });

        var landscapeOverlayCount = await page.Locator(".fortress-rotate-overlay").CountAsync();
        Assert.Equal(0, landscapeOverlayCount);
    }

    [Fact]
    public async Task NonArtilleryPlayer_SeesCanvasNotTopDownView()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Eve");
        // Deliberately not checking the artillery box.
        await StartGameAsync(page);

        await page.Locator("#fortress-canvas").WaitForAsync(new LocatorWaitForOptions { Timeout = 15000 });
        var artilleryGateCount = await page.Locator(".fortress-artillery-gate").CountAsync();
        Assert.Equal(0, artilleryGateCount);
    }

    [Fact]
    public async Task Slingshot_DragAndRelease_StartsCooldown()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        await using var _ = Disposable.From(() => page.CloseAsync());
        await page.SetViewportSizeAsync(1000, 900);

        await OpenFreshLobbyAsync(page, _server.BaseUrl, "Frank");
        await CheckArtilleryVolunteerBoxAsync(page);
        await StartGameAsync(page);

        var gate = page.Locator(".fortress-artillery-gate");
        await gate.WaitForAsync(new LocatorWaitForOptions { Timeout = 15000 });

        var box = await gate.BoundingBoxAsync();
        Assert.NotNull(box);

        var startX = box!.X + box.Width / 2;
        var startY = box.Y + box.Height - 20; // near the castle at the bottom
        var endX = startX + 60;
        var endY = startY - 120; // drag up-and-over, like pulling back a slingshot

        await page.Mouse.MoveAsync(startX, startY);
        await page.Mouse.DownAsync();
        await page.Mouse.MoveAsync(endX, endY, new MouseMoveOptions { Steps = 10 });
        await page.Mouse.UpAsync();

        // A successful FireSlingshot starts a cooldown, surfaced as "reloading Xs" in the corner.
        await page.GetByText("reloading", new PageGetByTextOptions { Exact = false })
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 3000 });
    }
}

/// <summary>Tiny helper so `await using` can wrap an arbitrary async cleanup delegate (here,
/// <c>page.CloseAsync</c>) without needing a bespoke disposable type per call site.</summary>
file static class Disposable
{
    public static IAsyncDisposable From(Func<Task> disposeAction) => new AsyncAction(disposeAction);

    private sealed class AsyncAction(Func<Task> action) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync() => await action();
    }
}
