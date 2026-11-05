import { useEffect, useState } from 'react';
import { Gamepad2, Crosshair, Move, Repeat, Activity, Vibrate, Waves, Hand } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, SliderRow, Button } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { useSystem, gyro } from '@/store/system.js';
import { BatteryGlyph } from '@/components/shell/StatusBar.jsx';
import { request } from '@/services/bridge.js';
import { haptic, patterns } from '@/services/haptics.js';
import { toast } from '@/store/ui.js';

const useV = () => useSettings((s) => s.values);
const TRANSPORT = { pogo: 'Pogo-Pins (UART)', ble: 'Bluetooth LE', usb: 'USB', bt: 'Bluetooth' };

function GyroViz() {
  const [g, setG] = useState({ pitch: 0, roll: 0 });
  useEffect(() => {
    let raf;
    const f = () => {
      setG({ pitch: gyro.pitch, roll: gyro.roll });
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="flex items-center gap-5 px-4 py-4">
      <div className="relative h-24 w-24 rounded-full border border-white/10 bg-white/[0.03]">
        <div className="absolute left-1/2 top-1/2 h-3 w-3 rounded-full bg-mist-50 shadow-[0_0_12px_rgba(255,255,255,0.6)]" style={{ transform: `translate(calc(-50% + ${Math.max(-40, Math.min(40, g.roll * 1.6))}px), calc(-50% + ${Math.max(-40, Math.min(40, -g.pitch * 1.6))}px))` }} />
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
      </div>
      <div className="text-[0.8rem] tabular-nums text-mist-300">
        <div>Neigung {g.pitch.toFixed(1)}°</div>
        <div>Rollen {g.roll.toFixed(1)}°</div>
        <div className="mt-1 text-[0.7rem] text-mist-500">ICM-20948 · Madgwick-Fusion auf dem ESP32-S3</div>
      </div>
    </div>
  );
}

export function ControllersSection() {
  const v = useV();
  const controllers = useSystem((s) => s.controllers);
  return (
    <>
      <ListGroup title={`Verbunden · ${controllers.length}/4`} footer="Bis zu 4 Controller: linker & rechter Joy (Pogo-Pins oder BLE), zusätzlich ein externer Controller (USB/Bluetooth).">
        {controllers.length === 0 && <ListRow label="Keine Controller verbunden" />}
        {controllers.map((c) => (
          <ListRow
            key={c.id}
            icon={Gamepad2}
            iconBg="bg-[#8a8f99]"
            label={`${c.name}${c.slot ? ` · Spieler ${c.slot}` : ''}`}
            sub={`${TRANSPORT[c.transport] || c.transport}${c.fw ? ` · Firmware ${c.fw}` : ''}`}
            chevron={false}
            right={
              <span className="flex items-center gap-3">
                <BatteryGlyph percent={c.battery} charging={c.charging} />
                <span className="w-9 text-right text-[0.8rem] tabular-nums text-mist-300">{c.battery ?? '—'}%</span>
                <Button size="sm" variant="subtle" onClick={(e) => (e.stopPropagation(), request('controllers.identify', { id: c.id }))}>Finden</Button>
                <Button size="sm" variant="subtle" onClick={(e) => (e.stopPropagation(), toast({ title: 'Kalibrierung …', body: 'Controller flach hinlegen', kind: 'info' }), request('controllers.calibrate', { id: c.id }, 20000).then(() => toast({ title: 'Kalibriert', kind: 'success' })))}>Kalibrieren</Button>
              </span>
            }
          />
        ))}
      </ListGroup>
      <ListGroup title="Gyroskop">
        <GyroViz />
        <ToggleRow icon={Activity} iconBg="bg-[#8a8f99]" label="Bewegungssteuerung" checked={v.gyroEnabled} onChange={(x) => setSetting('gyroEnabled', x)} />
        <ToggleRow icon={Crosshair} iconBg="bg-[#8a8f99]" label="Gyro als Maus / Zielen" sub="Über das virtuelle uinput-Gerät" checked={v.gyroAsMouse} onChange={(x) => setSetting('gyroAsMouse', x)} />
        <SliderRow icon={Move} iconBg="bg-[#8a8f99]" label="Empfindlichkeit" value={v.gyroSensitivity} min={0.25} max={3} step={0.05} detents={11} format={(x) => `${x.toFixed(2)}×`} onChange={(x) => setSetting('gyroSensitivity', x)} />
      </ListGroup>
      <ListGroup title="Sticks & Tasten">
        <SliderRow icon={Hand} iconBg="bg-[#8a8f99]" label="Stick-Totzone" value={v.stickDeadzone} min={0} max={0.3} step={0.01} detents={15} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('stickDeadzone', x)} />
        <ToggleRow icon={Repeat} iconBg="bg-[#8a8f99]" label="A/B tauschen (Nintendo-Layout)" checked={v.swapAB} onChange={(x) => setSetting('swapAB', x)} />
      </ListGroup>
    </>
  );
}

const PATTERN_LABEL = {
  'nav.tick': 'Navigation', 'nav.edge': 'Rand erreicht', 'nav.page': 'Seitenwechsel', select: 'Auswahl', back: 'Zurück', 'toggle.on': 'Schalter an', 'toggle.off': 'Schalter aus', 'slider.detent': 'Regler-Raster', key: 'Tastatur', open: 'Öffnen', close: 'Schließen',
  'faceid.scan': 'Face ID Scan', 'faceid.success': 'Face ID erkannt', 'faceid.fail': 'Face ID abgelehnt', 'boot.rise': 'Boot-Anstieg', 'controller.attach': 'Controller angesteckt', 'controller.detach': 'Controller abgenommen', notify: 'Mitteilung', success: 'Erfolg', error: 'Fehler', 'long.press': 'Langes Drücken',
};

export function HapticsSection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Haptik-Engine" footer="LRA-Linearaktuatoren über TI DRV2605L (Closed-Loop, Auto-Resonanz). Generische Controller nutzen Dual-Rumble.">
        <ToggleRow icon={Vibrate} iconBg="bg-[#c27b3a]" label="Haptisches Feedback" checked={v.hapticsEnabled} onChange={(x) => setSetting('hapticsEnabled', x)} />
        <SliderRow icon={Waves} iconBg="bg-[#c27b3a]" label="Intensität" value={v.hapticsIntensity} min={0.1} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => (setSetting('hapticsIntensity', x), haptic('select'))} />
        <ToggleRow label="Rumble für externe Controller" checked={v.hapticsRumbleFallback} onChange={(x) => setSetting('hapticsRumbleFallback', x)} />
      </ListGroup>
      <ListGroup title="Muster testen">
        <div className="grid grid-cols-3 gap-2 p-3">
          {patterns.map((p) => (
            <Button key={p} size="sm" variant="subtle" haptics="none" onClick={() => haptic(p)}>
              {PATTERN_LABEL[p] || p}
            </Button>
          ))}
        </div>
      </ListGroup>
    </>
  );
}
