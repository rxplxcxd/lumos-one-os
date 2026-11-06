// Apple-style Face ID glyph with state-driven morphing:
// idle → searching (rotating tick ring, breathing brackets) → detected → matched (checkmark
// draws itself) or failed (horizontal head-shake, flat mouth).
import { motion, AnimatePresence } from 'framer-motion';

const BRACKETS = ['M8 30 V18 Q8 8 18 8 H30', 'M70 8 H82 Q92 8 92 18 V30', 'M92 70 V82 Q92 92 82 92 H70', 'M30 92 H18 Q8 92 8 82 V70'];
const TICKS = 48;

export default function FaceIDGlyph({ state = 'idle', size = '7rem', color }) {
  const matched = state === 'matched';
  const failed = state === 'failed';
  const searching = state === 'searching' || state === 'detected';
  const stroke = color || (matched ? '#5fd69a' : failed ? '#ff6b6b' : '#f5f7fa');

  return (
    <motion.div
      style={{ width: size, height: size }}
      animate={failed ? { x: [0, -14, 12, -9, 7, -3, 0] } : { x: 0 }}
      transition={failed ? { duration: 0.55, ease: 'easeInOut' } : { duration: 0.2 }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* scanning tick ring */}
        <AnimatePresence>
          {searching && (
            <motion.g
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, rotate: 360 }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ rotate: { duration: 2.4, repeat: Infinity, ease: 'linear' }, opacity: { duration: 0.25 }, scale: { type: 'spring', stiffness: 200, damping: 20 } }}
              style={{ originX: '50px', originY: '50px' }}
            >
              {Array.from({ length: TICKS }, (_, i) => {
                const a = (i / TICKS) * Math.PI * 2;
                const r1 = 58;
                const r2 = state === 'detected' ? 64 : 62;
                const op = 0.15 + 0.85 * Math.pow((i / TICKS), 2);
                return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2} stroke={stroke} strokeWidth="1.6" opacity={op} />;
              })}
            </motion.g>
          )}
        </AnimatePresence>

        {/* corner brackets */}
        {BRACKETS.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            stroke={stroke}
            strokeWidth="5"
            initial={false}
            animate={{
              opacity: matched ? 0 : 1,
              scale: matched ? 0.6 : searching ? [1, 0.94, 1] : 1,
            }}
            transition={searching ? { scale: { duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.05 } } : { type: 'spring', stiffness: 260, damping: 22 }}
            style={{ originX: '50px', originY: '50px' }}
          />
        ))}

        {/* face */}
        <motion.g initial={false} animate={{ opacity: matched ? 0 : 1, scale: matched ? 0.7 : 1 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }} style={{ originX: '50px', originY: '50px' }}>
          <motion.path d="M35 36 V44" stroke={stroke} strokeWidth="5" animate={state === 'detected' ? { scaleY: [1, 0.2, 1] } : {}} transition={{ duration: 0.25 }} />
          <motion.path d="M65 36 V44" stroke={stroke} strokeWidth="5" animate={state === 'detected' ? { scaleY: [1, 0.2, 1] } : {}} transition={{ duration: 0.25 }} />
          <path d="M50 37 V54 H45" stroke={stroke} strokeWidth="5" />
          <motion.path stroke={stroke} strokeWidth="5" initial={false} animate={{ d: failed ? 'M37 68 Q50 68 63 68' : 'M36 64 Q50 76 64 64' }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} />
        </motion.g>

        {/* checkmark */}
        <AnimatePresence>
          {matched && (
            <motion.path
              d="M27 52 L43 68 L74 34"
              stroke={stroke}
              strokeWidth="7"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ pathLength: { type: 'spring', stiffness: 120, damping: 18, delay: 0.08 }, opacity: { duration: 0.1 } }}
            />
          )}
        </AnimatePresence>
      </svg>
    </motion.div>
  );
}

/** Enrollment ring: 72 ticks that light up as the head turns, with live IR preview inside. */
export function EnrollRing({ progress = 0, angle = 0, frame, done, size = '18rem' }) {
  const N = 72;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-[13%] overflow-hidden rounded-full bg-ink-800">
        {frame ? (
          <img src={frame} alt="" className="h-full w-full scale-x-[-1] object-cover opacity-80 grayscale" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FaceIDGlyph state={done ? 'matched' : 'searching'} size="45%" />
          </div>
        )}
      </div>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        {Array.from({ length: N }, (_, i) => {
          const a = (i / N) * Math.PI * 2 - Math.PI / 2;
          // ticks fill in clockwise from the current head angle, like iOS
          const lit = done || i / N <= progress;
          const near = Math.abs(((a + Math.PI / 2 - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35;
          return (
            <motion.line
              key={i}
              x1={50 + Math.cos(a) * 44}
              y1={50 + Math.sin(a) * 44}
              x2={50 + Math.cos(a) * (lit || near ? 49 : 47)}
              y2={50 + Math.sin(a) * (lit || near ? 49 : 47)}
              strokeWidth="1.3"
              strokeLinecap="round"
              initial={false}
              animate={{ stroke: done ? '#5fd69a' : lit ? '#5fd69a' : 'rgba(255,255,255,0.28)' }}
              transition={{ duration: 0.25 }}
            />
          );
        })}
      </svg>
    </div>
  );
}
