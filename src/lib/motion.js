// Physically-based spring presets shared by every animation in the shell.
export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  soft: { type: 'spring', stiffness: 260, damping: 28, mass: 0.9 },
  bouncy: { type: 'spring', stiffness: 420, damping: 18, mass: 0.8 },
  gentle: { type: 'spring', stiffness: 140, damping: 22, mass: 1 },
  sheet: { type: 'spring', stiffness: 380, damping: 38, mass: 1 },
};

export const screenVariants = {
  initial: { opacity: 0, scale: 0.965, y: 18, filter: 'blur(6px)' },
  animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: { ...spring.soft, opacity: { duration: 0.22 }, filter: { duration: 0.28 } } },
  exit: { opacity: 0, scale: 1.02, y: -8, filter: 'blur(4px)', transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

export const listStagger = {
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
};

export const itemRise = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: spring.soft },
};
