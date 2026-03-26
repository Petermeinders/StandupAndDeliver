namespace StandupAndDeliver.Models;

public class PromptCard
{
    public int Id { get; set; }
    public required string Text { get; set; }
    public bool IsActive { get; set; } = true;
}
