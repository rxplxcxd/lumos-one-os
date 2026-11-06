// Einstellungen → Tastatur & Steuerung: every controller input ↔ up to two keyboard keys.
// Select a key slot, press the new key; conflicts are moved automatically (with a hint).
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, RotateCcw, Gamepad2, Timer } from 'lucide-react';
import { ListGroup, ListRow, Segmented, SliderRow, Button, Sheet } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { ACTIONS, PRESETS, resolveBindings, assign, keyLabel } from '@/lib/keybindings.js';
import { setInputCapture } from '@/hooks/useInputSystem.js';
import { glyphFor } from '@/lib/controllers.js';
import { useUI, toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const ICON = { up: '▲', down: '▼', left: '◀', right: '▶', l3: 'L3', r3: 'R3', capture: '◎', ls_up: 'L↑', ls_down: 'L↓', ls_left: 'L←', ls_right: 'L→', rs_up: 'R↑', rs_down: 'R↓', rs_left: 'R←', rs_right: 'R→' };

function KeyChip({ code, onClick, active }) {
  return (
    <motion.button
      data-nav=""
      data-nav-haptic="none"
      layout
      onClick={onClick}
      transition={spring.snappy}
      className={`nav-focus min-w-[4.4rem] rounded-xl border px-3 py-1.5 text-[0.8rem] font-semibold ${active ? 'border-lumen bg-lumen/20 text-white' : code ? 'border-white/10 bg-white/[0.08] text-mist-50' : 'border-dashed border-white/15 text-mist-500'}`}
    >
      {code ? keyLabel(code) : '＋'}
    </motion.button>
  );
}

function CaptureSheet({ target, onDone }) {
  const [left, setLeft] = useState(6);
  useEffect(() => {
    if (!target) return undefined;
    setLeft(6);
    setInputCapture((ev) => {
      if (ev.kind === 'key') onDone(ev.code);
      else if (ev.kind === 'button' || ev.kind === 'virtual') onDone(null); // controller press cancels
    });
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(t);
      setInputCapture(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  useEffect(() => {
    if (target && left === 0) onDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  const action = ACTIONS.find((a) => a.id === target?.action);
  return (
    <Sheet open={!!target} onClose={() => onDone(null)}>
      <div className="flex flex-col items-center py-4 text-center">
        <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-lumen/20">
          <Keyboard className="h-8 w-8 text-lumen" />
        </motion.div>
        <div className="text-xl font-semibold">Taste drücken …</div>
        <div className="mt-1 text-[0.85rem] text-mist-300">für „{action?.label}“ ({target?.slot === 0 ? 'Haupttaste' : 'Zweittaste'})</div>
        <div className="mt-4 text-[0.75rem] tabular-nums text-mist-500">Abbruch in {left} s oder mit einer Controller-Taste</div>
      </div>
    </Sheet>
  );
}

export default function KeyboardSection() {
  const v = useSettings((s) => s.values);
  const fam = useUI((s) => s.padFamily);
  const family = v.glyphStyle === 'auto' ? fam : v.glyphStyle;
  const bindings = resolveBindings(v.keyBindings);
  const [target, setTarget] = useState(null);

  const finish = (code) => {
    const t = target;
    setTarget(null);
    if (!t || !code) return;
    const { bindings: next, stolenFrom } = assign(bindings, t.action, t.slot, code);
    setSetting('keyBindings', next);
    haptic('success');
    if (stolenFrom) toast({ title: `${keyLabel(code)} neu zugewiesen`, body: `Vorher: ${ACTIONS.find((a) => a.id === stolenFrom)?.label}`, kind: 'info' });
  };
  const clear = (action, slot) => {
    const next = { ...bindings, [action]: bindings[action].filter((_, i) => i !== slot) };
    setSetting('keyBindings', next);
    haptic('toggle.off');
  };

  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <>
      <div className="glass mb-6 flex items-center gap-4 rounded-3xl p-5 text-[0.82rem] text-mist-300">
        <Keyboard className="h-10 w-10 shrink-0 text-lumen" strokeWidth={1.5} />
        Jede Controller-Taste ist einer Tastaturtaste zugewiesen – so lässt sich Lumos One komplett ohne Controller bedienen. Wähle eine Taste aus und drücke die neue Belegung. Mit Entf auf einer Taste löschst du sie.
      </div>

      <ListGroup title="Vorlagen">
        <div className="flex flex-wrap gap-2 p-3">
          {Object.entries(PRESETS).map(([k, p]) => (
            <Button key={k} size="sm" variant="subtle" onClick={() => (setSetting('keyBindings', p.map), haptic('success'), toast({ title: 'Belegung übernommen', body: p.label, kind: 'success' }))}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => (setSetting('keyBindings', null), haptic('success'))}>
            Zurücksetzen
          </Button>
        </div>
      </ListGroup>

      {groups.map((g) => (
        <ListGroup key={g} title={g}>
          {ACTIONS.filter((a) => a.group === g).map((a) => (
            <div key={a.id} className="flex min-h-[3.2rem] items-center gap-3 border-b border-white/[0.05] px-4 py-2 last:border-b-0">
              <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/90 px-1.5 text-[0.62rem] font-bold text-ink-950">{ICON[a.id] || glyphFor(a.id, family)}</span>
              <span className="flex-1 text-[0.9rem]">{a.label}</span>
              {[0, 1].map((slot) => (
                <span
                  key={slot}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' && bindings[a.id][slot]) {
                      e.preventDefault();
                      e.stopPropagation();
                      clear(a.id, slot);
                    }
                  }}
                >
                  <KeyChip code={bindings[a.id][slot]} active={target?.action === a.id && target?.slot === slot} onClick={() => setTarget({ action: a.id, slot })} />
                </span>
              ))}
            </div>
          ))}
        </ListGroup>
      ))}

      <ListGroup title="In Spielen" footer="„Während Spielen“: lumosd übersetzt die Tastatur in Eingaben des virtuellen Gamepads, sobald ein Spiel den Bildschirm hat – Spiele sehen dann einen normalen Controller.">
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[0.92rem]"><Gamepad2 className="h-4 w-4" /> Tastatur als Controller</div>
          <Segmented value={v.keyboardPad} onChange={(x) => setSetting('keyboardPad', x)} options={[{ value: 'off', label: 'Aus' }, { value: 'games', label: 'Während Spielen' }]} />
        </div>
      </ListGroup>

      <ListGroup title="Wiederholung beim Halten">
        <SliderRow icon={Timer} iconBg="bg-[#4b5563]" label="Verzögerung" value={v.navRepeatDelay} min={150} max={800} step={10} detents={13} format={(x) => `${x} ms`} onChange={(x) => setSetting('navRepeatDelay', x)} />
        <SliderRow icon={Timer} iconBg="bg-[#4b5563]" label="Intervall" value={v.navRepeatRate} min={30} max={250} step={5} detents={11} format={(x) => `${x} ms`} onChange={(x) => setSetting('navRepeatRate', x)} />
      </ListGroup>

      <ListGroup title="Tastensymbole" footer="„Automatisch“ zeigt die Symbole des zuletzt benutzten Controllers bzw. die Tastaturbelegung.">
        <div className="px-4 py-3">
          <Segmented value={v.glyphStyle} onChange={(x) => setSetting('glyphStyle', x)} options={[{ value: 'auto', label: 'Automatisch' }, { value: 'xbox', label: 'Xbox' }, { value: 'playstation', label: 'PlayStation' }, { value: 'nintendo', label: 'Nintendo' }]} />
        </div>
        <ListRow label="Aktuell erkannt" value={{ lumos: 'Lumos Joy', xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo', generic: 'Generisch' }[fam]} />
      </ListGroup>

      <AnimatePresence>{target && <CaptureSheet target={target} onDone={finish} />}</AnimatePresence>
    </>
  );
}
