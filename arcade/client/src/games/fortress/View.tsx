import { FORTRESS_UPGRADES, fortressUpgradeCost, type FortressState } from '@arcade/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/socket';
import { getState, toast, useStore } from '../../lib/store';
import { playSound } from '../../lib/sound';
import { Accordion, WinnerScreen } from '../../shell/ui';
import type { GameViewProps } from '../registry';

export default function FortressView({ state, room, me }: GameViewProps<FortressState>) {
  const mount = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const file = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const conn = useStore(s => s.conn);
  const player = state.players.find(p => p.name === me);
  const artillery = player?.role === 'artillery';
  const spectator = !player || player.role === 'spectator';
  const host = room.players.some(p => p.name === me && p.isHost);
  const active = state.phase === 'WavePlaying' && !state.isPaused && !spectator && conn === 'online';
  const shop = state.phase === 'Shop';
  const ended = state.phase === 'GameOver';

  useEffect(() => {
    if (ended) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setReady(false);
    setError('');
    import('./scene').then(({ mountBattlefield }) => {
      if (cancelled || !mount.current) return;
      destroy = mountBattlefield(mount.current, {
        state: () => latest.current, me, artillery,
        connected: () => getState().conn === 'online',
        send: (action, payload) => api.act(action, payload, true),
        ready: () => { if (!cancelled) setReady(true); },
      });
    }).catch(() => { if (!cancelled) setError('The battlefield could not load. Reload to reconnect to this game.'); });
    return () => { cancelled = true; destroy?.(); };
  }, [me, artillery, ended]);

  const act = async (action: string, payload?: unknown) => {
    setBusy(true);
    try {
      const res = await api.act(action, payload);
      if (res.ok && action === 'PurchaseUpgrade') playSound('gold');
    } finally { setBusy(false); }
  };

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await stage.current?.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
      await orientation.lock?.(artillery ? 'portrait' : 'landscape').catch(() => {});
    } catch { toast('Fullscreen is unavailable here. Turn your phone sideways for a larger battlefield.'); }
  };

  const exportSave = () => {
    // v1 is the existing run + exporting player's wallet format, compatible with the .NET export.
    const save = { schemaVersion: 1, gameType: 'defend-fortress', wave: state.wave, gameMode: state.gameMode,
      fortressHp: state.fortressHp, fortressMaxHp: state.fortressMaxHp, gold: player?.gold ?? 0,
      castleUpgrades: Object.fromEntries(Object.entries(player?.upgrades ?? {}).filter(([id]) => !id.startsWith('sling_'))) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fortress-wave-${state.wave}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importSave = async (saveFile?: File) => {
    if (!saveFile) return;
    if (saveFile.size > 48_000) { toast('Save file is too large.', 'error'); return; }
    try { await act('ImportSave', { save: JSON.parse(await saveFile.text()) }); }
    catch { toast('That file is not a valid JSON save.', 'error'); }
    finally { if (file.current) file.current.value = ''; }
  };

  if (ended) return <WinnerScreen title={state.victory ? 'The fortress stands!' : 'The fortress has fallen'} subtitle={state.resultMessage ?? undefined}>
    <p>Wave {state.wave} · {player?.kills ?? 0} kills · {player?.flings ?? 0} flings</p>
  </WinnerScreen>;

  return <main className="screen-in mx-auto max-w-6xl px-3 py-4 sm:px-6" data-fortress-phase={state.phase}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-smoke">Protect Thy Fortress</p>
        <h1 className="font-display text-3xl">Wave {state.wave}<span className="text-lg text-smoke">{state.victoryWave ? ` / ${state.victoryWave}` : ' · Endless'}</span></h1></div>
      <div className="text-right"><p className="font-display text-2xl text-flame">{player?.gold ?? 0} gold</p>
        <p className="text-xs text-smoke">{state.enemiesRemaining} enemies remaining</p></div>
    </div>
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs"><span>Fortress walls</span><span>{state.fortressHp} / {state.fortressMaxHp} HP</span></div>
      <progress className="fortress-health" value={state.fortressHp} max={state.fortressMaxHp} aria-label="Fortress health" />
    </div>
    <div ref={stage} className={`fortress-stage ${artillery ? 'is-artillery' : ''}`}>
      <button className="fortress-exit btn btn-quiet" onClick={() => void document.exitFullscreen()}>Exit fullscreen</button>
      <div ref={mount} className="fortress-canvas" role="img" aria-label={artillery ? 'Artillery battlefield. Tap to aim and release to fire.' : 'Fortress battlefield. Drag a skeleton and release to fling it.'} />
      {!ready && <div className="fortress-overlay">{error || 'Lighting the watchfires…'}</div>}
      {state.isPaused && <div className="fortress-overlay"><strong className="font-display text-3xl">Paused</strong><p className="text-sm">by {state.pausedBy}</p>{host && <button className="btn btn-primary mt-3" onClick={() => act('TogglePause')}>Resume wave</button>}</div>}
      {state.phase === 'Countdown' && <div className="fortress-overlay"><span className="text-sm">Next wave in</span><strong className="font-display text-6xl text-flame">{Math.max(1, Math.ceil(state.countdownRemaining))}</strong></div>}
    </div>
    <div className="my-3 flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm text-smoke">{room.players.find(p => p.name === me)?.away ? 'Sitting out for the rest of this game.' : spectator ? 'Watching this wave. Join the defence at the next shop.' : artillery ? `Artillery · ${state.artilleryCooldown > 0 ? 'Reloading…' : 'Tap the field to aim and fire'}` : 'Grab a skeleton, swipe up, and let go.'}</p>
      <button className="btn btn-quiet px-3 py-2 text-sm" onClick={fullscreen}>Fullscreen</button>
      {host && state.phase === 'WavePlaying' && <button className="btn btn-quiet px-3 py-2 text-sm" disabled={busy || conn !== 'online'} onClick={() => act('TogglePause')}>{state.isPaused ? 'Resume wave' : 'Pause wave'}</button>}
      {(state.castleUpgrades.wizard ?? 0) > 0 && <button className="btn btn-primary px-3 py-2 text-sm" disabled={!active || state.wizardCooldown > 0 || busy} onClick={() => act('CastWizardSpell')}>{state.wizardCooldown > 0 ? `Fireball · ${state.wizardCooldown.toFixed(1)}s` : 'Cast fireball'}</button>}
    </div>
    {!artillery && <p className="mb-3 text-xs text-smoke sm:hidden">Turn your phone sideways or use fullscreen for more throwing room.</p>}
    {shop && <section className="panel mb-4 p-4 sm:p-6" aria-label="Fortress shop">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-3xl text-flame">{state.resultMessage}</h2><p className="text-sm text-smoke">Spend your gold. Get ready for wave {state.wave + 1}.</p></div>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || spectator || conn !== 'online'} onClick={() => act('ReadyForWave', { ready: !player?.ready })}>{player?.ready ? 'Cancel ready' : 'Ready for next wave'}</button>
          {host && <button className="btn btn-quiet" disabled={busy || conn !== 'online'} onClick={() => act('StartNextWave')}>Start next wave now</button>}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FORTRESS_UPGRADES.filter(u => !u.artillery || artillery).map(u => {
          const tier = player?.upgrades[u.id] ?? 0;
          const cost = fortressUpgradeCost(u.id, tier);
          const gold = u.artillery ? player?.artilleryGold ?? 0 : player?.gold ?? 0;
          return <button key={u.id} className="fortress-upgrade" disabled={busy || spectator || conn !== 'online' || gold < cost || (u.id === 'repair' && state.fortressHp === state.fortressMaxHp)} onClick={() => act('PurchaseUpgrade', { upgradeId: u.id })}>
            <span className="flex justify-between gap-2 font-bold"><span>{u.name} <span className="text-xs text-smoke">{tier > 0 && `· tier ${tier}`}</span></span><span className="text-flame">{cost}</span></span>
            <span className="mt-1 block text-xs text-smoke">{u.blurb}{u.artillery && ' · artillery gold'}</span>
          </button>;
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button className="btn btn-quiet" disabled={busy || spectator || conn !== 'online' || (!!state.artilleryPlayerName && !artillery)} onClick={() => act('VolunteerArtillery')}>{artillery ? 'Switch to flinger' : 'Take artillery seat'}</button>
        <span className="text-smoke">{state.artilleryPlayerName ? `${state.artilleryPlayerName} on artillery` : 'Artillery seat open'} · {player?.artilleryGold ?? 0} artillery gold</span>
      </div>
      {host && <details className="mt-5 text-sm"><summary className="cursor-pointer text-smoke">Save this run / load a save</summary>
        <p className="my-3 text-smoke">Saves contain the cleared wave, walls, mode, and your castle upgrades and gold. Other players’ wallets and artillery upgrades stay in this session. Loading replaces your saved values and clears everyone’s ready status.</p>
        <div className="flex gap-2"><button className="btn btn-quiet" onClick={exportSave}>Download save</button><button className="btn btn-quiet" disabled={busy} onClick={() => file.current?.click()}>Load save</button></div>
        <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Fortress save file" onChange={e => importSave(e.target.files?.[0])} />
      </details>}
    </section>}
    <section className="panel mb-4 p-4" aria-label="Defenders">
      <h2 className="mb-3 font-semibold">Defenders</h2>
      <ul className="flex flex-wrap gap-3">{state.players.map(p => <li key={p.name} className={`rounded-xl px-3 py-2 text-sm ${p.name === me ? 'bg-ember/15 ring-1 ring-ember/40' : 'bg-night/50'}`}>
        <strong>{p.name}</strong> <span className="text-smoke">· {p.role}{!p.isConnected && ' · offline'}</span>
        <p className="text-xs text-smoke">{p.kills} kills · {p.flings} flings{shop && (p.ready ? ' · Ready ✓' : ' · Shopping')}</p>
      </li>)}</ul>
    </section>
    <Accordion title="How to defend"><p>Fling skeletons high into the air or into each other. Your archers attack automatically. Between waves, buy upgrades with gold from kills. A mage unlocks fireballs; engineers repair the walls.</p><p>One player can take the artillery seat. Aim at airborne enemies for a combo that hits nearby skeletons. Everyone readies up to begin the next wave; the host can start early.</p></Accordion>
  </main>;
}
