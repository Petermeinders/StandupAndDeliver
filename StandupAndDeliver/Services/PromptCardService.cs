using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Data;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Services;

public class PromptCardService(IDbContextFactory<AppDbContext> dbFactory, ILogger<PromptCardService> logger)
{
    public async Task<PromptCard?> DrawCardAsync(HashSet<int> usedCardIds)
    {
        await using var db = await dbFactory.CreateDbContextAsync();

        var available = await db.PromptCards
            .Where(c => c.IsActive && !usedCardIds.Contains(c.Id))
            .ToListAsync();

        if (available.Count == 0)
        {
            logger.LogWarning("All active prompt cards have been used in this session.");
            return null;
        }

        var card = available[Random.Shared.Next(available.Count)];
        var (verb, adj, noun) = CorporateBsData.PickRandom();
        card.Text = $"{card.Text}|||{verb}|{adj}|{noun}";
        return card;
    }

    public async Task<List<PromptCard>> GetAllCardsAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.PromptCards.OrderBy(c => c.Id).ToListAsync();
    }

    public async Task<PromptCard> AddCardAsync(string text)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var card = new PromptCard { Text = text };
        db.PromptCards.Add(card);
        await db.SaveChangesAsync();
        return card;
    }

    public async Task<bool> DeactivateCardAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var card = await db.PromptCards.FindAsync(id);
        if (card is null) return false;
        card.IsActive = false;
        await db.SaveChangesAsync();
        return true;
    }
}
