// Build first. Starts an isolated production server, checks HTTP and lazy Phaser boot, then stops it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
const port = process.env.ARCADE_SMOKE_PORT ?? '3012';
const base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(path.join(tmpdir(), 'arcade-production-'));
const server = spawn(process.execPath, ['server/dist/index.js'], { env: { ...process.env, PORT: port, DATA_DIR: dir }, stdio: 'pipe' });
let logs = ''; server.stderr.on('data', data => { logs += data; });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${logs}`);
    try { ready = (await fetch(`${base}/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Production server healthy');
  assert.ok((await (await fetch(base)).text()).includes('/assets/'));
  browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const requests = []; const errors = [];
  p.on('request', r => requests.push(r.url())); p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}/?game=defend-fortress`);
  await p.getByRole('button', { name: 'Play Protect Thy Fortress' }).waitFor();
  assert.equal(requests.some(u => /\/assets\/scene-/.test(u)), false);
  await p.getByRole('button', { name: 'Play Protect Thy Fortress' }).click();
  await p.getByLabel('Your name').fill('Production smoke');
  await p.getByRole('button', { name: 'Create room' }).click();
  await p.getByRole('button', { name: 'Start game' }).click();
  await p.locator('canvas').waitFor();
  await p.getByText('Lighting the watchfires…').waitFor({ state: 'detached' });
  assert.ok(requests.some(u => /\/assets\/scene-/.test(u)));
  await p.getByRole('button', { name: 'Pause wave', exact: true }).click();
  await p.getByText('Paused', { exact: true }).waitFor();
  await p.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await p.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('✓ Production: health, built client/assets, Socket.IO room, lazy Phaser scene, pause and fullscreen exit');
} finally {
  await browser?.close();
  const exited = new Promise(resolve => server.once('exit', resolve));
  if (server.exitCode === null) { server.kill('SIGTERM'); await exited; }
  rmSync(dir, { recursive: true, force: true });
}
