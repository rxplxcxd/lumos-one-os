// iOS/Switch hybrid settings: section rail on the left, grouped lists on the right.
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Cpu, Palette, MonitorSmartphone, Volume2, Gauge, Wifi, Gamepad2, Vibrate, ScanFace, Cloud, RefreshCw, Code2, Info, UserRound, Image, Sparkles, Keyboard, Music, MoonStar, LayoutGrid, Bell, Shield, Users, Activity, PartyPopper, Link2 } from 'lucide-react';
import { Screen, Hint } from '@/components/ui/primitives.jsx';
import { useTabs } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';
import { SystemSection, AppearanceSection, DisplaySection, AudioSection, PowerSection } from './SystemSections.jsx';
import { NetworkSection, CloudSection, UpdatesSection, DeveloperSection, AboutSection, ProfileSection } from './ConnectSections.jsx';
import { ControllersSection, HapticsSection } from './ControllerSections.jsx';
import FaceIdSettings from './FaceIdSettings.jsx';
import KeyboardSection from './KeyboardSection.jsx';
import AccountsSection from './AccountsSection.jsx';
import AppsSection from './AppsSection.jsx';
import FamilySection from './FamilySection.jsx';
import { EqualizerGroup, LowPowerGroup, CursorGroup, OverlaySection, SeasonalSection } from './V11Sections.jsx';
import { LookSection, AnimationSection, SoundSection, ScreensaverSection, HomeSection, NotificationSection } from './MoreSections.jsx';

const Audio = () => (<><AudioSection /><EqualizerGroup /></>);
const Power = () => (<><LowPowerGroup /><PowerSection /></>);
const Keys = () => (<><CursorGroup /><KeyboardSection /></>);

export const SECTIONS = [
  { key: 'profile', label: 'Profil', icon: UserRound, bg: 'bg-[#5b6b8c]', C: ProfileSection },
  { key: 'system', label: 'System', icon: Cpu, bg: 'bg-[#6b7280]', C: SystemSection },
  { key: 'look', label: 'Darstellung & Farben', icon: Palette, bg: 'bg-[#c2567b]', C: LookSection },
  { key: 'appearance', label: 'Hintergrund', icon: Image, bg: 'bg-[#7c6bb0]', C: AppearanceSection },
  { key: 'animations', label: 'Animationen', icon: Sparkles, bg: 'bg-[#8b5cf6]', C: AnimationSection },
  { key: 'home', label: 'Startbildschirm', icon: LayoutGrid, bg: 'bg-[#5b6b8c]', C: HomeSection },
  { key: 'display', label: 'Display & TV-Docking', icon: MonitorSmartphone, bg: 'bg-[#3b82c4]', C: DisplaySection },
  { key: 'screensaver', label: 'Bildschirmschoner & Standby', icon: MoonStar, bg: 'bg-[#3b5bc4]', C: ScreensaverSection },
  { key: 'audio', label: 'Audio & Equalizer', icon: Volume2, bg: 'bg-[#d0566b]', C: Audio },
  { key: 'sounds', label: 'Systemklänge', icon: Music, bg: 'bg-[#e0627a]', C: SoundSection },
  { key: 'notifications', label: 'Mitteilungen', icon: Bell, bg: 'bg-[#d04848]', C: NotificationSection },
  { key: 'power', label: 'Leistung & Energie', icon: Gauge, bg: 'bg-[#3f9c6d]', C: Power },
  { key: 'network', label: 'Netzwerk & Bluetooth', icon: Wifi, bg: 'bg-[#2f7fe0]', C: NetworkSection },
  { key: 'controllers', label: 'Controller & Gyro', icon: Gamepad2, bg: 'bg-[#8a8f99]', C: ControllersSection },
  { key: 'keyboard', label: 'Tastatur & Steuerung', icon: Keyboard, bg: 'bg-[#4b5563]', C: Keys },
  { key: 'haptics', label: 'Haptik', icon: Vibrate, bg: 'bg-[#c27b3a]', C: HapticsSection },
  { key: 'faceid', label: 'Face ID & Code', icon: ScanFace, bg: 'bg-[#3fa66b]', C: FaceIdSettings },
  { key: 'apps', label: 'Apps & Berechtigungen', icon: Shield, bg: 'bg-[#3b5bc4]', C: AppsSection },
  { key: 'family', label: 'Familie & Kindersicherung', icon: Users, bg: 'bg-[#e0627a]', C: FamilySection },
  { key: 'overlay', label: 'Leistungs-HUD & Aufnahme', icon: Activity, bg: 'bg-[#c2567b]', C: OverlaySection },
  { key: 'seasonal', label: 'Saisonale Themen', icon: PartyPopper, bg: 'bg-[#e08a3a]', C: SeasonalSection },
  { key: 'accounts', label: 'Konten & Verknüpfungen', icon: Link2, bg: 'bg-[#107c10]', C: AccountsSection },
  { key: 'cloud', label: 'Cloud-Dienste', icon: Cloud, bg: 'bg-[#4a90d9]', C: CloudSection },
  { key: 'updates', label: 'Softwareupdate', icon: RefreshCw, bg: 'bg-[#6b7280]', C: UpdatesSection },
  { key: 'developer', label: 'Entwickler', icon: Code2, bg: 'bg-[#4b5563]', C: DeveloperSection },
  { key: 'about', label: 'Über Lumos One', icon: Info, bg: 'bg-[#6b7280]', C: AboutSection },
];

export default function SettingsScreen({ section = 'system' }) {
  const [cur, setCur] = useState(section);
  const S = SECTIONS.find((s) => s.key === cur) || SECTIONS[1];
  useTabs((dir) => {
    const i = SECTIONS.findIndex((s) => s.key === cur);
    setCur(SECTIONS[(i + dir + SECTIONS.length) % SECTIONS.length].key);
    haptic('nav.page');
  }, [cur]);
  return (
    <Screen title="Einstellungen" icon={Settings} noPad hints={<><Hint k="lb">Bereich</Hint><Hint k="a">Auswählen</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="flex h-full">
        <aside className="w-[19rem] shrink-0 overflow-y-auto px-6 pb-16">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              data-nav=""
              data-nav-autofocus={s.key === cur ? '' : undefined}
              data-nav-haptic="none"
              onClick={() => (setCur(s.key), haptic('select'))}
              onFocus={() => setCur(s.key)}
              className={`row-focus relative mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[0.88rem] ${cur === s.key ? 'text-white' : 'text-mist-300'}`}
            >
              {cur === s.key && <motion.span layoutId="settings-active" transition={spring.snappy} className="absolute inset-0 -z-10 rounded-2xl bg-white/[0.09]" />}
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className="h-4 w-4 text-white" />
              </span>
              {s.label}
            </button>
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto pb-20 pr-10">
          <AnimatePresence mode="wait">
            <motion.div key={cur} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={spring.soft} className="mx-auto max-w-[46rem]">
              <h2 className="mb-5 text-[1.6rem] font-semibold tracking-tight">{S.label}</h2>
              <S.C />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Screen>
  );
}
