import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, BatteryCharging, Cloud, CloudOff, RefreshCw, Download, Gamepad2, Tv, FlaskConical } from 'lucide-react';
import { useSystem } from '@/store/system.js';
import { useDownloads } from '@/store/downloads.js';
import { useCloud } from '@/services/cloud/cloudService.js';
import { useSettings } from '@/store/settings.js';
import { useNow } from '@/components/ui/primitives.jsx';
import { useProfiles, activeProfile } from '@/store/profile.js';
import { spring } from '@/lib/motion.js';
import AnimatedNumber from '@/components/ui/AnimatedNumber.jsx';

export function BatteryGlyph({ percent, charging, className = '' }) {
  const p = percent ?? 0;
  const color = charging ? '#5fd69a' : p <= 15 ? '#ff6b6b' : p <= 30 ? '#f2c46b' : '#f5f7fa';
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <span className="relative h-[0.8rem] w-[1.55rem] rounded-[0.28rem] border-[1.5px] border-white/50 p-[1.5px]">
        <motion.span className="block h-full rounded-[0.12rem]" style={{ background: color }} animate={{ width: `${Math.max(6, p)}%` }} transition={spring.soft} />
      </span>
      <span className="ml-[1.5px] h-[0.32rem] w-[2px] rounded-r bg-white/50" />
      {charging && <BatteryCharging className="absolute -left-4 h-3.5 w-3.5 text-ok" />}
    </span>
  );
}

export function Avatar({ size = '2rem', className = '' }) {
  const p = useProfiles(activeProfile);
  return (
    <span className={`inline-flex items-center justify-center overflow-hidden rounded-full bg-ink-700 ring-1 ring-white/10 ${className}`} style={{ width: size, height: size }}>
      {p?.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <span className="text-[0.8rem] font-semibold">{p?.name?.[0] ?? '?'}</span>}
    </span>
  );
}

export default function StatusBar() {
  const now = useNow(1000);
  const h24 = useSettings((s) => s.values.clock24h);
  const showSec = useSettings((s) => s.values.statusSeconds);
  const showPct = useSettings((s) => s.values.statusBatteryPct);
  const battery = useSystem((s) => s.battery);
  const controllers = useSystem((s) => s.controllers);
  const dock = useSystem((s) => s.dock);
  const daemon = useSystem((s) => s.daemon);
  const net = useSystem((s) => s.network);
  const jobs = useDownloads((s) => s.jobs);
  const cloud = useCloud((s) => ({ status: s.status, pending: s.pending }));
  const jobList = Object.values(jobs);
  const avg = jobList.length ? Math.round(jobList.reduce((a, j) => a + (j.percent || 0), 0) / jobList.length) : 0;
  const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', ...(showSec ? { second: '2-digit' } : {}), hour12: !h24 });

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex h-[3.5rem] items-center gap-4 px-10 text-[0.85rem] text-mist-100">
      <Avatar size="1.9rem" />
      <span className="font-semibold tabular-nums tracking-tight">{time}</span>
      {daemon.mode === 'simulator' && (
        <span className="flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-0.5 text-[0.7rem] font-medium text-warn">
          <FlaskConical className="h-3.5 w-3.5" /> Simulation
        </span>
      )}
      <div className="ml-auto flex items-center gap-4">
        <AnimatePresence>
          {jobList.length > 0 && (
            <motion.span key="dl" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              <span className="relative h-1 w-14 overflow-hidden rounded-full bg-white/15">
                <motion.span className="absolute inset-y-0 left-0 rounded-full bg-white" animate={{ width: `${avg}%` }} transition={spring.soft} />
              </span>
              <AnimatedNumber value={avg} format={(x) => `${Math.round(x)}%`} />
            </motion.span>
          )}
        </AnimatePresence>
        {dock.docked && <Tv className="h-4 w-4 text-lumen-400" />}
        {controllers.length > 0 && (
          <motion.span key={controllers.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={spring.bouncy} className="flex items-center gap-1">
            <Gamepad2 className="h-4 w-4" />
            <span className="text-[0.72rem] tabular-nums text-mist-300">{controllers.length}</span>
          </motion.span>
        )}
        {cloud.status === 'syncing' ? (
          <RefreshCw className="h-4 w-4 animate-spin text-mist-300" />
        ) : cloud.status === 'offline' || cloud.status === 'error' ? (
          <CloudOff className="h-4 w-4 text-warn" />
        ) : cloud.status !== 'signed-out' ? (
          <Cloud className="h-4 w-4 text-mist-300" />
        ) : null}
        {net?.wifi?.ssid || net?.ethernet ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4 text-mist-500" />}
        <span className="flex items-center gap-2">
          {battery.percent != null && showPct && <AnimatedNumber value={battery.percent} format={(x) => `${Math.round(x)}%`} className="text-[0.8rem]" />}
          <BatteryGlyph percent={battery.percent} charging={battery.charging} />
        </span>
      </div>
    </div>
  );
}
