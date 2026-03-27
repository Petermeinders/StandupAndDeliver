using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.HttpOverrides;
using StandupAndDeliver.Endpoints;
using Microsoft.EntityFrameworkCore;
using Serilog;
using StandupAndDeliver.Client.Pages;
using StandupAndDeliver.Components;
using StandupAndDeliver.Data;
using StandupAndDeliver.Hubs;
using StandupAndDeliver.Services;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
    configuration.WriteTo.Console());

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveWebAssemblyComponents();

builder.Services.AddSignalR();
builder.Services.AddHealthChecks();
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=standup.db";
builder.Services.AddDbContextFactory<AppDbContext>(options => options.UseSqlite(connectionString), ServiceLifetime.Singleton);
builder.Services.AddSingleton<PromptCardService>();
builder.Services.AddSingleton<GameRoomService>();
builder.Services.AddSingleton<GameTimerService>();
builder.Services.AddHostedService<RoomCleanupService>();

var app = builder.Build();

await using (var db = app.Services.GetRequiredService<IDbContextFactory<AppDbContext>>().CreateDbContext())
{
    await db.Database.EnsureCreatedAsync();
    await SeedData.SeedAsync(db);
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseWebAssemblyDebugging();
}
else
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
if (!app.Environment.IsDevelopment())
    app.UseHttpsRedirection();

app.UseAntiforgery();

app.UseStaticFiles();
app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(StandupAndDeliver.Client._Imports).Assembly);

app.MapHub<GameHub>("/gamehub", options =>
{
    options.Transports = HttpTransportType.WebSockets;
});

app.MapHealthChecks("/health");
app.MapAdminCardEndpoints();
app.MapFeedbackEndpoints();

app.Run();
