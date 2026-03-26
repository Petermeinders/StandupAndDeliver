using Microsoft.EntityFrameworkCore;
using StandupAndDeliver.Models;

namespace StandupAndDeliver.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<PromptCard> PromptCards => Set<PromptCard>();
}
