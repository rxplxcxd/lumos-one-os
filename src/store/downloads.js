// Global download / install queue fed by lumosd flatpak events. Shown on the home screen,
// in the library and in the store — always with a live percentage.
import { create } from 'zustand';
import { on, request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { toast } from './ui.js';

export const useDownloads = create(() => ({ jobs: {}, installed: {} }));
const set = (fn) => useDownloads.setState(fn);
const meta = new Map(); // app id -> {name, icon}

export function startDownloadFeeds() {
  refreshInstalled();
  request('flatpak.jobs').then((jobs) => jobs?.forEach((j) => upsert(j)), () => {});
  const offs = [
    on('flatpak.progress', upsert),
    on('flatpak.done', (j) => {
      const m = meta.get(j.id) || {};
      set((s) => {
        const jobs = { ...s.jobs };
        delete jobs[j.job];
        return { jobs };
      });
      haptic('success');
      toast({ title: j.op === 'install' ? 'Installiert' : 'Entfernt', body: m.name || j.id, icon: m.icon, kind: 'success' });
      refreshInstalled();
    }),
    on('flatpak.error', (j) => {
      set((s) => {
        const jobs = { ...s.jobs };
        delete jobs[j.job];
        return { jobs };
      });
      haptic('error');
      toast({ title: 'Fehlgeschlagen', body: `${meta.get(j.id)?.name || j.id}: ${j.message}`, kind: 'error' });
    }),
  ];
  return () => offs.forEach((f) => f());
}

function upsert(j) {
  const m = meta.get(j.id) || {};
  set((s) => ({ jobs: { ...s.jobs, [j.job]: { ...s.jobs[j.job], ...j, name: j.name || m.name || j.id, icon: j.icon || m.icon } } }));
}

export async function refreshInstalled() {
  try {
    const list = await request('flatpak.list');
    set(() => ({ installed: Object.fromEntries(list.map((a) => [a.id, a])) }));
  } catch {
    /* daemon offline */
  }
}

export async function install(app) {
  meta.set(app.id, { name: app.name, icon: app.icon });
  haptic('select');
  const r = await request('flatpak.install', { id: app.id, remote: 'flathub', name: app.name, icon: app.icon });
  upsert({ job: r.job, id: app.id, op: 'install', percent: 0, stage: 'Wird vorbereitet', name: app.name, icon: app.icon });
  return r;
}

export async function uninstall(app) {
  meta.set(app.id, { name: app.name, icon: app.icon });
  const r = await request('flatpak.uninstall', { id: app.id });
  upsert({ job: r.job, id: app.id, op: 'uninstall', percent: 0, stage: 'Wird entfernt', name: app.name, icon: app.icon });
  return r;
}

export const cancel = (job) => request('flatpak.cancel', { job });

export const jobFor = (jobs, id) => Object.values(jobs).find((j) => j.id === id);
