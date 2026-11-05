// Home: centred "recently played" carousel with focus animations + haptic ticks, the app
// dock, live downloads and the widget board (Y = edit, X = add).
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Library, StickyNote, Calculator, KeyRound, Settings, Cloud, RefreshCw, UserRound, FolderOpen, Gamepad2, Plus, Minus, Maximize2, Globe, Play } from 'lucide-react';
import { useLibrary, artFor, launch } from '@/store/library.js';
import { open, useUI, setEditWidgets } from '@/store/ui.js';
import { useWidgets, addWidget, removeWidget, cycleWidgetSize, moveWidget, WIDGET_TYPES } from '@/store/widgets.js';
import { WIDGETS, useMediaPolling } from '@/components/widgets/Widgets.jsx';
import DownloadTray from '@/components/shell/DownloadTray.jsx';
import { Sheet, Button, Hint, Img } from '@/components/ui/primitives.jsx';
import { useAction, useTabs } from '@/hooks/useInputSystem.js';
import { useProfiles, activeProfile } from '@/store/profile.js';
import { request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const TILE_W = 10.5; // rem
const GAP = 1.4;

function relTime(ts) {
  if (!ts) return 'Noch nie gespielt';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

function GameTile({ item, focused, onFocus, index }) {
  const art = artFor(item);
  return (
    <motion.button
      data-nav=""
      data-nav-noscroll=""
      data-nav-autofocus={index === 0 ? '' : undefined}
      onFocus={onFocus}
      onClick={() => launch(item)}
      animate={{ scale: focused ? 1.12 : 0.94, y: focused ? -6 : 0, opacity: focused ? 1 : 0.72 }}
      transition={spring.snappy}
      className={`relative shrink-0 overflow-hidden rounded-[1.4rem] bg-ink-800 outline-none ${focused ? 'shimmer' : ''}`}
      style={{ width: `${TILE_W}rem`, height: `${TILE_W * 1.5}rem`, boxShadow: focused ? '0 0 0 2.5px rgba(245,247,250,0.95), 0 30px 60px -20px rgba(127,163,255,0.45)' : '0 12px 30px -16px rgba(0,0,0,0.8)' }}
    >
      {art.cover ? (
        <Img src={art.cover} data-fallback-src={art.coverFallback} alt={item.name} className="h-full w-full object-cover" fallback={<Fallback item={item} />} />
      ) : (
        <Fallback item={item} icon={art.icon} />
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[1.4rem] ring-1 ring-inset ring-white/10" />
    </motion.button>
  );
}

function Fallback({ item, icon }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-ink-700 to-ink-900 p-4">
      {icon ? <img src={icon} alt="" className="h-20 w-20 rounded-2xl drop-shadow-xl" /> : <Gamepad2 className="h-14 w-14 text-mist-400" />}
      <span className="text-center text-[0.85rem] font-semibold leading-tight">{item.name}</span>
    </div>
  );
}

const DOCK = [
  { key: 'store', label: 'Store', icon: Store },
  { key: 'library', label: 'Bibliothek', icon: Library },
  { key: 'steam', label: 'Steam Big Picture', icon: Gamepad2 },
  { key: 'browser', label: 'Web', icon: Globe },
  { key: 'notes', label: 'Notizen', icon: StickyNote },
  { key: 'calculator', label: 'Rechner', icon: Calculator },
  { key: 'keychain', label: 'Passwörter', icon: KeyRound },
  { key: 'avatar', label: 'Profil & Avatar', icon: UserRound },
  { key: 'files', label: 'Dateien', icon: FolderOpen },
  { key: 'cloud', label: 'Lumos Cloud', icon: Cloud },
  { key: 'updater', label: 'Sync & Update', icon: RefreshCw },
  { key: 'settings', label: 'Einstellungen', icon: Settings },
];

function DockButton({ d }) {
  const [f, setF] = useState(false);
  const go = () => (d.key === 'steam' ? request('steam.bigpicture').then(() => window.lumos?.window?.handoff()).catch(() => {}) : open(d.key));
  return (
    <div className="relative flex flex-col items-center">
      <motion.button
        data-nav=""
        onFocus={() => setF(true)}
        onBlur={() => setF(false)}
        onClick={go}
        aria-label={d.label}
        animate={{ scale: f ? 1.14 : 1 }}
        transition={spring.bouncy}
        className="nav-focus glass flex h-[3.6rem] w-[3.6rem] items-center justify-center rounded-full"
      >
        <d.icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={1.8} />
      </motion.button>
      <AnimatePresence>
        {f && (
          <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute top-[4.3rem] whitespace-nowrap text-[0.75rem] font-medium text-mist-100">
            {d.label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

const INTERACTIVE = new Set(['music', 'quick', 'cloud', 'notes']);
const WIDGET_LINK = { system: ['settings', { section: 'power' }], weather: ['settings', { section: 'system' }], clock: ['settings', { section: 'system' }], controllers: ['settings', { section: 'controllers' }], downloads: ['library', {}] };

function WidgetCard({ w, edit }) {
  const C = WIDGETS[w.type];
  const focusable = edit || !INTERACTIVE.has(w.type);
  return (
    <motion.div
      layout
      data-nav={focusable ? '' : undefined}
      data-widget-id={w.id}
      tabIndex={focusable ? 0 : undefined}
      onClick={() => {
        if (edit) cycleWidgetSize(w.id);
        else if (WIDGET_LINK[w.type]) open(...WIDGET_LINK[w.type]);
      }}
      transition={edit ? { rotate: { repeat: Infinity, duration: 0.5, ease: 'easeInOut' }, layout: spring.soft } : spring.soft}
      animate={edit ? { rotate: [0, -0.6, 0.6, 0] } : { rotate: 0 }}
      style={{ gridColumn: `span ${w.size}`, gridRow: `span ${w.size}` }}
      className="nav-focus glass relative overflow-hidden rounded-[1.6rem] p-4"
    >
      <div className={edit ? 'pointer-events-none h-full opacity-80' : 'h-full'}>{C ? <C size={w.size} /> : null}</div>
      {edit && (
        <div className="absolute right-2 top-2 flex gap-1.5">
          <span className="flex h-7 items-center gap-1 rounded-full bg-black/60 px-2 text-[0.68rem] font-semibold"><Maximize2 className="h-3 w-3" />{w.size}×{w.size}</span>
          <button data-nav="" aria-label="Entfernen" onClick={(e) => (e.stopPropagation(), haptic('close'), removeWidget(w.id))} className="nav-focus flex h-7 w-7 items-center justify-center rounded-full bg-bad text-white"><Minus className="h-4 w-4" /></button>
        </div>
      )}
    </motion.div>
  );
}

function WidgetPicker({ open: isOpen, onClose }) {
  return (
    <Sheet open={isOpen} onClose={onClose} title="Widget hinzufügen" className="w-[52rem]">
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(WIDGET_TYPES).map(([type, t]) => (
          <div key={type} className="rounded-2xl bg-white/[0.05] p-3">
            <div className="mb-2 text-[0.85rem] font-medium">{t.label}</div>
            <div className="flex gap-2">
              {t.sizes.map((s, i) => (
                <Button key={s} size="sm" variant="subtle" autoFocus={type === 'system' && i === 0} onClick={() => (addWidget(type, s), haptic('success'), onClose())}>
                  {s}×{s}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export default function HomeScreen() {
  useMediaPolling();
  const items = useLibrary((s) => s.items);
  const layout = useWidgets((s) => s.layout);
  const edit = useUI((s) => s.editWidgets);
  const profile = useProfiles(activeProfile);
  const [picker, setPicker] = useState(false);
  const recent = useMemo(() => [...items].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 12), [items]);
  const [fi, setFi] = useState(0);
  const [heroFocus, setHeroFocus] = useState(true);
  const focused = recent[Math.min(fi, recent.length - 1)];
  const hero = focused ? artFor(focused).hero : null;

  useAction(
    (a) => {
      if (a === 'y') {
        setEditWidgets(!useUI.getState().editWidgets);
        haptic('long.press');
      }
      if (a === 'x' && useUI.getState().editWidgets) setPicker(true);
    },
    [],
  );
  useTabs((dir) => {
    if (!useUI.getState().editWidgets) return;
    const id = document.activeElement?.dataset?.widgetId;
    if (id) {
      moveWidget(id, dir);
      haptic('nav.page');
    }
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

  return (
    <div data-nav-scope="0" className="absolute inset-0 overflow-y-auto overflow-x-hidden pt-[3.5rem]">
      {/* hero art of the focused title */}
      <AnimatePresence>
        {hero && heroFocus && (
          <motion.div key={hero} className="pointer-events-none absolute inset-x-0 top-0 h-[34rem]" initial={{ opacity: 0 }} animate={{ opacity: 0.38 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <Img src={hero} className="h-full w-full object-cover" fallback={<div />} style={{ maskImage: 'linear-gradient(to bottom, black 30%, transparent 95%)', WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 95%)' }} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative px-10 pt-2">
        <motion.h1 className="text-[1.35rem] font-semibold tracking-tight" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
          {greeting}, {profile?.name}
        </motion.h1>
        <p className="text-[0.8rem] text-mist-400">Zuletzt gespielt</p>
      </div>

      {/* centred carousel */}
      <section className="relative mt-4 h-[18.5rem]" onFocus={() => setHeroFocus(true)}>
        {recent.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Button variant="glass" icon={Store} onClick={() => open('store')} autoFocus>
              Spiele im Store entdecken
            </Button>
          </div>
        ) : (
          <motion.div className="absolute top-[1.2rem] flex items-start" style={{ gap: `${GAP}rem`, left: '50%' }} animate={{ x: `calc(${-(fi * (TILE_W + GAP) + TILE_W / 2)}rem)` }} transition={spring.soft}>
            {recent.map((it, i) => (
              <GameTile key={it.id} item={it} index={i} focused={i === fi && heroFocus} onFocus={() => setFi(i)} />
            ))}
          </motion.div>
        )}
      </section>
      <div className="relative flex h-[3.6rem] items-start justify-center">
        <AnimatePresence mode="wait">
          {focused && heroFocus && (
            <motion.div key={focused.id} className="text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring.snappy}>
              <div className="text-[1.15rem] font-semibold tracking-tight">{focused.name}</div>
              <div className="text-[0.75rem] text-mist-400">
                {relTime(focused.lastPlayed)}
                {focused.playtime ? ` · ${Math.round(focused.playtime / 60)} Std. gespielt` : ''} · <span className="inline-flex items-center gap-1"><Play className="inline h-3 w-3" /> A zum Spielen</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* dock */}
      <nav className="relative mt-2 flex h-[6rem] justify-center gap-[1.1rem]" onFocus={() => setHeroFocus(false)}>
        {DOCK.map((d) => (
          <DockButton key={d.key} d={d} />
        ))}
      </nav>

      {/* widgets */}
      <section className="relative px-10 pb-24 pt-2" onFocus={() => setHeroFocus(false)}>
        <div className="mb-3 flex items-center gap-4">
          <h2 className="label">Widgets</h2>
          {edit && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setPicker(true)}>
              Hinzufügen
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="subtle" onClick={() => setEditWidgets(false)}>
              Fertig
            </Button>
          )}
        </div>
        <motion.div layout className="grid gap-4" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: '4.9rem', gridAutoFlow: 'dense' }}>
          {layout.map((w) => (
            <WidgetCard key={w.id} w={w} edit={edit} />
          ))}
        </motion.div>
      </section>

      <div className="fixed bottom-5 right-6 z-30 w-[22rem]">
        <DownloadTray compact />
      </div>
      <footer className="pointer-events-none fixed bottom-0 left-0 z-20 flex gap-5 px-10 pb-3">
        <Hint k="a">Öffnen</Hint>
        <Hint k="y">{edit ? 'Bearbeiten beenden' : 'Widgets bearbeiten'}</Hint>
        {edit && <Hint k="x">Widget hinzufügen</Hint>}
        {edit && <Hint k="lb">/ R verschieben</Hint>}
        <Hint k="start">Schnellzugriff</Hint>
      </footer>

      <WidgetPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}
