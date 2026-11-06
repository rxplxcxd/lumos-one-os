// Physically-based spring presets shared by every animation in the shell. The global animation
// speed (Einstellungen → Animationen) scales all springs: ω ∝ √stiffness, so speed s → stiffness·s², damping·s.
const BASE = {
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  soft: { type: 'spring', stiffness: 260, damping: 28, mass: 0.9 },
  bouncy: { type: 'spring', stiffness: 420, damping: 18, mass: 0.8 },
  gentle: { type: 'spring', stiffness: 140, damping: 22, mass: 1 },
  sheet: { type: 'spring', stiffness: 380, damping: 38, mass: 1 },
};

export const spring = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, { ...v }]));

export let motionSpeed = 1;
export function setMotionSpeed(s) {
  motionSpeed = Math.max(0.4, Math.min(2.5, s || 1));
  for (const [k, v] of Object.entries(BASE)) {
    spring[k].stiffness = v.stiffness * motionSpeed * motionSpeed;
    spring[k].damping = v.damping * motionSpeed;
  }
}
const d = (sec) => sec / motionSpeed;

// Screen transitions. `custom` = { style, dir } where dir = 1 (open) / −1 (back).
export const TRANSITIONS = [
  { key: 'spring', label: 'Federn' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'slide', label: 'Schieben' },
  { key: 'rise', label: 'Aufsteigen' },
  { key: 'flip', label: 'Drehen' },
  { key: 'fade', label: 'Überblenden' },
];

export const screenVariants = {
  initial: ({ style = 'spring', dir = 1 } = {}) => {
    switch (style) {
      case 'zoom':
        return { opacity: 0, scale: dir > 0 ? 0.86 : 1.12, filter: 'blur(10px)' };
      case 'slide':
        return { opacity: 0, x: `${dir * 8}%`, scale: 1 };
      case 'rise':
        return { opacity: 0, y: dir > 0 ? 60 : -40, scale: 0.98 };
      case 'flip':
        return { opacity: 0, rotateY: dir * 18, scale: 0.94, transformPerspective: 1400 };
      case 'fade':
        return { opacity: 0 };
      default:
        return { opacity: 0, scale: 0.965, y: 18 * dir, filter: 'blur(6px)' };
    }
  },
  animate: ({ style = 'spring' } = {}) => ({
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotateY: 0,
    filter: 'blur(0px)',
    transitionEnd: { filter: 'none' },
    transition: style === 'fade' ? { duration: d(0.25) } : { ...spring.soft, opacity: { duration: d(0.22) }, filter: { duration: d(0.28) } },
  }),
  exit: ({ style = 'spring', dir = 1 } = {}) => {
    const t = { duration: d(0.18), ease: [0.4, 0, 1, 1] };
    switch (style) {
      case 'zoom':
        return { opacity: 0, scale: dir > 0 ? 1.1 : 0.9, filter: 'blur(8px)', transition: t };
      case 'slide':
        return { opacity: 0, x: `${-dir * 8}%`, transition: t };
      case 'rise':
        return { opacity: 0, y: dir > 0 ? -30 : 40, transition: t };
      case 'flip':
        return { opacity: 0, rotateY: -dir * 18, scale: 0.96, transformPerspective: 1400, transition: t };
      case 'fade':
        return { opacity: 0, transition: t };
      default:
        return { opacity: 0, scale: 1.02, y: -8 * dir, filter: 'blur(4px)', transition: t };
    }
  },
};

export const listStagger = {
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
};

export const itemRise = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: spring.soft },
};
