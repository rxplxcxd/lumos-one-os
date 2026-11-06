// Developer control panel & hardware simulator (Ctrl+Shift+D / F12).
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, X, ScanFace, Gamepad2, Battery, Tv, Activity, Radio, Usb } from 'lucide-react';
import { Toggle, Slider, Button } from '@/components/ui/primitives.jsx';
import { request, on, bridgeMode } from '@/services/bridge.js';
import { verifyFace } from '@/services/faceid.js';
import { toggleDevPanel } from '@/store/ui.js';
import { useSystem } from '@/store/system.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const sim = (m, p) => request(`sim.${m}`, p).catch((e) => console.warn(e.message));

function Card({ icon: Icon, title, children }) {
  return (
    <section className="rounded-3xl bg-white/[0.05] p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[0.85rem] font-semibold"><Icon className="h-4 w-4 text-mist-300" />{title}</h3>
      {children}
    </section>
  );
}

function PadButton({ b, label, className = '' }) {
  return (
    <button
      type="button"
      onPointerDown={() => (haptic('key'), sim('button', { button: b, pressed: true }))}
      onPointerUp={() => sim('button', { button: b, pressed: false })}
      onPointerLeave={(e) => e.buttons && sim('button', { button: b, pressed: false })}
      className={`nav-focus flex items-center justify-center rounded-full bg-white/[0.1] text-[0.75rem] font-bold active:bg-white/30 ${className}`}
    >
      {label}
    </button>
  );
}

export default function DevPanel() {
  const controllers = useSystem((s) => s.controllers);
  const battery = useSystem((s) => s.battery);
  const dock = useSystem((s) => s.dock);
  const [face, setFace] = useState('success');
  const [batt, setBatt] = useState(Math.round(battery.percent ?? 78));
  const [joy, setJoy] = useState({ left: 84, right: 81 });
  const [tilt, setTilt] = useState({ pitch: 0, roll: 0 });
  const [log, setLog] = useState([]);
  const logRef = useRef([]);

  useEffect(() => {
    request('sim.state').then((s) => s?.faceOutcome && setFace(s.faceOutcome), () => {});
    return on('*', (data, event) => {
      if (event === 'gyro' || event === 'system.stats' || event === 'faceid.frame') return;
      logRef.current = [{ t: new Date().toLocaleTimeString('de-DE'), event, data: JSON.stringify(data).slice(0, 120) }, ...logRef.current].slice(0, 60);
      setLog(logRef.current);
    });
  }, []);

  const side = (s) => controllers.find((c) => c.side === s);
  return (
    <motion.aside data-nav-scope="70" className="glass-strong fixed bottom-3 right-3 top-3 z-[72] flex w-[31rem] flex-col rounded-[2rem]" initial={{ x: 540 }} animate={{ x: 0 }} exit={{ x: 540 }} transition={spring.sheet}>
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <FlaskConical className="h-5 w-5 text-warn" />
        <div className="flex-1">
          <div className="text-[0.95rem] font-semibold">Entwickler-Panel</div>
          <div className="text-[0.7rem] text-mist-400">Hardware-Simulator · Bridge: {bridgeMode()}</div>
        </div>
        <button data-nav="" onClick={() => toggleDevPanel(false)} className="nav-focus rounded-full bg-white/10 p-2" aria-label="Schließen"><X className="h-4 w-4" /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Card icon={ScanFace} title="Face ID Pretend">
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[['success', 'Erfolg'], ['fail', 'Abgelehnt'], ['none', 'Kein Gesicht']].map(([k, l]) => (
              <Button key={k} size="sm" variant={face === k ? 'primary' : 'subtle'} autoFocus={k === 'success'} onClick={() => (setFace(k), sim('faceid', { outcome: k }))}>{l}</Button>
            ))}
          </div>
          <Button size="sm" variant="glass" className="w-full" onClick={() => verifyFace('Test-Scan aus dem Entwickler-Panel')}>IR-Scan jetzt auslösen</Button>
        </Card>

        <Card icon={Gamepad2} title="Virtuelle Joy-Cons & Pogo-Pins">
          {['left', 'right'].map((s) => {
            const c = side(s);
            const docked = c?.transport === 'pogo';
            return (
              <div key={s} className="mb-3 rounded-2xl bg-white/[0.04] p-3 last:mb-0">
                <div className="mb-2 flex items-center gap-3 text-[0.82rem]">
                  <span className="flex-1 font-medium">Joy ({s === 'left' ? 'L' : 'R'}) · {c ? (docked ? 'angedockt' : 'BLE') : 'aus'}</span>
                  <span className="text-[0.72rem] text-mist-400">Pogo</span>
                  <Toggle checked={!!docked} onChange={(v) => sim('controller', { side: s, attached: v })} label="Pogo" />
                  <span className="text-[0.72rem] text-mist-400">An</span>
                  <Toggle checked={!!c} onChange={(v) => sim('controller_power', { side: s, connected: v })} label="Power" />
                </div>
                <Slider label="Akku" value={joy[s]} min={0} max={100} format={(x) => `${x}%`} onChange={(x) => (setJoy({ ...joy, [s]: x }), sim('controller', { side: s, battery: x }))} />
              </div>
            );
          })}
        </Card>

        <Card icon={Usb} title="USB- & Bluetooth-Controller (Drittanbieter)">
          <div className="grid grid-cols-1 gap-1.5">
            {[['xbox', 'Xbox Wireless (BT)'], ['dualsense', 'DualSense (USB)'], ['pro', 'Switch Pro (BT)'], ['8bitdo', '8BitDo (USB)'], ['generic', 'Generisches HID-Gamepad']].map(([m, l]) => {
              const on = controllers.some((c) => c.id?.startsWith('ext-') && c.name && ((m === 'xbox' && c.family === 'xbox') || (m === 'dualsense' && c.family === 'playstation') || (m === 'pro' && c.name.includes('Pro')) || (m === '8bitdo' && c.name.includes('8BitDo')) || (m === 'generic' && c.family === 'generic')));
              return (
                <div key={m} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-1.5 text-[0.8rem]">
                  {l}
                  <Toggle checked={on} onChange={(v) => sim('usb_controller', { model: m, connected: v })} label={l} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card icon={Gamepad2} title="Virtuelles Gamepad">
          <div className="flex items-center justify-between px-2">
            <div className="grid grid-cols-3 grid-rows-3 gap-1">
              <span />
              <PadButton b="up" label="▲" className="h-10 w-10" />
              <span />
              <PadButton b="left" label="◀" className="h-10 w-10" />
              <PadButton b="home" label="◉" className="h-10 w-10" />
              <PadButton b="right" label="▶" className="h-10 w-10" />
              <span />
              <PadButton b="down" label="▼" className="h-10 w-10" />
              <span />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2"><PadButton b="lb" label="L" className="h-8 w-14" /><PadButton b="rb" label="R" className="h-8 w-14" /></div>
              <div className="flex gap-2"><PadButton b="select" label="−" className="h-8 w-14" /><PadButton b="start" label="+" className="h-8 w-14" /></div>
            </div>
            <div className="grid grid-cols-3 grid-rows-3 gap-1">
              <span />
              <PadButton b="y" label="Y" className="h-10 w-10" />
              <span />
              <PadButton b="x" label="X" className="h-10 w-10" />
              <span />
              <PadButton b="a" label="A" className="h-10 w-10 bg-white/25" />
              <span />
              <PadButton b="b" label="B" className="h-10 w-10" />
              <span />
            </div>
          </div>
        </Card>

        <Card icon={Battery} title="Akku">
          <Slider label="Ladestand" value={batt} min={1} max={100} format={(x) => `${x}%`} onChange={(x) => (setBatt(x), sim('battery', { percent: x }))} />
          <div className="mt-3 flex items-center justify-between text-[0.82rem]">Netzteil angeschlossen <Toggle checked={!!battery.charging} onChange={(v) => sim('battery', { charging: v })} label="Laden" /></div>
        </Card>

        <Card icon={Tv} title="Docking-Simulator">
          <div className="flex items-center justify-between text-[0.82rem]">
            <span>TV-Dock (Hall-Sensor + DP-Hotplug) · {dock.docked ? `${dock.resolution} · FSR` : 'Handheld 1920×1200'}</span>
            <Toggle checked={!!dock.docked} onChange={(v) => sim('dock', { docked: v })} label="Dock" />
          </div>
        </Card>

        <Card icon={Activity} title="Gyro-Override">
          <Slider label="Pitch" value={tilt.pitch} min={-25} max={25} format={(x) => `${x}°`} onChange={(x) => (setTilt({ ...tilt, pitch: x }), sim('gyro', { ...tilt, pitch: x }))} />
          <div className="h-2" />
          <Slider label="Roll" value={tilt.roll} min={-25} max={25} format={(x) => `${x}°`} onChange={(x) => (setTilt({ ...tilt, roll: x }), sim('gyro', { ...tilt, roll: x }))} />
        </Card>

        <Card icon={Radio} title="Event-Stream">
          <div className="max-h-[14rem] space-y-1 overflow-y-auto font-mono text-[0.66rem] leading-snug text-mist-300">
            {log.map((l, i) => (
              <div key={i}><span className="text-mist-500">{l.t}</span> <span className="text-lumen-400">{l.event}</span> {l.data}</div>
            ))}
            {!log.length && <div className="text-mist-500">Warte auf Events …</div>}
          </div>
        </Card>
      </div>
    </motion.aside>
  );
}
