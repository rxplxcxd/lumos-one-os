// Global focus halo + press ripples.
//  • Halo: one softly glowing frame that springs from the previously focused element to the next
//    one (size, position and corner radius) — the Switch/PS5 "light follows you" feel.
//  • Ripples: every A press / tap emits a light wave clipped to the pressed element's shape.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';
import { useSettings } from '@/store/settings.js';
import { motionSpeed } from '@/lib/motion.js';

function rectOf(el) {
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  const radius = parseFloat(st.borderTopLeftRadius) || 12;
  // whileFocus scale animations: read the real transformed box
  return { x: r.left, y: r.top, w: r.width, h: r.height, radius };
}

function Halo() {
  const cfg = { stiffness: 720 * motionSpeed * motionSpeed, damping: 46 * motionSpeed, mass: 0.8 };
  const x = useSpring(0, cfg);
  const y = useSpring(0, cfg);
  const w = useSpring(0, cfg);
  const h = useSpring(0, cfg);
  const radius = useSpring(12, cfg);
  const [visible, setVisibleState] = useState(false);
  const visibleRef = useRef(false);
  const setVisible = (v) => {
    visibleRef.current = v;
    setVisibleState(v);
  };
  const target = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    let raf;
    const track = () => {
      const el = target.current;
      if (el && el.isConnected && document.activeElement === el) {
        const r = rectOf(el);
        if (r.w < 2) setVisible(false);
        else {
          const pad = 3;
          const jump = first.current;
          for (const [mv, v] of [[x, r.x - pad], [y, r.y - pad], [w, r.w + pad * 2], [h, r.h + pad * 2], [radius, r.radius + pad]]) jump ? mv.jump(v) : mv.set(v);
          first.current = false;
        }
      } else if (target.current) {
        target.current = null;
        setVisible(false);
      }
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    const onFocus = (e) => {
      const el = e.target;
      if (!el?.matches?.('[data-nav]')) return;
      if (!target.current) first.current = !visibleRef.current;
      target.current = el;
      setVisible(true);
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('focusin', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[96]"
      style={{ x, y, width: w, height: h, borderRadius: radius }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 rounded-[inherit]" style={{ boxShadow: '0 0 0 2px rgb(var(--lumen) / 0.95), 0 0 22px 2px rgb(var(--lumen) / 0.28), inset 0 0 18px rgb(var(--lumen) / 0.10)' }} />
      <motion.div
        className="absolute inset-0 rounded-[inherit]"
        style={{ boxShadow: '0 0 0 1px rgb(var(--lumen) / 0.5)' }}
        animate={{ opacity: [0.7, 0.1, 0.7], scale: [1, 1.03, 1] }}
        transition={{ duration: 2.4 / motionSpeed, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  );
}

let rippleSeq = 1;
function Ripples() {
  const [ripples, setRipples] = useState([]);
  useEffect(() => {
    const spawn = (el, cx, cy) => {
      if (!el) return;
      const r = rectOf(el);
      const id = rippleSeq++;
      const size = Math.hypot(r.w, r.h) * 2.1;
      setRipples((rs) => [...rs.slice(-5), { id, ...r, cx: (cx ?? r.x + r.w / 2) - r.x, cy: (cy ?? r.y + r.h / 2) - r.y, size }]);
      setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 900 / motionSpeed);
    };
    const onActivate = (e) => spawn(e.detail?.el);
    const onDown = (e) => {
      const el = e.target.closest?.('[data-nav]');
      if (el) spawn(el, e.clientX, e.clientY);
    };
    window.addEventListener('lumos:activate', onActivate);
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      window.removeEventListener('lumos:activate', onActivate);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[97]">
      <AnimatePresence>
        {ripples.map((r) => (
          <div key={r.id} className="absolute overflow-hidden" style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.radius }}>
            <motion.span
              className="absolute rounded-full"
              style={{ left: r.cx - r.size / 2, top: r.cy - r.size / 2, width: r.size, height: r.size, background: 'radial-gradient(circle, rgb(var(--lumen) / 0.35) 0%, rgb(var(--lumen) / 0.12) 40%, transparent 70%)' }}
              initial={{ scale: 0.05, opacity: 0.9 }}
              animate={{ scale: 1, opacity: 0 }}
              transition={{ duration: 0.75 / motionSpeed, ease: [0.2, 0.7, 0.2, 1] }}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function FocusLayer() {
  const focusStyle = useSettings((s) => s.values.focusStyle);
  const ripples = useSettings((s) => s.values.pressRipples);
  const reduce = useSettings((s) => s.values.reduceMotion);
  return (
    <>
      {focusStyle === 'halo' && <Halo />}
      {ripples && !reduce && <Ripples />}
    </>
  );
}
