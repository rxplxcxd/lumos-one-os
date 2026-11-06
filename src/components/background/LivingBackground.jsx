// Full-screen animated wallpaper. Reacts to: gyro tilt (lumosd), pointer/touch swipes,
// every button press (ripple from the focused element), and idles with a slow breathing drift.
import { useEffect, useRef } from 'react';
import { BackgroundRenderer } from './renderer.js';
import { gyro } from '@/store/system.js';
import { useUI } from '@/store/ui.js';
import { useSettings } from '@/store/settings.js';
import { idb } from '@/services/storage.js';
import { UI_THEMES } from '@/lib/themes.js';

export async function loadCustomSource() {
  const rec = await idb.get('bg.custom');
  if (!rec) return null;
  const url = rec.url || URL.createObjectURL(rec.blob);
  const isVideo = (rec.type || rec.blob?.type || '').startsWith('video');
  if (isVideo) {
    const v = document.createElement('video');
    Object.assign(v, { src: url, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous' });
    await v.play().catch(() => {});
    return v;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

export default function LivingBackground() {
  const ref = useRef(null);
  const rendererRef = useRef(null);
  const theme = useSettings((s) => s.values.background);
  const intensity = useSettings((s) => s.values.bgIntensity);
  const useGyro = useSettings((s) => s.values.bgGyro);
  const reduce = useSettings((s) => s.values.reduceMotion);
  const speed = useSettings((s) => s.values.bgSpeed);
  const particles = useSettings((s) => s.values.bgParticles);
  const uiTheme = useSettings((s) => s.values.uiTheme);
  const lowPower = useSettings((s) => s.values.lowPower);
  const live = useRef({ intensity, useGyro, reduce, speed, particles, accent: [0.85, 0.89, 1] });
  live.current = { ...live.current, intensity, useGyro, reduce, speed, particles, lowPower };
  useEffect(() => {
    const t = UI_THEMES.find((x) => x.key === uiTheme) || UI_THEMES[0];
    live.current.accent = t.accent[2].split(' ').map((x) => Number(x) / 255);
  }, [uiTheme]);

  useEffect(() => {
    let r;
    try {
      r = new BackgroundRenderer(ref.current);
    } catch (e) {
      console.warn('[background]', e.message);
      return undefined;
    }
    rendererRef.current = r;

    const st = {
      tilt: [0, 0],
      tiltV: [0, 0],
      flow: [0, 0],
      flowV: [0, 0],
      ripple: [0, 0, 10],
      amp: 0,
      pointer: null,
      pointerTilt: [0, 0],
    };
    const toScene = (x, y) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return [(x - w / 2) / h, (h / 2 - y) / h];
    };
    const kick = (x, y, strength = 1) => {
      const [sx, sy] = toScene(x, y);
      st.ripple = [sx, sy, 0];
      st.amp = Math.min(1.4, st.amp * 0.5 + strength);
    };

    // button presses → ripple from the focused element (or centre)
    const unsubImpulse = useUI.subscribe((s, p) => {
      if (s.impulse === p.impulse) return;
      const el = document.activeElement;
      if (el && el !== document.body && !st.pointerDownRecent) {
        const b = el.getBoundingClientRect();
        kick(b.left + b.width / 2, b.top + b.height / 2, 0.55);
      }
    });
    const onDown = (e) => {
      st.pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
      st.pointerDownRecent = true;
      setTimeout(() => (st.pointerDownRecent = false), 50);
      kick(e.clientX, e.clientY, 0.9);
    };
    const onMove = (e) => {
      // swipe velocity → flow
      if (st.pointer && e.buttons) {
        const now = performance.now();
        const dt = Math.max(1, now - st.pointer.t);
        st.flowV[0] += ((e.clientX - st.pointer.x) / dt) * 0.08;
        st.flowV[1] += ((e.clientY - st.pointer.y) / dt) * 0.04;
        st.pointer = { x: e.clientX, y: e.clientY, t: now };
      }
      // desktop fallback for gyro: gentle pointer parallax
      st.pointerTilt = [(e.clientX / window.innerWidth - 0.5) * 0.6, (0.5 - e.clientY / window.innerHeight) * 0.6];
    };
    const onUp = () => (st.pointer = null);
    const onOrient = (e) => {
      if (e.beta == null) return;
      gyro.roll = e.gamma ?? 0;
      gyro.pitch = (e.beta ?? 0) - 45;
      gyro.t = performance.now();
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('deviceorientation', onOrient, { passive: true });

    let raf;
    let last = performance.now();
    let simTime = 0;
    let refreshBudget = 1000 / 60;
    let budgetSamples = [];
    let lastDraw = 0;
    const frame = (now) => {
      if (live.current.lowPower) {
        // Energiesparmodus: wallpaper at ≤30 fps and half resolution
        r.maxScale = 0.5;
        if (r.scale > 0.5) r.scale = 0.5;
        if (now - lastDraw < 32) {
          raf = requestAnimationFrame(frame);
          return;
        }
      } else r.maxScale = 1;
      lastDraw = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      const ms = now - last;
      last = now;
      if (budgetSamples.length < 120) {
        budgetSamples.push(ms);
        if (budgetSamples.length === 120) refreshBudget = budgetSamples.sort((a, b) => a - b)[60];
      } else r.adapt(ms, refreshBudget);

      const { intensity: inten, useGyro: ug, reduce: rm, speed: sp = 1, particles: pc = 1, accent } = live.current;
      const motion = rm ? 0.25 : 1;
      // target tilt: gyro if fresh, otherwise pointer parallax + slow breathing
      const fresh = ug && now - gyro.t < 1500;
      simTime += dt * sp * motion;
      const idle = [Math.sin(simTime / 9) * 0.12, Math.cos(simTime / 11) * 0.1];
      const target = fresh
        ? [Math.max(-1, Math.min(1, gyro.roll / 25)), Math.max(-1, Math.min(1, gyro.pitch / 25))]
        : [st.pointerTilt[0] + idle[0], st.pointerTilt[1] + idle[1]];
      // critically damped spring (ω = 7 rad/s) — feels physical, never jittery
      const w = 7;
      for (let i = 0; i < 2; i++) {
        const a = w * w * (target[i] - st.tilt[i]) - 2 * w * st.tiltV[i];
        st.tiltV[i] += a * dt;
        st.tilt[i] += st.tiltV[i] * dt;
        // swipe flow decays with friction
        st.flow[i] += st.flowV[i] * dt;
        st.flowV[i] *= Math.exp(-dt * 3.2);
        st.flow[i] *= Math.exp(-dt * 0.6);
      }
      st.ripple[2] += dt;
      st.amp *= Math.exp(-dt * 0.9);
      r.render({
        time: simTime,
        particles: pc,
        accent,
        tilt: [st.tilt[0] * motion, st.tilt[1] * motion],
        flow: [st.flow[0] * motion, st.flow[1] * motion],
        ripple: st.ripple,
        amp: st.amp * motion,
        intensity: 0.55 + inten * 0.6,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unsubImpulse();
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('deviceorientation', onOrient);
      r.dispose();
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    let cancelled = false;
    r.setTheme(theme);
    const reload = () => {
      if (theme !== 'custom') return r.setTexture(null);
      loadCustomSource()
        .then((src) => !cancelled && r.setTexture(src))
        .catch(() => r.setTexture(null));
    };
    reload();
    window.addEventListener('lumos:bg-custom-changed', reload);
    return () => {
      cancelled = true;
      window.removeEventListener('lumos:bg-custom-changed', reload);
    };
  }, [theme]);

  return <canvas ref={ref} className="fixed inset-0 h-full w-full" aria-hidden="true" />;
}
