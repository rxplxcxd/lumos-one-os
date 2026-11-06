// Keyboard ⇄ controller mapping. Every controller input has up to two keyboard keys
// (KeyboardEvent.code → layout-independent). Editable in Einstellungen → Tastatur & Steuerung;
// the same table drives lumosd's keyboard→virtual-gamepad bridge inside games.
export const ACTIONS = [
  { id: 'up', label: 'Steuerkreuz hoch', group: 'Steuerkreuz' },
  { id: 'down', label: 'Steuerkreuz runter', group: 'Steuerkreuz' },
  { id: 'left', label: 'Steuerkreuz links', group: 'Steuerkreuz' },
  { id: 'right', label: 'Steuerkreuz rechts', group: 'Steuerkreuz' },
  { id: 'a', label: 'A – Bestätigen', group: 'Aktionstasten' },
  { id: 'b', label: 'B – Zurück', group: 'Aktionstasten' },
  { id: 'x', label: 'X', group: 'Aktionstasten' },
  { id: 'y', label: 'Y', group: 'Aktionstasten' },
  { id: 'lb', label: 'L – Schultertaste links', group: 'Schultertasten' },
  { id: 'rb', label: 'R – Schultertaste rechts', group: 'Schultertasten' },
  { id: 'lt', label: 'ZL – Trigger links', group: 'Schultertasten' },
  { id: 'rt', label: 'ZR – Trigger rechts', group: 'Schultertasten' },
  { id: 'start', label: '+ / Menü', group: 'System' },
  { id: 'select', label: '− / Ansicht', group: 'System' },
  { id: 'home', label: 'Home', group: 'System' },
  { id: 'capture', label: 'Capture / Schnellzugriff', group: 'System' },
  { id: 'l3', label: 'Linker Stick drücken', group: 'Sticks' },
  { id: 'r3', label: 'Rechter Stick drücken', group: 'Sticks' },
  { id: 'ls_up', label: 'Linker Stick hoch', group: 'Sticks' },
  { id: 'ls_down', label: 'Linker Stick runter', group: 'Sticks' },
  { id: 'ls_left', label: 'Linker Stick links', group: 'Sticks' },
  { id: 'ls_right', label: 'Linker Stick rechts', group: 'Sticks' },
  { id: 'rs_up', label: 'Rechter Stick hoch', group: 'Sticks' },
  { id: 'rs_down', label: 'Rechter Stick runter', group: 'Sticks' },
  { id: 'rs_left', label: 'Rechter Stick links', group: 'Sticks' },
  { id: 'rs_right', label: 'Rechter Stick rechts', group: 'Sticks' },
];

export const PRESETS = {
  standard: {
    label: 'Standard (Pfeile + WASD)',
    map: {
      up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
      a: ['Enter', 'Space'], b: ['Escape', 'Backspace'], x: ['KeyX', 'KeyF'], y: ['KeyZ', 'KeyR'], // KeyZ = „Y“ auf QWERTZ
      lb: ['KeyQ', 'PageUp'], rb: ['KeyE', 'PageDown'], lt: ['Digit1', 'ShiftLeft'], rt: ['Digit3', 'ControlLeft'],
      start: ['KeyM', 'Tab'], select: ['KeyN'], home: ['Home', 'F1'], capture: ['F9'],
      l3: ['KeyV'], r3: ['KeyC'],
      ls_up: ['KeyI'], ls_down: ['KeyK'], ls_left: ['KeyJ'], ls_right: ['KeyL'],
      rs_up: ['Numpad8'], rs_down: ['Numpad2'], rs_left: ['Numpad4'], rs_right: ['Numpad6'],
    },
  },
  arrows: {
    label: 'Nur Pfeiltasten (Einhand)',
    map: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], a: ['Enter'], b: ['Backspace', 'Escape'], x: ['ShiftRight'], y: ['ControlRight'],
      lb: ['PageUp'], rb: ['PageDown'], lt: ['Insert'], rt: ['Delete'], start: ['End'], select: ['ContextMenu'], home: ['Home'], capture: ['F9'],
      l3: ['Numpad0'], r3: ['NumpadDecimal'], ls_up: ['Numpad8'], ls_down: ['Numpad5'], ls_left: ['Numpad4'], ls_right: ['Numpad6'], rs_up: ['NumpadDivide'], rs_down: ['NumpadMultiply'], rs_left: ['NumpadSubtract'], rs_right: ['NumpadAdd'],
    },
  },
  gamer: {
    label: 'Gaming (WASD + Maushand)',
    map: {
      up: ['Digit2'], down: ['KeyX'], left: ['KeyZ'], right: ['KeyC'], a: ['Space', 'Enter'], b: ['KeyF', 'Escape'], x: ['KeyR'], y: ['KeyG'],
      lb: ['KeyQ'], rb: ['KeyE'], lt: ['ShiftLeft'], rt: ['ControlLeft'], start: ['Tab'], select: ['KeyB'], home: ['Home'], capture: ['F12'],
      l3: ['AltLeft'], r3: ['KeyV'], ls_up: ['KeyW'], ls_down: ['KeyS'], ls_left: ['KeyA'], ls_right: ['KeyD'], rs_up: ['ArrowUp'], rs_down: ['ArrowDown'], rs_left: ['ArrowLeft'], rs_right: ['ArrowRight'],
    },
  },
};

export const DEFAULT_BINDINGS = PRESETS.standard.map;

export function resolveBindings(stored) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = (stored && Array.isArray(stored[a.id]) ? stored[a.id] : DEFAULT_BINDINGS[a.id] || []).slice(0, 2);
  return out;
}

/** code → action lookup */
export function reverseBindings(bindings) {
  const m = new Map();
  for (const [action, codes] of Object.entries(bindings)) for (const c of codes) if (c && !m.has(c)) m.set(c, action);
  return m;
}

/** Assign `code` to action slot; removes it from any other action. Returns {bindings, stolenFrom}. */
export function assign(bindings, action, slot, code) {
  const next = Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, [...v]]));
  let stolenFrom = null;
  for (const [k, v] of Object.entries(next)) {
    const i = v.indexOf(code);
    if (i >= 0 && !(k === action && i === slot)) {
      v.splice(i, 1);
      if (k !== action) stolenFrom = k;
    }
  }
  const list = next[action] || [];
  if (slot >= list.length) list.push(code);
  else list[slot] = code;
  next[action] = list.filter(Boolean).slice(0, 2);
  return { bindings: next, stolenFrom };
}

const NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Eingabe', NumpadEnter: 'Num Eingabe', Space: 'Leertaste', Escape: 'Esc', Backspace: 'Rücktaste', Tab: 'Tab',
  ShiftLeft: 'Umschalt L', ShiftRight: 'Umschalt R', ControlLeft: 'Strg L', ControlRight: 'Strg R', AltLeft: 'Alt', AltRight: 'Alt Gr', MetaLeft: 'Super', ContextMenu: 'Menü',
  Home: 'Pos1', End: 'Ende', PageUp: 'Bild ↑', PageDown: 'Bild ↓', Insert: 'Einfg', Delete: 'Entf', CapsLock: 'Feststell',
  Minus: 'ß', Equal: '´', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backquote: '^', Backslash: '#', Comma: ',', Period: '.', Slash: '-', IntlBackslash: '<',
  NumpadDecimal: 'Num ,', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3) === 'Y' ? 'Z' : code.slice(3) === 'Z' ? 'Y' : code.slice(3); // QWERTZ labels
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}
