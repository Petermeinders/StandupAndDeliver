using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Endpoints;

public static class FeedbackEndpoints
{
    private static readonly ConcurrentDictionary<string, List<DateTime>> _submissions = new();
    private const int MaxPerHour = 5;

    public static void MapFeedbackEndpoints(this WebApplication app)
    {
        app.MapPost("/api/feedback", async (FeedbackRequest req, IDbContextFactory<AppDbContext> dbFactory, IConfiguration config, HttpContext ctx, ILoggerFactory loggerFactory, IHttpClientFactory httpClientFactory) =>
        {
            var logger = loggerFactory.CreateLogger("Feedback");
            var message = req.Message?.Trim();
            if (string.IsNullOrEmpty(message) || message.Length > 2000)
                return Results.BadRequest("Message is required and must be under 2000 characters.");

            // Rate limit: 5 submissions per IP per hour
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var now = DateTime.UtcNow;
            var windowStart = now.AddHours(-1);

            var timestamps = _submissions.GetOrAdd(ip, _ => []);
            lock (timestamps)
            {
                timestamps.RemoveAll(t => t < windowStart);
                if (timestamps.Count >= MaxPerHour)
                    return Results.StatusCode(429);
                timestamps.Add(now);
            }

            // Save to database first — nothing is lost even if email fails
            await using var db = dbFactory.CreateDbContext();
            db.Feedback.Add(new FeedbackEntry { Message = message });
            await db.SaveChangesAsync();

            // Send email via Resend (best-effort)
            var apiKey = config["RESEND_API_KEY"] ?? config["Resend:ApiKey"];
            var toEmail = config["Resend:ToEmail"];
            var fromEmail = config["Resend:FromEmail"];

            if (!string.IsNullOrEmpty(apiKey) && !string.IsNullOrEmpty(toEmail) && !string.IsNullOrEmpty(fromEmail))
            {
                try
                {
                    var payload = new
                    {
                        from = fromEmail,
                        to = new[] { toEmail },
                        subject = "New Standup & Deliver Feedback",
                        text = $"New feedback received:\n\n{message}\n\nSubmitted: {DateTime.UtcNow:u}"
                    };

                    var http = httpClientFactory.CreateClient();
                    using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
                    request.Content = JsonContent.Create(payload);
                    var response = await http.SendAsync(request);

                    if (response.IsSuccessStatusCode)
                        logger.LogInformation("Feedback email sent successfully.");
                    else
                        logger.LogWarning("Resend returned {Status}", response.StatusCode);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Resend send failed");
                }
            }
            else
            {
                logger.LogWarning("Resend not configured — email skipped.");
            }

            return Results.Ok();
        });
    }

    public record FeedbackRequest(string? Message);
}
