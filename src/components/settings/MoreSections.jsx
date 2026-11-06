// Darstellung, Animationen, Töne, Bildschirmschoner, Startbildschirm, Mitteilungen.
import { motion } from 'framer-motion';
import { Droplets, Contrast, Type, Focus, Sparkles, Gauge, MousePointerClick, Move3d, BatteryCharging, Power, Volume2, Music, Moon, Timer, Home, LayoutGrid, Image as ImageIcon, Clock, Bell, Download, Gamepad2, MessageSquare, Waves } from 'lucide-react';
import { ListGroup, ToggleRow, SliderRow, Segmented, Button } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { UI_THEMES } from '@/lib/themes.js';
import { TRANSITIONS, spring } from '@/lib/motion.js';
import { haptic } from '@/services/haptics.js';
import { playSound } from '@/services/sounds.js';
import { toast, useUI } from '@/store/ui.js';

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

export function LookSection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Farbschema">
        <div className="grid grid-cols-3 gap-2 p-3">
          {UI_THEMES.map((t) => {
            const active = v.uiTheme === t.key;
            return (
              <motion.button
                key={t.key}
                data-nav=""
                whileFocus={{ scale: 1.04 }}
                transition={spring.snappy}
                onClick={() => (setSetting('uiTheme', t.key), haptic('toggle.on'))}
                className={`nav-focus relative flex items-center gap-3 overflow-hidden rounded-2xl p-3 text-left ${active ? 'ring-2 ring-white' : 'ring-1 ring-white/10'}`}
                style={{ background: `linear-gradient(135deg, rgb(${t.glass.join(' ')}) 0%, rgb(${t.accent[3]} / 0.35) 140%)` }}
              >
                <span className="flex -space-x-1.5">
                  {t.accent.slice(0, 3).map((c) => (
                    <span key={c} className="h-5 w-5 rounded-full ring-2 ring-black/40" style={{ background: `rgb(${c})` }} />
                  ))}
                </span>
                <span className="text-[0.85rem] font-medium">{t.label}</span>
              </motion.button>
            );
          })}
        </div>
      </ListGroup>
      <ListGroup title="Glas & Lesbarkeit">
        <SliderRow icon={Droplets} iconBg="bg-[#4a90d9]" label="Glas-Deckkraft" value={v.glassOpacity} min={0.25} max={0.9} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('glassOpacity', x)} />
        <SliderRow icon={Droplets} iconBg="bg-[#4a90d9]" label="Glas-Unschärfe" value={v.glassBlur} min={0} max={60} detents={12} format={(x) => `${x}px`} onChange={(x) => setSetting('glassBlur', x)} />
        <ToggleRow icon={Droplets} iconBg="bg-[#6b7280]" label="Transparenz reduzieren" sub="Undurchsichtige Flächen statt Glas" checked={v.reduceTransparency} onChange={(x) => setSetting('reduceTransparency', x)} />
        <ToggleRow icon={Contrast} iconBg="bg-[#6b7280]" label="Kontrast erhöhen" checked={v.highContrast} onChange={(x) => setSetting('highContrast', x)} />
        <ToggleRow icon={Type} iconBg="bg-[#6b7280]" label="Fetter Text" checked={v.boldText} onChange={(x) => setSetting('boldText', x)} />
      </ListGroup>
      <ListGroup title="Fokus" footer="Der Halo gleitet mit einer Feder von Element zu Element.">
        <Seg icon={Focus} label="Fokus-Darstellung" value={v.focusStyle} onChange={(x) => setSetting('focusStyle', x)} options={[{ value: 'halo', label: 'Gleitender Halo' }, { value: 'ring', label: 'Rahmen' }]} />
      </ListGroup>
    </>
  );
}

export function AnimationSection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Bildschirmwechsel">
        <div className="grid grid-cols-3 gap-2 p-3">
          {TRANSITIONS.map((t) => (
            <Button key={t.key} size="sm" variant={v.transitionStyle === t.key ? 'primary' : 'subtle'} onClick={() => (setSetting('transitionStyle', t.key), haptic('toggle.on'))}>
              {t.label}
            </Button>
          ))}
        </div>
      </ListGroup>
      <ListGroup title="Tempo & Bewegung">
        <SliderRow icon={Gauge} iconBg="bg-[#7c6bb0]" label="Animationstempo" value={v.animationSpeed} min={0.5} max={2} step={0.05} detents={6} format={(x) => `${x.toFixed(2)}×`} onChange={(x) => setSetting('animationSpeed', x)} />
        <SliderRow icon={Move3d} iconBg="bg-[#7c6bb0]" label="Kachel-Neigung (Gyro & Zeiger)" value={v.tileTilt} min={0} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('tileTilt', x)} />
        <ToggleRow icon={MousePointerClick} iconBg="bg-[#7c6bb0]" label="Lichtwellen beim Drücken" checked={v.pressRipples} onChange={(x) => setSetting('pressRipples', x)} />
        <ToggleRow icon={BatteryCharging} iconBg="bg-[#3f9c6d]" label="Lade-Animation" sub="Lichtring beim Anschließen des Netzteils" checked={v.chargeAnimation} onChange={(x) => setSetting('chargeAnimation', x)} />
        <ToggleRow icon={Sparkles} iconBg="bg-[#6b7280]" label="Bewegung reduzieren" checked={v.reduceMotion} onChange={(x) => setSetting('reduceMotion', x)} />
      </ListGroup>
      <ListGroup title="Start">
        <Seg icon={Power} label="Startanimation" value={v.bootAnimation} onChange={(x) => setSetting('bootAnimation', x)} options={[{ value: 'full', label: 'Vollständig' }, { value: 'short', label: 'Kurz' }, { value: 'off', label: 'Aus' }]} />
      </ListGroup>
    </>
  );
}

export function SoundSection() {
  const v = useV();
  return (
    <ListGroup title="Systemklänge" footer="Leise, synthetisierte Klicks passend zur Haptik – keine Audiodateien.">
      <ToggleRow icon={Volume2} iconBg="bg-[#d0566b]" label="Systemklänge" checked={v.uiSounds} onChange={(x) => setSetting('uiSounds', x)} />
      <Seg icon={Music} label="Klangstil" value={v.uiSoundTheme} onChange={(x) => (setSetting('uiSoundTheme', x), setTimeout(() => playSound('select'), 30))} options={[{ value: 'soft', label: 'Weich' }, { value: 'crisp', label: 'Klar' }, { value: 'glass', label: 'Glas' }]} />
      <SliderRow icon={Volume2} iconBg="bg-[#d0566b]" label="Lautstärke der Systemklänge" value={v.uiSoundVolume} min={0} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setSetting('uiSoundVolume', x)} />
      <div className="flex flex-wrap gap-2 p-3">
        {['nav.tick', 'select', 'back', 'toggle.on', 'success', 'notify', 'error'].map((p) => (
          <Button key={p} size="sm" variant="subtle" haptics="none" onClick={() => haptic(p)}>{p}</Button>
        ))}
      </div>
    </ListGroup>
  );
}

export function ScreensaverSection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Bildschirmschoner" footer="Die Uhr wandert langsam über das Display, um Einbrennen auf dem OLED zu vermeiden. Während Spielen ist der Bildschirmschoner aus.">
        <Seg icon={Timer} label="Nach Inaktivität" value={v.screensaverMin} onChange={(x) => setSetting('screensaverMin', x)} options={[0, 1, 2, 5, 10, 30].map((m) => ({ value: m, label: m ? `${m} min` : 'Aus' }))} />
        <Seg icon={Clock} label="Darstellung" value={v.screensaverStyle} onChange={(x) => setSetting('screensaverStyle', x)} options={[{ value: 'clock', label: 'Uhr' }, { value: 'ambient', label: 'Ambient' }, { value: 'photo', label: 'Hintergrund' }]} />
        <ToggleRow icon={Moon} iconBg="bg-[#3b82c4]" label="Display dabei abdunkeln" checked={v.screensaverDim} onChange={(x) => setSetting('screensaverDim', x)} />
        <div className="p-3">
          <Button size="sm" variant="subtle" onClick={() => useUI.setState({ screensaver: true })}>Jetzt anzeigen</Button>
        </div>
      </ListGroup>
      <ListGroup title="Standby">
        <Seg icon={Power} label="Automatisch in den Ruhezustand" value={v.autoSleepMin} onChange={(x) => setSetting('autoSleepMin', x)} options={[0, 5, 10, 15, 30, 60].map((m) => ({ value: m, label: m ? `${m} min` : 'Nie' }))} />
      </ListGroup>
      <ListGroup title="Nachtmodus">
        <SliderRow icon={Moon} iconBg="bg-[#c27b3a]" label="Wärmere Farben" value={v.nightShift} min={0} max={1} step={0.05} format={(x) => (x ? `${Math.round(x * 100)}%` : 'Aus')} onChange={(x) => setSetting('nightShift', x)} />
      </ListGroup>
    </>
  );
}

export function HomeSection() {
  const v = useV();
  return (
    <>
      <ListGroup title="Startbildschirm">
        <ToggleRow icon={MessageSquare} iconBg="bg-[#5b6b8c]" label="Begrüßung anzeigen" checked={v.showGreeting} onChange={(x) => setSetting('showGreeting', x)} />
        <Seg icon={LayoutGrid} label="Kachelgröße" value={v.tileSize} onChange={(x) => setSetting('tileSize', x)} options={[{ value: 's', label: 'Klein' }, { value: 'm', label: 'Mittel' }, { value: 'l', label: 'Groß' }]} />
        <Seg icon={Home} label="Zuletzt gespielt" value={v.recentCount} onChange={(x) => setSetting('recentCount', x)} options={[6, 9, 12, 20].map((n) => ({ value: n, label: `${n} Titel` }))} />
        <ToggleRow icon={ImageIcon} iconBg="bg-[#5b6b8c]" label="Spiel-Artwork im Hintergrund" checked={v.heroArtwork} onChange={(x) => setSetting('heroArtwork', x)} />
      </ListGroup>
      <ListGroup title="Statusleiste">
        <ToggleRow icon={BatteryCharging} iconBg="bg-[#3f9c6d]" label="Akkustand in Prozent" checked={v.statusBatteryPct} onChange={(x) => setSetting('statusBatteryPct', x)} />
        <ToggleRow icon={Clock} iconBg="bg-[#d0566b]" label="Sekunden anzeigen" checked={v.statusSeconds} onChange={(x) => setSetting('statusSeconds', x)} />
      </ListGroup>
    </>
  );
}

export function NotificationSection() {
  const v = useV();
  return (
    <ListGroup title="Mitteilungen">
      <SliderRow icon={Bell} iconBg="bg-[#d0566b]" label="Anzeigedauer" value={v.toastDuration} min={1.5} max={10} step={0.5} detents={17} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => setSetting('toastDuration', x)} />
      <ToggleRow icon={Download} iconBg="bg-[#2f7fe0]" label="Downloads & Installationen" checked={v.notifyDownloads} onChange={(x) => setSetting('notifyDownloads', x)} />
      <ToggleRow icon={Gamepad2} iconBg="bg-[#8a8f99]" label="Controller verbunden / getrennt" checked={v.notifyControllers} onChange={(x) => setSetting('notifyControllers', x)} />
      <div className="p-3">
        <Button size="sm" variant="subtle" icon={Waves} onClick={() => (haptic('notify'), toast({ title: 'Testmitteilung', body: 'So sehen Mitteilungen aus', kind: 'info' }))}>Test</Button>
      </div>
    </ListGroup>
  );
}

