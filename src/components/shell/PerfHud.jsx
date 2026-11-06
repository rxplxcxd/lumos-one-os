// Live telemetry OSD (RivaTuner-style): FPS, 1 % low, frametime graph, CPU/GPU load & temperature,
// RAM, battery drain in watts. In games the same layout is rendered by MangoHud (lumosd writes the config).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useSettings } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { frames, onFrameStats, startFpsMeter } from '@/lib/fps.js';

const POS = { tl: 'left-4 top-16', tr: 'right-4 top-16', bl: 'left-4 bottom-4', br: 'right-4 bottom-4' };
const fmt = (v, d = 0, u = '') => (v == null || Number.isNaN(v) ? '—' : `${Number(v).toFixed(d)}${u}`);

function Graph() {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      const W = (c.width = c.clientWidth * 2);
      const H = (c.height = c.clientHeight * 2);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(0, H - (16.7 / 40) * H);
      ctx.lineTo(W, H - (16.7 / 40) * H);
      ctx.stroke();
      ctx.strokeStyle = '#7dff9c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = frames.times.length;
      for (let k = 0; k < n; k++) {
        const dt = frames.times[(frames.i + k) % n] || 0;
        const y = H - Math.min(1, dt / 40) * H;
        const x = (k / (n - 1)) * W;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="mt-1.5 h-10 w-full" />;
}

export default function PerfHud() {
  const mode = useSettings((s) => s.values.hudMode);
  const pos = useSettings((s) => s.values.hudPosition);
  const stats = useSystem((s) => s.stats);
  const battery = useSystem((s) => s.battery);
  const [f, setF] = useState({ fps: 0, low1: 0 });
  useEffect(() => {
    if (mode === 'off') return undefined;
    startFpsMeter();
    return onFrameStats((x) => setF({ fps: x.fps, low1: x.low1 }));
  }, [mode]);
  if (mode === 'off') return null;
  const ft = f.fps ? 1000 / f.fps : 0;
  const row = (label, value, color = 'text-white') => (
    <div className="flex justify-between gap-4">
      <span className="text-white/55">{label}</span>
      <span className={`tabular-nums ${color}`}>{value}</span>
    </div>
  );
  return createPortal(
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={`pointer-events-none fixed z-[93] rounded-2xl bg-black/55 px-3 py-2 font-mono text-[0.68rem] leading-[1.45] backdrop-blur-md ${POS[pos] || POS.tr} ${mode === 'minimal' ? 'flex gap-3' : 'w-[13.5rem]'}`}>
      {mode === 'minimal' ? (
        <>
          <span className="text-[#7dff9c]">{fmt(f.fps)} FPS</span>
          <span className="text-white/70">{fmt(ft, 1)} ms</span>
          <span className="text-[#ffd479]">{fmt(stats?.power_w ?? battery.watts, 1)} W</span>
          <span className="text-white/70">{fmt(battery.percent)}%</span>
        </>
      ) : (
        <>
          {row('FPS', `${fmt(f.fps)} · 1% ${fmt(f.low1)}`, 'text-[#7dff9c]')}
          {row('Frametime', `${fmt(ft, 1)} ms`)}
          {row('CPU', `${fmt(stats?.cpu)}% · ${fmt(stats?.temp_cpu)}°C`, 'text-[#81a2ff]')}
          {row('GPU', `${fmt(stats?.gpu)}% · ${fmt(stats?.temp_gpu)}°C`, 'text-[#ff9f6b]')}
          {row('RAM', `${fmt((stats?.ram_used ?? 0) / 1e9, 1)} GB`)}
          {row('Akku', `${fmt(battery.percent)}% · ${fmt(stats?.power_w ?? battery.watts, 1)} W`, 'text-[#ffd479]')}
          {row('TDP', `${fmt(stats?.tdp_w)} W`)}
          <Graph />
        </>
      )}
    </motion.div>,
    document.body,
  );
}
