namespace StandupAndDeliver.Client.Services;

public record GameRegistration(
    string Id,
    string Name,
    string Tagline,
    string? ImageUrl,
    string Icon,
    Type ComponentType);

public class GameRegistry
{
    private readonly List<GameRegistration> _games = [];

    public IReadOnlyList<GameRegistration> Games => _games;

    public void Register(GameRegistration registration) => _games.Add(registration);

    public Type? GetComponent(string gameType) =>
        _games.FirstOrDefault(g => g.Id == gameType)?.ComponentType;

    public GameRegistration? Get(string gameType) =>
        _games.FirstOrDefault(g => g.Id == gameType);
}
