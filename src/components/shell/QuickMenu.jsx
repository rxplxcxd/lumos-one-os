// Quick-access panel (Start / ≡ button): brightness, volume, performance, radios, power.
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Volume2, Gauge, Wifi, Bluetooth, Moon, Power, RotateCcw, Tv, Code2, Leaf, Activity, Clapperboard, Camera, Search, ListTree, SquareTerminal, Users, SlidersHorizontal, MoonStar } from 'lucide-react';
import { open as openScreen } from '@/store/ui.js';
import { saveClip, takeScreenshot } from '@/services/captureActions.js';
import { toggleSpotlight } from '@/components/shell/Spotlight.jsx';
import { openProfilePicker } from '@/components/shell/ProfilePicker.jsx';
import { EQ_PRESETS } from '@/components/settings/V11Sections.jsx';
import { setSettings } from '@/store/settings.js';

const HUD_NEXT = { off: 'minimal', minimal: 'full', full: 'off' };
const EQ_KEYS = Object.keys(EQ_PRESETS);
const go = (fn) => () => (toggleQuickMenu(false), setTimeout(fn, 120));
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
              <Tile icon={Leaf} label="Energiesparen" active={v.lowPower} onClick={() => setSetting('lowPower', !v.lowPower)} />
              <Tile icon={Activity} label={`HUD: ${{ off: 'Aus', minimal: 'Minimal', full: 'Voll' }[v.hudMode]}`} active={v.hudMode !== 'off'} onClick={() => setSetting('hudMode', HUD_NEXT[v.hudMode] || 'off')} />
              <Tile icon={MoonStar} label="Nachtmodus" active={v.nightShiftMode !== 'off'} onClick={() => setSetting('nightShiftMode', v.nightShiftMode === 'off' ? 'manual' : 'off')} />
              <Tile icon={SlidersHorizontal} label={`EQ: ${EQ_PRESETS[v.eqPreset]?.label || 'Eigenes'}`} active={v.eqEnabled} onClick={() => { const k = EQ_KEYS[(EQ_KEYS.indexOf(v.eqPreset) + 1) % EQ_KEYS.length]; setSettings({ eqPreset: k, eqBands: EQ_PRESETS[k].bands, eqEnabled: k !== 'neutral' }); }} />
              <Tile icon={Clapperboard} label="Clip (30 s)" active={false} onClick={go(saveClip)} />
              <Tile icon={Camera} label="Screenshot" active={false} onClick={go(takeScreenshot)} />
              <Tile icon={Search} label="Suche" active={false} onClick={go(() => toggleSpotlight(true))} />
              <Tile icon={ListTree} label="Task-Manager" active={false} onClick={go(() => openScreen('taskmanager'))} />
              <Tile icon={SquareTerminal} label="Terminal" active={false} onClick={go(() => openScreen('terminal'))} />
              <Tile icon={Users} label="Profil wechseln" active={false} onClick={go(openProfilePicker)} />
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
