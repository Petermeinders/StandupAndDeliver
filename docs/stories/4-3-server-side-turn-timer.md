# Story 4.3: Server-Side 60-Second Turn Timer

## Status: Done

## Story
As a **player**, I want the turn timer to run on the server, so that the time limit is enforced fairly regardless of any individual client's state.

## Acceptance Criteria
- Given a turn begins, when `GameTimerService` starts the countdown, then a `PeriodicTimer` fires every second decrementing `SecondsRemaining`.
- Given each tick, then `ReceiveTimerTick` is broadcast to all clients with the updated seconds value.
- Given the timer reaches zero, then the server automatically transitions to `Voting` phase.
- Given a player disconnects mid-turn, when the timer is running, then the countdown continues unaffected (NFR-R3).

## Implementation Notes
- `PeriodicTimer(TimeSpan.FromSeconds(1))` in `GameTimerService.RunTurnTimerAsync()`
- `IGameClient.ReceiveTimerTick(int secondsRemaining)` broadcast each tick
- `GameStateService.UpdateTimer()` on client; `SecondsRemaining` drives `SpeakerView`/`WaitingView` countdown display
- Colour-coded: white >20s, yellow ≤20s, red ≤10s
