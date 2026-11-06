// Library / Game Hub: Steam, Flatpak, emulators and sideloaded apps in one grid.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Library, Gamepad2, Plus, Trash2, Play, RefreshCw } from 'lucide-react';
import { Screen, Hint, Img, Button, Sheet } from '@/components/ui/primitives.jsx';
import DownloadTray from '@/components/shell/DownloadTray.jsx';
import { useLibrary, artFor, launch, refreshLibrary } from '@/store/library.js';
import { uninstall } from '@/store/downloads.js';
import { open, toast } from '@/store/ui.js';
import { request } from '@/services/bridge.js';
import { useTabs, useAction } from '@/hooks/useInputSystem.js';
import { spring, listStagger, itemRise } from '@/lib/motion.js';

const TABS = [
  { key: 'all', label: 'Alle' },
  { key: 'steam', label: 'Steam' },
  { key: 'flatpak', label: 'Apps' },
  { key: 'emulator', label: 'Emulatoren' },
  { key: 'sideload', label: 'Sideload' },
];

function Cover({ item, onFocusItem }) {
  const art = artFor(item);
  const [f, setF] = useState(false);
  return (
    <motion.div variants={itemRise} className="flex flex-col gap-2">
      <motion.button
        data-nav=""
        onFocus={() => (setF(true), onFocusItem(item))}
        onBlur={() => setF(false)}
        onClick={() => launch(item)}
        animate={{ scale: f ? 1.06 : 1, y: f ? -4 : 0 }}
        transition={spring.snappy}
        className={`nav-focus relative aspect-[2/3] overflow-hidden rounded-[1.2rem] bg-ink-800 ${f ? 'shimmer' : ''}`}
      >
        {art.cover ? (
          <Img src={art.cover} data-fallback-src={art.coverFallback} alt="" className="h-full w-full object-cover" fallback={<Placeholder item={item} icon={art.icon} />} />
        ) : (
          <Placeholder item={item} icon={art.icon} />
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-mist-200 backdrop-blur">{{ steam: 'Steam', flatpak: 'App', emulator: 'Emulator', appimage: 'AppImage', binary: 'Binary' }[item.kind] || item.kind}</span>
      </motion.button>
      <span className="truncate px-1 text-[0.8rem] text-mist-200">{item.name}</span>
    </motion.div>
  );
}

function Placeholder({ item, icon }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-ink-700 to-ink-900 p-3">
      {icon ? <Img src={icon} alt="" className="h-16 w-16 rounded-2xl" fallback={<Gamepad2 className="h-12 w-12 text-mist-400" />} /> : <Gamepad2 className="h-12 w-12 text-mist-400" />}
      <span className="text-center text-[0.78rem] font-semibold leading-tight">{item.name}</span>
    </div>
  );
}

export default function LibraryScreen() {
  const { items, loading, error } = useLibrary();
  const [tab, setTab] = useState('all');
  const [focused, setFocused] = useState(null);
  const [opts, setOpts] = useState(null);
  const list = useMemo(() => {
    const f = items.filter((i) => tab === 'all' || (tab === 'sideload' ? ['appimage', 'binary'].includes(i.kind) : i.kind === tab));
    return f.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [items, tab]);

  useTabs((dir) => {
    const i = TABS.findIndex((t) => t.key === tab);
    setTab(TABS[(i + dir + TABS.length) % TABS.length].key);
  }, [tab]);
  useAction((a) => a === 'y' && focused && setOpts(focused), [focused]);

  const remove = async (item) => {
    setOpts(null);
    try {
      if (item.flatpak) await uninstall({ id: item.flatpak, name: item.name, icon: artFor(item).icon });
      else if (item.kind === 'appimage' || item.kind === 'binary') {
        await request('sideload.remove', { id: item.id });
        refreshLibrary();
      } else if (item.kind === 'steam') await request('library.launch', { id: `steam-uninstall:${item.appid}` });
    } catch (e) {
      toast({ title: 'Entfernen fehlgeschlagen', body: e.message, kind: 'error' });
    }
  };

  return (
    <Screen
      title="Bibliothek"
      icon={Library}
      subtitle={`${items.length} Titel`}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      actions={
        <>
          <Button size="sm" variant="subtle" icon={RefreshCw} onClick={refreshLibrary}>{loading ? 'Lädt …' : 'Aktualisieren'}</Button>
          <Button size="sm" variant="subtle" icon={Gamepad2} onClick={() => request('steam.bigpicture').then(() => window.lumos?.window?.handoff())}>Big Picture</Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => open('files', { mode: 'sideload' })}>Hinzufügen</Button>
        </>
      }
      hints={
        <>
          <Hint k="lb">Filter</Hint>
          <Hint k="a">Starten</Hint>
          <Hint k="y">Optionen</Hint>
          <Hint k="b">Zurück</Hint>
        </>
      }
    >
      <div className="mb-5 max-w-[30rem]">
        <DownloadTray />
      </div>
      {error && <div className="mb-4 rounded-2xl bg-bad/10 px-4 py-3 text-[0.8rem] text-bad">Bibliothek nicht verfügbar: {error}</div>}
      {list.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-4 py-20 text-mist-400">
          <Gamepad2 className="h-10 w-10" />
          Noch nichts hier.
          <Button variant="glass" onClick={() => open('store')} autoFocus>Store öffnen</Button>
        </div>
      )}
      <motion.div key={tab} variants={listStagger} initial="initial" animate="animate" className="grid grid-cols-6 gap-x-5 gap-y-6">
        {list.map((it) => (
          <Cover key={it.id} item={it} onFocusItem={setFocused} />
        ))}
      </motion.div>
      <Sheet open={!!opts} onClose={() => setOpts(null)} title={opts?.name}>
        <div className="flex gap-3">
          <Button variant="primary" icon={Play} autoFocus onClick={() => (launch(opts), setOpts(null))}>Starten</Button>
          <Button variant="danger" icon={Trash2} onClick={() => remove(opts)}>{opts?.kind === 'steam' ? 'In Steam deinstallieren' : 'Entfernen'}</Button>
          <Button variant="ghost" onClick={() => setOpts(null)}>Abbrechen</Button>
        </div>
        {opts?.playtime > 0 && <p className="mt-4 text-[0.8rem] text-mist-400">{Math.round(opts.playtime / 60)} Stunden gespielt</p>}
      </Sheet>
    </Screen>
  );
}
