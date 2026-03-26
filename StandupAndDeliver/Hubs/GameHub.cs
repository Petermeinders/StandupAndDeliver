using Microsoft.AspNetCore.SignalR;
using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Hubs;

public class GameHub : Hub<IGameClient>
{
}
