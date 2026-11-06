// Ambient layer: screensaver after inactivity (drifting clock / ambient / photo), charging
// animation when the charger is connected, night-shift tint (manual / sunset→sunrise /
// schedule), OLED care (pixel shift, dimming static chrome) and auto-sleep.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BatteryCharging } from 'lucide-react';
import { useSettings } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { useUI } from '@/store/ui.js';
import { useNow } from '@/components/ui/primitives.jsx';
import AnimatedNumber from '@/components/ui/AnimatedNumber.jsx';
import { haptic } from '@/services/haptics.js';
import { notify, request } from '@/services/bridge.js';
import { nightShiftActive } from '@/lib/sun.js';

// ±1–2 px orbit applied to the main UI layer every 3 min (OLED burn-in protection)
export const pixelOffset = { x: 0, y: 0, listeners: new Set() };
const ORBIT = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function Screensaver({ style, onWake }) {
  const now = useNow(1000);
  const battery = useSystem((s) => s.battery);
  const h24 = useSettings((s) => s.values.clock24h);
  // slow Lissajous drift avoids OLED burn-in
  const t = now.getTime() / 1000;
  const x = Math.sin(t / 47) * 18;
  const y = Math.cos(t / 61) * 14;
  return (
    <motion.div className="fixed inset-0 z-[98] cursor-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.2 }} onPointerDown={onWake}>
      <div className={`absolute inset-0 ${style === 'photo' ? 'bg-black/25' : style === 'ambient' ? 'bg-black/55' : 'bg-black/80'}`} />
      {style !== 'photo' && (
        <motion.div className="absolute inset-0 flex flex-col items-center justify-center" animate={{ x: `${x}vw`, y: `${y}vh` }} transition={{ type: 'spring', stiffness: 4, damping: 6 }}>
          <div className="text-[7rem] font-extralight tabular-nums leading-none text-white/80">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: !h24 })}</div>
          <div className="mt-3 text-lg text-white/45">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {battery.percent != null && (
            <div className="mt-6 flex items-center gap-2 text-[0.9rem] text-white/40">
              {battery.charging && <BatteryCharging className="h-4 w-4 text-ok/70" />}
              {Math.round(battery.percent)}%
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function Charging({ percent }) {
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-[94] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <motion.div className="absolute h-[30rem] w-[30rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(95,214,154,0.28), rgba(95,214,154,0.05) 55%, transparent 70%)' }} initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: [0.2, 1.15, 1], opacity: [0, 1, 0.8] }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }} />
      <svg viewBox="0 0 100 100" className="absolute h-[14rem] w-[14rem] -rotate-90">
        <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.08)" strokeWidth="3" fill="none" />
        <motion.circle cx="50" cy="50" r="44" stroke="#5fd69a" strokeWidth="3.5" strokeLinecap="round" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: (percent ?? 0) / 100 }} transition={{ duration: 1.2, ease: [0.3, 0, 0.2, 1] }} />
      </svg>
      <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.15 }}>
        <BatteryCharging className="h-10 w-10 text-ok" />
        <AnimatedNumber value={percent} format={(v) => `${Math.round(v)}%`} className="mt-1 text-3xl font-light text-white" />
        <span className="text-[0.8rem] text-mist-300">Wird geladen</span>
      </motion.div>
    </motion.div>
  );
}

export default function Ambient() {
  const v = useSettings((s) => s.values);
  const battery = useSystem((s) => s.battery);
  const running = useSystem((s) => s.running);
  const saver = useUI((s) => s.screensaver);
  const [charging, setCharging] = useState(false);
  const lastInput = useRef(Date.now());
  const prevCharging = useRef(battery.charging);
  const dimmed = useRef(false);
  const [night, setNight] = useState(() => nightShiftActive(useSettings.getState().values));

  // night shift: re-evaluate every minute (auto mode follows local sunset/sunrise)
  useEffect(() => {
    setNight(nightShiftActive(v));
    const t = setInterval(() => setNight(nightShiftActive(useSettings.getState().values)), 60000);
    return () => clearInterval(t);
  }, [v.nightShiftMode, v.nightShiftFrom, v.nightShiftTo, v.nightShift, v.weatherLocation]);

  // pixel shift + dim static chrome after 2 min without input
  useEffect(() => {
    let step = 0;
    const shift = setInterval(() => {
      const on = useSettings.getState().values.pixelShift;
      step = on ? (step + 1) % ORBIT.length : 0;
      [pixelOffset.x, pixelOffset.y] = ORBIT[step];
      pixelOffset.listeners.forEach((f) => f(pixelOffset));
    }, 180000);
    const dim = setInterval(() => {
      const idle = Date.now() - lastInput.current > 120000;
      const want = idle && useSettings.getState().values.dimStatic && !useSystem.getState().running;
      document.documentElement.classList.toggle('dim-static', !!want);
    }, 5000);
    return () => (clearInterval(shift), clearInterval(dim));
  }, []);

  // inactivity tracking
  useEffect(() => {
    const bump = () => {
      lastInput.current = Date.now();
      document.documentElement.classList.remove('dim-static');
      if (useUI.getState().screensaver) wake();
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'lumos:action'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const { screensaverMin, autoSleepMin, screensaverDim } = useSettings.getState().values;
      const idle = (Date.now() - lastInput.current) / 60000;
      if (useSystem.getState().running) return; // never while a game runs
      if (screensaverMin > 0 && idle >= screensaverMin && !useUI.getState().screensaver) {
        useUI.setState({ screensaver: true });
        if (screensaverDim) {
          dimmed.current = true;
          notify('display.set', { brightness: Math.max(5, Math.round(useSettings.getState().values.brightness * 0.35)) });
        }
      }
      if (autoSleepMin > 0 && idle >= autoSleepMin) {
        lastInput.current = Date.now();
        request('system.power', { action: 'suspend' }).catch(() => {});
      }
    }, 5000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, []);

  function wake() {
    useUI.setState({ screensaver: false });
  }
  useEffect(() => {
    if (!saver && dimmed.current) {
      dimmed.current = false;
      notify('display.set', { brightness: useSettings.getState().values.brightness });
    }
    if (!saver) lastInput.current = Date.now();
  }, [saver]);

  // charger connected → charging animation
  useEffect(() => {
    if (battery.charging && prevCharging.current === false && v.chargeAnimation && !running) {
      haptic('success');
      setCharging(true);
      const t = setTimeout(() => setCharging(false), 2600);
      prevCharging.current = battery.charging;
      return () => clearTimeout(t);
    }
    prevCharging.current = battery.charging;
    return undefined;
  }, [battery.charging, v.chargeAnimation, running]);

  return (
    <>
      <AnimatePresence>
        {night && <motion.div key="ns" className="pointer-events-none fixed inset-0 z-[99] mix-blend-multiply" style={{ background: `rgba(255, 170, 90, ${(v.nightShift || 0.5) * 0.35})` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 3 }} />}
      </AnimatePresence>
      <AnimatePresence>{charging && <Charging key="chg" percent={battery.percent} />}</AnimatePresence>
      <AnimatePresence>{saver && <Screensaver key="ss" style={v.screensaverStyle} onWake={wake} />}</AnimatePresence>
    </>
  );
}
