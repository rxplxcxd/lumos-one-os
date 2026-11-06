// v1.1 settings: Equalizer & sound profiles, low-power mode & battery warnings, stick cursor,
// performance HUD & capture, seasonal themes.
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, BatteryLow, BatteryWarning, Leaf, MousePointer2, ScrollText, Activity, Clapperboard, Camera, Film, PartyPopper, Volume2, CloudUpload } from 'lucide-react';
import { ListGroup, ToggleRow, SliderRow, Segmented, Button } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting, setSettings } from '@/store/settings.js';
import { SEASONS, activeSeason, autoSeason, playJingle } from '@/lib/seasons.js';
import { saveClip, takeScreenshot } from '@/services/captureActions.js';
import { open } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';

const useV = () => useSettings((s) => s.values);
const Seg = ({ label, icon: I, ...rest }) => (
  <div className="border-b border-white/[0.05] px-4 py-3 last:border-b-0">
    <div className="mb-2 flex items-center gap-2 text-[0.92rem]">
      {I && <I className="h-4 w-4 text-mist-300" />}
      {label}
    </div>
    <Segmented {...rest} />
  </div>
);

// ---- Equalizer ----------------------------------------------------------------------------
export const EQ_BANDS = [
  { f: 60, type: 'lowshelf', label: '60 Hz' },
  { f: 250, type: 'peaking', label: '250 Hz' },
  { f: 1000, type: 'peaking', label: '1 kHz' },
  { f: 3500, type: 'peaking', label: '3,5 kHz' },
  { f: 10000, type: 'highshelf', label: '10 kHz' },
];
export const EQ_PRESETS = {
  neutral: { label: 'Neutral', bands: [0, 0, 0, 0, 0] },
  bass: { label: 'Bass-Boost', bands: [6, 3, 0, 0, 1] },
  voice: { label: 'Stimme', bands: [-3, -1, 3, 4, 1] },
  headphones: { label: 'Kopfhörer', bands: [3, 1, -1, 1, 3] },
  speaker: { label: 'Lautsprecher', bands: [-4, 2, 1, 2, 3] },
  night: { label: 'Nacht', bands: [-5, -2, 2, 1, -3] },
  gaming: { label: 'Gaming (Schritte)', bands: [-2, -1, 1, 5, 3] },
};

// Real biquad responses computed by Web Audio (getFrequencyResponse) – no approximation.
function useResponse(bands, n = 120) {
  return useMemo(() => {
    try {
      const ctx = new OfflineAudioContext(1, 128, 48000);
      const freqs = new Float32Array(n).map((_, i) => 20 * Math.pow(1000, i / (n - 1))); // 20 Hz … 20 kHz
      const total = new Float32Array(n).fill(0);
      const mag = new Float32Array(n);
      const ph = new Float32Array(n);
      EQ_BANDS.forEach((b, i) => {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.f;
        f.Q.value = 1;
        f.gain.value = bands[i] || 0;
        f.getFrequencyResponse(freqs, mag, ph);
        for (let k = 0; k < n; k++) total[k] += 20 * Math.log10(mag[k] || 1);
      });
      return Array.from(total);
    } catch {
      return bands.flatMap((b) => Array(n / bands.length).fill(b));
    }
  }, [bands, n]);
}

function EqGraph({ bands }) {
  const r = useResponse(bands);
  const W = 600;
  const H = 120;
  const y = (db) => H / 2 - (db / 12) * (H / 2 - 6);
  const path = r.map((db, i) => `${i ? 'L' : 'M'}${((i / (r.length - 1)) * W).toFixed(1)},${y(db).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[7.5rem] w-full">
      {[-12, -6, 0, 6, 12].map((d) => <line key={d} x1="0" x2={W} y1={y(d)} y2={y(d)} stroke="rgba(255,255,255,0.07)" strokeDasharray={d ? '3 5' : ''} />)}
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="rgb(var(--lumen) / 0.12)" />
      <path d={path} fill="none" stroke="rgb(var(--lumen))" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function EqualizerGroup() {
  const v = useV();
  const bands = v.eqBands || [0, 0, 0, 0, 0];
  const preset = (k) => (setSettings({ eqPreset: k, eqBands: EQ_PRESETS[k].bands, eqEnabled: k !== 'neutral' || v.eqEnabled }), haptic('toggle.on'));
  const band = (i, x) => setSettings({ eqPreset: 'custom', eqBands: bands.map((b, j) => (j === i ? x : b)) });
  return (
    <ListGroup title="Equalizer & Klangprofile" footer="Systemweit über PipeWire (filter-chain) – wirkt auf Spiele, Browser und Medien. Kurve: echte Biquad-Antwort.">
      <ToggleRow icon={SlidersHorizontal} iconBg="bg-[#d0566b]" label="Equalizer aktiv" checked={v.eqEnabled} onChange={(x) => setSetting('eqEnabled', x)} />
      <div className="flex flex-wrap gap-2 border-b border-white/[0.05] px-4 py-3">
        {Object.entries(EQ_PRESETS).map(([k, p]) => (
          <Button key={k} size="sm" variant={v.eqPreset === k ? 'primary' : 'subtle'} onClick={() => preset(k)}>{p.label}</Button>
        ))}
        {v.eqPreset === 'custom' && <span className="self-center text-[0.75rem] text-mist-400">Eigenes Profil</span>}
      </div>
      <div className={`px-4 pt-3 transition-opacity ${v.eqEnabled ? '' : 'opacity-40'}`}>
        <EqGraph bands={bands} />
      </div>
      {EQ_BANDS.map((b, i) => (
        <SliderRow key={b.f} icon={Volume2} iconBg="bg-[#7c6bb0]" label={b.label} value={bands[i]} min={-12} max={12} step={1} detents={24} format={(x) => `${x > 0 ? '+' : ''}${x} dB`} onChange={(x) => band(i, x)} />
      ))}
    </ListGroup>
  );
}

// ---- Power -----------------------------------------------------------------------------
export function LowPowerGroup() {
  const v = useV();
  return (
    <ListGroup title="Energiesparmodus & Akku-Warnungen" footer="Energiesparen: 60 Hz, FPS ≤ 60, TDP ≤ 8 W, leiser Lüfter, Helligkeit ≤ 55 %, weniger Unschärfe und Animationen. Schaltet sich bei 10 % automatisch ein und beim Laden ab 80 % wieder aus.">
      <ToggleRow icon={Leaf} iconBg="bg-[#e0b64a]" label="Energiesparmodus" checked={v.lowPower} onChange={(x) => setSetting('lowPower', x)} />
      <ToggleRow icon={BatteryLow} iconBg="bg-[#d04848]" label="Warnungen bei 20 %, 10 % und 2 %" checked={v.batteryWarnings} onChange={(x) => setSetting('batteryWarnings', x)} />
      <ToggleRow icon={BatteryWarning} iconBg="bg-[#8b1e1e]" label="Bei 2 % sicher herunterfahren" sub="60 s Countdown, abbrechbar" checked={v.autoShutdownCritical} onChange={(x) => setSetting('autoShutdownCritical', x)} />
    </ListGroup>
  );
}

// ---- Controller cursor -----------------------------------------------------------------
export function CursorGroup() {
  const v = useV();
  return (
    <ListGroup title="Controller-Cursor" footer="Linker Stick bewegt einen Licht-Cursor (A klickt), rechter Stick scrollt. Steuerkreuz bleibt Fokus-Navigation. In Spielen deaktiviert.">
      <ToggleRow icon={MousePointer2} iconBg="bg-[#3b82c4]" label="Cursor mit linkem Stick" checked={v.stickCursor} onChange={(x) => setSetting('stickCursor', x)} />
      <SliderRow icon={MousePointer2} iconBg="bg-[#3b82c4]" label="Cursor-Tempo" value={v.cursorSpeed} min={0.3} max={2.5} step={0.1} format={(x) => `${x.toFixed(1)}×`} onChange={(x) => setSetting('cursorSpeed', x)} />
      <SliderRow icon={ScrollText} iconBg="bg-[#5b6b8c]" label="Scroll-Tempo (rechter Stick)" value={v.scrollSpeed} min={0.3} max={2.5} step={0.1} format={(x) => `${x.toFixed(1)}×`} onChange={(x) => setSetting('scrollSpeed', x)} />
    </ListGroup>
  );
}

// ---- HUD & capture ---------------------------------------------------------------------
export function OverlaySection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Leistungs-HUD" footer="Minimal: FPS. Voll: FPS, 1 %-Low, Frametime-Graph, CPU, GPU, RAM, Temperatur, Akku, Netz. In nativen Spielen über MangoHud.">
        <Seg icon={Activity} label="Anzeige" value={v.hudMode} onChange={(x) => setSetting('hudMode', x)} options={[{ value: 'off', label: 'Aus' }, { value: 'minimal', label: 'Minimal' }, { value: 'full', label: 'Voll' }]} />
        <Seg label="Position" value={v.hudPosition} onChange={(x) => setSetting('hudPosition', x)} options={[{ value: 'tl', label: '↖ Oben links' }, { value: 'tr', label: '↗ Oben rechts' }, { value: 'bl', label: '↙ Unten links' }, { value: 'br', label: '↘ Unten rechts' }]} />
      </ListGroup>
      <ListGroup title="Aufnahme" footer="Der Replay-Puffer hält die letzten 30 Sekunden im Speicher (Spiele: gpu-screen-recorder, Vorschau: MediaRecorder). F10 = Clip, F11 = Screenshot.">
        <ToggleRow icon={Film} iconBg="bg-[#c2567b]" label="Replay-Puffer (30 s) in Spielen" checked={v.replayBuffer} onChange={(x) => setSetting('replayBuffer', x)} />
        <ToggleRow icon={CloudUpload} iconBg="bg-[#4a90d9]" label="Spielstand beim Beenden in die Cloud" checked={v.autoCloudSave} onChange={(x) => setSetting('autoCloudSave', x)} />
        <div className="flex flex-wrap gap-2 p-3">
          <Button size="sm" variant="subtle" icon={Clapperboard} onClick={saveClip}>Letzte 30 s sichern</Button>
          <Button size="sm" variant="subtle" icon={Camera} onClick={takeScreenshot}>Screenshot</Button>
          <Button size="sm" variant="ghost" onClick={() => open('captures')}>Galerie öffnen</Button>
        </div>
      </ListGroup>
    </>
  );
}

// ---- Seasonal --------------------------------------------------------------------------
export function SeasonalSection() {
  const v = useV();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const auto = autoSeason(now);
  const cur = activeSeason(v.seasonal, now);
  return (
    <ListGroup title="Saisonale Themen" footer={`Automatisch: Halloween (20.10.–1.11.), Weihnachten (1.–26.12.), Silvester (31.12.–2.1.), Valentinstag, Ostern (Gründonnerstag–Ostermontag). Heute: ${auto ? SEASONS[auto].label : 'kein Feiertag'}.`}>
      <div className="grid grid-cols-2 gap-2 p-3">
        {[['auto', 'Automatisch'], ['off', 'Aus'], ...Object.entries(SEASONS).map(([k, s]) => [k, s.label])].map(([k, label]) => (
          <Button key={k} variant={v.seasonal === k ? 'primary' : 'subtle'} icon={k === 'off' ? undefined : PartyPopper} onClick={() => (setSetting('seasonal', k), haptic('toggle.on'), SEASONS[k] && playJingle(k))}>
            {label}
          </Button>
        ))}
      </div>
      <div className="border-t border-white/[0.05] px-4 py-3 text-[0.82rem] text-mist-300">Aktiv: {cur ? SEASONS[cur].label : '—'}</div>
    </ListGroup>
  );
}
