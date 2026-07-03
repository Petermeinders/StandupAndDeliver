using System.Diagnostics;
using System.Net.Http;

namespace StandupAndDeliver.E2ETests;

/// <summary>
/// Boots the real ASP.NET Core host (Kestrel + SignalR) as a subprocess on a dedicated test port,
/// so Playwright drives an actual browser against actual websockets — not an in-memory TestServer,
/// which doesn't reliably support SignalR's transport negotiation.
/// </summary>
public sealed class ServerFixture : IAsyncLifetime
{
    public const int Port = 5299;
    public string BaseUrl => $"http://127.0.0.1:{Port}";

    /// <summary>Persistent log of the server's stdout/stderr for this run — useful for checking
    /// whether a hung browser navigation ever actually reached the server at all.</summary>
    public string LogPath { get; } = Path.Combine(Path.GetTempPath(), "sad-e2e-server.log");

    private Process? _process;
    private StreamWriter? _logWriter;

    public async Task InitializeAsync()
    {
        var repoRoot = FindRepoRoot();
        var serverProject = Path.Combine(repoRoot, "StandupAndDeliver", "StandupAndDeliver.csproj");

        _logWriter = new StreamWriter(File.Open(LogPath, FileMode.Create, FileAccess.Write, FileShare.Read)) { AutoFlush = true };

        _process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                // Deliberately no --no-build: this app's Blazor static assets (blazor.web.js etc.)
                // are wired up via ASP.NET Core's build-time static-asset manifest, which can point
                // at files that don't exist on disk if a stale/mismatched build is reused — that
                // surfaced as blazor.web.js 500-ing and the WASM app never bootstrapping.
                Arguments = $"run --no-launch-profile --project \"{serverProject}\"",
                WorkingDirectory = Path.GetDirectoryName(serverProject),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                EnvironmentVariables =
                {
                    ["ASPNETCORE_ENVIRONMENT"] = "Development",
                    // "dotnet run --urls" is swallowed by the `dotnet run` CLI itself rather than
                    // forwarded to the app unless passed after a literal "--" separator, so this env
                    // var is the reliable way to pin the port.
                    ["ASPNETCORE_URLS"] = BaseUrl,
                    // Surfaces per-request logging (method/path/status/duration) in the log file above.
                    ["Logging__LogLevel__Microsoft.AspNetCore"] = "Information"
                }
            },
            EnableRaisingEvents = true
        };
        _process.OutputDataReceived += (_, e) => { if (e.Data is not null) _logWriter.WriteLine(e.Data); };
        _process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _logWriter.WriteLine(e.Data); };
        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        Console.WriteLine($"[ServerFixture] Server log: {LogPath}");
        await WaitForServerReady(TimeSpan.FromSeconds(120));
    }

    private async Task WaitForServerReady(TimeSpan timeout)
    {
        using var client = new HttpClient();
        var deadline = DateTime.UtcNow + timeout;
        Exception? last = null;

        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var response = await client.GetAsync(BaseUrl);
                if (response.IsSuccessStatusCode) return;
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(500);
        }

        throw new TimeoutException($"Server at {BaseUrl} did not become ready in {timeout}.", last);
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "StandupAndDeliver.sln")))
            dir = dir.Parent;

        return dir?.FullName ?? throw new InvalidOperationException("Could not locate repo root (StandupAndDeliver.sln) from " + AppContext.BaseDirectory);
    }

    public Task DisposeAsync()
    {
        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { /* best effort */ }
        }
        _process?.Dispose();
        _logWriter?.Flush();
        _logWriter?.Dispose(); // deliberately not deleting LogPath — that's the whole point of it
        return Task.CompletedTask;
    }
}

[CollectionDefinition("Server collection")]
public class ServerCollection : ICollectionFixture<ServerFixture>, ICollectionFixture<BrowserFixture>;
