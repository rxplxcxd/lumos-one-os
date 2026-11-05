// Reactive attach/detach feedback: a glow sweeps along the screen edge where the Joy-Con
// left (or arrived), plus a battery popup that rides the glow.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystem } from '@/store/system.js';
import { BatteryGlyph } from './StatusBar.jsx';
import { spring } from '@/lib/motion.js';

export default function ControllerEdge() {
  const ev = useSystem((s) => s.detachEvent);
  const [show, setShow] = useState(null);
  useEffect(() => {
    if (!ev) return undefined;
    setShow(ev);
    const t = setTimeout(() => setShow(null), 2600);
    return () => clearTimeout(t);
  }, [ev]);

  const side = show?.c?.side === 'right' ? 'right' : 'left';
  const attached = show?.kind === 'attached';
  const glow = attached ? '127,163,255' : '255,255,255';
  const transportLabel = { pogo: 'Angedockt · lädt', ble: 'Bluetooth LE', usb: 'USB', bt: 'Bluetooth' }[show?.c?.transport] || '';

  return (
    <AnimatePresence>
      {show && (
        <motion.div key={show.t} className="pointer-events-none fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          <motion.div
            className={`absolute top-0 h-full w-[5rem] ${side === 'left' ? 'left-0' : 'right-0'}`}
            style={{ background: `linear-gradient(${side === 'left' ? '90deg' : '270deg'}, rgba(${glow},0.5), rgba(${glow},0.1) 35%, transparent)` }}
            initial={{ scaleY: 0.1, opacity: 0 }}
            animate={{ scaleY: [0.1, 1, 1], opacity: [0, 1, 0.65] }}
            transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <motion.div
            className={`absolute top-0 h-full w-[2px] ${side === 'left' ? 'left-0' : 'right-0'}`}
            style={{ background: `rgba(${glow},0.95)`, boxShadow: `0 0 24px 6px rgba(${glow},0.7)` }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={spring.soft}
          />
          <motion.div
            className={`glass-strong absolute top-1/2 flex -translate-y-1/2 items-center gap-3 rounded-3xl px-4 py-3 ${side === 'left' ? 'left-6' : 'right-6'}`}
            initial={{ x: side === 'left' ? -60 : 60, opacity: 0, scale: 0.9 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: side === 'left' ? -40 : 40, opacity: 0 }}
            transition={spring.bouncy}
          >
            <div className={`flex h-14 w-8 items-end justify-center ${side === 'left' ? 'rounded-l-full' : 'rounded-r-full'} border border-white/20 bg-ink-700 pb-1`}>
              <span className="h-2 w-2 rounded-full bg-white/60" />
            </div>
            <div>
              <div className="text-[0.85rem] font-semibold">{show.c.side === 'right' ? 'Joy (R)' : 'Joy (L)'} {attached ? 'verbunden' : show.c.lost ? 'getrennt' : 'abgenommen'}</div>
              <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-mist-300">
                <BatteryGlyph percent={show.c.battery} charging={show.c.charging} />
                <span className="tabular-nums">{show.c.battery ?? '—'}%</span>
                <span>· {show.c.lost ? 'Verbindung verloren' : transportLabel}</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
