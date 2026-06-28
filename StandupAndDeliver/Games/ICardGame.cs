using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public interface ICardGame
{
    string GameType { get; }
    Task StartGame(GameRoom room, string connectionId);
    Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId);
    Task OnPlayerDisconnected(GameRoom room, string connectionId);
    Task OnPlayerRejoined(GameRoom room, string connectionId);
    Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost);
}
