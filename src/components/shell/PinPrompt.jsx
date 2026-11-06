// Promise-based PIN pad (parental PIN, profile PINs). Fully controller-navigable.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { motion } from 'framer-motion';
import { Delete, Lock } from 'lucide-react';
import { Sheet } from '@/components/ui/primitives.jsx';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const usePin = create(() => ({ req: null }));

/** askPin({ title, sub, check: async (pin) => boolean }) → resolves true/false (or the PIN if no check). */
export function askPin(opts) {
  return new Promise((resolve) => usePin.setState({ req: { ...opts, resolve } }));
}

export default function PinPrompt() {
  const req = usePin((s) => s.req);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  useEffect(() => setPin(''), [req]);
  const close = (v) => {
    req?.resolve(v);
    usePin.setState({ req: null });
  };
  const press = async (k) => {
    haptic('key');
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 8);
    setPin(next);
    if (next.length >= (req.length || 4) && req.check) {
      if (await req.check(next)) {
        haptic('success');
        close(true);
      } else if (next.length >= (req.length || 4)) {
        haptic('faceid.fail');
        setShake((x) => x + 1);
        setTimeout(() => setPin(''), 350);
      }
    }
  };
  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('del');
      if (e.key === 'Enter' && !req.check && pin.length >= 4) close(pin);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <Sheet open={!!req} onClose={() => close(req?.check ? false : null)} className="w-[26rem]">
      <div className="flex flex-col items-center">
        <Lock className="mb-2 h-7 w-7 text-lumen" />
        <div className="text-lg font-semibold">{req?.title || 'PIN eingeben'}</div>
        {req?.sub && <div className="mt-1 text-center text-[0.8rem] text-mist-400">{req.sub}</div>}
        <motion.div key={shake} animate={shake ? { x: [0, -12, 10, -6, 4, 0] } : {}} transition={{ duration: 0.4 }} className="my-5 flex gap-3">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <motion.span key={i} animate={{ scale: i < pin.length ? 1.15 : 1, backgroundColor: i < pin.length ? '#f5f7fa' : 'rgba(255,255,255,0.15)' }} transition={spring.bouncy} className="h-3.5 w-3.5 rounded-full" />
          ))}
        </motion.div>
        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ok', '0', 'del'].map((k) => (
            <motion.button
              key={k}
              data-nav=""
              data-nav-haptic="none"
              data-nav-autofocus={k === '5' ? '' : undefined}
              whileTap={{ scale: 0.9 }}
              onClick={() => (k === 'ok' ? (!req.check && pin.length >= 4 ? close(pin) : null) : press(k))}
              className={`nav-focus flex h-14 w-20 items-center justify-center rounded-2xl text-xl font-medium ${k === 'ok' ? (req?.check ? 'invisible' : 'bg-mist-50 text-ink-950 text-base') : 'bg-white/[0.08]'}`}
            >
              {k === 'del' ? <Delete className="h-5 w-5" /> : k === 'ok' ? 'OK' : k}
            </motion.button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
