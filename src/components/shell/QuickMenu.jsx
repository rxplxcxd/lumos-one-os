// Quick-access panel (Start / ≡ button): brightness, volume, performance, radios, power.
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Volume2, Gauge, Wifi, Bluetooth, Moon, Power, RotateCcw, Tv, Code2 } from 'lucide-react';
import { useUI, toggleQuickMenu, toggleDevPanel } from '@/store/ui.js';
import { useSettings, setSetting } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { Slider, Segmented, Button } from '@/components/ui/primitives.jsx';
import { request, notify } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

function Tile({ icon: Icon, label, active, onClick }) {
  return (
    <button
      data-nav=""
      data-nav-haptic="none"
      onClick={() => {
        haptic(active ? 'toggle.off' : 'toggle.on');
        onClick();
      }}
      className={`nav-focus flex flex-col items-start gap-3 rounded-2xl p-3.5 text-left transition-colors ${active ? 'bg-mist-50 text-ink-950' : 'bg-white/[0.07] text-mist-100'}`}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[0.78rem] font-medium">{label}</span>
    </button>
  );
}

export default function QuickMenu() {
  const open = useUI((s) => s.quickMenu);
  const v = useSettings((s) => s.values);
  const stats = useSystem((s) => s.stats);
  const dock = useSystem((s) => s.dock);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/35" onClick={() => toggleQuickMenu(false)} />
          <motion.aside
            data-nav-scope="55"
            className="glass-strong absolute bottom-4 right-4 top-[3.8rem] flex w-[25rem] flex-col gap-4 overflow-y-auto rounded-[2rem] p-5"
            initial={{ x: 120, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={spring.sheet}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Schnellzugriff</h2>
              <span className="text-[0.75rem] tabular-nums text-mist-400">{stats ? `${Math.round(stats.power_w ?? 0)} W · ${Math.round(stats.temp_cpu ?? 0)} °C` : ''}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile icon={Wifi} label="WLAN" active={v.wifiEnabled} onClick={() => (setSetting('wifiEnabled', !v.wifiEnabled), notify('network.set_wifi', { enabled: !v.wifiEnabled }))} />
              <Tile icon={Bluetooth} label="Bluetooth" active={v.bluetoothEnabled} onClick={() => (setSetting('bluetoothEnabled', !v.bluetoothEnabled), notify('bluetooth.set', { enabled: !v.bluetoothEnabled }))} />
              <Tile icon={Code2} label="Entwickler" active={false} onClick={() => (toggleQuickMenu(false), toggleDevPanel(true))} />
            </div>
            <div className="space-y-3">
              <Slider icon={Sun} label="Helligkeit" value={v.brightness} min={5} max={100} onChange={(x) => setSetting('brightness', x)} format={(x) => `${x}%`} />
              <Slider icon={Volume2} label="Lautstärke" value={v.volume} min={0} max={100} onChange={(x) => setSetting('volume', x)} format={(x) => `${x}%`} />
            </div>
            <div>
              <div className="label mb-2 flex items-center gap-2"><Gauge className="h-3.5 w-3.5" /> Leistung</div>
              <Segmented
                value={v.powerProfile}
                onChange={(p) => setSetting('powerProfile', p)}
                options={[
                  { value: 'silent', label: 'Leise' },
                  { value: 'balanced', label: 'Ausgewogen' },
                  { value: 'performance', label: 'Leistung' },
                ]}
              />
              <div className="mt-3">
                <Slider label="TDP" value={v.tdp} min={4} max={28} onChange={(x) => setSetting('tdp', x)} format={(x) => `${x} W`} detents={24} />
              </div>
              <div className="mt-3">
                <div className="label mb-2">FPS-Limit</div>
                <Segmented value={v.fpsLimit} onChange={(x) => setSetting('fpsLimit', x)} options={[0, 30, 60, 90, 120].map((f) => ({ value: f, label: f ? String(f) : 'Aus' }))} />
              </div>
            </div>
            {dock.docked && (
              <div className="flex items-center gap-3 rounded-2xl bg-lumen-500/10 p-3 text-[0.8rem] text-lumen">
                <Tv className="h-5 w-5" /> TV-Modus · {dock.resolution} · {v.tvUpscaler.toUpperCase()}
              </div>
            )}
            <div className="mt-auto grid grid-cols-3 gap-2">
              <Button variant="subtle" icon={Moon} onClick={() => request('system.power', { action: 'suspend' })}>Ruhe</Button>
              <Button variant="subtle" icon={RotateCcw} onClick={() => request('system.power', { action: 'reboot' })}>Neustart</Button>
              <Button variant="danger" icon={Power} onClick={() => request('system.power', { action: 'shutdown' })}>Aus</Button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
