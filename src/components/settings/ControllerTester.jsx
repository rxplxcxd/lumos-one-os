// Live controller tester (Gamepad API) + mapping wizard for third-party USB/Bluetooth pads whose
// layout the browser does not know ("non-standard" mapping). Mappings are stored per Gamepad.id.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, Wand2, Trash2, Check } from 'lucide-react';
import { Sheet, Button, Segmented } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { setInputCapture, readPad } from '@/hooks/useInputSystem.js';
import { padFamily, glyphFor, FAMILY_LABEL } from '@/lib/controllers.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const WIZARD = [
  ['a', 'Untere Aktionstaste (Bestätigen)'], ['b', 'Rechte Aktionstaste (Zurück)'], ['x', 'Linke Aktionstaste'], ['y', 'Obere Aktionstaste'],
  ['up', 'Steuerkreuz hoch'], ['down', 'Steuerkreuz runter'], ['left', 'Steuerkreuz links'], ['right', 'Steuerkreuz rechts'],
  ['lb', 'Linke Schultertaste'], ['rb', 'Rechte Schultertaste'], ['lt', 'Linker Trigger'], ['rt', 'Rechter Trigger'],
  ['select', 'Select / Ansicht / −'], ['start', 'Start / Menü / +'], ['home', 'Home / Guide (optional)'], ['l3', 'Linker Stick drücken'], ['r3', 'Rechter Stick drücken'],
];

function usePads() {
  const [pads, setPads] = useState([]);
  useEffect(() => {
    let raf;
    const tick = () => {
      const list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      setPads(list.map((p) => ({ id: p.id, index: p.index, mapping: p.mapping, buttons: p.buttons.map((b) => b.value), axes: [...p.axes], raw: p })));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return pads;
}

function Wizard({ pad, onClose }) {
  const [step, setStep] = useState(0);
  const [map, setMap] = useState({});
  useEffect(() => {
    setInputCapture((ev) => {
      if (ev.pad !== pad.id || (ev.kind !== 'button' && ev.kind !== 'axis')) return;
      const action = WIZARD[step]?.[0];
      if (!action) return;
      setMap((m) => ({ ...m, [action]: ev.kind === 'button' ? { type: 'button', index: ev.index } : { type: 'axis', index: ev.index, dir: ev.dir } }));
      haptic('select');
      setStep((s) => s + 1);
    });
    return () => setInputCapture(null);
  }, [pad.id, step]);
  const done = step >= WIZARD.length;
  const save = () => {
    const all = { ...useSettings.getState().values.padMappings, [pad.id]: map };
    setSetting('padMappings', all);
    haptic('success');
    onClose();
  };
  return (
    <div className="text-center">
      <div className="label mb-1">Schritt {Math.min(step + 1, WIZARD.length)} / {WIZARD.length}</div>
      <div className="mx-auto mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full bg-lumen" animate={{ width: `${(step / WIZARD.length) * 100}%` }} transition={spring.soft} />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring.snappy} className="py-6">
          {done ? (
            <>
              <Check className="mx-auto mb-2 h-10 w-10 text-ok" />
              <div className="text-lg font-semibold">Alle Tasten zugeordnet</div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold">Drücke: {WIZARD[step][1]}</div>
              <div className="mt-1 text-[0.8rem] text-mist-400">am Controller „{pad.id.split('(')[0].trim()}“</div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="flex justify-center gap-2">
        {!done && <Button variant="ghost" onClick={() => setStep((s) => s + 1)}>Überspringen</Button>}
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        {done && <Button variant="primary" autoFocus onClick={save}>Zuordnung speichern</Button>}
      </div>
    </div>
  );
}

export default function ControllerTester({ open, onClose }) {
  const pads = usePads();
  const mappings = useSettings((s) => s.values.padMappings);
  const [sel, setSel] = useState(0);
  const [wizard, setWizard] = useState(false);
  const pad = pads.find((p) => p.index === sel) || pads[0];
  const fam = pad ? padFamily(pad.id) : 'generic';
  const actions = pad ? readPad(pad.raw, mappings) : new Set();

  return (
    <Sheet open={open} onClose={() => (setWizard(false), onClose())} title="Controller-Tester" className="w-[58rem]">
      {!pads.length && (
        <div className="flex flex-col items-center gap-3 py-12 text-mist-400">
          <Gamepad2 className="h-10 w-10" />
          Kein Controller erkannt – USB-Controller anschließen oder eine Taste am Bluetooth-Controller drücken.
        </div>
      )}
      {pad && !wizard && (
        <>
          <Segmented value={pad.index} onChange={setSel} options={pads.map((p) => ({ value: p.index, label: `${p.index + 1}: ${p.id.split('(')[0].trim().slice(0, 26)}` }))} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-mist-400">
            <span>{FAMILY_LABEL[fam]}</span>
            <span>Browser-Zuordnung: {pad.mapping === 'standard' ? 'Standard ✓' : 'nicht standardisiert'}</span>
            {mappings[pad.id] && <span className="text-ok">eigene Zuordnung aktiv</span>}
            <span className="truncate">{pad.id}</span>
          </div>
          <div className="mt-4 grid grid-cols-[1fr_16rem] gap-5">
            <div>
              <div className="label mb-2">Tasten</div>
              <div className="grid grid-cols-9 gap-1.5">
                {pad.buttons.map((v, i) => (
                  <motion.div key={i} animate={{ scale: v > 0.5 ? 0.9 : 1, backgroundColor: v > 0.5 ? 'rgb(var(--lumen) / 0.9)' : 'rgba(255,255,255,0.07)' }} transition={spring.snappy} className="flex h-10 items-center justify-center rounded-xl text-[0.72rem] font-semibold">
                    <span className={v > 0.5 ? 'text-ink-950' : 'text-mist-300'}>{i}</span>
                  </motion.div>
                ))}
              </div>
              <div className="label mb-2 mt-4">Erkannte Aktionen</div>
              <div className="flex min-h-[2.2rem] flex-wrap gap-1.5">
                {[...actions].map((a) => (
                  <motion.span key={a} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-full bg-white/90 px-2.5 py-1 text-[0.72rem] font-bold text-ink-950">
                    {glyphFor(a, fam)}
                  </motion.span>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-2">Achsen</div>
              <div className="space-y-1.5">
                {pad.axes.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-[0.7rem] tabular-nums text-mist-400">
                    <span className="w-4">{i}</span>
                    <div className="relative h-2 flex-1 rounded-full bg-white/10">
                      <div className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-lumen" style={{ left: `${((v + 1) / 2) * 100}%` }} />
                    </div>
                    <span className="w-10 text-right">{v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="primary" icon={Wand2} onClick={() => setWizard(true)}>Tasten zuordnen</Button>
            {mappings[pad.id] && (
              <Button
                variant="danger"
                icon={Trash2}
                onClick={() => {
                  const all = { ...mappings };
                  delete all[pad.id];
                  setSetting('padMappings', all);
                }}
              >
                Eigene Zuordnung löschen
              </Button>
            )}
            <Button
              variant="subtle"
              onClick={() => pad.raw.vibrationActuator?.playEffect('dual-rumble', { duration: 300, strongMagnitude: 0.8, weakMagnitude: 0.6 }).catch(() => {})}
            >
              Vibration testen
            </Button>
          </div>
        </>
      )}
      {pad && wizard && <Wizard pad={pad} onClose={() => setWizard(false)} />}
    </Sheet>
  );
}
