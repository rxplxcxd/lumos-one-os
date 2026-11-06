// Subtle synthesized UI sounds (WebAudio, no sample files), paired with the haptic patterns.
let ctx = null;
let cfg = { enabled: false, theme: 'soft', volume: 0.5 };
const last = new Map();

export function configureSounds(c) {
  cfg = { ...cfg, ...c };
}

const THEMES = {
  soft: { wave: 'sine', base: 660, decay: 0.06 },
  crisp: { wave: 'triangle', base: 1250, decay: 0.035 },
  glass: { wave: 'sine', base: 1760, decay: 0.12 },
};

// pattern → [pitch multiplier, gain, extra tone (pitch, delay s)]
const MAP = {
  'nav.tick': [1, 0.12],
  'nav.edge': [0.5, 0.18],
  'nav.page': [1.25, 0.14],
  'slider.detent': [1.5, 0.07],
  key: [1.33, 0.09],
  select: [1.5, 0.22, [2, 0.05]],
  back: [0.8, 0.16],
  open: [1.2, 0.18, [1.6, 0.06]],
  close: [1.1, 0.16, [0.8, 0.06]],
  'toggle.on': [1.6, 0.18],
  'toggle.off': [1.1, 0.15],
  success: [1.5, 0.22, [2.25, 0.08]],
  'faceid.success': [1.5, 0.2, [2, 0.09]],
  'faceid.fail': [0.6, 0.24, [0.5, 0.1]],
  error: [0.45, 0.25, [0.4, 0.09]],
  notify: [1.33, 0.2, [1.78, 0.1]],
  'controller.attach': [1.2, 0.22, [1.8, 0.07]],
  'controller.detach': [1.8, 0.2, [1.2, 0.07]],
};

function tone(freq, gain, t0, decay, wave) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(freq * 0.92, t0 + decay * 2);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * 3);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + decay * 3 + 0.02);
}

export function playSound(pattern) {
  if (!cfg.enabled || !MAP[pattern]) return;
  const now = performance.now();
  if (now - (last.get(pattern) ?? 0) < 25) return;
  last.set(pattern, now);
  try {
    if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // autoplay policy: wait for the first interaction
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const th = THEMES[cfg.theme] || THEMES.soft;
    const [mul, gain, extra] = MAP[pattern];
    const t0 = ctx.currentTime + 0.001;
    tone(th.base * mul, gain * cfg.volume * 0.5, t0, th.decay, th.wave);
    if (extra) tone(th.base * extra[0], gain * cfg.volume * 0.4, t0 + extra[1], th.decay, th.wave);
  } catch {
    /* audio unavailable */
  }
}
