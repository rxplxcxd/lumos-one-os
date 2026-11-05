// Navigation stack, overlays and toasts.
import { create } from 'zustand';
import { haptic } from '@/services/haptics.js';

export const useUI = create(() => ({
  stack: [{ screen: 'home', params: {} }],
  booted: false,
  locked: false,
  devPanel: false,
  quickMenu: false,
  editWidgets: false,
  toasts: [],
  faceSheet: null, // { reason, state }
  impulse: 0, // bumps on every interaction → background ripple
}));

const set = (p) => useUI.setState(p);
const get = () => useUI.getState();

export const current = () => get().stack.at(-1);

export function open(screen, params = {}) {
  const top = current();
  if (top.screen === screen && JSON.stringify(top.params) === JSON.stringify(params)) return;
  haptic('open');
  set({ stack: screen === 'home' ? [{ screen: 'home', params: {} }] : [...get().stack, { screen, params }] });
}

export function back() {
  const s = get();
  if (s.devPanel) return set({ devPanel: false });
  if (s.quickMenu) return set({ quickMenu: false });
  if (s.editWidgets) return set({ editWidgets: false });
  if (s.stack.length > 1) {
    haptic('close');
    set({ stack: s.stack.slice(0, -1) });
    return true;
  }
  haptic('nav.edge');
  return false;
}

export const goHome = () => {
  if (get().stack.length > 1) haptic('close');
  set({ stack: [{ screen: 'home', params: {} }], quickMenu: false });
};

export const setBooted = () => set({ booted: true });
export const toggleDevPanel = (v) => set({ devPanel: v ?? !get().devPanel });
export const toggleQuickMenu = (v) => set({ quickMenu: v ?? !get().quickMenu });
export const setEditWidgets = (v) => set({ editWidgets: v });
export const setLocked = (v) => set({ locked: v });
export const bumpImpulse = () => set({ impulse: get().impulse + 1 });

let toastSeq = 1;
export function toast(t) {
  const id = toastSeq++;
  set({ toasts: [...get().toasts, { id, kind: 'info', ...t }].slice(-4) });
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), t.duration ?? 3800);
  return id;
}
