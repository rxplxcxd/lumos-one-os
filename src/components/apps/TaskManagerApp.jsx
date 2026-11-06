// Task-Manager ("Strg+Alt+Entf" / Select+Start): running titles, daemon, shell services and
// overlays; hung apps are terminated cleanly (SIGTERM → SIGKILL) by lumosd.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, XCircle, Cpu, MemoryStick, Gauge, Server, AppWindow, Layers } from 'lucide-react';
import { Screen, Button, Hint, Sheet } from '@/components/ui/primitives.jsx';
import { request } from '@/services/bridge.js';
import { useSystem } from '@/store/system.js';
import { useUI, goHome, toast } from '@/store/ui.js';
import { frames, startFpsMeter, memory } from '@/lib/fps.js';
import { replay } from '@/lib/recorder.js';
import { useAction } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { formatBytes } from '@/services/flathub.js';
import { listStagger, itemRise } from '@/lib/motion.js';

function shellTasks() {
  const ui = useUI.getState();
  const out = [{ pid: null, id: 'shell', name: 'Lumos Shell (Oberfläche)', kind: 'shell', cpu: null, rss: memory()?.used, info: `${Math.round(frames.fps || 0)} FPS`, killable: false }];
  ui.stack.slice(1).forEach((s) => out.push({ pid: null, id: `screen:${s.screen}`, name: `Ansicht: ${s.screen}`, kind: 'view', killable: s.screen !== 'taskmanager', screen: s.screen }));
  if (replay.active) out.push({ pid: null, id: 'replay', name: 'Aufnahmepuffer (30 s)', kind: 'service', killable: true });
  if (document.querySelector('[data-pip]')) out.push({ pid: null, id: 'pip', name: 'Bild-in-Bild-Fenster', kind: 'service', killable: true });
  return out;
}

export default function TaskManagerApp() {
  const [procs, setProcs] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const stats = useSystem((s) => s.stats);
  const running = useSystem((s) => s.running);
  const load = async () => {
    const sys = await request('process.list').catch(() => []);
    const builtin = running?.builtin ? [{ pid: null, id: running.id, name: running.name, kind: 'app', cpu: null, rss: null, killable: true, builtin: true }] : [];
    setProcs([...builtin, ...sys, ...shellTasks()]);
  };
  useEffect(() => {
    startFpsMeter();
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  useAction((a) => a === 'x' && document.activeElement?.dataset?.proc && setConfirm(procs.find((p) => String(p.pid ?? p.id) === document.activeElement.dataset.proc)), [procs]);

  const kill = async (p) => {
    setConfirm(null);
    try {
      if (p.builtin) {
        useSystem.setState({ running: null });
        goHome();
      } else if (p.id === 'replay') replay.stop();
      else if (p.id === 'pip') window.dispatchEvent(new Event('lumos:pip-close'));
      else if (p.screen) useUI.setState((s) => ({ stack: s.stack.filter((x) => x.screen !== p.screen) }));
      else {
        const r = await request('process.kill', { pid: p.pid }, 10000);
        toast({ title: `${p.name} beendet`, body: r.signal === 'KILL' ? 'Erzwungen (SIGKILL)' : 'Sauber beendet', kind: 'success' });
      }
      haptic('success');
      load();
    } catch (e) {
      haptic('error');
      toast({ title: 'Beenden fehlgeschlagen', body: e.message, kind: 'error' });
    }
  };

  const ICON = { app: AppWindow, daemon: Server, service: Layers, shell: Activity, view: Layers };
  return (
    <Screen title="Task-Manager" icon={Activity} hints={<><Hint k="x">Beenden</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="mb-5 grid grid-cols-4 gap-3">
        {[
          [Cpu, 'CPU', stats ? `${Math.round(stats.cpu)} %` : '—'],
          [Gauge, 'GPU', stats?.gpu != null ? `${Math.round(stats.gpu)} %` : '—'],
          [MemoryStick, 'RAM', stats ? formatBytes(stats.ram_used) : '—'],
          [Activity, 'Shell', `${Math.round(frames.fps || 0)} FPS`],
        ].map(([I, l, v]) => (
          <div key={l} className="glass rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[0.7rem] text-mist-400"><I className="h-3.5 w-3.5" />{l}</div>
            <div className="mt-1 text-[1.05rem] font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <motion.div variants={listStagger} initial="initial" animate="animate" className="glass overflow-hidden rounded-3xl">
        <div className="grid grid-cols-[1fr_6rem_7rem_6rem_8rem] gap-3 border-b border-white/[0.06] px-4 py-2 text-[0.7rem] uppercase tracking-wider text-mist-500">
          <span>Prozess</span><span className="text-right">CPU</span><span className="text-right">Speicher</span><span className="text-right">PID</span><span />
        </div>
        <AnimatePresence initial={false}>
          {procs.map((p) => {
            const I = ICON[p.kind] || Layers;
            return (
              <motion.div key={p.pid ?? p.id} variants={itemRise} exit={{ opacity: 0, x: 40 }} layout className="grid grid-cols-[1fr_6rem_7rem_6rem_8rem] items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-[0.85rem] last:border-0">
                <span className="flex min-w-0 items-center gap-2.5">
                  <I className="h-4 w-4 shrink-0 text-mist-400" />
                  <span className="truncate">{p.name}</span>
                  {p.info && <span className="text-[0.72rem] text-mist-500">{p.info}</span>}
                </span>
                <span className="text-right tabular-nums text-mist-300">{p.cpu != null ? `${p.cpu} %` : '—'}</span>
                <span className="text-right tabular-nums text-mist-300">{p.rss ? formatBytes(p.rss) : '—'}</span>
                <span className="text-right tabular-nums text-mist-500">{p.pid ?? '—'}</span>
                <span className="flex justify-end">
                  {p.killable && (
                    <button data-nav="" data-proc={String(p.pid ?? p.id)} onClick={() => setConfirm(p)} className="nav-focus flex items-center gap-1.5 rounded-xl bg-bad/15 px-3 py-1.5 text-[0.75rem] font-medium text-bad">
                      <XCircle className="h-3.5 w-3.5" /> Beenden
                    </button>
                  )}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={`„${confirm?.name}“ beenden?`}>
        <p className="mb-4 text-[0.85rem] text-mist-300">Nicht gespeicherter Fortschritt geht verloren. Reagiert die App nicht, wird sie nach 3 Sekunden erzwungen beendet.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Abbrechen</Button>
          <Button variant="danger" autoFocus onClick={() => kill(confirm)}>Beenden</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
