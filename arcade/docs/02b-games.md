# 2b. Game modules and rules

## Server contract (`server/src/games/types.ts`)

```ts
interface GameModule {
  id: GameId;
  maxPlayers: number;
  bot?: boolean;            // can fill a solo game with a bot
  midRunJoin?: boolean;     // late joiners allowed (as spectators)
  create(ctx: GameContext, settings: Record<string, unknown>): GameInstance;
}
interface GameContext {
  room: Room;
  broadcastRoom(): void;                       // room:state to everyone
  sendState(player: Player, state: unknown): void;   // private game:state
  emit(event, payload, exceptPlayer?): void;   // room-wide game events
  after(ms, fn): () => void;                   // timer, auto-cancelled on dispose
  endGame(): void;                             // phase → GameOver, lobby after 8 s
  log(event, playerName?): void;
}
interface GameInstance {
  start(): void;
  action(player: Player, action: string, payload: unknown): Result;
  sync(player: Player): void;                  // re-send this player's view (rejoin)
  onDisconnected?(player): void;
  onGraceExpired?(name: string, wasHost: boolean): void;
  onDropped?(name: string): void;
  onSatOut?(player): void;
  onJoined?(player): void;
}
```

A game instance owns its state; one instance per room per game played. All timers go through
`ctx.after` so nothing fires after the game is disposed. Rules are deterministic given an
injected `rng` (default `Math.random`) so tests can script shuffles.

## Client contract (`client/src/games/registry.ts`)

```ts
interface GameEntry {
  id: GameId; name: string; tagline: string; icon: string;
  cover: string | null; preview: string | null;      // /covers/x, /previews/x.webm
  minPlayers: number; maxPlayers: number; experimental?: boolean;
  View: React.LazyExoticComponent<(p: GameViewProps) => JSX.Element>;
  HowToPlay: () => JSX.Element;
  LobbySettings?: (p) => JSX.Element;                // e.g. OneO "numbers only"
}
interface GameViewProps<S> { state: S; room: RoomState; me: string; send(action, payload?): Promise<Result> }
```

---

## Standup & Deliver  (`standup`)
From `Games/StandupGame.cs` + `Services/GameTimerService.cs`. 1–8 players, no bot.

Flow per speaker (room order): **SpeakerTurn → Voting → Results**, then next speaker; after
the last speaker the game is over.

| Rule | Detail |
|---|---|
| Card | Random unused prompt + 3 random buzzwords (verb, adjective, noun). Only the speaker sees it until Results. |
| Flip | Speaker taps the card; the 60 s clock starts only then. |
| Clock | Server ticks every second (`timer:tick`). Speaker may pause/resume. At 0, or on Done, → Voting. |
| Skip | Host may end the speaker's turn at any time. Disconnected speakers are skipped at turn start. |
| Transcript | Speaker's browser speech-to-text is relayed live (≤2000 chars); shown again in Voting/Results. |
| Reactions | Listeners may send 👏 😂 🔥 🤔 💀 during the turn. |
| Voting | Everyone except the speaker rates 1–5, once. 30 s limit; ends early when all connected listeners voted. |
| Score | `round(avg, 1) * 10` added to the speaker. No votes → 0. |
| Results | Host presses Next. If the host's grace period expires here, the game advances itself. |
| End | Scoreboard; no auto-return to lobby timer in .NET — new version returns via `endGame()` like the others. |

Actions: `FlipCard`, `EndTurn`, `SkipTurn`, `PauseTurn`, `ResumeTurn`, `SubmitImpressiveness {rating}`,
`AdvanceTurn`, `SendTranscript {text}`, `SendReaction {emoji}`.

## OneO  (`oneo`)
From `Games/OneOGame.cs`, `Models/OneOCard.cs`. 2–8 players, bot for solo.

| Rule | Detail |
|---|---|
| Deck | Per colour (R/G/B/Y): one 0, two each of 1–9, two each Skip/Reverse/Draw Two. Plus 4 Wild, 4 Wild Draw Four. 108 cards. "Numbers only" setting removes all specials (76 cards). |
| Deal | 7 each. Flip the first discard; a Wild Draw Four goes back to the bottom. Opening Skip/Reverse/Draw Two apply to the first player; opening Wild → Red. |
| Legal play | Wild always; same colour as current colour; same special type; same number. |
| Draw | Draw one. If playable the turn stays (may play it); otherwise the turn passes. |
| Specials | Skip: next loses turn. Reverse: flips direction (acts as Skip with 2 players). Draw Two / Wild Draw Four: next draws and is skipped. Wilds need a chosen colour. |
| Reshuffle | Draw pile empty → shuffle all discards but the top into it. |
| Win | First empty hand. Game over, lobby after 8 s. |
| Drop | Dropped player's hand is discarded and their seat skipped forever; one player left → they win. A plain disconnect pauses on their turn (by design). |
| Bot | Waits 1.2–2.4 s. Scores playable cards (hold Draw Fours until an opponent is low, prefer own strongest colour, dump low numbers); otherwise draws and plays the drawn card if legal. Picks its most-held colour for wilds. |

Actions: `PlayCard {cardId, chosenColor?}`, `DrawCard`.

## Cursed Vault  (`cursed-vault`)
From `Games/CursedVaultGame.cs`. 2–8 players, bot for solo.

| Rule | Detail |
|---|---|
| Setup | Each player: 5 gold + 1 skull in hand. Shared face-down pile starts empty. |
| Round 1 | Play one card to the pile. No gambling. |
| Later turns | Either play a card (gold or skull) to the pile, or gamble: declare N (1..pile size) and flip random pile cards one at a time. |
| Gold flip | +1 gold immediately (card leaves the pile). Reaching 10 gold wins instantly. After N golds, the player must play one card from hand, then the turn passes. |
| Skull flip | Every card flipped this gamble (including the skull) goes back and the pile is shuffled. Gold already gained is kept. Player loses the skull in hand; no skull left → eliminated (hand trashed, not added to pile). Turn passes. |
| Turn order | Skips eliminated players and players with an empty hand when the pile is also empty. Wrapping past the first seat increments the round. |
| Win | 10 gold, or last player not eliminated. Lobby after 8 s. |
| Leaving | Grace expiry or host drop = elimination. |
| Bot | Round 1 / empty pile: play gold. Otherwise may gamble 1–3 (up to 5 at ≥8 gold) with appetite by gold (≤2: 70 %, ≤5: 40 %, ≥8: 60 %, else 45 %), never when pile ≤2. After a gamble plays gold. Flips every 0.8–1.4 s. |

Actions: `PlayCard {type}`, `StartGamble {count}`, `FlipCard`, `PlayCardAfterGamble {type}`.

## Last Stand  (`last-stand`)
From `Games/LastStandGame.cs`; tests in `StandupAndDeliver.Tests/Services/LastStandGameTests.cs`
are the spec and should be ported. 2–8 players, bot for solo (new).

| Rule | Detail |
|---|---|
| Setup | Each player: cards 1–10, 3 lives. |
| Round | Everyone secretly selects a card and locks in. When all active players are locked: 1.5 s suspense, then reveal. |
| Resolve | Cards played by more than one player cancel. Among unique cards: highest wins the round, lowest loses a life. If only one unique card exists it wins and nobody loses. |
| After | Played cards are discarded. 0 lives → eliminated (spectates; sees locked-in picks live). RoundOver shows for 5 s. |
| Sudden death | 3 consecutive rounds where the last two players cancel each other → next round both are forced to their highest card. |
| End | One player left → winner. All remaining hands empty → most lives *at the start of the final round* wins. Lobby after 8 s. |
| Leaving | Grace expiry or host drop: eliminated, pending pick voided; if the rest are all locked, the round resolves. |
| Bot (new) | Picks a random remaining card 0.8–2 s after each round starts and locks in. |

Actions: `SelectCard {card}`, `LockIn`.

## Checklist

- [x] `types.ts`, `registry.ts`
- [x] standup · [x] oneo · [x] cursed-vault · [x] last-stand (server)
- [x] Unit tests: OneO legality + specials, Vault skull/elimination/win, Last Stand resolution (port .NET tests), Standup scoring
- [x] Client views for all four
