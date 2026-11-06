// Seasonal theme engine (render side): procedural particles behind the UI (snow, bats,
// confetti, petals, hearts), decorations (string lights, candle flicker, fireworks),
// festive dock styling via <html data-season>, a once-a-day greeting jingle and
// hidden easter eggs (Halloween pumpkins / Easter eggs that pop up and can be collected).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { SEASONS, activeSeason, playJingle } from '@/lib/seasons.js';

const COUNT = { snow: 90, bats: 10, confetti: 70, petals: 40, hearts: 26 };

function spawn(kind, w, h, initial) {
  const r = Math.random;
  const base = { x: r() * w, y: initial ? r() * h : -20, phase: r() * Math.PI * 2 };
  switch (kind) {
    case 'snow':
      return { ...base, s: 1 + r() * 2.6, vy: 18 + r() * 34, vx: -6 + r() * 12, a: 0.35 + r() * 0.5 };
    case 'bats':
      return { ...base, y: r() * h * 0.6, x: initial ? r() * w : -30, s: 8 + r() * 10, vx: 40 + r() * 60, vy: 0, a: 0.55 };
    case 'confetti':
      return { ...base, s: 3 + r() * 4, vy: 40 + r() * 50, vx: -20 + r() * 40, a: 0.8, hue: Math.floor(r() * 360), spin: r() * 6 };
    case 'petals':
      return { ...base, s: 4 + r() * 4, vy: 20 + r() * 25, vx: 8 + r() * 20, a: 0.6, hue: [330, 50, 110, 280][Math.floor(r() * 4)], spin: r() * 3 };
    default: // hearts
      return { ...base, y: initial ? r() * h : h + 20, s: 6 + r() * 8, vy: -(16 + r() * 22), vx: 0, a: 0.4 + r() * 0.3 };
  }
}

function draw(c, p, kind, t) {
  c.globalAlpha = p.a;
  if (kind === 'snow') {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(p.x, p.y, p.s, 0, Math.PI * 2);
    c.fill();
  } else if (kind === 'bats') {
    const flap = Math.sin(t * 14 + p.phase) * 0.6;
    c.fillStyle = '#0b0710';
    c.save();
    c.translate(p.x, p.y + Math.sin(t * 2 + p.phase) * 10);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-p.s, -p.s * flap, -p.s * 2, p.s * 0.2);
    c.quadraticCurveTo(-p.s, p.s * 0.1, 0, p.s * 0.4);
    c.quadraticCurveTo(p.s, p.s * 0.1, p.s * 2, p.s * 0.2);
    c.quadraticCurveTo(p.s, -p.s * flap, 0, 0);
    c.fill();
    c.restore();
  } else if (kind === 'confetti' || kind === 'petals') {
    c.save();
    c.translate(p.x, p.y);
    c.rotate(t * p.spin + p.phase);
    c.fillStyle = `hsl(${p.hue} 85% ${kind === 'petals' ? 82 : 62}%)`;
    if (kind === 'petals') {
      c.beginPath();
      c.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      c.fill();
    } else c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    c.restore();
  } else {
    c.fillStyle = '#ff5c8a';
    c.save();
    c.translate(p.x + Math.sin(t + p.phase) * 12, p.y);
    c.scale(p.s / 10, p.s / 10);
    c.beginPath();
    c.moveTo(0, 3);
    c.bezierCurveTo(-10, -4, -4, -11, 0, -5);
    c.bezierCurveTo(4, -11, 10, -4, 0, 3);
    c.fill();
    c.restore();
  }
}

function Particles({ kind, lowPower }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const c = cv.getContext('2d');
    let w = 0;
    let h = 0;
    const resize = () => {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    const n = Math.round((COUNT[kind] || 40) * (lowPower ? 0.35 : 1));
    let ps = Array.from({ length: n }, () => spawn(kind, w, h, true));
    let raf;
    let last = performance.now();
    const minDt = lowPower ? 1000 / 30 : 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || useSystem.getState().running) return;
      const dtMs = now - last;
      if (dtMs < minDt) return;
      last = now;
      const dt = Math.min(0.05, dtMs / 1000);
      const t = now / 1000;
      c.clearRect(0, 0, w, h);
      ps = ps.map((p) => {
        p.x += (p.vx + (kind === 'snow' ? Math.sin(t + p.phase) * 8 : 0)) * dt;
        p.y += p.vy * dt;
        const out = p.y > h + 30 || p.y < -40 || p.x > w + 40 || p.x < -60;
        return out ? spawn(kind, w, h, false) : p;
      });
      for (const p of ps) draw(c, p, kind, t);
      c.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [kind, lowPower]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0" aria-hidden />;
}

const BULBS = ['#ff4d4d', '#ffd84d', '#4dff88', '#4db8ff', '#ff4dd2'];
function Lights() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[2] flex justify-between px-4" aria-hidden>
      <svg className="absolute inset-x-0 top-0 h-6 w-full" preserveAspectRatio="none" viewBox="0 0 100 10">
        <path d="M0 2 Q 5 7 10 2 T 20 2 T 30 2 T 40 2 T 50 2 T 60 2 T 70 2 T 80 2 T 90 2 T 100 2" stroke="rgba(20,40,20,0.8)" strokeWidth="0.5" fill="none" />
      </svg>
      {Array.from({ length: 21 }, (_, i) => (
        <span key={i} className="season-bulb relative mt-[0.55rem] h-2.5 w-1.5 rounded-b-full" style={{ background: BULBS[i % 5], color: BULBS[i % 5], animationDelay: `${(i % 5) * 0.37}s`, marginTop: i % 2 ? '0.95rem' : '0.4rem' }} />
      ))}
    </div>
  );
}

function Candles() {
  return <div className="season-candles pointer-events-none fixed inset-0 z-[2]" aria-hidden />;
}

function Fireworks({ lowPower }) {
  const [bursts, setBursts] = useState([]);
  useEffect(() => {
    if (lowPower) return undefined;
    const t = setInterval(() => {
      const id = Math.random();
      setBursts((b) => [...b.slice(-3), { id, x: 10 + Math.random() * 80, y: 8 + Math.random() * 30, hue: Math.floor(Math.random() * 360) }]);
    }, 2600);
    return () => clearInterval(t);
  }, [lowPower]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[1]" aria-hidden>
      {bursts.map((b) => (
        <div key={b.id} className="absolute" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return <motion.span key={i} className="absolute h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${b.hue} 90% 65%)`, boxShadow: `0 0 8px hsl(${b.hue} 90% 60%)` }} initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos(a) * 70, y: Math.sin(a) * 70 + 20, opacity: 0 }} transition={{ duration: 1.6, ease: 'easeOut' }} />;
          })}
        </div>
      ))}
    </div>
  );
}

// Hidden collectibles: a pumpkin (Halloween) or egg (Easter) pops up every few minutes.
function EasterEgg({ season }) {
  const [spot, setSpot] = useState(null);
  const found = useRef(Number(localStorage.getItem(`lumos.season.${season}.found`) || 0));
  useEffect(() => {
    const t = setInterval(() => {
      if (useSystem.getState().running || Math.random() > 0.35) return;
      setSpot({ x: 6 + Math.random() * 84, y: 18 + Math.random() * 64, id: Date.now() });
      setTimeout(() => setSpot(null), 9000);
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const collect = () => {
    found.current += 1;
    try {
      localStorage.setItem(`lumos.season.${season}.found`, String(found.current));
    } catch {
      /* private mode */
    }
    haptic('success');
    playJingle(season, 0.12);
    toast({ title: season === 'halloween' ? `Kürbis gefunden! (${found.current})` : `Osterei gefunden! (${found.current})`, body: found.current >= 5 ? 'Sammler-Abzeichen freigeschaltet ✨' : 'Halte weiter die Augen offen …', kind: 'success' });
    setSpot(null);
  };
  return createPortal(
    <AnimatePresence>
      {spot && (
        <motion.button key={spot.id} data-nav="" aria-label="Verstecktes Objekt" onClick={collect} className="fixed z-[60] text-[2.6rem] drop-shadow-[0_0_14px_rgba(255,160,40,0.7)]" style={{ left: `${spot.x}%`, top: `${spot.y}%` }} initial={{ scale: 0, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: [0, -8, 8, 0], opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
          {season === 'halloween' ? '🎃' : '🥚'}
        </motion.button>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default function SeasonalLayer() {
  const setting = useSettings((s) => s.values.seasonal);
  const lowPower = useSettings((s) => s.values.lowPower);
  const reduceMotion = useSettings((s) => s.values.reduceMotion);
  const [key, setKey] = useState(() => activeSeason(setting));
  useEffect(() => {
    setKey(activeSeason(setting));
    const t = setInterval(() => setKey(activeSeason(useSettings.getState().values.seasonal)), 10 * 60000);
    return () => clearInterval(t);
  }, [setting]);
  useEffect(() => {
    const root = document.documentElement;
    if (key) {
      root.dataset.season = key;
      root.style.setProperty('--season', SEASONS[key].accent.join(' '));
    } else delete root.dataset.season;
    if (!key) return;
    const day = new Date().toDateString();
    const stamp = `lumos.season.greeted.${key}`;
    if (localStorage.getItem(stamp) === day) return;
    const t = setTimeout(() => {
      toast({ title: SEASONS[key].greeting, body: 'Saisonales Thema aktiv – änderbar unter Einstellungen → Saisonale Themen.' });
      playJingle(key);
      try {
        localStorage.setItem(stamp, day);
      } catch {
        /* ignore */
      }
    }, 4500);
    return () => clearTimeout(t);
  }, [key]);
  if (!key) return null;
  const s = SEASONS[key];
  return (
    <>
      {!reduceMotion && <Particles kind={s.particles} lowPower={lowPower} />}
      {s.decor === 'lights' && <Lights />}
      {s.decor === 'candles' && !reduceMotion && <Candles />}
      {s.decor === 'fireworks' && !reduceMotion && <Fireworks lowPower={lowPower} />}
      {(key === 'halloween' || key === 'easter') && <EasterEgg season={key} />}
    </>
  );
}
