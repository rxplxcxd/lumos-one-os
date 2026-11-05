import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Sun, Clock, Languages, MapPin, ZoomIn, Accessibility, Smartphone, Upload, Image as ImageIcon, Gauge, Fan, BatteryCharging, Zap, Tv, Sparkles, Activity, MonitorSmartphone, Volume2, Headphones, Music } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, SliderRow, Segmented, TextField, Button, Sheet } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { THEMES } from '@/components/background/shaders.js';
import { idb } from '@/services/storage.js';
import { geocode } from '@/services/weather.js';
import { request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { open, toast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

const useV = () => useSettings((s) => s.values);

export function SystemSection() {
  const v = useV();
  const info = useSystem((s) => s.info);
  const [loc, setLoc] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  return (
    <>
      <ListGroup title="Allgemein">
        <ListRow icon={Smartphone} iconBg="bg-[#6b7280]" label="Gerätename" value={v.deviceName} />
        <ListRow icon={Languages} iconBg="bg-[#3b82c4]" label="Sprache" value="Deutsch" />
        <ToggleRow icon={Clock} iconBg="bg-[#d0566b]" label="24-Stunden-Format" checked={v.clock24h} onChange={(x) => setSetting('clock24h', x)} />
        <ListRow icon={MapPin} iconBg="bg-[#3f9c6d]" label="Wetter-Standort" value={v.weatherLocation.name} onClick={() => setLoc(true)} />
      </ListGroup>
      <ListGroup title="Bedienungshilfen">
        <SliderRow icon={ZoomIn} iconBg="bg-[#2f7fe0]" label="UI-Skalierung" value={v.uiScale} min={0.85} max={1.25} step={0.05} detents={8} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('uiScale', x)} />
        <ToggleRow icon={Accessibility} iconBg="bg-[#2f7fe0]" label="Bewegung reduzieren" sub="Ersetzt Federn & Parallaxe durch Überblendungen" checked={v.reduceMotion} onChange={(x) => setSetting('reduceMotion', x)} />
      </ListGroup>
      {info && (
        <ListGroup title="Hardware">
          <ListRow label="Prozessor" value={info.cpu} />
          <ListRow label="Grafik" value={info.gpu} />
          <ListRow label="Arbeitsspeicher" value={`${Math.round(info.ram_total / 1e9)} GB`} />
          <ListRow label="Speicher" value={`${Math.round(info.storage.free / 1e9)} GB frei von ${Math.round(info.storage.total / 1e9)} GB`} />
          <ListRow label="Kernel" value={info.kernel} />
        </ListGroup>
      )}
      <Sheet open={loc} onClose={() => setLoc(false)} title="Wetter-Standort">
        <div className="flex gap-2">
          <TextField autoFocus value={q} onChange={setQ} placeholder="Stadt suchen" onEnter={() => geocode(q).then(setRes, (e) => toast({ title: e.message, kind: 'error' }))} />
          <Button variant="primary" onClick={() => geocode(q).then(setRes, (e) => toast({ title: e.message, kind: 'error' }))}>Suchen</Button>
        </div>
        <div className="mt-3 max-h-[16rem] overflow-y-auto rounded-2xl">
          {res.map((r) => (
            <ListRow key={`${r.lat},${r.lon}`} label={r.name} sub={r.region} onClick={() => (setSetting('weatherLocation', { name: r.name, lat: r.lat, lon: r.lon }), setLoc(false))} />
          ))}
        </div>
      </Sheet>
    </>
  );
}

const PREVIEW = {
  tide: 'linear-gradient(180deg,#0b0f17 0%,#141c2b 45%,#26324a 70%,#1a2333 100%)',
  drift: 'radial-gradient(circle at 70% 30%,#25304a 0%,#0a0d14 60%)',
  aurora: 'linear-gradient(160deg,#081014 0%,#13363a 40%,#2b2350 75%,#0a0b12 100%)',
  silk: 'linear-gradient(120deg,#0d0f13 0%,#2a2e38 35%,#11141a 55%,#3a3f4c 75%,#0d0f13 100%)',
  ember: 'radial-gradient(circle at 30% 60%,#4a2a20 0%,#1a1012 45%,#0a0a0f 100%)',
  custom: 'linear-gradient(135deg,#1c212a,#272d38)',
};

export function AppearanceSection() {
  const v = useV();
  const fileRef = useRef(null);
  const [customName, setCustomName] = useState(null);
  useEffect(() => {
    idb.get('bg.custom').then((r) => r && setCustomName(r.name || 'Eigener Hintergrund'));
  }, []);
  const onFile = async (f) => {
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast({ title: 'Nur Bilder oder Videos', kind: 'error' });
    await idb.set('bg.custom', { blob: f, type: f.type, name: f.name });
    setCustomName(f.name);
    setSetting('background', 'custom');
    window.dispatchEvent(new Event('lumos:bg-custom-changed'));
    haptic('success');
  };
  return (
    <>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const active = v.background === t.key;
          return (
            <motion.button
              key={t.key}
              data-nav=""
              whileFocus={{ scale: 1.04 }}
              transition={spring.snappy}
              onClick={() => (t.key === 'custom' && !customName ? fileRef.current?.click() : setSetting('background', t.key))}
              className={`nav-focus relative h-[8.5rem] overflow-hidden rounded-3xl text-left ${active ? 'ring-2 ring-mist-50' : 'ring-1 ring-white/10'}`}
              style={{ background: PREVIEW[t.key] }}
            >
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <div className="text-[0.9rem] font-semibold">{t.label}</div>
                <div className="text-[0.7rem] text-mist-300">{t.key === 'custom' && customName ? customName : t.desc}</div>
              </div>
              {t.key === 'custom' && <ImageIcon className="absolute right-3 top-3 h-5 w-5 text-mist-300" />}
            </motion.button>
          );
        })}
      </div>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <ListGroup title="Eigener Hintergrund" footer="Bilder (JPG, PNG, WebP, AVIF) und Videos (MP4, WebM) werden als Loop mit Gyro-Parallaxe und Wellen-Reaktion abgespielt.">
        <ListRow icon={Upload} iconBg="bg-[#7c6bb0]" label="Datei auswählen …" onClick={() => fileRef.current?.click()} />
        <ListRow icon={ImageIcon} iconBg="bg-[#7c6bb0]" label="Von USB / Dateisystem" onClick={() => open('files', { mode: 'background' })} />
      </ListGroup>
      <ListGroup title="Bewegung">
        <SliderRow icon={Sparkles} iconBg="bg-[#7c6bb0]" label="Intensität" value={v.bgIntensity} min={0} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('bgIntensity', x)} />
        <ToggleRow icon={Activity} iconBg="bg-[#7c6bb0]" label="Auf Gyrosensor reagieren" sub="Der Hintergrund neigt sich mit dem Gerät" checked={v.bgGyro} onChange={(x) => setSetting('bgGyro', x)} />
      </ListGroup>
    </>
  );
}

export function DisplaySection() {
  const v = useV();
  const dock = useSystem((s) => s.dock);
  return (
    <>
      <ListGroup title="Bildschirm">
        <SliderRow icon={Sun} iconBg="bg-[#3b82c4]" label="Helligkeit" value={v.brightness} min={5} max={100} format={(x) => `${x}%`} onChange={(x) => setSetting('brightness', x)} />
        <ToggleRow icon={Sun} iconBg="bg-[#3b82c4]" label="Automatische Helligkeit" sub="Umgebungslichtsensor" checked={v.autoBrightness} onChange={(x) => setSetting('autoBrightness', x)} />
        <div className="border-b border-white/[0.05] px-4 py-3">
          <div className="mb-2 text-[0.92rem]">Bildwiederholrate</div>
          <Segmented value={v.refreshRate} onChange={(x) => setSetting('refreshRate', x)} options={[60, 90, 120, 144, 165].map((h) => ({ value: h, label: `${h} Hz` }))} />
        </div>
        <div className="border-b border-white/[0.05] px-4 py-3">
          <div className="mb-2 text-[0.92rem]">FPS-Limiter</div>
          <Segmented value={v.fpsLimit} onChange={(x) => setSetting('fpsLimit', x)} options={[0, 30, 40, 60, 82, 120].map((f) => ({ value: f, label: f ? String(f) : 'Aus' }))} />
        </div>
        <ToggleRow icon={MonitorSmartphone} iconBg="bg-[#3b82c4]" label="HDR" sub="Nur für HDR-fähige Spiele & Gamescope ≥ 3.13" checked={v.hdr} onChange={(x) => setSetting('hdr', x)} />
      </ListGroup>
      <ListGroup title="TV-Docking" footer={dock.docked ? `Angedockt an ${dock.output} · ${dock.resolution}` : 'Wird automatisch per Hall-Sensor und DisplayPort-Hotplug erkannt.'}>
        <div className="border-b border-white/[0.05] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[0.92rem]"><Tv className="h-4 w-4" /> TV-Auflösung</div>
          <Segmented value={v.tvResolution} onChange={(x) => setSetting('tvResolution', x)} options={[{ value: 'auto', label: 'Auto' }, { value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }, { value: '4k', label: '4K' }]} />
        </div>
        <div className="border-b border-white/[0.05] px-4 py-3">
          <div className="mb-2 text-[0.92rem]">Upscaler (Gamescope)</div>
          <Segmented value={v.tvUpscaler} onChange={(x) => setSetting('tvUpscaler', x)} options={[{ value: 'fsr', label: 'AMD FSR 1' }, { value: 'nis', label: 'NVIDIA NIS' }, { value: 'linear', label: 'Linear' }, { value: 'pixel', label: 'Pixel' }]} />
        </div>
        <ToggleRow label="FSR im Handheld-Modus" sub="Spiele intern niedriger rendern und hochskalieren" checked={v.fsrEnabled} onChange={(x) => setSetting('fsrEnabled', x)} />
        <SliderRow label="Schärfe" value={20 - v.fsrSharpness} min={0} max={20} detents={20} format={(x) => `${x}/20`} onChange={(x) => setSetting('fsrSharpness', 20 - x)} />
      </ListGroup>
    </>
  );
}

export function AudioSection() {
  const v = useV();
  const [audio, setAudio] = useState(null);
  useEffect(() => {
    request('audio.get').then(setAudio, () => {});
  }, []);
  return (
    <>
      <ListGroup title="Lautstärke">
        <SliderRow icon={Volume2} iconBg="bg-[#d0566b]" label="Medien & Spiele" value={v.volume} min={0} max={100} format={(x) => `${x}%`} onChange={(x) => setSetting('volume', x)} />
        <ToggleRow icon={Music} iconBg="bg-[#d0566b]" label="Systemklänge" checked={v.uiSounds} onChange={(x) => setSetting('uiSounds', x)} />
      </ListGroup>
      <ListGroup title="Ausgabe" footer="PipeWire / WirePlumber">
        {(audio?.outputs || []).map((o) => (
          <ListRow
            key={o.id}
            icon={/head|kopf|bt|blue/i.test(o.name) ? Headphones : Volume2}
            iconBg="bg-[#d0566b]"
            label={o.name}
            right={audio.output === o.id ? <span className="text-[0.8rem] text-ok">Aktiv</span> : null}
            chevron={false}
            onClick={() => request('audio.set', { output: o.id }).then(() => setAudio({ ...audio, output: o.id }))}
          />
        ))}
        {!audio && <ListRow label="Audiogeräte werden geladen …" />}
      </ListGroup>
    </>
  );
}

export function PowerSection() {
  const v = useV();
  const stats = useSystem((s) => s.stats);
  const b = useSystem((s) => s.battery);
  return (
    <>
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          ['Leistungsaufnahme', stats?.power_w != null ? `${stats.power_w.toFixed(1)} W` : '—'],
          ['CPU', stats ? `${Math.round(stats.cpu)}% · ${Math.round(stats.temp_cpu)} °C` : '—'],
          ['GPU', stats ? `${Math.round(stats.gpu)}% · ${Math.round(stats.temp_gpu)} °C` : '—'],
          ['Lüfter', stats?.fan_rpm ? `${Math.round(stats.fan_rpm)} U/min` : '—'],
        ].map(([l, x]) => (
          <div key={l} className="glass rounded-2xl p-3">
            <div className="text-[0.7rem] text-mist-400">{l}</div>
            <div className="mt-1 text-[0.95rem] font-semibold tabular-nums">{x}</div>
          </div>
        ))}
      </div>
      <ListGroup title="Leistungsprofil">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <Segmented value={v.powerProfile} onChange={(x) => setSetting('powerProfile', x)} options={[{ value: 'silent', label: 'Leise' }, { value: 'balanced', label: 'Ausgewogen' }, { value: 'performance', label: 'Leistung' }, { value: 'custom', label: 'Eigenes' }]} />
        </div>
        <SliderRow icon={Zap} iconBg="bg-[#3f9c6d]" label="TDP-Limit (ryzenadj / RAPL)" value={v.tdp} min={4} max={28} detents={24} format={(x) => `${x} W`} onChange={(x) => setSettingCustom('tdp', x)} />
      </ListGroup>
      <ListGroup title="Lüfter" footer="Steuerung über die Framework-EC (framework_tool / ectool).">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <Segmented value={v.fanMode} onChange={(x) => setSetting('fanMode', x)} options={[{ value: 'auto', label: 'Automatisch' }, { value: 'quiet', label: 'Leise' }, { value: 'max', label: 'Maximal' }, { value: 'custom', label: 'Fest' }]} />
        </div>
        {v.fanMode === 'custom' && <SliderRow icon={Fan} iconBg="bg-[#3f9c6d]" label="Lüfterdrehzahl" value={v.fanPct} min={0} max={100} format={(x) => `${x}%`} onChange={(x) => setSetting('fanPct', x)} />}
      </ListGroup>
      <ListGroup title="Akku" footer={`Zustand ${b.health ?? '—'}% · ${b.charging ? 'lädt' : 'entlädt'}`}>
        <SliderRow icon={BatteryCharging} iconBg="bg-[#3f9c6d]" label="Ladelimit (Akkuschonung)" value={v.chargeLimit} min={50} max={100} step={5} detents={10} format={(x) => `${x}%`} onChange={(x) => setSetting('chargeLimit', x)} />
        <ListRow icon={Gauge} iconBg="bg-[#3f9c6d]" label="Verbleibend" value={b.time_left_min ? `${Math.floor(b.time_left_min / 60)} h ${b.time_left_min % 60} min` : '—'} />
      </ListGroup>
    </>
  );
}

function setSettingCustom(k, x) {
  setSetting(k, x);
  if (useSettings.getState().values.powerProfile !== 'custom') setSetting('powerProfile', 'custom');
}
