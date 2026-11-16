# 2c. Site shell (React client)

Ported from `StandupAndDeliver.Client/Pages/{Index,GameRoom}.razor` and `Components/*`.

## Structure

```
client/src/
  main.tsx, App.tsx          picks Home or Room from store state; handles ?join=
  styles.css                 Tailwind 4 + design tokens (see 04-visuals.md)
  lib/
    socket.ts                typed socket.io client, playerId handshake, call() → Promise<Result>
    store.ts                 single external store + useStore(selector)
    sound.ts                 preloaded sfx, unlock on first gesture, mute setting
    speech.ts                Web Speech API wrapper (Standup transcript)
    storage.ts               localStorage keys: fa_player_id, fa_name, fa_room, fa_settings
  shell/
    Home.tsx                 title, resume banner, carousel, how-to-play, Play button, feedback
    Carousel.tsx             cover-flow picker with preview clips
    NameDialog.tsx           "who's playing?" + join by code
    Header.tsx               room code chip, menu (players, host tools, leave, settings)
    Lobby.tsx                QR + link, players, per-game settings, Start
    Room.tsx                 connecting / lost / lobby / lazy game view
    Toasts.tsx, Feedback.tsx, ui.tsx (shared modal, controls and winner screen)
  games/
    registry.tsx              GameEntry list (+ external tiles)
    standup/ oneo/ cursed-vault/ last-stand/   View.tsx; shared rules copy in games/howto.tsx
    fortress/                View.tsx + lazy scene.ts (Phaser)
```

## Store shape

```ts
{ conn: 'connecting'|'online'|'reconnecting'|'offline',
  name: string, room: RoomState|null, game: {type, state}|null,
  timer: number|null, votes: {submitted,total}|null,
  reactions: {name,emoji,at}[], transcript: string,
  toasts: Toast[], settings: {sound: boolean, experimental: boolean, oneoNumbersOnly: boolean} }
```

Socket events write to the store; components read with selectors. No router library: the
screen is a function of `room` (null → Home, else Room) and the URL only carries `?join=`.

## Flows

| Flow | Steps |
|---|---|
| First visit | Carousel → Play → NameDialog (name saved to `fa_name`) → `room:enter` → Lobby |
| Invite link | `?join=CODE` → fetch room info → NameDialog pre-filled with code, shows who is inside → join. Known name → joins straight away. |
| Reload / dropped connection | On `connect`, if `fa_room` exists → `room:rejoin`. Failure clears it and shows Home with a toast. |
| Reconnecting | Banner while socket.io retries; after rejoin the server re-sends private state. |
| Leave game | Header menu → `game:sitOut`; the game applies its bench/elimination rules; the room menu labels the player as sitting out. |
| Leave room | Header menu → `room:leave`, clear `fa_room`, Home. |
| Game over | Shared GameOver card (winner, scores); server returns everyone to Lobby after 8 s. |

## Features carried over

- [x] Carousel: click, drag/swipe (48 px threshold), arrows, dots, keyboard ←/→; external single-player tiles; lock to a game when arriving by invite
- [x] How to play + example accordions per game (copy from `GameHowToPlay.razor`)
- [x] Lobby QR (generated locally with `qrcode`, .NET called api.qrserver.com) + copy link + native share
- [x] Host tools: start, switch game, drop from game/room; claim host when host is gone
- [x] Settings: sound on/off, show experimental games, OneO numbers-only, Fortress run length and lobby artillery seat
- [x] Feedback form
- [x] Toasts
- [x] Sounds: menu, confirm, flip, gold, hit, slam, levelup, spell (files in `public/sfx`)
- [x] PWA manifest + icons (install nudge and service worker: later)

## Dropped on purpose

Activity log drawer, sticky-header toggle, light theme, QR *scanner* (phone cameras open
invite links directly), "Add to phone" modal. Re-add if missed.
