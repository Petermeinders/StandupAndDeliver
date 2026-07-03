using StandupAndDeliver.Models;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Games;

public interface ICardGame
{
    string GameType { get; }
    Task StartGame(GameRoom room, string connectionId, string? settingsJson = null);
    Task<HubResult> HandleAction(string action, string? payloadJson, GameRoom room, string connectionId);
    Task OnPlayerDisconnected(GameRoom room, string connectionId);
    Task OnPlayerRejoined(GameRoom room, string connectionId);
    Task OnPlayerGraceExpired(GameRoom room, string playerName, bool wasHost);

    /// <summary>Called after a new player has been added to <paramref name="room"/> mid-run
    /// (i.e. joined after <see cref="StartGame"/>). Most games ignore this; games that support
    /// mid-run joins (e.g. spectator-until-next-round) override it.</summary>
    Task OnPlayerJoined(GameRoom room, string connectionId) => Task.CompletedTask;

    /// <summary>Called when a player explicitly "Leaves Game" (stays connected/grouped, but
    /// <see cref="Player.AwayFromGame"/> is now set). Games with an existing spectator/bench concept
    /// should fold the player into it (see DefendFortressGame, which reuses its mid-wave-join
    /// spectator handling) so active-roster/reward logic already skips them; games without one can
    /// ignore this and rely on the platform-level flag alone.</summary>
    Task OnPlayerLeftGame(GameRoom room, string connectionId) => Task.CompletedTask;

    /// <summary>Host-triggered "Drop" — immediate, not a grace-period timeout, and not something the
    /// dropped player asked for. They stay a room member but are forcibly removed from the *active
    /// game*: hand/turn-slot cleanup happens the same way a permanent disconnect would (or reuses
    /// existing elimination logic where a game already has one, e.g. CursedVaultGame). Looked up by
    /// player name rather than connection ID since the target may already be disconnected.</summary>
    Task OnPlayerDropped(GameRoom room, string playerName) => Task.CompletedTask;
}
