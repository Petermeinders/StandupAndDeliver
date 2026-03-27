using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using StandupAndDeliver.Client.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

builder.Services.AddScoped<GameStateService>();
builder.Services.AddScoped<ThemeService>();
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

await builder.Build().RunAsync();
