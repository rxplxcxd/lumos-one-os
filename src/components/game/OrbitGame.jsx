// "Lumos Orbit" — a small built-in arcade game. It makes clips, the performance HUD, per-game
// profiles, the task manager and playtime limits testable without any installed game.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystem } from '@/store/system.js';
import { setCaptureCanvas } from '@/lib/recorder.js';
import { applyBuiltinProfile, restoreBuiltinProfile } from '@/services/gameSession.js';
import { useSettings } from '@/store/settings.js';
import { haptic } from '@/services/haptics.js';
import { Button } from '@/components/ui/primitives.jsx';
import { back } from '@/store/ui.js';

const ID = 'builtin:orbit';

export default function OrbitGame() {
  const canvas = useRef(null);
  const [hud, setHud] = useState({ score: 0, lives: 3, best: Number(localStorage.getItem('orbit.best') || 0), over: false });
  const restart = useRef(null);

  useEffect(() => {
    useSystem.setState({ running: { id: ID, name: 'Lumos Orbit', builtin: true, started: Date.now() } });
    applyBuiltinProfile(ID);
    const c = canvas.current;
    const ctx = c.getContext('2d');
    setCaptureCanvas(c);
    const keys = new Set();
    const kd = (e) => keys.add(e.code);
    const ku = (e) => keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = c.width = c.clientWidth * dpr;
      H = c.height = c.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);
    const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
    let st;
    const reset = () => {
      st = { p: { x: W / 2, y: H / 2, vx: 0, vy: 0 }, orbs: [], shards: [], parts: [], score: 0, lives: 3, t: 0, inv: 0, shake: 0, over: false, combo: 0 };
      setHud((h) => ({ ...h, score: 0, lives: 3, over: false }));
    };
    reset();
    restart.current = reset;

    let raf;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      st.t += dt;
      const s = W / 1600;
      // input: left stick / d-pad / WASD / arrows
      let ax = 0;
      let ay = 0;
      for (const pad of navigator.getGamepads?.() || []) {
        if (!pad) continue;
        ax += Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0;
        ay += Math.abs(pad.axes[1]) > 0.15 ? pad.axes[1] : 0;
        if (pad.buttons[14]?.pressed) ax -= 1;
        if (pad.buttons[15]?.pressed) ax += 1;
        if (pad.buttons[12]?.pressed) ay -= 1;
        if (pad.buttons[13]?.pressed) ay += 1;
        if (st.over && pad.buttons[0]?.pressed) reset();
      }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) ay -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) ay += 1;
      const p = st.p;
      if (!st.over) {
        p.vx = (p.vx + ax * 3200 * s * dt) * Math.pow(0.04, dt);
        p.vy = (p.vy + ay * 3200 * s * dt) * Math.pow(0.04, dt);
        p.x = Math.max(20, Math.min(W - 20, p.x + p.vx * dt));
        p.y = Math.max(20, Math.min(H - 20, p.y + p.vy * dt));
      }
      // spawn
      if (st.orbs.length < 6 && Math.random() < dt * 2) st.orbs.push({ x: 60 + Math.random() * (W - 120), y: 60 + Math.random() * (H - 120), r: 10 * s + Math.random() * 8 * s, ph: Math.random() * 6 });
      const level = 1 + st.score / 150;
      if (!st.over && Math.random() < dt * (0.6 + level * 0.25)) {
        const edge = Math.floor(Math.random() * 4);
        const sx = edge === 0 ? -30 : edge === 1 ? W + 30 : Math.random() * W;
        const sy = edge === 2 ? -30 : edge === 3 ? H + 30 : Math.random() * H;
        const ang = Math.atan2(p.y - sy, p.x - sx) + (Math.random() - 0.5) * 0.6;
        const sp = (180 + Math.random() * 160) * s * Math.min(2.2, level);
        st.shards.push({ x: sx, y: sy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: 0, r: 14 * s });
      }
      // collisions
      for (const o of st.orbs) {
        if (!st.over && Math.hypot(o.x - p.x, o.y - p.y) < o.r + 18 * s) {
          o.dead = true;
          st.combo++;
          st.score += 10 * Math.min(5, st.combo);
          haptic(st.combo % 5 === 0 ? 'success' : 'select');
          for (let i = 0; i < 18; i++) st.parts.push({ x: o.x, y: o.y, vx: (Math.random() - 0.5) * 600 * s, vy: (Math.random() - 0.5) * 600 * s, life: 0.7, col: '216,228,255' });
        }
      }
      for (const sh of st.shards) {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.rot += dt * 4;
        if (!st.over && st.inv <= 0 && Math.hypot(sh.x - p.x, sh.y - p.y) < sh.r + 14 * s) {
          sh.dead = true;
          st.lives--;
          st.combo = 0;
          st.inv = 1.5;
          st.shake = 0.4;
          haptic('error');
          for (let i = 0; i < 30; i++) st.parts.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 900 * s, vy: (Math.random() - 0.5) * 900 * s, life: 0.9, col: '255,107,107' });
          if (st.lives <= 0) {
            st.over = true;
            const best = Math.max(st.score, Number(localStorage.getItem('orbit.best') || 0));
            localStorage.setItem('orbit.best', String(best));
            haptic('faceid.fail');
            setHud({ score: st.score, lives: 0, best, over: true });
          }
        }
        if (sh.x < -80 || sh.x > W + 80 || sh.y < -80 || sh.y > H + 80) sh.dead = true;
      }
      st.orbs = st.orbs.filter((o) => !o.dead);
      st.shards = st.shards.filter((x) => !x.dead);
      st.inv -= dt;
      st.shake = Math.max(0, st.shake - dt);
      // trail
      if (!st.over) st.parts.push({ x: p.x, y: p.y, vx: -p.vx * 0.1, vy: -p.vy * 0.1, life: 0.45, col: '127,163,255' });
      for (const q of st.parts) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.life -= dt;
      }
      st.parts = st.parts.filter((q) => q.life > 0);

      // draw
      ctx.save();
      if (st.shake) ctx.translate((Math.random() - 0.5) * 18 * st.shake, (Math.random() - 0.5) * 18 * st.shake);
      const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
      g.addColorStop(0, '#111a2e');
      g.addColorStop(1, '#03040a');
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      for (const sr of stars) {
        const x = (sr.x * W - p.x * 0.03 * sr.z + W) % W;
        const y = (sr.y * H - p.y * 0.03 * sr.z + H) % H;
        ctx.fillStyle = `rgba(220,230,255,${0.2 + sr.z * 0.6})`;
        ctx.fillRect(x, y, 1.5 + sr.z * 2, 1.5 + sr.z * 2);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const q of st.parts) {
        ctx.fillStyle = `rgba(${q.col},${q.life})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3 * s + q.life * 4 * s, 0, 6.283);
        ctx.fill();
      }
      for (const o of st.orbs) {
        const pr = o.r * (1 + 0.15 * Math.sin(st.t * 4 + o.ph));
        const og = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, pr * 3);
        og.addColorStop(0, 'rgba(255,255,255,0.95)');
        og.addColorStop(0.3, 'rgba(169,194,255,0.6)');
        og.addColorStop(1, 'rgba(127,163,255,0)');
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(o.x, o.y, pr * 3, 0, 6.283);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const sh of st.shards) {
        ctx.save();
        ctx.translate(sh.x, sh.y);
        ctx.rotate(sh.rot);
        ctx.fillStyle = '#ff6b6b';
        ctx.shadowColor = 'rgba(255,107,107,0.8)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(0, -sh.r);
        ctx.lineTo(sh.r * 0.8, sh.r * 0.7);
        ctx.lineTo(-sh.r * 0.8, sh.r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (!st.over && (st.inv <= 0 || Math.floor(st.t * 12) % 2)) {
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 34 * s);
        pg.addColorStop(0, '#ffffff');
        pg.addColorStop(0.35, '#d8e4ff');
        pg.addColorStop(1, 'rgba(127,163,255,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 34 * s, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
      if (Math.floor(st.t * 10) !== Math.floor((st.t - dt) * 10)) setHud((h) => (h.score === st.score && h.lives === st.lives ? h : { ...h, score: st.score, lives: st.lives }));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('resize', resize);
      setCaptureCanvas(null);
      restoreBuiltinProfile();
      if (useSystem.getState().running?.id === ID) useSystem.setState({ running: null });
    };
  }, []);

  const lowPower = useSettings((s) => s.values.lowPower);
  return (
    <div data-nav-scope="0" className="absolute inset-0 z-[45] bg-black">
      <canvas ref={canvas} className="h-full w-full" style={{ imageRendering: lowPower ? 'pixelated' : 'auto' }} />
      <div className="pointer-events-none absolute left-10 top-[4.6rem] font-semibold tabular-nums text-white/90">
        <div className="text-[2rem] leading-none">{hud.score}</div>
        <div className="mt-1 text-[0.8rem] text-white/60">{'●'.repeat(Math.max(0, hud.lives))}{'○'.repeat(Math.max(0, 3 - hud.lives))} · Rekord {hud.best}</div>
      </div>
      <div className="pointer-events-none absolute bottom-5 left-8 text-[0.75rem] text-white/45">Stick / WASD bewegen · Lichter sammeln · roten Splittern ausweichen · B beendet</div>
      <AnimatePresence>
        {hud.over && (
          <motion.div data-nav-scope="60" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="text-4xl font-semibold">Game Over</div>
            <div className="text-mist-300">{hud.score} Punkte · Rekord {hud.best}</div>
            <div className="flex gap-2">
              <Button variant="primary" autoFocus onClick={() => restart.current?.()}>Nochmal</Button>
              <Button variant="glass" onClick={() => back()}>Beenden</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
