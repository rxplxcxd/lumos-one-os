// Unifies keyboard (fully re-bindable), Gamepad API (Lumos uinput pad, USB/Bluetooth third-party
// controllers incl. non-standard HID pads with custom mappings) and daemon virtual buttons into
// semantic actions, with configurable key-repeat for held directions.
import { useEffect } from 'react';
import { move, activate, ensureFocus, currentFocus } from '@/lib/spatialNav.js';
import { back, goHome, toggleDevPanel, toggleQuickMenu, bumpImpulse, useUI } from '@/store/ui.js';
import { on } from '@/services/bridge.js';
import { useSettings } from '@/store/settings.js';
import { setLastInput } from '@/components/shell/OnScreenKeyboard.jsx';
import { resolveBindings, reverseBindings } from '@/lib/keybindings.js';
import { padFamily } from '@/lib/controllers.js';

export function emitAction(action) {
  window.dispatchEvent(new CustomEvent('lumos:action', { detail: { action } }));
}

// --- capture mode (key rebinding / controller mapping wizard) -----------------------------
let capture = null;
/** While set, raw inputs go to `fn({kind:'key'|'button'|'axis', …})` instead of the UI. */
export function setInputCapture(fn) {
  capture = fn;
}

function scrollFocused(dir) {
  let el = currentFocus() || document.activeElement;
  while (el && el !== document.body) {
    const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (el && el !== document.body) el.scrollBy({ top: dir * el.clientHeight * 0.35, behavior: 'smooth' });
}

export function dispatch(action) {
  if (useUI.getState().screensaver) {
    useUI.setState({ screensaver: false }); // first input only wakes the screen
    return;
  }
  bumpImpulse();
  const swap = useSettings.getState().values.swapAB;
  if (swap && (action === 'a' || action === 'b')) action = action === 'a' ? 'b' : 'a';
  if (action.startsWith('ls_')) action = action.slice(3); // left stick navigates like the d-pad
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
    case 'capture':
      toggleQuickMenu();
      break;
    case 'lb':
    case 'rb':
      window.dispatchEvent(new CustomEvent('lumos:tab', { detail: { dir: action === 'lb' ? -1 : 1 } }));
      break;
    case 'rs_up':
    case 'lt':
      scrollFocused(-1);
      break;
    case 'rs_down':
    case 'rt':
      scrollFocused(1);
      break;
    default:
      break;
  }
  emitAction(action);
}

// W3C "standard" gamepad mapping
const STD_BUTTONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'l3', 11: 'r3', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home', 17: 'capture' };
const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'rs_up', 'rs_down', 'lt', 'rt']);

const rest = new Map();
function restAxes(p) {
  const k = `${p.index}:${p.id}`;
  if (!rest.has(k)) rest.set(k, [...p.axes]);
  return rest.get(k);
}

/** Reads one gamepad into a set of pressed actions. Non-standard HID pads use a learned mapping. */
export function readPad(p, mappings) {
  const pressed = new Set();
  const custom = mappings?.[p.id];
  if (custom) {
    for (const [action, m] of Object.entries(custom)) {
      if (m.type === 'button' && p.buttons[m.index]?.pressed) pressed.add(action);
      if (m.type === 'axis' && (p.axes[m.index] ?? 0) * m.dir > 0.55) pressed.add(action);
    }
  } else if (p.mapping === 'standard') {
    p.buttons.forEach((b, i) => (b.pressed || b.value > 0.5) && STD_BUTTONS[i] && pressed.add(STD_BUTTONS[i]));
  } else {
    // generic DirectInput-style pad: 4 face buttons, shoulders, select/start, hat on axes 6/7 or a POV axis 9
    const generic = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'l3', 11: 'r3', 12: 'home' };
    p.buttons.forEach((b, i) => b.pressed && generic[i] && pressed.add(generic[i]));
    // hat as two axes (6/7) — only when they rest at 0, so analog triggers resting at −1 are ignored
    const base = restAxes(p);
    if (p.axes.length >= 8 && Math.abs(base[6] ?? 1) < 0.1 && Math.abs(base[7] ?? 1) < 0.1) {
      if (p.axes[6] < -0.5) pressed.add('left');
      if (p.axes[6] > 0.5) pressed.add('right');
      if (p.axes[7] < -0.5) pressed.add('up');
      if (p.axes[7] > 0.5) pressed.add('down');
    }
    // POV hat on axis 9: discrete values −1 (up) … +1 (up-left) in steps of 2/7, ~1.29 when released
    const pov = p.axes[9];
    if (pov != null && pov <= 1.01) {
      const step = Math.round((pov + 1) * 3.5);
      if (Math.abs((step / 3.5 - 1) - pov) < 0.04) {
        if ([7, 0, 1].includes(step)) pressed.add('up');
        if ([1, 2, 3].includes(step)) pressed.add('right');
        if ([3, 4, 5].includes(step)) pressed.add('down');
        if ([5, 6, 7].includes(step)) pressed.add('left');
      }
    }
  }
  const [lx = 0, ly = 0, rx = 0, ry = 0] = p.mapping === 'standard' || !custom ? p.axes : [];
  if (lx < -0.55) pressed.add('ls_left');
  if (lx > 0.55) pressed.add('ls_right');
  if (ly < -0.55) pressed.add('ls_up');
  if (ly > 0.55) pressed.add('ls_down');
  if (p.mapping === 'standard') {
    if (ry < -0.55) pressed.add('rs_up');
    if (ry > 0.55) pressed.add('rs_down');
    if (rx < -0.55) pressed.add('rs_left');
    if (rx > 0.55) pressed.add('rs_right');
  }
  return pressed;
}

export function useInputSystem() {
  useEffect(() => {
    let reverse = reverseBindings(resolveBindings(useSettings.getState().values.keyBindings));
    const unsubBindings = useSettings.subscribe((s, p) => {
      if (s.values.keyBindings !== p.values.keyBindings) reverse = reverseBindings(resolveBindings(s.values.keyBindings));
    });

    const onKeyCapture = (e) => {
      if (!capture) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) capture({ kind: 'key', code: e.code });
    };
    window.addEventListener('keydown', onKeyCapture, true);
    const onKey = (e) => {
      const typing = e.target.matches?.('input, textarea, [contenteditable="true"]');
      if ((e.ctrlKey && e.shiftKey && e.code === 'KeyD') || e.key === 'F12') {
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
          dispatch(e.key === 'ArrowDown' ? 'down' : 'up');
        }
        return;
      }
      const a = reverse.get(e.code);
      if (!a) return;
      e.preventDefault();
      if (e.repeat && !REPEATABLE.has(a) && !a.startsWith('ls_')) return;
      setLastInput('key');
      useUI.setState({ inputSource: 'keyboard' });
      dispatch(a);
    };
    window.addEventListener('keydown', onKey);

    // Gamepad polling with repeat
    const held = new Map();
    const prevRaw = new Map();
    let raf;
    const poll = (t) => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      const { padMappings, navRepeatDelay, navRepeatRate } = useSettings.getState().values;
      if (capture) {
        // report the first newly pressed button / axis deflection of any pad
        for (const p of pads) {
          const prev = prevRaw.get(p.index) || { buttons: [], axes: [] };
          p.buttons.forEach((b, i) => b.pressed && !prev.buttons[i] && capture?.({ kind: 'button', index: i, pad: p.id }));
          p.axes.forEach((v, i) => Math.abs(v) > 0.7 && Math.abs(prev.axes[i] ?? 0) <= 0.7 && capture?.({ kind: 'axis', index: i, dir: Math.sign(v), pad: p.id }));
          prevRaw.set(p.index, { buttons: p.buttons.map((b) => b.pressed), axes: [...p.axes] });
        }
        raf = requestAnimationFrame(poll);
        return;
      }
      const pressed = new Set();
      for (const p of pads) {
        const set = readPad(p, padMappings);
        if (set.size) {
          const fam = padFamily(p.id);
          if (useUI.getState().padFamily !== fam || useUI.getState().inputSource !== 'pad') useUI.setState({ padFamily: fam, inputSource: 'pad' });
        }
        set.forEach((a) => pressed.add(a));
        prevRaw.set(p.index, { buttons: p.buttons.map((b) => b.pressed), axes: [...p.axes] });
      }
      for (const a of pressed) {
        const h = held.get(a);
        if (!h) {
          held.set(a, { t0: t, last: t });
          setLastInput('pad');
          dispatch(a);
        } else if ((REPEATABLE.has(a) || a.startsWith('ls_')) && t - h.t0 > navRepeatDelay && t - h.last > navRepeatRate) {
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
      if (capture) return capture({ kind: 'virtual', action: button });
      setLastInput('pad');
      dispatch(button);
    });
    const offHome = on('input.home', () => goHome());
    const offQam = on('input.qam', () => toggleQuickMenu());

    // touch / pointer → background ripple
    const onPointer = (e) => {
      bumpImpulse();
      if (useUI.getState().inputSource !== 'pointer') useUI.setState({ inputSource: e.pointerType === 'touch' ? 'touch' : 'pointer' });
    };
    window.addEventListener('pointerdown', onPointer, { passive: true });

    const unsubUi = useUI.subscribe((s, p) => {
      if (s.stack !== p.stack || s.devPanel !== p.devPanel || s.quickMenu !== p.quickMenu || s.faceSheet !== p.faceSheet) {
        setTimeout(() => ensureFocus(), 60);
      }
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('pointerdown', onPointer);
      cancelAnimationFrame(raf);
      offBtn();
      offHome();
      offQam();
      unsubUi();
      unsubBindings();
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
