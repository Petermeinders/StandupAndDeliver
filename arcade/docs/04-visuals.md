# 4. Visuals

## Direction

"Fireside": a dark room lit by a fire, game boxes on the table. Warm, a little toy-like, not
neon-arcade. The one loud element is the selected game card; everything else stays quiet.

| Token | Value | Use |
|---|---|---|
| `--night` | `#1b1320` | Page background (plum-black, not neutral black) |
| `--coal` | `#2a1f30` | Panels |
| `--ash` | `#f1e7ea` | Text |
| `--smoke` | `#a8969f` | Secondary text |
| `--ember` | `#ff7a1a` | Primary actions, selected card ring |
| `--flame` | `#ffc247` | Highlights, room code, scores |
| `--spark` | `#4fd1b5` | External / single-player tiles |
| `--danger` | `#ff4d5e` | Errors, life lost |

Type: **Lilita One** (display: title, game names, big numbers) + **Figtree** (everything else).
Both self-hosted via `@fontsource`, no external font requests.

Motion: one ambient effect only — a slow firelight flicker behind the selected card. All other
motion answers an action (card slide, flip, deal, reveal). `prefers-reduced-motion` turns off
the flicker and preview autoplay.

## Carousel

| Feature | Detail |
|---|---|
| Card | 2:3 portrait, 280 px wide (240 px under 400 px viewports), cover image, caption at bottom |
| Neighbours | Scale −8 % and dim per step from centre |
| Selected ring | Ember for playable games, spark for external tiles |
| Preview clip | `<video muted loop playsinline preload="none">` stacked over the cover. 600 ms after a card becomes selected the video loads and plays; it fades in over 500 ms once `playing` fires and fades out on deselect. No clip → cover only. |
| Backdrop | Blurred, darkened cover of the selected game cross-fades behind the page |
| Controls | Click, drag/swipe, arrows, dots, ←/→ keys |

## Preview clips

- Recorded from the real app with Playwright (`arcade/tools/record-previews.mjs`): a scripted
  two-player game per title at 360×540, 6–8 s loop.
- Encoded with ffmpeg to `public/previews/<id>.webm` (VP9, ~300–600 KB) and `<id>.mp4` (H.264
  fallback for older iOS). GIFs are not used: 5–10× larger and 256 colours.
- Re-record whenever a game's look changes: `npm run previews`.

## Cover art

| Game | Current file | State |
|---|---|---|
| Standup & Deliver | `covers/standup-v2.webp` | New 1024×1536 portrait; original retained |
| OneO | `covers/oneo.jpg` | OK |
| Cursed Vault | `covers/cursed-vault.webp` | OK (768×1376, slightly tall) |
| Last Stand | `covers/last-stand.webp` | New 1024×1536 portrait |
| Protect Thy Fortress | `covers/fortress.webp` | OK |
| Crypt Sweepers | `covers/crypt-sweepers.jpg` | OK |
| Spellbound | `covers/spellbound.webp` | Low-res (330×595) |

Spec for new covers: 2:3 portrait, ≥ 840×1260, WebP, title in the top two-thirds (the bottom
third sits under the caption gradient). Drop into `client/public/covers/` and update
`games/registry.tsx`.

## Checklist

- [x] Tokens + fonts in `styles.css`
- [x] Carousel with preview layer + backdrop
- [x] Card-game table styling (shared `Card`, `Panel`, `Button` primitives)
- [x] Recorder script + clips for the four card games
- [x] Fortress clip (after step 3)
- [x] New Standup and Last Stand covers ([prompts and provenance](cover-art.md))

The source fallback now lets browsers try MP4 after an unsupported WebM source. Reduced-motion mode keeps the cover still. Fortress uses the same recorded preview layer as the card games.
