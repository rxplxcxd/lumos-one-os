// Home-screen widget layout (16-column unit grid; sizes 2×2, 4×4, 6×6).
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/services/storage.js';

export const WIDGET_TYPES = {
  system: { label: 'Akku & System', sizes: [2, 4, 6] },
  weather: { label: 'Wetter', sizes: [2, 4, 6] },
  music: { label: 'Musik', sizes: [2, 4, 6] },
  quick: { label: 'Schnellstart', sizes: [2, 4, 6] },
  clock: { label: 'Uhr & Kalender', sizes: [2, 4, 6] },
  controllers: { label: 'Controller', sizes: [2, 4] },
  cloud: { label: 'Lumos Cloud', sizes: [2, 4] },
  notes: { label: 'Notizen', sizes: [2, 4, 6] },
  downloads: { label: 'Downloads', sizes: [2, 4] },
};

const DEFAULT_LAYOUT = [
  { id: 'w1', type: 'weather', size: 4 },
  { id: 'w2', type: 'system', size: 4 },
  { id: 'w3', type: 'music', size: 4 },
  { id: 'w4', type: 'clock', size: 2 },
  { id: 'w5', type: 'controllers', size: 2 },
  { id: 'w6', type: 'quick', size: 2 },
  { id: 'w7', type: 'cloud', size: 2 },
];

export const useWidgets = create(() => ({ layout: loadJSON('lumos.widgets', DEFAULT_LAYOUT) }));
const persist = () => saveJSON('lumos.widgets', useWidgets.getState().layout);

export function addWidget(type, size) {
  useWidgets.setState((s) => ({ layout: [...s.layout, { id: `w${Date.now().toString(36)}`, type, size }] }));
  persist();
}
export function removeWidget(id) {
  useWidgets.setState((s) => ({ layout: s.layout.filter((w) => w.id !== id) }));
  persist();
}
export function cycleWidgetSize(id) {
  useWidgets.setState((s) => ({
    layout: s.layout.map((w) => {
      if (w.id !== id) return w;
      const sizes = WIDGET_TYPES[w.type].sizes;
      return { ...w, size: sizes[(sizes.indexOf(w.size) + 1) % sizes.length] };
    }),
  }));
  persist();
}
export function moveWidget(id, dir) {
  useWidgets.setState((s) => {
    const l = [...s.layout];
    const i = l.findIndex((w) => w.id === id);
    const j = Math.max(0, Math.min(l.length - 1, i + dir));
    [l[i], l[j]] = [l[j], l[i]];
    return { layout: l };
  });
  persist();
}
export const resetWidgets = () => (useWidgets.setState({ layout: DEFAULT_LAYOUT }), persist());
