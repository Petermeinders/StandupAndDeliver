// Plays each game with two scripted players in real browsers, and records player one's
// screen as the looping preview clip for the home-page carousel.
//
//   npm run dev            (in another terminal)
//   npm run previews       (all games)   |   npm run previews -- oneo last-stand
//
// It is also the UI smoke test: any step that can't find its button fails the run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { playFortress } from './fortress-browser.mjs';

const BASE = process.env.ARCADE_URL ?? 'http://localhost:5173';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/public/previews');
const VIEW = { width: 360, height: 540 };
const CLIP_SECONDS = 9;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = async (locator) => (await locator.count()) > 0 && (await locator.first().isVisible());

/** Scripts: each plays for a while with visible action, and returns nothing. */
const GAMES = {
  'defend-fortress': { name: 'Protect Thy Fortress', play: pages => playFortress(pages, 14) },
  standup: {
    name: 'Standup & Deliver',
    async play([a, b]) {
      await sleep(900);
      await a.getByRole('button', { name: /Tap to flip/ }).click();
      await sleep(1500);
      for (const emoji of ['👏', '😂', '🔥', '💀']) {
        await b.getByRole('button', { name: `React ${emoji}` }).click();
        await sleep(450);
      }
      await a.getByRole('button', { name: 'I’m done' }).click();
      await sleep(700);
      await b.getByRole('radio', { name: '5' }).click();
      await sleep(300);
      await b.getByRole('button', { name: 'Submit rating' }).click();
      await a.getByRole('button', { name: 'Next speaker' }).waitFor();
      await sleep(3500);
    },
  },

  oneo: {
    name: 'OneO',
    async play(pages) {
      const until = Date.now() + 22_000;
      while (Date.now() < until) {
        for (const page of pages) {
          if (await seen(page.getByText('Back to the lobby'))) return;
          const color = page.getByRole('dialog', { name: 'Choose a color' });
          if (await seen(color)) {
            await color.getByRole('button', { name: 'Blue' }).click();
            continue;
          }
          const playable = page.locator('button.pcard.deal-in:not([disabled])');
          if (await seen(playable)) {
            await playable.first().click();
            await sleep(900);
            continue;
          }
          const draw = page.getByRole('button', { name: /^Draw a card/ });
          if ((await seen(draw)) && (await draw.isEnabled())) {
            await draw.click();
            await sleep(900);
          }
        }
        await sleep(120);
      }
    },
  },

  'cursed-vault': {
    name: 'Cursed Vault',
    async play(pages) {
      const until = Date.now() + 24_000;
      let turn = 0;
      while (Date.now() < until) {
        for (const page of pages) {
          if (await seen(page.getByText('Back to the lobby'))) return;
          const flip = page.getByRole('button', { name: 'Flip a card' });
          if (await seen(flip)) {
            await sleep(700);
            await flip.click({ timeout: 2000 }).catch(() => {});
            await sleep(900);
            continue;
          }
          const gamble = page.getByRole('button', { name: /^Gamble \d/ });
          const gold = page.getByRole('button', { name: 'Put a gold card in the vault' });
          const skull = page.getByRole('button', { name: /Put your skull/ });
          if ((await seen(gamble)) && turn++ % 3 !== 2) {
            const more = page.getByRole('button', { name: 'More cards' });
            if (await more.isEnabled()) await more.click();
            await sleep(500);
            await gamble.click();
            await sleep(800);
          } else if ((await seen(skull)) && turn % 4 === 1) {
            await skull.click();
            await sleep(900);
          } else if (await seen(gold)) {
            await gold.click();
            await sleep(900);
          } else if (await seen(skull)) {
            await skull.click();
            await sleep(900);
          }
        }
        await sleep(120);
      }
    },
  },

  'last-stand': {
    name: 'Last Stand',
    async play(pages) {
      const until = Date.now() + 26_000;
      let n = 0;
      while (Date.now() < until) {
        for (const page of pages) {
          if (await seen(page.getByText('Back to the lobby'))) return;
          const cards = page.locator('button[aria-pressed]:not([disabled])');
          const count = await cards.count();
          if (!count) continue;
          await sleep(500);
          await cards.nth((n++ * 7 + 3) % count).click({ timeout: 2000 }).catch(() => {});
          await sleep(500);
          await page.getByRole('button', { name: /^Lock in \d/ }).click({ timeout: 2000 }).catch(() => {});
        }
        await sleep(150);
      }
    },
  },
};

async function seat(page, as, name, url) {
  await page.goto(`${BASE}${url}${url.includes('?') ? '&' : '?'}as=${as}`);
  return name;
}

async function record(browser, id) {
  const game = GAMES[id];
  const videoDir = mkdtempSync(path.join(tmpdir(), 'arcade-preview-'));
  const ctxA = await browser.newContext({ viewport: VIEW, recordVideo: { dir: videoDir, size: VIEW } });
  const ctxB = await browser.newContext({ viewport: VIEW });
  for (const ctx of [ctxA, ctxB]) await ctx.addInitScript(() => sessionStorage.setItem('fa_settings', JSON.stringify({ experimental: true, sound: false })));
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const started = Date.now();
  for (const p of [a, b]) p.on('pageerror', (e) => { throw new Error(`[${id}] page error: ${e.message}`); });

  await a.goto(`${BASE}/?game=${id}&as=rec1`);
  await a.getByRole('button', { name: `Play ${game.name}` }).click();
  await a.getByLabel('Your name').fill('Peter');
  await a.getByRole('button', { name: 'Create room' }).click();
  const code = await a.locator('[data-room-code]').getAttribute('data-room-code');

  await b.goto(`${BASE}/?join=${code}&as=rec2`);
  await b.getByLabel('Your name').fill('Sam');
  await b.getByRole('button', { name: 'Join room' }).click();
  await a.getByText('In the room (2)').waitFor();

  await a.bringToFront();
  await a.getByRole('button', { name: 'Start game' }).click();
  await a.getByText('In the room').waitFor({ state: 'detached' });
  const offset = (Date.now() - started) / 1000 + 0.4;

  await game.play([a, b]);
  await sleep(600);

  await ctxA.close();
  await ctxB.close();
  const raw = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  const src = path.join(videoDir, raw);
  // Playwright records at CSS-pixel size; a modest upscale keeps text readable on dense phone screens.
  const filter = `scale=${VIEW.width * 1.5}:${VIEW.height * 1.5}:flags=lanczos,fps=24`;
  const cut = ['-y', '-loglevel', 'error', '-ss', offset.toFixed(2), '-t', String(CLIP_SECONDS), '-i', src, '-an', '-vf', filter];
  execFileSync('ffmpeg', [...cut, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', path.join(OUT, `${id}.webm`)]);
  execFileSync('ffmpeg', [...cut, '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, `${id}.mp4`)]);
  rmSync(videoDir, { recursive: true, force: true });
  console.log(`✓ ${id}`);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GAMES);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = false;
for (const id of wanted) {
  if (!GAMES[id]) {
    console.error(`Unknown game "${id}". Known: ${Object.keys(GAMES).join(', ')}`);
    failed = true;
    continue;
  }
  try {
    await record(browser, id);
  } catch (err) {
    failed = true;
    console.error(`✗ ${id}: ${err.message.split('\n')[0]}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
