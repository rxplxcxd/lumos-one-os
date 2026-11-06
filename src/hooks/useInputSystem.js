// Unifies keyboard, Gamepad API (uinput pad from lumosd, external pads) and daemon virtual
// buttons into semantic actions, with key-repeat for held directions.
import { useEffect } from 'react';
import { move, activate, ensureFocus } from '@/lib/spatialNav.js';
import { back, goHome, toggleDevPanel, toggleQuickMenu, bumpImpulse, useUI } from '@/store/ui.js';
import { on } from '@/services/bridge.js';
import { useSettings } from '@/store/settings.js';
import { setLastInput } from '@/components/shell/OnScreenKeyboard.jsx';

export function emitAction(action) {
  window.dispatchEvent(new CustomEvent('lumos:action', { detail: { action } }));
}

export function dispatch(action) {
  bumpImpulse();
  const swap = useSettings.getState().values.swapAB;
  if (swap && (action === 'a' || action === 'b')) action = action === 'a' ? 'b' : 'a';
  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      move(action);
      break;
    case 'a':
      activate();
      break;
    case 'b':
      // like the Switch: A starts editing a field (on-screen keyboard), B closes the keyboard,
      // a second B leaves the screen — focus never gets trapped inside a text field
      if (document.querySelector('[data-osk]')) window.dispatchEvent(new Event('lumos:osk-close'));
      else {
        if (document.activeElement?.matches('input, textarea')) document.activeElement.blur();
        if (!back()) ensureFocus();
      }
      break;
    case 'home':
      goHome();
      break;
    case 'start':
      toggleQuickMenu();
      break;
    case 'lb':
    case 'rb':
      window.dispatchEvent(new CustomEvent('lumos:tab', { detail: { dir: action === 'lb' ? -1 : 1 } }));
      break;
    default:
      break;
  }
  emitAction(action);
}

const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'a',
  ' ': 'a',
  Escape: 'b',
  Backspace: 'b',
  Home: 'home',
  q: 'lb',
  e: 'rb',
  x: 'x',
  y: 'y',
  m: 'start',
};

// W3C "standard" gamepad mapping
const PAD_BUTTONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
const REPEATABLE = new Set(['up', 'down', 'left', 'right']);

export function useInputSystem() {
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target.matches?.('input, textarea, [contenteditable="true"]');
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') || e.key === 'F12') {
        if (useSettings.getState().values.devPanelShortcut) {
          e.preventDefault();
          toggleDevPanel();
        }
        return;
      }
      if (typing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          dispatch('b');
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.tagName === 'INPUT') {
          e.preventDefault();
          dispatch(KEYMAP[e.key]);
        }
        return;
      }
      const a = KEYMAP[e.key];
      if (!a) return;
      setLastInput('key');
      e.preventDefault();
      dispatch(a);
    };
    window.addEventListener('keydown', onKey);

    // Gamepad polling with repeat
    const held = new Map();
    let raf;
    const poll = (t) => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      const pressed = new Set();
      for (const p of pads) {
        p.buttons.forEach((b, i) => b.pressed && PAD_BUTTONS[i] && pressed.add(PAD_BUTTONS[i]));
        const [lx = 0, ly = 0] = p.axes;
        if (lx < -0.55) pressed.add('left');
        if (lx > 0.55) pressed.add('right');
        if (ly < -0.55) pressed.add('up');
        if (ly > 0.55) pressed.add('down');
      }
      for (const a of pressed) {
        const h = held.get(a);
        if (!h) {
          held.set(a, { t0: t, last: t });
          setLastInput('pad');
          dispatch(a);
        } else if (REPEATABLE.has(a) && t - h.t0 > 380 && t - h.last > 85) {
          h.last = t;
          dispatch(a);
        }
      }
      for (const a of [...held.keys()]) if (!pressed.has(a)) held.delete(a);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    // Virtual buttons from the developer panel / daemon (e.g. Lumos button on the Joy-Con)
    const offBtn = on('input.button', ({ button, pressed }) => {
      if (!pressed) return;
      setLastInput('pad');
      dispatch(button);
    });
    const offHome = on('input.home', () => goHome());
    const offQam = on('input.qam', () => toggleQuickMenu());

    // touch / pointer → background ripple
    const onPointer = () => bumpImpulse();
    window.addEventListener('pointerdown', onPointer, { passive: true });

    const unsubUi = useUI.subscribe((s, p) => {
      if (s.stack !== p.stack || s.devPanel !== p.devPanel || s.quickMenu !== p.quickMenu || s.faceSheet !== p.faceSheet) {
        setTimeout(() => ensureFocus(), 60);
      }
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      cancelAnimationFrame(raf);
      offBtn();
      offHome();
      offQam();
      unsubUi();
    };
  }, []);
}

/** Subscribe to semantic actions (x, y, select, …) while mounted. */
export function useAction(handler, deps = []) {
  useEffect(() => {
    const fn = (e) => handler(e.detail.action);
    window.addEventListener('lumos:action', fn);
    return () => window.removeEventListener('lumos:action', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useTabs(handler, deps = []) {
  useEffect(() => {
    const fn = (e) => handler(e.detail.dir);
    window.addEventListener('lumos:tab', fn);
    return () => window.removeEventListener('lumos:tab', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
