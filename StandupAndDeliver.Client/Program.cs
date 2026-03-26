using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using StandupAndDeliver.Client.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

builder.Services.AddScoped<GameStateService>();

await builder.Build().RunAsync();
