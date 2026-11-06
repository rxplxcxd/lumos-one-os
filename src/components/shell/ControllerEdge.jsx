// Reactive attach/detach feedback: a glow sweeps along the screen edge where the Joy-Con
// left (or arrived), plus a battery popup that rides the glow.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystem } from '@/store/system.js';
import { BatteryGlyph } from './StatusBar.jsx';
import { spring } from '@/lib/motion.js';
import { useSettings } from '@/store/settings.js';
import { Gamepad2 } from 'lucide-react';
import { FAMILY_LABEL } from '@/lib/controllers.js';

const FAMILY_COLOR = { xbox: '#107c10', playstation: '#2f5fd0', nintendo: '#e60012', generic: '#6b7280', lumos: '#8a8f99' };

function ExternalPopup({ show, attached }) {
  const c = show.c;
  const color = FAMILY_COLOR[c.family] || FAMILY_COLOR.generic;
  return (
    <AnimatePresence>
      <div key={show.t} className="pointer-events-none fixed inset-x-0 top-[4.2rem] z-[60] flex justify-center">
        <motion.div className="glass-strong flex items-center gap-4 rounded-full py-2.5 pl-2.5 pr-6" initial={{ y: -50, opacity: 0, scale: 0.85 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -40, opacity: 0 }} transition={spring.bouncy}>
          <motion.span className="relative flex h-11 w-11 items-center justify-center rounded-full" style={{ background: color }} animate={attached ? { scale: [1, 1.18, 1] } : { rotate: [0, -12, 12, 0] }} transition={{ duration: 0.6 }}>
            <Gamepad2 className="h-6 w-6 text-white" />
            {attached && <motion.span className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${color}` }} initial={{ scale: 1, opacity: 0.9 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 0.9 }} />}
          </motion.span>
          <div>
            <div className="text-[0.88rem] font-semibold">{c.name} {attached ? 'verbunden' : 'getrennt'}</div>
            <div className="text-[0.72rem] text-mist-300">
              {FAMILY_LABEL[c.family] || 'Controller'} · {c.transport === 'bt' ? 'Bluetooth' : 'USB'}
              {attached && c.slot ? ` · Spieler ${c.slot}` : ''}
              {c.battery != null ? ` · ${c.battery}%` : ''}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function ControllerEdge() {
  const ev = useSystem((s) => s.detachEvent);
  const [show, setShow] = useState(null);
  const notifyOn = useSettings((st) => st.values.notifyControllers);
  useEffect(() => {
    if (!ev || !notifyOn) return undefined;
    setShow(ev);
    const t = setTimeout(() => setShow(null), 2600);
    return () => clearTimeout(t);
  }, [ev, notifyOn]);

  const side = show?.c?.side === 'right' ? 'right' : 'left';
  const attached = show?.kind === 'attached';
  const glow = attached ? '127,163,255' : '255,255,255';
  const transportLabel = { pogo: 'Angedockt · lädt', ble: 'Bluetooth LE', usb: 'USB', bt: 'Bluetooth' }[show?.c?.transport] || '';

  if (show && show.c?.side !== 'left' && show.c?.side !== 'right') return <ExternalPopup show={show} attached={attached} />;
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
          <div className={`absolute inset-y-0 flex items-center ${side === 'left' ? 'left-6' : 'right-6'}`}>
          <motion.div
            className="glass-strong flex items-center gap-3 rounded-3xl px-4 py-3"
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
