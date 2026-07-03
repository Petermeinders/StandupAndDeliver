using System.Net;
using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Games;
using StandupAndDeliver.Models;
using StandupAndDeliver.Services;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Hubs;

public class GameHub(
    GameRoomService gameRoomService,
    EventLogService eventLog,
    IEnumerable<ICardGame> cardGames) : Hub<IGameClient>
{
    private ICardGame GetGame(string gameType) =>
        cardGames.First(g => g.GameType == gameType);

    public async Task<HubResult> CreateOrJoinRoom(string? code, string playerName, string gameType, bool useFunName)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var validTypes = cardGames.Select(g => g.GameType).ToArray();
        if (!validTypes.Contains(gameType)) gameType = validTypes.FirstOrDefault() ?? "standup";

        var safeName = WebUtility.HtmlEncode(playerName.Trim());

        // Scrub this connection ID from any room it currently occupies so stale
        // lookups (StartGame, GameAction) can't find the wrong room.
        foreach (var stale in gameRoomService.GetAllRooms())
        {
            var sp = stale.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (sp is not null) { sp.ConnectionId = string.Empty; sp.IsConnected = false; }
        }

        var (room, roomCode, created, error) = gameRoomService.CreateOrJoinRoom(code, safeName, Context.ConnectionId, gameType, useFunName);

        if (room is null) return new HubResult(false, error ?? "Failed to join room.");

        await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
        await Clients.Group(roomCode).ReceiveGameState(BuildLeanDto(room));

        var action = created ? "RoomCreated" : "PlayerJoined";
        _ = eventLog.LogAsync(action, gameType, roomCode, safeName, room.Players.Count);

        if (!created && room.Phase != GamePhase.Lobby)
            await GetGame(room.GameType).OnPlayerJoined(room, Context.ConnectionId);

        // Cancel any pending empty-room timer since a player just joined
        gameRoomService.CancelEmptyRoomTimer(roomCode);

        return new HubResult(true, RoomCode: roomCode);
    }

    public async Task<HubResult> CreateRoom(string playerName, string gameType = "standup")
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var validTypes = cardGames.Select(g => g.GameType).ToArray();
        if (!validTypes.Contains(gameType)) gameType = validTypes.FirstOrDefault() ?? "standup";

        var safeName = WebUtility.HtmlEncode(playerName.Trim());
        var (room, code) = gameRoomService.CreateRoom(safeName, Context.ConnectionId, gameType);
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Caller.ReceiveGameState(BuildLeanDto(room));
        _ = eventLog.LogAsync("RoomCreated", gameType, code, safeName, 1);
        return new HubResult(true);
    }

    public async Task<HubResult> JoinRoom(string roomCode, string playerName)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new HubResult(false, "Player name is required.");

        var safeName = WebUtility.HtmlEncode(playerName.Trim());
        var (room, result) = gameRoomService.JoinRoom(roomCode.ToUpperInvariant(), safeName, Context.ConnectionId);
        if (!result.Success) return result;

        await Groups.AddToGroupAsync(Context.ConnectionId, room!.RoomCode);
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));
        _ = eventLog.LogAsync("PlayerJoined", room.GameType, room.RoomCode, safeName, room.Players.Count);

        if (room.Phase != GamePhase.Lobby)
            await GetGame(room.GameType).OnPlayerJoined(room, Context.ConnectionId);

        return new HubResult(true);
    }

    public async Task<HubResult> RejoinRoom(string roomCode, string playerName)
    {
        var room = gameRoomService.GetRoom(roomCode);
        if (room is null) return new HubResult(false, "Room not found or has expired.");

        var player = room.Players.FirstOrDefault(p =>
            string.Equals(p.Name, WebUtility.HtmlEncode(playerName.Trim()), StringComparison.OrdinalIgnoreCase));
        if (player is null) return new HubResult(false, "No player with that name in this room.");

        player.ConnectionId = Context.ConnectionId;
        player.IsConnected = true;
        player.AwayFromGame = false;
        room.LastActivity = DateTime.UtcNow;
        gameRoomService.CancelGracePeriod(roomCode, player.Name);

        await Groups.AddToGroupAsync(Context.ConnectionId, room.RoomCode);

        // Send lean platform state to all (player list changed — reconnected)
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));

        // Delegate game-specific rejoin logic to the game implementation
        var game = GetGame(room.GameType);
        await game.OnPlayerRejoined(room, Context.ConnectionId);

        return new HubResult(true);
    }

    public async Task<HubResult> StartGame(string? settingsJson = null)
    {
        Console.WriteLine($"[GameHub] StartGame called connId={Context.ConnectionId[..Math.Min(8,Context.ConnectionId.Length)]} settings={settingsJson ?? "null"}");
        var room = gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));
        if (room is null)
        {
            Console.WriteLine($"[GameHub] StartGame: room not found for connId");
            return new HubResult(false, "Room not found.");
        }
        Console.WriteLine($"[GameHub] StartGame: found room={room.RoomCode} phase={room.Phase}");

        var (updatedRoom, result) = gameRoomService.StartGame(room.RoomCode, Context.ConnectionId);
        if (!result.Success)
        {
            await Clients.Caller.ReceiveGameState(BuildLeanDto(room));
            return result;
        }

        var game = GetGame(updatedRoom!.GameType);
        try
        {
            await game.StartGame(updatedRoom, Context.ConnectionId, settingsJson);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[GameHub] StartGame exception: {ex}");
            return new HubResult(false, $"Game start failed: {ex.Message}");
        }
        _ = eventLog.LogAsync("GameStarted", updatedRoom.GameType, updatedRoom.RoomCode, "", updatedRoom.Players.Count(p => p.IsConnected));
        return new HubResult(true);
    }

    public async Task<HubResult> GameAction(string action, string? payloadJson)
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var game = GetGame(room.GameType);
        return await game.HandleAction(action, payloadJson, room, Context.ConnectionId);
    }

    /// <summary>Lobby-time seat pre-pick (e.g. defend-fortress's Artillery role, epic §14/Q18).
    /// Only meaningful before the game starts — games read <see cref="Player.PreferredRole"/> in
    /// their own StartGame implementation if they care about it; other games just ignore it.</summary>
    public async Task<HubResult> SetPreferredRole(string? role)
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");
        if (room.Phase != GamePhase.Lobby) return new HubResult(false, "Game already started.");

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player is null) return new HubResult(false, "Player not found.");

        var normalizedRole = string.IsNullOrWhiteSpace(role) ? null : role;
        if (normalizedRole is not null
            && room.Players.Any(p => p != player && !p.IsBot && p.PreferredRole == normalizedRole))
            return new HubResult(false, "Someone else already holds that seat.");

        player.PreferredRole = normalizedRole;
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));
        return new HubResult(true);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var room in gameRoomService.GetAllRooms())
        {
            var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (player is not null)
            {
                player.IsConnected = false;
                room.LastActivity = DateTime.UtcNow;

                // Immediately broadcast so remaining clients see updated presence
                await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));

                var game = GetGame(room.GameType);
                await game.OnPlayerDisconnected(room, Context.ConnectionId);

                var roomCode = room.RoomCode;
                var playerName = player.Name;
                var wasHost = player.IsHost;

                gameRoomService.StartGracePeriod(roomCode, playerName, async () =>
                {
                    var r = gameRoomService.GetRoom(roomCode);
                    if (r is null) return;
                    var g = GetGame(r.GameType);
                    await g.OnPlayerGraceExpired(r, playerName, wasHost);

                    // Start empty-room timer if no humans remain
                    if (r.Players.All(p => !p.IsConnected || p.IsBot))
                        gameRoomService.StartEmptyRoomTimer(roomCode);
                });

                break;
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    public async Task LeaveRoomGroup(string roomCode)
    {
        var upper = roomCode.ToUpperInvariant();
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, upper);

        // Sever the connection-ID link so this caller can't be found in the old room
        // by future hub method lookups (StartGame, GameAction, etc.)
        var room = gameRoomService.GetRoom(upper);
        var player = room?.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player is not null)
        {
            player.ConnectionId = string.Empty;
            player.IsConnected = false;
        }
    }

    /// <summary>"Leave Game" — the player stays a room member and stays connected/grouped (so they
    /// keep getting live state and can resume instantly); every game's active-roster/turn logic
    /// treats them like a spectator until they come back. Distinct from <see cref="LeaveRoomGroup"/>
    /// (internal cleanup before switching rooms/games) and from <see cref="LeaveRoomPermanently"/>
    /// (the real "Leave Room" action).</summary>
    public async Task<HubResult> LeaveGame()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player is null) return new HubResult(false, "Player not found.");

        player.AwayFromGame = true;
        room.LastActivity = DateTime.UtcNow;
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));
        await GetGame(room.GameType).OnPlayerLeftGame(room, Context.ConnectionId);
        return new HubResult(true);
    }

    /// <summary>"Leave Room" — full, deliberate exit. Removes the player from the room outright
    /// (not just marked disconnected, so there's no reconnect grace period to wait out) and purges
    /// the room immediately if that was the last human, instead of waiting for the 5-minute
    /// empty-room timer.</summary>
    public async Task<HubResult> LeaveRoomPermanently(string roomCode)
    {
        var upper = roomCode.ToUpperInvariant();
        var room = gameRoomService.GetRoom(upper);
        if (room is null) return new HubResult(true);

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, upper);
        var playerName = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId)?.Name;
        gameRoomService.RemovePlayerByConnectionId(upper, Context.ConnectionId);

        var remaining = gameRoomService.GetRoom(upper);
        if (remaining is not null)
        {
            await Clients.Group(upper).ReceiveGameState(BuildLeanDto(remaining));
            _ = eventLog.LogAsync("PlayerLeftRoom", remaining.GameType, upper, playerName ?? "", remaining.Players.Count);
        }

        return new HubResult(true);
    }

    /// <summary>Host authority: forcibly remove another player from the active game (they stay a
    /// room member, folded into whatever spectator/elimination handling that game already has) or
    /// from the room outright. Anyone may drop the host, but only if the host is themselves
    /// <see cref="Player.AwayFromGame"/> and the scope is "game" — that's the "if the host leaves the
    /// game, anyone can drop them from the game" carve-out; a host who's just left the room already
    /// triggers auto-promotion via <see cref="LeaveRoomPermanently"/>, so there's nothing to drop.</summary>
    public async Task<HubResult> DropPlayer(string targetPlayerName, string scope)
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null) return new HubResult(false, "Player not found.");

        var target = room.Players.FirstOrDefault(p => p.Name == targetPlayerName);
        if (target is null) return new HubResult(false, "That player isn't in this room.");
        if (target == caller) return new HubResult(false, "You can't drop yourself.");

        var allowed = caller.IsHost || (scope == "game" && target.IsHost && target.AwayFromGame);
        if (!allowed) return new HubResult(false, "Only the host can drop players.");

        if (scope == "room")
        {
            if (target.IsConnected && !string.IsNullOrEmpty(target.ConnectionId))
                await Groups.RemoveFromGroupAsync(target.ConnectionId, room.RoomCode);

            var game = GetGame(room.GameType);
            if (room.Phase == GamePhase.Playing) await game.OnPlayerDropped(room, target.Name);

            gameRoomService.RemovePlayer(room, target);

            var remaining = gameRoomService.GetRoom(room.RoomCode);
            if (remaining is not null)
                await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(remaining));
            _ = eventLog.LogAsync("PlayerDropped", room.GameType, room.RoomCode, target.Name, remaining?.Players.Count ?? 0);
            return new HubResult(true);
        }

        target.AwayFromGame = true;
        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));
        await GetGame(room.GameType).OnPlayerDropped(room, target.Name);
        _ = eventLog.LogAsync("PlayerDropped", room.GameType, room.RoomCode, target.Name, room.Players.Count);
        return new HubResult(true);
    }

    public async Task<HubResult> PromoteToHost()
    {
        var room = GetRoomForCaller();
        if (room is null) return new HubResult(false, "Room not found.");

        var caller = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (caller is null) return new HubResult(false, "Player not found.");

        // Only allow promotion if no connected host exists
        var hasConnectedHost = room.Players.Any(p => p.IsHost && p.IsConnected && !p.IsBot);
        if (hasConnectedHost) return new HubResult(false, "The host is still connected.");

        // Remove old host flag, promote caller
        foreach (var p in room.Players) p.IsHost = false;
        caller.IsHost = true;

        await Clients.Group(room.RoomCode).ReceiveGameState(BuildLeanDto(room));
        _ = eventLog.LogAsync("HostPromoted", room.GameType, room.RoomCode, caller.Name, room.Players.Count);
        return new HubResult(true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private GameRoom? GetRoomForCaller() =>
        gameRoomService.GetAllRooms()
            .FirstOrDefault(r => r.Players.Any(p => p.ConnectionId == Context.ConnectionId));

    public static GameStateDto BuildLeanDto(GameRoom room) =>
        new(room.Phase, room.RoomCode,
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot, p.PreferredRole, p.AwayFromGame)).ToList(),
            room.GameType);
}
