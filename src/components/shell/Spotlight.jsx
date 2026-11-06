// Global Spotlight search (Strg+K / Strg+Leertaste / Select): apps & games, system apps,
// deep settings, cloud saves, friends, notes, Flathub (live), calculator and web search.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Gamepad2, Settings, Cloud, Users, StickyNote, Store, Globe, Calculator, AppWindow, ArrowRight } from 'lucide-react';
import { useLibrary, launch } from '@/store/library.js';
import { useNotes } from '@/store/notes.js';
import { useCloud } from '@/services/cloud/cloudService.js';
import { search as flathubSearch } from '@/services/flathub.js';
import { evaluate, format } from '@/lib/calc.js';
import { open } from '@/store/ui.js';
import { useAction } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { focusEl } from '@/lib/spatialNav.js';
import { spring } from '@/lib/motion.js';

export const useSpotlight = create(() => ({ open: false }));
export const toggleSpotlight = (v) => useSpotlight.setState((s) => ({ open: v ?? !s.open }));

const APPS = [
  ['store', 'Store', 'apps flathub installieren'], ['library', 'Bibliothek', 'spiele games'], ['notes', 'Notizen', 'notes'], ['calculator', 'Rechner', 'taschenrechner'],
  ['keychain', 'Passwörter', 'schlüsselbund keychain'], ['avatar', 'Avatar-Studio', 'profil charakter'], ['files', 'Dateien', 'usb sideload'], ['cloud', 'Lumos Cloud', 'saves'],
  ['updater', 'Sync & Update', 'update ota'], ['settings', 'Einstellungen', 'settings'], ['terminal', 'Terminal', 'shell konsole logs'], ['taskmanager', 'Task-Manager', 'prozesse beenden'],
  ['captures', 'Aufnahmen', 'clips screenshots editor'], ['social', 'Freunde & Chat', 'nachrichten'], ['browser', 'Web', 'internet browser'],
];
const SETTINGS = [
  ['system', 'System', 'gerätename sprache uhr wetter'], ['look', 'Darstellung & Farben', 'farbschema theme glas kontrast'], ['appearance', 'Hintergrund', 'wallpaper shader eigenes bild'],
  ['animations', 'Animationen', 'übergänge tempo wellen'], ['home', 'Startbildschirm', 'kacheln widgets begrüßung'], ['display', 'Display & TV-Docking', 'helligkeit fps hz hdr fsr 4k tv'],
  ['screensaver', 'Bildschirmschoner & Standby', 'nachtmodus blaulicht pixel shift ruhezustand'], ['audio', 'Audio & Equalizer', 'lautstärke equalizer bass höhen stimme'],
  ['sounds', 'Systemklänge', 'töne klick'], ['notifications', 'Mitteilungen', 'benachrichtigungen'], ['power', 'Leistung & Energie', 'tdp lüfter akku energiesparmodus ladelimit'],
  ['network', 'Netzwerk & Bluetooth', 'wlan wifi bluetooth kopplen'], ['controllers', 'Controller & Gyro', 'gamepad usb xbox dualsense tester'], ['keyboard', 'Tastatur & Steuerung', 'tastenbelegung cursor'],
  ['haptics', 'Haptik', 'vibration'], ['faceid', 'Face ID & Code', 'gesicht pin'], ['apps', 'Apps & Berechtigungen', 'rechte sensoren netzwerk profile fps tdp'],
  ['family', 'Familie & Kindersicherung', 'profile kinder gast pin zeitlimit'], ['overlay', 'Leistungs-HUD & Aufnahme', 'fps overlay mangohud clip'], ['seasonal', 'Saisonale Themen', 'halloween weihnachten'],
  ['cloud', 'Cloud-Dienste', 'supabase backend'], ['updates', 'Softwareupdate', 'kanal'], ['developer', 'Entwickler', 'debug simulator'],
];

function score(q, ...fields) {
  const s = fields.join(' ').toLowerCase();
  if (!q) return 0;
  const i = s.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return 80 - Math.min(40, i);
  let j = 0;
  for (const ch of s) if (ch === q[j]) j++;
  return j === q.length ? 30 : 0; // subsequence match ("lbib" → Bibliothek)
}

export default function Spotlight() {
  const isOpen = useSpotlight((s) => s.open);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const items = useLibrary((s) => s.items);
  const notes = useNotes((s) => s.notes);
  const { saves, friends } = useCloud();
  const input = useRef(null);

  const selTimer = useRef(0);
  // Select opens Spotlight – slightly delayed so Select+Start (task manager) doesn't open it
  useAction((a) => {
    if (a === 'select') selTimer.current = setTimeout(() => toggleSpotlight(), 280);
    if (a === 'start') clearTimeout(selTimer.current);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.code === 'Space')) {
        e.preventDefault();
        toggleSpotlight();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (isOpen) {
      setQ('');
      haptic('open');
      setTimeout(() => input.current && focusEl(input.current, { silent: true }), 60);
    }
  }, [isOpen]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setRemote([]);
    const t = setTimeout(() => flathubSearch(term, { perPage: 5 }).then((r) => setRemote(r.items.slice(0, 5)), () => setRemote([])), 280);
    return () => clearTimeout(t);
  }, [q]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out = [];
    const add = (group, icon, title, sub, run, s) => s > 0 && out.push({ group, icon, title, sub, run, s });
    for (const it of items) add('Spiele & Apps', Gamepad2, it.name, { steam: 'Steam', flatpak: 'App', emulator: 'Emulator', builtin: 'Lumos', appimage: 'AppImage' }[it.kind] || it.kind, () => launch(it), score(term, it.name) + 5);
    for (const [k, l, kw] of APPS) add('System', AppWindow, l, 'App', () => open(k), score(term, l, kw));
    for (const [k, l, kw] of SETTINGS) add('Einstellungen', Settings, l, 'Einstellungen', () => open('settings', { section: k }), score(term, l, kw) - 2);
    for (const s of saves) add('Cloud-Spielstände', Cloud, s.title, `v${s.version} · ${new Date(s.updatedAt).toLocaleDateString('de-DE')}`, () => open('cloud'), score(term, s.title));
    for (const f of friends) add('Kontakte', Users, f.name, f.status === 'accepted' ? 'Freund' : 'Anfrage', () => open('social'), score(term, f.name));
    for (const n of notes) add('Notizen', StickyNote, n.title || n.body.split('\n')[0] || 'Notiz', n.body.slice(0, 60), () => open('notes'), score(term, n.title, n.body) - 5);
    out.sort((a, b) => b.s - a.s);
    let calc = null;
    try {
      if (/[\d)]\s*[-+*/×÷^%]|sqrt|sin|cos|π/.test(term)) calc = format(evaluate(q));
    } catch {
      calc = null;
    }
    const final = out.slice(0, 14);
    if (calc) final.unshift({ group: 'Rechner', icon: Calculator, title: `= ${calc}`, sub: q, run: () => navigator.clipboard?.writeText(calc), s: 999 });
    for (const a of remote) final.push({ group: 'Flathub', icon: Store, title: a.name, sub: a.summary, img: a.icon, run: () => open('store', { app: a.id }) });
    const isUrl = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q.trim());
    final.push({ group: 'Web', icon: Globe, title: isUrl ? `Öffnen: ${q.trim()}` : `Im Web suchen: „${q.trim()}“`, sub: isUrl ? 'Lumos Web' : 'DuckDuckGo', run: () => open('browser', { url: isUrl ? `https://${q.trim().replace(/^https?:\/\//, '')}` : `https://duckduckgo.com/?q=${encodeURIComponent(q.trim())}` }) });
    return final;
  }, [q, items, notes, saves, friends, remote]);

  const run = (r) => {
    haptic('select');
    toggleSpotlight(false);
    setTimeout(r.run, 80);
  };
  let lastGroup = null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-[89] flex justify-center bg-black/45 pt-[9vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && toggleSpotlight(false)}>
          <motion.div data-nav-scope="89" className="glass-strong flex h-fit max-h-[78vh] w-[44rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[1.8rem]" initial={{ y: -30, scale: 0.96, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -20, scale: 0.97, opacity: 0 }} transition={spring.sheet}>
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
              <Search className="h-5 w-5 text-mist-300" />
              <input
                ref={input}
                data-nav=""
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results[0]) run(results[0]);
                  if (e.key === 'Escape') toggleSpotlight(false);
                }}
                placeholder="Apps, Spiele, Einstellungen, Kontakte, Web …"
                className="nav-focus flex-1 rounded-lg bg-transparent text-[1.2rem] outline-none placeholder:text-mist-500"
              />
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[0.65rem] text-mist-400">Strg K</span>
            </div>
            <div className="overflow-y-auto p-2">
              {!q && <div className="p-6 text-center text-[0.85rem] text-mist-500">Tippe, um alles auf deinem Lumos One zu durchsuchen.</div>}
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <div key={`${r.group}-${r.title}-${i}`}>
                    {header && <div className="label px-3 pb-1 pt-3">{header}</div>}
                    <motion.button data-nav="" onClick={() => run(r)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.snappy, delay: Math.min(i, 10) * 0.015 }} className="row-focus group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left">
                      {r.img ? <img src={r.img} alt="" className="h-8 w-8 rounded-lg" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08]"><r.icon className="h-4 w-4" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.92rem]">{r.title}</span>
                        {r.sub && <span className="block truncate text-[0.72rem] text-mist-400">{r.sub}</span>}
                      </span>
                      <ArrowRight className="h-4 w-4 text-mist-500 opacity-0 group-focus:opacity-100" />
                    </motion.button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
