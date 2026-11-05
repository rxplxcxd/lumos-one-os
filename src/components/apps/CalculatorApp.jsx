// Calculator with standard & scientific keypads and a history tape.
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calculator as CalcIcon, History } from 'lucide-react';
import { Screen, Hint, Segmented } from '@/components/ui/primitives.jsx';
import { evaluate, format } from '@/lib/calc.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';
import { useAction } from '@/hooks/useInputSystem.js';

const STD = [
  ['AC', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', ',', '⌫', '='],
];
const SCI = [
  ['(', ')', 'x²', '^'],
  ['sin', 'cos', 'tan', '√'],
  ['ln', 'log', 'π', 'e'],
];

export default function CalculatorApp() {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('std');
  const [tape, setTape] = useState([]);
  let preview = null;
  try {
    preview = expr && !/[+\-−×÷^(]$/.test(expr) ? format(evaluate(expr)) : null;
  } catch {
    preview = null;
  }

  const press = useCallback(
    (k) => {
      haptic('key');
      setResult(null);
      if (k === 'AC') return setExpr('');
      if (k === '⌫') return setExpr((e) => e.slice(0, -1));
      if (k === '=') {
        try {
          const v = evaluate(expr);
          setTape((t) => [{ expr, v }, ...t].slice(0, 30));
          setResult(format(v));
          setExpr(String(Math.round(v * 1e10) / 1e10).replace('.', ','));
          haptic('success');
        } catch {
          haptic('error');
          setResult('Fehler');
        }
        return;
      }
      if (k === '±') return setExpr((e) => (e.startsWith('−(') && e.endsWith(')') ? e.slice(2, -1) : e ? `−(${e})` : '−'));
      if (k === 'x²') return setExpr((e) => `${e}^2`);
      if (['sin', 'cos', 'tan', 'ln', 'log', '√'].includes(k)) return setExpr((e) => `${e}${k}(`);
      setExpr((e) => e + k);
    },
    [expr],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const map = { '*': '×', '/': '÷', '-': '−', '.': ',', Enter: '=', '=': '=', Backspace: '⌫', Delete: 'AC' };
      const k = map[e.key] || (/^[0-9+%^(),]$/.test(e.key) ? e.key : null);
      if (k && e.key !== 'Enter') {
        e.stopPropagation();
        press(k);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [press]);
  useAction((a) => a === 'x' && setMode((m) => (m === 'std' ? 'sci' : 'std')), []);

  const Key = ({ k, auto }) => {
    const op = ['÷', '×', '−', '+', '='].includes(k);
    const fn = ['AC', '±', '%', '⌫'].includes(k) || SCI.flat().includes(k);
    return (
      <motion.button
        data-nav=""
        data-nav-haptic="none"
        data-nav-autofocus={auto ? '' : undefined}
        whileTap={{ scale: 0.9 }}
        whileFocus={{ scale: 1.06 }}
        transition={spring.bouncy}
        onClick={() => press(k)}
        className={`nav-focus flex h-[4.1rem] items-center justify-center rounded-full text-[1.45rem] font-medium ${op ? 'bg-[#f2a33a] text-white' : fn ? 'bg-white/[0.2] text-white' : 'bg-white/[0.09] text-white'} ${k === '0' ? '' : ''}`}
      >
        {k}
      </motion.button>
    );
  };

  return (
    <Screen title="Rechner" icon={CalcIcon} noPad actions={<Segmented value={mode} onChange={setMode} options={[{ value: 'std', label: 'Standard' }, { value: 'sci', label: 'Wissenschaftlich' }]} />} hints={<><Hint k="x">Modus</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="flex h-full gap-6 px-10 pb-14">
        <div className="flex w-[30rem] flex-col">
          <div className="glass mb-4 flex h-[8.5rem] flex-col items-end justify-end rounded-3xl px-6 py-4">
            <div className="h-6 w-full truncate text-right text-[1rem] text-mist-400">{result != null ? tape[0]?.expr : preview ? `= ${preview}` : ''}</div>
            <AnimatePresence mode="popLayout">
              <motion.div key={result ?? 'e'} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="w-full truncate text-right text-[3.2rem] font-light tabular-nums leading-tight">
                {result ?? (expr || '0')}
              </motion.div>
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {mode === 'sci' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-2 grid grid-cols-4 gap-2.5 overflow-hidden">
                {SCI.flat().map((k) => (
                  <Key key={k} k={k} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-4 gap-2.5">
            {STD.flat().map((k) => (
              <Key key={k} k={k} auto={k === '5'} />
            ))}
          </div>
        </div>
        <div className="glass flex flex-1 flex-col rounded-3xl p-5">
          <div className="label mb-3 flex items-center gap-2"><History className="h-3.5 w-3.5" /> Verlauf</div>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {tape.length === 0 && <div className="text-[0.85rem] text-mist-500">Noch keine Berechnungen</div>}
            {tape.map((t, i) => (
              <button key={i} data-nav="" onClick={() => (setExpr(String(t.v).replace('.', ',')), setResult(null))} className="row-focus block w-full rounded-xl px-3 py-2 text-right">
                <div className="text-[0.8rem] text-mist-400">{t.expr}</div>
                <div className="text-[1.15rem] tabular-nums">{format(t.v)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
