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
            room.Players.Select(p => new PlayerDto(p.Name, p.Score, p.IsHost, p.IsConnected, p.IsBot)).ToList(),
            room.GameType);
}
