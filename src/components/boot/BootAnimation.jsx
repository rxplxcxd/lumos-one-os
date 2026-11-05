// "Lumos One" boot sequence: a point of light ignites in the centre, stretches into a beam,
// the wordmark condenses out of the light, then the beam blooms open and reveals the shell
// underneath — accompanied by a rising haptic swell (pattern boot.rise).
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '@/services/haptics.js';

const DURATION = 3600;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export default function BootAnimation({ onReveal, onDone, fast }) {
  const canvas = useRef(null);
  const [phase, setPhase] = useState('ignite');
  const total = fast ? 1400 : DURATION;

  useEffect(() => {
    haptic('boot.rise');
    const c = canvas.current;
    const ctx = c.getContext('2d');
    let raf;
    const t0 = performance.now();
    let revealed = false;
    const draw = (now) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = (c.width = c.clientWidth * dpr);
      const H = (c.height = c.clientHeight * dpr);
      const t = (now - t0) / total;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const cx = W / 2;
      const cy = H / 2;

      const ignite = ease(seg(t, 0.02, 0.2));
      const stretch = easeInOut(seg(t, 0.16, 0.42));
      const bloom = easeInOut(seg(t, 0.72, 0.98));
      const fade = 1 - seg(t, 0.86, 1);
      const flicker = 0.92 + 0.08 * Math.sin(now / 37) * Math.sin(now / 91);

      // core point
      const coreR = (2 + ignite * 10) * dpr;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 14);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * ignite * fade})`);
      g.addColorStop(0.08, `rgba(225,235,255,${0.55 * ignite * fade})`);
      g.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // horizontal beam
      if (stretch > 0) {
        const half = (W * 0.46 * stretch);
        const thick = (1.2 + 1.8 * (1 - bloom)) * dpr;
        const lg = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
        lg.addColorStop(0, 'rgba(180,200,255,0)');
        lg.addColorStop(0.5, `rgba(255,255,255,${0.95 * flicker * fade})`);
        lg.addColorStop(1, 'rgba(180,200,255,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(cx - half, cy - thick / 2, half * 2, thick);
        // halo around the beam
        for (let i = 1; i <= 3; i++) {
          const hh = thick * (6 + i * 10);
          const hg = ctx.createLinearGradient(0, cy - hh, 0, cy + hh);
          hg.addColorStop(0, 'rgba(120,150,255,0)');
          hg.addColorStop(0.5, `rgba(150,175,255,${(0.07 / i) * stretch * fade})`);
          hg.addColorStop(1, 'rgba(120,150,255,0)');
          ctx.fillStyle = hg;
          ctx.fillRect(cx - half * 0.9, cy - hh, half * 1.8, hh * 2);
        }
      }

      // bloom: the light opens vertically and floods the screen
      if (bloom > 0) {
        const r = Math.hypot(W, H) * 0.6 * bloom;
        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
        bg.addColorStop(0, `rgba(235,240,255,${0.32 * (1 - bloom) * fade})`);
        bg.addColorStop(0.7, `rgba(160,185,255,${0.12 * (1 - bloom) * fade})`);
        bg.addColorStop(1, 'rgba(120,150,255,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
      }

      if (t > 0.3 && phase !== 'word') setPhase((p) => (p === 'ignite' ? 'word' : p));
      if (t > 0.74 && !revealed) {
        revealed = true;
        setPhase('reveal');
        onReveal?.();
      }
      if (t < 1) raf = requestAnimationFrame(draw);
      else onDone?.();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letters = 'Lumos One'.split('');
  return (
    <motion.div className="fixed inset-0 z-[100] overflow-hidden" initial={{ opacity: 1 }} animate={{ opacity: phase === 'reveal' ? 0 : 1 }} transition={{ duration: (total / 1000) * 0.26, ease: 'easeOut' }}>
      <motion.div className="absolute inset-0 bg-black" animate={{ clipPath: phase === 'reveal' ? 'inset(50% 0% 50% 0%)' : 'inset(0% 0% 0% 0%)' }} transition={{ duration: (total / 1000) * 0.24, ease: [0.7, 0, 0.2, 1] }} />
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {phase !== 'ignite' && (
            <motion.div className="relative flex -translate-y-[2.6rem] select-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {letters.map((ch, i) => (
                <motion.span
                  key={i}
                  className="text-[3.4rem] font-[300] text-white"
                  style={{ textShadow: '0 0 24px rgba(200,215,255,0.55)' }}
                  initial={{ opacity: 0, y: 14, filter: 'blur(12px)', letterSpacing: '0.6em' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)', letterSpacing: '0.18em' }}
                  transition={{ delay: (fast ? 0.01 : 0.035) * i, type: 'spring', stiffness: 160, damping: 20, filter: { delay: (fast ? 0.01 : 0.035) * i, duration: 0.55, ease: 'easeOut' }, opacity: { delay: (fast ? 0.01 : 0.035) * i, duration: 0.4 } }}
                >
                  {ch === ' ' ? ' ' : ch}
                </motion.span>
              ))}
              <motion.span
                className="pointer-events-none absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/40 to-transparent mix-blend-overlay"
                initial={{ x: '-8rem' }}
                animate={{ x: '28rem' }}
                transition={{ delay: fast ? 0.1 : 0.45, duration: fast ? 0.4 : 0.9, ease: [0.3, 0, 0.2, 1] }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
