// Seasonal holiday engine: decides which festive theme is active (automatically by date or
// forced in settings) and describes its particles, accent colour, decorations and jingle.

/** Easter Sunday (Gregorian computus, Meeus/Jones/Butcher). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export const SEASONS = {
  halloween: {
    label: 'Halloween',
    greeting: 'Fröhliches Gruseln! 🎃',
    accent: [255, 140, 40],
    particles: 'bats',
    decor: 'candles',
    jingle: [[220, 0.5, 'triangle'], [207.65, 0.5, 'triangle'], [196, 0.5, 'triangle'], [155.56, 1.2, 'sine']],
  },
  christmas: {
    label: 'Weihnachten',
    greeting: 'Frohe Weihnachten! 🎄',
    accent: [230, 70, 70],
    particles: 'snow',
    decor: 'lights',
    jingle: [[659.25, 0.18], [659.25, 0.18], [659.25, 0.36], [659.25, 0.18], [659.25, 0.18], [659.25, 0.36], [659.25, 0.18], [783.99, 0.18], [523.25, 0.27], [587.33, 0.09], [659.25, 0.6]],
  },
  newyear: {
    label: 'Silvester & Neujahr',
    greeting: 'Frohes neues Jahr! 🎆',
    accent: [255, 210, 90],
    particles: 'confetti',
    decor: 'fireworks',
    jingle: [[523.25, 0.12], [659.25, 0.12], [783.99, 0.12], [1046.5, 0.5]],
  },
  easter: {
    label: 'Ostern',
    greeting: 'Frohe Ostern! 🐣',
    accent: [150, 210, 120],
    particles: 'petals',
    decor: 'eggs',
    jingle: [[783.99, 0.15], [880, 0.15], [987.77, 0.15], [1174.66, 0.45]],
  },
  valentine: {
    label: 'Valentinstag',
    greeting: 'Alles Liebe zum Valentinstag ❤',
    accent: [240, 90, 140],
    particles: 'hearts',
    decor: null,
    jingle: [[587.33, 0.25], [739.99, 0.25], [880, 0.6]],
  },
};

const md = (d) => (d.getMonth() + 1) * 100 + d.getDate();

/** Which season is active automatically on `date` (null if none). */
export function autoSeason(date = new Date()) {
  const x = md(date);
  if (x >= 1020 && x <= 1101) return 'halloween';
  if (x >= 1201 && x <= 1226) return 'christmas';
  if (x >= 1231 || x <= 102) return 'newyear';
  if (x >= 213 && x <= 214) return 'valentine';
  const e = easterSunday(date.getFullYear());
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - e) / 864e5);
  if (diff >= -3 && diff <= 1) return 'easter';
  return null;
}

/** Resolves the `seasonal` setting (auto | off | <key>) to a season key or null. */
export function activeSeason(setting = 'auto', date = new Date()) {
  if (setting === 'off') return null;
  if (setting && setting !== 'auto') return SEASONS[setting] ? setting : null;
  return autoSeason(date);
}

let ctx;
/** Plays the season's short synthesized jingle through Web Audio. */
export function playJingle(key, volume = 0.18) {
  const s = SEASONS[key];
  if (!s) return;
  try {
    if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // autoplay policy: wait for the first interaction
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    let t = ctx.currentTime + 0.02;
    for (const [freq, dur, wave = 'sine'] of s.jingle) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(freq, t);
      if (key === 'halloween') o.frequency.linearRampToValueAtTime(freq * 0.97, t + dur); // eerie glide
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volume, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur;
    }
  } catch {
    /* no audio */
  }
}
