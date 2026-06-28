using StandupAndDeliver.Shared;

namespace StandupAndDeliver.Models;

public class StandupRoomState
{
    public int CurrentSpeakerIndex { get; set; }
    public HashSet<int> UsedCardIds { get; set; } = [];
    public Dictionary<string, int> CurrentTurnImpressiveness { get; set; } = [];
    public int? ActiveCardId { get; set; }
    public bool CardFlipped { get; set; }
    public string CurrentTranscript { get; set; } = "";
    public StandupSubPhase SubPhase { get; set; } = StandupSubPhase.SpeakerTurn;
}
