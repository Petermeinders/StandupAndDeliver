using System.Collections.Concurrent;
using System.Net;
using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Endpoints;

public static class FeedbackEndpoints
{
    // IP -> list of submission timestamps in the current window
    private static readonly ConcurrentDictionary<string, List<DateTime>> _submissions = new();
    private const int MaxPerHour = 5;

    public static void MapFeedbackEndpoints(this WebApplication app)
    {
        app.MapPost("/api/feedback", async (FeedbackRequest req, IDbContextFactory<AppDbContext> dbFactory, IConfiguration config, HttpContext ctx) =>
        {
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

            // Send email via SMTP (best-effort)
            var host = config["Smtp:Host"];
            var toEmail = config["Smtp:ToEmail"];
            var username = config["Smtp:Username"];
            var password = config["Smtp:Password"];

            if (!string.IsNullOrEmpty(host) && !string.IsNullOrEmpty(toEmail) && !string.IsNullOrEmpty(username))
            {
                try
                {
                    var port = int.TryParse(config["Smtp:Port"], out var p) ? p : 587;
                    using var client = new SmtpClient(host, port)
                    {
                        EnableSsl = true,
                        Credentials = new NetworkCredential(username, password)
                    };
                    var mail = new MailMessage(username, toEmail)
                    {
                        Subject = "New Standup & Deliver Feedback",
                        Body = $"New feedback received:\n\n{message}\n\nSubmitted: {DateTime.UtcNow:u}"
                    };
                    await client.SendMailAsync(mail);
                }
                catch
                {
                    // Email failure is silent — feedback is already saved to DB
                }
            }

            return Results.Ok();
        });
    }

    public record FeedbackRequest(string? Message);
}
