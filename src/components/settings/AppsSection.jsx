// Einstellungen → Apps & Berechtigungen: per-app sandbox switches (enforced through Flatpak
// overrides / launcher wrappers in lumosd) and per-game performance profiles (FPS, TDP, Hz).
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, Activity, HardDrive, Cloud, Wifi, Bell, Gauge, Search, ChevronLeft, Shield } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, SliderRow, Segmented, Button, TextField, Img } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { useLibrary, artFor } from '@/store/library.js';
import { request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { toast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

export const PERMISSIONS = [
  { key: 'sensors', label: 'Sensoren', sub: 'Gyroskop & Beschleunigungssensor', icon: Activity, bg: 'bg-[#8b5cf6]' },
  { key: 'controller', label: 'Controller & Haptik', sub: 'Eingabegeräte und Vibration', icon: Gamepad2, bg: 'bg-[#8a8f99]' },
  { key: 'storage', label: 'Lokaler Speicher', sub: 'Zugriff auf deinen persönlichen Ordner', icon: HardDrive, bg: 'bg-[#3f9c6d]' },
  { key: 'cloud', label: 'Cloud-Sync', sub: 'Spielstände automatisch in Lumos Cloud sichern', icon: Cloud, bg: 'bg-[#4a90d9]' },
  { key: 'network', label: 'Netzwerk', sub: 'Internet und lokales Netz', icon: Wifi, bg: 'bg-[#2f7fe0]' },
  { key: 'push', label: 'Mitteilungen', sub: 'Push- und Systembenachrichtigungen', icon: Bell, bg: 'bg-[#d04848]' },
];

export const permsOf = (perms, id) => ({ sensors: true, controller: true, storage: true, cloud: true, network: true, push: true, ...(perms?.[id] || {}) });

function AppDetail({ item, onBack }) {
  const all = useSettings((s) => s.values.appPermissions);
  const profiles = useSettings((s) => s.values.gameProfiles);
  const perms = permsOf(all, item.id);
  const prof = profiles[item.id];
  const art = artFor(item);

  const setPerm = async (key, value) => {
    const next = { ...perms, [key]: value };
    setSetting('appPermissions', { ...all, [item.id]: next });
    try {
      const r = await request('permissions.apply', { id: item.id, flatpak: item.flatpak, perms: next });
      if (r.enforced === 'stored' && ['network', 'sensors', 'storage'].includes(key) && !value) toast({ title: 'Gespeichert', body: 'Wird beim nächsten Start durchgesetzt (Flatpak/firejail)', kind: 'info' });
    } catch (e) {
      toast({ title: 'Berechtigung nicht anwendbar', body: e.message, kind: 'error' });
    }
  };
  const setProf = (patch) => {
    const next = { ...profiles, [item.id]: { fps: 60, tdp: 15, refresh: null, ...(prof || {}), ...patch } };
    setSetting('gameProfiles', next);
  };
  const clearProf = () => {
    const next = { ...profiles };
    delete next[item.id];
    setSetting('gameProfiles', next);
    haptic('toggle.off');
  };

  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={spring.soft}>
      <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} autoFocus>Alle Apps</Button>
      <div className="my-4 flex items-center gap-4">
        <Img src={art.icon || art.header} alt="" className="h-16 w-16 rounded-2xl object-cover" fallback={<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10"><Gamepad2 className="h-7 w-7" /></div>} />
        <div>
          <div className="text-xl font-semibold">{item.name}</div>
          <div className="text-[0.78rem] text-mist-400">{{ steam: 'Steam', flatpak: 'Flatpak', emulator: 'Emulator (Flatpak)', appimage: 'AppImage', binary: 'Programm', builtin: 'Lumos-App' }[item.kind] || item.kind}</div>
        </div>
      </div>
      <ListGroup title="Darf zugreifen auf" footer={item.flatpak ? 'Durchgesetzt über Flatpak-Sandbox-Overrides (flatpak override --user).' : item.kind === 'steam' ? 'Steam-Spiele laufen in Steams eigener Umgebung – Lumos steuert Cloud-Sync und Profile, die Sandbox-Schalter gelten nur für Flatpak-Apps.' : 'Netzwerk-Sperre über firejail (falls installiert), übrige Schalter wirken auf Lumos-Funktionen.'}>
        {PERMISSIONS.map((p) => (
          <ToggleRow key={p.key} icon={p.icon} iconBg={p.bg} label={p.label} sub={p.sub} checked={perms[p.key]} onChange={(v) => setPerm(p.key, v)} />
        ))}
      </ListGroup>
      <ListGroup title="Leistungsprofil" footer="Wird beim Start automatisch über lumosd geladen und nach dem Beenden zurückgesetzt.">
        <ToggleRow icon={Gauge} iconBg="bg-[#3f9c6d]" label="Eigenes Profil für dieses Spiel" checked={!!prof} onChange={(v) => (v ? setProf({}) : clearProf())} />
        {prof && (
          <>
            <div className="border-b border-white/[0.05] px-4 py-3">
              <div className="mb-2 text-[0.92rem]">FPS-Limit</div>
              <Segmented value={prof.fps} onChange={(fps) => setProf({ fps })} options={[0, 30, 40, 45, 60, 90, 120].map((f) => ({ value: f, label: f ? String(f) : 'Aus' }))} />
            </div>
            <SliderRow label="TDP" value={prof.tdp} min={4} max={28} detents={24} format={(x) => `${x} W`} onChange={(tdp) => setProf({ tdp })} />
            <div className="px-4 py-3">
              <div className="mb-2 text-[0.92rem]">Bildwiederholrate</div>
              <Segmented value={prof.refresh || 0} onChange={(r) => setProf({ refresh: r || null })} options={[{ value: 0, label: 'System' }, { value: 60, label: '60 Hz' }, { value: 90, label: '90 Hz' }, { value: 120, label: '120 Hz' }, { value: 165, label: '165 Hz' }]} />
            </div>
          </>
        )}
      </ListGroup>
    </motion.div>
  );
}

export default function AppsSection() {
  const items = useLibrary((s) => s.items);
  const profiles = useSettings((s) => s.values.gameProfiles);
  const perms = useSettings((s) => s.values.appPermissions);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const list = useMemo(() => [...items].filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'de')), [items, q]);
  const item = items.find((i) => i.id === sel);
  return (
    <AnimatePresence mode="wait">
      {item ? (
        <AppDetail key={item.id} item={item} onBack={() => setSel(null)} />
      ) : (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <TextField value={q} onChange={setQ} placeholder="App suchen" className="pl-10" />
          </div>
          <ListGroup title={`${list.length} Apps & Spiele`}>
            {list.map((i) => {
              const denied = Object.values(permsOf(perms, i.id)).filter((x) => !x).length;
              return (
                <ListRow
                  key={i.id}
                  icon={Shield}
                  iconBg={denied ? 'bg-[#c27b3a]' : 'bg-[#3f9c6d]'}
                  label={i.name}
                  sub={[denied ? `${denied} Berechtigung${denied > 1 ? 'en' : ''} gesperrt` : 'Alle Berechtigungen', profiles[i.id] ? `Profil: ${profiles[i.id].fps || '∞'} FPS · ${profiles[i.id].tdp} W` : null].filter(Boolean).join(' · ')}
                  onClick={() => setSel(i.id)}
                />
              );
            })}
          </ListGroup>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
