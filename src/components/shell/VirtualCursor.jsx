import { useEffect, useRef, useState } from 'react';
import { motion, useSpring } from 'framer-motion';
import { createPortal } from 'react-dom';
import { cursor, onCursor, hideCursor } from '@/lib/cursor.js';

export default function VirtualCursor() {
  const x = useSpring(cursor.x, { stiffness: 1400, damping: 70, mass: 0.4 });
  const y = useSpring(cursor.y, { stiffness: 1400, damping: 70, mass: 0.4 });
  const [state, setState] = useState({ visible: false, hover: false, pressed: 0 });
  const timer = useRef();
  useEffect(() => {
    const off = onCursor((c) => {
      x.set(c.x);
      y.set(c.y);
      setState({ visible: c.visible, hover: !!c.hover, pressed: c.pressed });
      clearTimeout(timer.current);
      timer.current = setTimeout(hideCursor, 3500);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, [x, y]);
  const pressing = performance.now() - state.pressed < 160;
  return createPortal(
    <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[99]" style={{ x, y }} animate={{ opacity: state.visible ? 1 : 0 }} transition={{ duration: 0.25 }}>
      <motion.div
        className="absolute -left-[1.1rem] -top-[1.1rem] h-[2.2rem] w-[2.2rem] rounded-full"
        animate={{ scale: pressing ? 0.7 : state.hover ? 1.35 : 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 22 }}
        style={{
          border: '2.5px solid rgb(var(--lumen) / 0.85)',
          background: state.hover ? 'rgb(var(--lumen) / 0.12)' : 'rgba(255,255,255,0.04)',
          boxShadow: '0 0 18px 2px rgb(var(--lumen) / 0.45), inset 0 0 10px rgb(var(--lumen) / 0.25)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div className="absolute -left-[3px] -top-[3px] h-[6px] w-[6px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
    </motion.div>,
    document.body,
  );
}
