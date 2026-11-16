// Smoke check selected preview playback, reduced motion, fallback, and lazy Phaser loading.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.ARCADE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
try {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  const errors = []; const requests = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('request', r => requests.push(r.url()));
  await p.goto(`${base}/?game=last-stand`);
  await p.getByRole('button', { name: 'Play Last Stand', exact: true }).waitFor();
  await p.waitForTimeout(1200);
  assert.ok(await p.locator('video').evaluateAll(videos => videos.every(v => v.paused)));
  assert.ok(await p.locator('img[src="/covers/last-stand.webp"]').first().evaluate(img => img.complete && img.naturalWidth > 0));
  await p.screenshot({ path: '/tmp/arcade-home-cover.png', fullPage: true });
  // A deep link makes an experimental tile visible even before its setting is enabled.
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.goto(`${base}/?game=defend-fortress`);
  await p.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.currentSrc.includes('defend-fortress') && !v.paused && v.currentTime > .2));
  const video = p.locator('video[src="/previews/defend-fortress.webm"]');
  assert.ok(await video.evaluate(v => v.classList.contains('is-playing')));
  await p.screenshot({ path: '/tmp/arcade-home-preview.png', fullPage: true });
  assert.equal(requests.some(u => /phaser/i.test(u)), false);
  // A browser that cannot load WebM should still try the MP4 source.
  await p.route('**/previews/*.webm', route => route.abort());
  await p.goto(`${base}/?game=standup`);
  await p.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.currentSrc.endsWith('standup.mp4') && !v.paused && v.currentTime > .2)).catch(async err => { console.error(await p.locator('video').evaluateAll(videos => videos.map(v => ({ src: v.currentSrc, error: v.error?.message, state: v.readyState, paused: v.paused, time: v.currentTime, mp4: v.canPlayType('video/mp4') })))); throw err; });
  assert.deepEqual(errors, []);
  console.log('✓ Carousel: new cover, reduced motion, Fortress deep link and fade, MP4 fallback, no Phaser on home');
  await c.close();
} finally { await browser.close(); }
