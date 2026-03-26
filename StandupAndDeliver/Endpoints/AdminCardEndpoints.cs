using System.Text;
using StandupAndDeliver.Services;

namespace StandupAndDeliver.Endpoints;

public static class AdminCardEndpoints
{
    public static void MapAdminCardEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/cards").AddEndpointFilter<BasicAuthFilter>();

        group.MapGet("/", async (PromptCardService svc) =>
        {
            var cards = await svc.GetAllCardsAsync();
            return Results.Ok(cards.Select(c => new { c.Id, c.Text, c.IsActive }));
        });

        group.MapPost("/", async (CardRequest req, PromptCardService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.Text))
                return Results.BadRequest("Card text is required.");
            var card = await svc.AddCardAsync(req.Text.Trim());
            return Results.Created($"/admin/cards/{card.Id}", new { card.Id, card.Text, card.IsActive });
        });

        group.MapDelete("/{id:int}", async (int id, PromptCardService svc) =>
        {
            var found = await svc.DeactivateCardAsync(id);
            return found ? Results.NoContent() : Results.NotFound();
        });
    }

    private record CardRequest(string Text);

    private class BasicAuthFilter : IEndpointFilter
    {
        public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
        {
            var config = ctx.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var expectedUser = config["AdminAuth:Username"] ?? Environment.GetEnvironmentVariable("ADMIN_USERNAME") ?? "admin";
            var expectedPass = config["AdminAuth:Password"] ?? Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "";

            var authHeader = ctx.HttpContext.Request.Headers.Authorization.FirstOrDefault();
            if (authHeader is null || !authHeader.StartsWith("Basic "))
                return Unauthorized(ctx.HttpContext);

            string credentials;
            try
            {
                credentials = Encoding.UTF8.GetString(Convert.FromBase64String(authHeader["Basic ".Length..]));
            }
            catch
            {
                return Unauthorized(ctx.HttpContext);
            }

            var sep = credentials.IndexOf(':');
            if (sep < 0) return Unauthorized(ctx.HttpContext);

            var user = credentials[..sep];
            var pass = credentials[(sep + 1)..];

            if (user != expectedUser || pass != expectedPass)
                return Unauthorized(ctx.HttpContext);

            return await next(ctx);
        }

        private static IResult Unauthorized(HttpContext ctx)
        {
            ctx.Response.Headers.WWWAuthenticate = "Basic realm=\"admin\"";
            return Results.Unauthorized();
        }
    }
}
