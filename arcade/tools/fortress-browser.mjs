// Uses real pointer input against the dev server. No simulation shortcuts or test endpoints.
// ARCADE_URL=http://localhost:5173 node tools/fortress-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

export const snapshot = page => page.evaluate(async () => (await import('/src/lib/store.ts')).getState().game?.state);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async (check, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) { if (Date.now() > deadline) throw new Error('Timed out waiting for Fortress state'); await sleep(50); }
};

export async function fling(page, enemy, sideways = false) {
  await page.bringToFront();
  const box = await page.locator('canvas').boundingBox();
  assert.ok(box, 'Battlefield mounted');
  const point = (x, y) => ({ x: box.x + x / 800 * box.width, y: box.y + y / 360 * box.height });
  const start = point(enemy.x, enemy.y);
  const end = point(sideways ? 5 : Math.max(5, enemy.x - 70), sideways ? enemy.y - 20 : 70);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await sleep(55);
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(start.x + (end.x - start.x) * i / 5, start.y + (end.y - start.y) * i / 5);
    await sleep(16);
  }
  await page.mouse.up();
}

export async function playFortress(pages, seconds = 12) {
  const a = pages[0];
  await a.bringToFront();
  await a.locator('canvas').waitFor();
  await a.getByText('Lighting the watchfires…').waitFor({ state: 'detached' });
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const s = await snapshot(a);
    if (s.phase !== 'WavePlaying') break;
    const enemy = s.enemies.find(e => e.x > 35 && (e.state === 'march' || e.state === 'attacking'));
    if (enemy) await fling(a, enemy);
    else await sleep(120);
  }
  await a.screenshot({ path: '/tmp/fortress-input-debug.png', fullPage: true });
  assert.ok((await snapshot(a)).players.find(p => p.name === 'Peter')?.flings > 0, `Pointer fling reached the server: ${JSON.stringify(await snapshot(a))}`);
}

async function smoke() {
  const base = process.env.ARCADE_URL ?? 'http://localhost:5173';
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const contexts = [];
  try {
    const context = async viewport => {
      const c = await browser.newContext({ viewport }); contexts.push(c);
      await c.addInitScript(() => localStorage.setItem('fa_settings', JSON.stringify({ experimental: true, sound: false })));
      return c;
    };
    const ca = await context({ width: 1100, height: 850 });
    const cb = await context({ width: 390, height: 844 });
    const a = await ca.newPage(), b = await cb.newPage();
    for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));
    const requests = []; a.on('request', r => requests.push(r.url()));
    await a.goto(`${base}/?game=defend-fortress`);
    await a.getByRole('button', { name: 'Play Protect Thy Fortress' }).waitFor();
    assert.equal(requests.some(url => /phaser/i.test(url)), false, 'Home does not load Phaser');
    await a.getByRole('button', { name: 'Play Protect Thy Fortress' }).click();
    await a.getByLabel('Your name').fill('Peter');
    await a.getByRole('button', { name: 'Create room' }).click();
    const code = await a.locator('[data-room-code]').getAttribute('data-room-code');
    await b.goto(`${base}/?join=${code}`);
    await b.getByLabel('Your name').fill('Sam');
    await b.getByRole('button', { name: 'Join room' }).click();
    await b.getByRole('button', { name: 'Take artillery seat', exact: true }).click();
    await b.getByRole('button', { name: /Artillery selected/ }).waitFor();
    await a.getByRole('button', { name: 'Start game' }).click();
    await a.locator('canvas').waitFor(); await b.locator('canvas').waitFor();
    await a.getByText('Lighting the watchfires…').waitFor({ state: 'detached' });
    await b.getByText('Lighting the watchfires…').waitFor({ state: 'detached' });
    await playFortress([a, b], 8);
    const box = await b.locator('canvas').boundingBox();
    await b.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
    await wait(async () => (await snapshot(a)).artilleryCooldown > 0);
    await a.screenshot({ path: '/tmp/fortress-desktop.png', fullPage: true });
    await b.screenshot({ path: '/tmp/fortress-artillery.png', fullPage: true });
    await a.getByRole('button', { name: 'Pause wave', exact: true }).click();
    await b.getByText('Paused', { exact: true }).waitFor();
    const frozen = (await snapshot(b)).enemies;
    await sleep(250); assert.deepEqual((await snapshot(b)).enemies, frozen);
    await ca.setOffline(true); await sleep(300); await ca.setOffline(false);
    await wait(async () => (await a.evaluate(async () => (await import('/src/lib/store.ts')).getState().conn)) === 'online');
    await a.reload(); await a.locator('canvas').waitFor();
    await a.getByRole('button', { name: 'Resume wave', exact: true }).last().click();
    await wait(async () => !(await snapshot(b)).isPaused);
    // A genuine late player sees the scene but has no combat authority until the shop.
    const cc = await context({ width: 390, height: 844 }); const c = await cc.newPage();
    c.on('pageerror', e => errors.push(e.message));
    await c.goto(`${base}/?join=${code}`); await c.getByLabel('Your name').fill('Robin');
    await c.getByRole('button', { name: 'Join room' }).click();
    await c.getByText('Watching this wave. Join the defence at the next shop.').waitFor();
    // Clear the first wave using the same pointer controls a human uses.
    const deadline = Date.now() + 75_000;
    while ((await snapshot(a)).phase === 'WavePlaying') {
      if (Date.now() > deadline) throw new Error('Wave did not finish');
      const enemy = (await snapshot(a)).enemies.find(e => e.x > 30 && (e.state === 'march' || e.state === 'attacking'));
      if (enemy) await fling(a, enemy, true); else await sleep(70);
    }
    await a.getByRole('region', { name: 'Fortress shop' }).waitFor();
    assert.equal((await snapshot(c)).players.find(p => p.name === 'Robin').role, 'flinger');
    await a.screenshot({ path: '/tmp/fortress-shop.png', fullPage: true });
    await a.getByText('Save this run / load a save').click();
    const downloaded = a.waitForEvent('download');
    await a.getByRole('button', { name: 'Download save' }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'fortress-wave-1.json');
    await download.saveAs('/tmp/fortress-save.json');
    await a.getByLabel('Fortress save file').setInputFiles('/tmp/fortress-save.json');
    await a.getByRole('heading', { name: 'Save loaded: wave 1 cleared.' }).waitFor();
    // Buy a real affordable upgrade if fling earnings reached its price.
    const before = await snapshot(a);
    if (before.players[0].gold >= 150) {
      await a.getByRole('button', { name: /^Archers/ }).click();
      await wait(async () => (await snapshot(a)).players[0].upgrades.archer === 2);
    }
    await a.setViewportSize({ width: 390, height: 844 });
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout fits viewport');
    await a.screenshot({ path: '/tmp/fortress-mobile.png', fullPage: true });
    await a.getByRole('button', { name: 'Ready for next wave', exact: true }).click();
    await b.getByRole('button', { name: 'Ready for next wave', exact: true }).click();
    await c.getByRole('button', { name: 'Ready for next wave', exact: true }).click();
    await wait(async () => (await snapshot(a)).wave === 2);
    assert.equal((await snapshot(b)).wave, 2);
    assert.deepEqual(errors, []);
    console.log('✓ Fortress: lazy loading, pointer flings, artillery, pause, reload/reconnect, late join, wave clear, shop, save round trip, mobile and ready-up');
  } finally { for (const c of contexts) await c.close(); await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await smoke();
