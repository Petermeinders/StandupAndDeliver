using Microsoft.Playwright;

namespace StandupAndDeliver.E2ETests;

/// <summary>Basic connectivity smoke test — mostly useful for diagnosing environment/sandbox
/// issues (server not starting, browser unable to reach it) before chasing app-level bugs.</summary>
[Collection("Server collection")]
public class DiagnosticTests
{
    private readonly ServerFixture _server;
    private readonly BrowserFixture _browserFixture;

    public DiagnosticTests(ServerFixture server, BrowserFixture browserFixture)
    {
        _server = server;
        _browserFixture = browserFixture;
    }

    [Fact]
    public async Task Diagnostic_CanChromiumReachLocalhost()
    {
        var page = await _browserFixture.Browser.NewPageAsync();
        try
        {
            var response = await page.GotoAsync(_server.BaseUrl, new PageGotoOptions { Timeout = 30000 });
            Assert.NotNull(response);
            Assert.True(response!.Ok, $"Expected a successful navigation, got status {response.Status}.");
        }
        finally
        {
            await page.CloseAsync();
        }
    }
}
