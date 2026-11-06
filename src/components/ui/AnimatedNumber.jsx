// Number that rolls smoothly to its new value (spring) instead of jumping.
import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';

export default function AnimatedNumber({ value, format = (v) => Math.round(v), className = '' }) {
  const ref = useRef(null);
  const prev = useRef(value);
  useEffect(() => {
    if (value == null || !ref.current) return undefined;
    const from = prev.current ?? value;
    prev.current = value;
    const ctl = animate(from, value, { type: 'spring', stiffness: 120, damping: 22, onUpdate: (v) => ref.current && (ref.current.textContent = format(v)) });
    return () => ctl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {value == null ? '—' : format(value)}
    </span>
  );
}
