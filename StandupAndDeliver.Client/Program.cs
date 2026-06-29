using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using StandupAndDeliver.Client.Components.Games.CursedVault;
using StandupAndDeliver.Client.Components.Games.OneO;
using StandupAndDeliver.Client.Components.Games.Standup;
using StandupAndDeliver.Client.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

builder.Services.AddScoped<GameStateService>();
builder.Services.AddScoped<SavedSessionService>();
builder.Services.AddScoped<ThemeService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddSingleton<HubService>();
builder.Services.AddScoped<ToastService>();
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

var registry = new GameRegistry();
registry.Register(new GameRegistration(
    Id: "standup",
    Name: "Standup & Deliver",
    Tagline: "Corporate chaos",
    ImageUrl: "/StandupAndDeliverBanner.jpg",
    Icon: "🎤",
    ComponentType: typeof(StandupGameRoot)));
registry.Register(new GameRegistration(
    Id: "OneO",
    Name: "OneO",
    Tagline: "Classic card game",
    ImageUrl: "/OneOCover.png",
    Icon: "🃏",
    ComponentType: typeof(OneOGameRoot)));
registry.Register(new GameRegistration(
    Id: "cursed-vault",
    Name: "Cursed Vault",
    Tagline: "How much are you willing to risk for the hope of treasure?",
    ImageUrl: "/CursedVaultCover.webp",
    Icon: "☠️",
    ComponentType: typeof(CursedVaultGameRoot)));

builder.Services.AddSingleton(registry);

await builder.Build().RunAsync();
