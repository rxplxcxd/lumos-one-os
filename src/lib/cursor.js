// Virtual "light donut" pointer driven by the left stick. Hovering focuses the element under it
// (halo + focus springs = hover animation), A clicks at the pointer position.
import { focusEl } from '@/lib/spatialNav.js';
import { haptic } from '@/services/haptics.js';

export const cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2, visible: false, lastMove: 0, hover: null, pressed: 0 };
const listeners = new Set();
export const onCursor = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((f) => f(cursor));

export const cursorActive = () => cursor.visible && performance.now() - cursor.lastMove < 4000;

export function moveCursor(dx, dy) {
  cursor.x = Math.max(0, Math.min(window.innerWidth - 1, cursor.x + dx));
  cursor.y = Math.max(0, Math.min(window.innerHeight - 1, cursor.y + dy));
  cursor.visible = true;
  cursor.lastMove = performance.now();
  const under = document.elementFromPoint(cursor.x, cursor.y);
  // synthetic pointer move: tilt effects and :hover-like logic follow the virtual cursor
  under?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' }));
  const target = under?.closest?.('[data-nav]:not([disabled])') || null;
  if (target !== cursor.hover) {
    cursor.hover = target;
    if (target && document.activeElement !== target) focusEl(target, { silent: true, scroll: false });
    if (target) haptic('nav.tick');
  }
  emit();
}

export function cursorClick() {
  cursor.pressed = performance.now();
  cursor.lastMove = performance.now();
  emit();
  const el = cursor.hover || document.elementFromPoint(cursor.x, cursor.y);
  if (!el) return false;
  const opts = { bubbles: true, cancelable: true, clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  haptic(el.dataset?.navHaptic && el.dataset.navHaptic !== 'none' ? el.dataset.navHaptic : 'select');
  if (el.matches?.('input:not([type=checkbox]):not([type=range]), textarea')) {
    el.focus();
    window.dispatchEvent(new CustomEvent('lumos:osk', { detail: { target: el } }));
  } else el.click();
  window.dispatchEvent(new CustomEvent('lumos:activate', { detail: { el } }));
  return true;
}

export function hideCursor() {
  if (!cursor.visible) return;
  cursor.visible = false;
  cursor.hover = null;
  emit();
}

/** Analog scroll (right stick): scrolls the scrollable under the cursor, else around the focus. */
export function analogScroll(dx, dy) {
  let el = (cursorActive() && document.elementFromPoint(cursor.x, cursor.y)) || document.activeElement;
  const ev = new CustomEvent('lumos:rs-scroll', { cancelable: true, detail: { dx, dy, x: cursor.x, y: cursor.y } });
  if (!window.dispatchEvent(ev)) return; // PiP / webview took it
  while (el && el !== document.body) {
    const st = getComputedStyle(el);
    const canY = /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const canX = /(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if ((dy && canY) || (dx && canX)) {
      el.scrollBy({ left: canX ? dx : 0, top: canY ? dy : 0 });
      return;
    }
    el = el.parentElement;
  }
}
