// Live hardware state fed by daemon events.
import { create } from 'zustand';
import { on, onStatus, request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';

export const useSystem = create(() => ({
  daemon: { connected: false, mode: 'connecting' },
  info: null,
  battery: { percent: null, charging: false },
  controllers: [],
  dock: { docked: false, mode: 'handheld' },
  media: null,
  stats: null,
  network: null,
  detachEvent: null, // last attach/detach for the edge popup
  running: null,
}));

// Gyro is high-frequency: kept outside React state, read by the background renderer per frame.
export const gyro = { pitch: 0, roll: 0, yaw: 0, t: 0 };

const set = (p) => useSystem.setState(p);

export function startSystemFeeds() {
  const offs = [
    onStatus((s) => {
      set({ daemon: s });
      if (s.connected) refresh();
    }),
    on('battery', (b) => set({ battery: b })),
    on('controllers.changed', (list) => set({ controllers: list })),
    on('controller.attached', (c) => {
      haptic('controller.attach');
      set({ detachEvent: { kind: 'attached', c, t: Date.now() } });
    }),
    on('controller.detached', (c) => {
      haptic('controller.detach');
      set({ detachEvent: { kind: 'detached', c, t: Date.now() } });
    }),
    on('dock.changed', (d) => {
      haptic('notify');
      set({ dock: d });
    }),
    on('media.state', (m) => set({ media: m })),
    on('system.stats', (s) => set({ stats: s })),
    on('library.launched', (r) => set({ running: r })),
    on('library.exited', () => set({ running: null })),
    on('gyro', (g) => {
      gyro.pitch = g.pitch;
      gyro.roll = g.roll;
      gyro.yaw = g.yaw;
      gyro.t = performance.now();
    }),
  ];
  const statsTimer = setInterval(() => {
    if (useSystem.getState().daemon.connected) request('system.stats').then((s) => set({ stats: s }), () => {});
  }, 3000);
  return () => {
    offs.forEach((f) => f());
    clearInterval(statsTimer);
  };
}

async function refresh() {
  const tryReq = (m, p) => request(m, p).catch(() => null);
  const [info, controllers, dock, media, network] = await Promise.all([tryReq('system.info'), tryReq('controllers.list'), tryReq('dock.status'), tryReq('media.status'), tryReq('network.status')]);
  set({ info, controllers: controllers || [], dock: dock || { docked: false }, media, network });
  const b = await tryReq('power.battery');
  if (b) set({ battery: b });
}
