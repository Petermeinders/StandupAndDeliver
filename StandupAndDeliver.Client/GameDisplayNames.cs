namespace StandupAndDeliver.Client;

public static class GameDisplayNames
{
    public static string GetTitle(string? gameType) => gameType switch
    {
        "OneO" => "OneO",
        "standup" => "Standup & Deliver",
        "crypt-sweepers" => "Crypt Sweepers",
        _ => "Peter's Party Games"
    };

    public static string? GetCoverImage(string? gameType) => gameType switch
    {
        "OneO" => "/OneOCover.png",
        "standup" => "/StandupAndDeliverBanner.jpg",
        "crypt-sweepers" => "/CryptSweepersCover.png",
        _ => null
    };
}
