// "Clip speichern" / "Screenshot" actions (Schnellzugriff, F10/F11, Capture-Taste lang).
import { replay, screenshotBlob, captureSource } from '@/lib/recorder.js';
import { saveCapture } from './captures.js';
import { request } from './bridge.js';
import { toast } from '@/store/ui.js';
import { haptic } from './haptics.js';
import { useSystem } from '@/store/system.js';

export async function saveClip() {
  // a real game is running → lumosd's gpu-screen-recorder replay buffer has the frames
  const running = useSystem.getState().running;
  if (running && !running.builtin) {
    try {
      const r = await request('capture.clip', {}, 20000);
      haptic('success');
      toast({ title: 'Clip gespeichert', body: r.path, kind: 'success' });
      return;
    } catch {
      /* fall back to the shell recorder */
    }
  }
  if (!replay.active) {
    toast({ title: 'Kein Aufnahmepuffer', body: captureSource() ? 'Puffer startet gerade' : 'In Spielen automatisch aktiv – oder unter Aufnahmen „Bildschirmaufnahme aktivieren“', kind: 'info' });
    return;
  }
  try {
    const r = await replay.save(30);
    const meta = await saveCapture({ blob: r.blob, kind: 'video', duration: r.duration, trimStart: r.trimStart, source: running?.name || 'Lumos One' });
    haptic('success');
    const { open } = await import('@/store/ui.js');
    toast({ title: 'Clip gespeichert', body: `Letzte ${Math.round(Math.min(30, r.duration))} s`, kind: 'success', actions: [{ label: 'Bearbeiten', primary: true, run: () => open('captures', { edit: meta.id }) }], duration: 6000 });
  } catch (e) {
    haptic('error');
    toast({ title: 'Clip fehlgeschlagen', body: e.message, kind: 'error' });
  }
}

export async function takeScreenshot() {
  const running = useSystem.getState().running;
  if (running && !running.builtin) {
    try {
      const r = await request('capture.screenshot', {}, 10000);
      haptic('success');
      toast({ title: 'Screenshot gespeichert', body: r.path, kind: 'success' });
      return;
    } catch {
      /* fall through */
    }
  }
  const blob = await screenshotBlob();
  if (!blob) return toast({ title: 'Screenshot nicht möglich', kind: 'error' });
  await saveCapture({ blob, kind: 'image', source: running?.name || 'Lumos One' });
  haptic('success');
  // white flash like a camera shutter
  const f = document.createElement('div');
  Object.assign(f.style, { position: 'fixed', inset: 0, background: 'white', opacity: 0.7, zIndex: 120, pointerEvents: 'none', transition: 'opacity 400ms ease-out' });
  document.body.appendChild(f);
  requestAnimationFrame(() => (f.style.opacity = 0));
  setTimeout(() => f.remove(), 450);
  toast({ title: 'Screenshot gespeichert', kind: 'success', duration: 2000 });
}
