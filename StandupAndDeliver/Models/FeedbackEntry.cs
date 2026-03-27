namespace StandupAndDeliver.Models;

public class FeedbackEntry
{
    public int Id { get; set; }
    public string Message { get; set; } = "";
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
}
