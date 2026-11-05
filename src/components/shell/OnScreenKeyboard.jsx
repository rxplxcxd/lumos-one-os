// Controller-friendly on-screen keyboard (QWERTZ, umlauts, symbols). Opens when a text field is
// activated with A or tapped; writes into the target through the native value setter so React
// onChange handlers fire normally.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, ArrowBigUp, CornerDownLeft, ChevronDown, Space } from 'lucide-react';
import { haptic } from '@/services/haptics.js';
import { focusEl } from '@/lib/spatialNav.js';
import { spring } from '@/lib/motion.js';

const LETTERS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß'],
  ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
  ['y', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-', '@'],
];
const SYMBOLS = [
  ['!', '"', '§', '$', '%', '&', '/', '(', ')', '=', '?'],
  ['+', '*', '#', "'", '<', '>', '[', ']', '{', '}', '\\'],
  ['€', '^', '°', '|', '~', '`', '´', ';', ':', '_', '…'],
  ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', '·', '•', '–', '…', '¿'],
];

let lastInput = 'pointer';
export const setLastInput = (k) => (lastInput = k);

function insert(el, text) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  let v;
  let caret;
  if (text === '\b') {
    if (start === end && start > 0) {
      v = el.value.slice(0, start - 1) + el.value.slice(end);
      caret = start - 1;
    } else {
      v = el.value.slice(0, start) + el.value.slice(end);
      caret = start;
    }
  } else {
    v = el.value.slice(0, start) + text + el.value.slice(end);
    caret = start + text.length;
  }
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* type=email etc. */
  }
}

export default function OnScreenKeyboard() {
  const [target, setTarget] = useState(null);
  const [shift, setShift] = useState(false);
  const [sym, setSym] = useState(false);
  const firstKey = useRef(null);

  useEffect(() => {
    const show = (e) => {
      const el = e.detail?.target || e.target;
      if (!el?.matches?.('input:not([type=checkbox]):not([type=range]):not([type=file]), textarea')) return;
      setTarget(el);
    };
    const onFocusIn = (e) => {
      if (lastInput === 'pad' || lastInput === 'touch') show(e);
    };
    const onKey = (e) => {
      if (e.key.length === 1 && !e.target.closest?.('[data-osk]')) setTarget(null); // physical keyboard → hide
    };
    window.addEventListener('lumos:osk', show);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKey);
    const onPointer = (e) => (lastInput = e.pointerType === 'touch' ? 'touch' : 'pointer');
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('lumos:osk', show);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  useEffect(() => {
    if (target && firstKey.current && lastInput === 'pad') setTimeout(() => focusEl(firstKey.current, { silent: true, scroll: false }), 30);
  }, [target]);

  const close = () => {
    const t = target;
    setTarget(null);
    if (t) setTimeout(() => focusEl(t, { silent: true }), 30);
  };
  useEffect(() => {
    const fn = () => close();
    window.addEventListener('lumos:osk-close', fn);
    return () => window.removeEventListener('lumos:osk-close', fn);
  });
  const press = (k) => {
    if (!target) return;
    haptic('key');
    if (k === 'enter') {
      if (target instanceof HTMLTextAreaElement) insert(target, '\n');
      else {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        close();
      }
      return;
    }
    insert(target, k === 'space' ? ' ' : k === 'bksp' ? '\b' : shift ? k.toUpperCase() : k);
    if (shift && k.length === 1) setShift(false);
  };

  const rows = sym ? SYMBOLS : LETTERS;
  return (
    <AnimatePresence>
      {target && (
        <motion.div
          data-osk=""
          data-nav-scope="85"
          className="glass-strong fixed bottom-3 left-1/2 z-[85] w-[62rem] -translate-x-1/2 rounded-[1.8rem] p-3"
          initial={{ y: 260, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 260, opacity: 0 }}
          transition={spring.sheet}
          onPointerDown={(e) => e.preventDefault()}
        >
          {rows.map((r, ri) => (
            <div key={ri} className="mb-1.5 flex justify-center gap-1.5">
              {r.map((k, ki) => (
                <button key={k + ki} ref={ri === 1 && ki === 0 ? firstKey : undefined} data-nav="" data-nav-haptic="none" onClick={() => press(k)} className="nav-focus h-12 w-[4.9rem] rounded-xl bg-white/[0.08] text-[1.05rem] font-medium">
                  {shift && !sym ? k.toUpperCase() : k}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-1.5">
            <button data-nav="" data-nav-haptic="none" onClick={() => (setShift(!shift), haptic('toggle.on'))} className={`nav-focus flex h-12 w-[6.5rem] items-center justify-center rounded-xl ${shift ? 'bg-mist-50 text-ink-950' : 'bg-white/[0.14]'}`}><ArrowBigUp className="h-5 w-5" /></button>
            <button data-nav="" data-nav-haptic="none" onClick={() => (setSym(!sym), haptic('toggle.on'))} className="nav-focus h-12 w-[6.5rem] rounded-xl bg-white/[0.14] text-[0.9rem] font-medium">{sym ? 'ABC' : '#+='}</button>
            <button data-nav="" data-nav-haptic="none" onClick={() => press('space')} className="nav-focus flex h-12 w-[26rem] items-center justify-center rounded-xl bg-white/[0.08]"><Space className="h-5 w-5 text-mist-300" /></button>
            <button data-nav="" data-nav-haptic="none" onClick={() => press('bksp')} className="nav-focus flex h-12 w-[6.5rem] items-center justify-center rounded-xl bg-white/[0.14]"><Delete className="h-5 w-5" /></button>
            <button data-nav="" data-nav-haptic="none" onClick={() => press('enter')} className="nav-focus flex h-12 w-[6.5rem] items-center justify-center rounded-xl bg-lumen-500 text-white"><CornerDownLeft className="h-5 w-5" /></button>
            <button data-nav="" onClick={close} aria-label="Tastatur schließen" className="nav-focus flex h-12 w-[4.9rem] items-center justify-center rounded-xl bg-white/[0.14]"><ChevronDown className="h-5 w-5" /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
