// Everything that happens around a game session:
//  • replay buffer (30 s clips) while a title runs
//  • per-game profiles for built-in titles (daemon handles launched apps itself)
//  • automatic cloud save upload when the game exits (with conflict detection)
import { on, request, notify } from './bridge.js';
import { useSettings } from '@/store/settings.js';
import { useCloud, syncSave } from './cloud/cloudService.js';
import { permsOf } from '@/components/settings/AppsSection.jsx';
import { toast } from '@/store/ui.js';
import { haptic } from './haptics.js';

const EMU_SAVES = {
  'org.libretro.RetroArch': 'retroarch',
  'org.ppsspp.PPSSPP': 'ppsspp',
  'org.DolphinEmu.dolphin-emu': 'dolphin',
  'net.pcsx2.PCSX2': 'pcsx2',
  'net.kuribo64.melonDS': 'melonds',
  'org.prismlauncher.PrismLauncher': 'prism',
};

export function saveIdFor(itemId) {
  if (itemId.startsWith('steam:')) return `steam-${itemId.slice(6)}`;
  if (itemId.startsWith('flatpak:')) return EMU_SAVES[itemId.slice(8)] || null;
  return null;
}

export async function autoCloudSave(itemId, { quiet = false } = {}) {
  const v = useSettings.getState().values;
  const sid = saveIdFor(itemId);
  if (!sid || !v.autoCloudSave || !v.cloudSyncSaves || !useCloud.getState().user) return;
  if (!permsOf(v.appPermissions, itemId).cloud) return;
  const local = (await request('saves.list').catch(() => [])).find((s) => s.id === sid);
  if (!local) return;
  try {
    const r = await syncSave(local, { auto: true });
    if (r.status === 'uploaded' && !quiet) toast({ title: 'Spielstand gesichert', body: `${local.title} → Lumos Cloud`, kind: 'success' });
    if (r.status === 'conflict' || r.status === 'cloud-newer') {
      haptic('notify');
      const { open } = await import('@/store/ui.js');
      toast({
        title: r.status === 'conflict' ? 'Spielstand-Konflikt' : 'Neuerer Spielstand in der Cloud',
        body: `${local.title}: lokal und Cloud unterscheiden sich`,
        kind: 'info',
        duration: 12000,
        actions: [{ label: 'Vergleichen', primary: true, run: () => open('cloud', { conflict: sid }) }],
      });
    }
  } catch (e) {
    toast({ title: 'Cloud-Sicherung fehlgeschlagen', body: e.message, kind: 'error' });
  }
}

let restore = null;
export function applyBuiltinProfile(itemId) {
  const p = useSettings.getState().values.gameProfiles[itemId];
  if (!p) return;
  const v = useSettings.getState().values;
  restore = { fps_limit: v.fpsLimit, refresh: v.refreshRate, tdp: v.tdp, profile: v.powerProfile };
  notify('display.set', { fps_limit: p.fps, ...(p.refresh ? { refresh: p.refresh } : {}) });
  notify('power.set', { profile: 'custom', tdp_w: p.tdp });
  toast({ title: 'Spielprofil geladen', body: `${p.fps || '∞'} FPS · ${p.tdp} W`, kind: 'info', duration: 2200 });
}
export function restoreBuiltinProfile() {
  if (!restore) return;
  notify('display.set', { fps_limit: restore.fps_limit, refresh: restore.refresh });
  notify('power.set', { profile: restore.profile, tdp_w: restore.tdp });
  restore = null;
}

function startPlaytimeTracking() {
  return setInterval(async () => {
    const { useSystem } = await import('@/store/system.js');
    const { useUI, goHome } = await import('@/store/ui.js');
    const { useProfiles, activeProfile } = await import('@/store/profile.js');
    const { addPlayMinute, minutesToday } = await import('@/store/parental.js');
    const running = useSystem.getState().running;
    const builtin = useUI.getState().stack.at(-1)?.screen === 'game';
    if (!running && !builtin) return;
    const p = activeProfile(useProfiles.getState());
    if (!p) return;
    addPlayMinute(p.id);
    const limit = p.role === 'child' ? p.controls?.dailyMinutes || 0 : 0;
    if (!limit) return;
    const used = minutesToday(p.id);
    if (used === limit - 5) toast({ title: 'Noch 5 Minuten', body: 'Die tägliche Spielzeit ist gleich erreicht', kind: 'battery', duration: 8000 });
    if (used >= limit) {
      haptic('notify');
      toast({ title: 'Spielzeit für heute erreicht', body: 'Bis morgen! (Eltern können das Limit anpassen)', kind: 'info', duration: 10000 });
      if (builtin) goHome();
      if (running?.pid) request('process.kill', { pid: running.pid }).catch(() => {});
    }
  }, 60000);
}

export function startGameSession() {
  const timer = startPlaytimeTracking();
  const offs = [
    () => clearInterval(timer),
    on('library.launched', ({ id }) => {
      if (useSettings.getState().values.replayBuffer) notify('capture.buffer', { on: true, seconds: 30 });
      const p = useSettings.getState().values.gameProfiles[id];
      if (p) toast({ title: 'Spielprofil geladen', body: `${p.fps || '∞'} FPS · ${p.tdp} W`, kind: 'info', duration: 2200 });
    }),
    on('library.exited', ({ id }) => {
      notify('capture.buffer', { on: false });
      autoCloudSave(id);
    }),
  ];
  return () => offs.forEach((f) => f());
}
