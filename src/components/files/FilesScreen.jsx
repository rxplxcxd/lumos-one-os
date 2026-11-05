// File browser (USB sticks, home, SD) for sideloading AppImages / Flatpaks / binaries, picking
// custom backgrounds and importing profile pictures.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Folder, File, Package, Image as ImageIcon, Film, Usb, Home, ChevronUp, Cpu } from 'lucide-react';
import { Screen, Hint, Button, Sheet } from '@/components/ui/primitives.jsx';
import { request } from '@/services/bridge.js';
import { refreshLibrary } from '@/store/library.js';
import { setSetting } from '@/store/settings.js';
import { useProfiles, updateProfile } from '@/store/profile.js';
import { idb } from '@/services/storage.js';
import { formatBytes } from '@/services/flathub.js';
import { back, toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { listStagger, itemRise } from '@/lib/motion.js';

const kindOf = (name) => {
  const n = name.toLowerCase();
  if (n.endsWith('.appimage')) return 'appimage';
  if (n.endsWith('.flatpak') || n.endsWith('.flatpakref')) return 'flatpak';
  if (/\.(png|jpe?g|webp|avif|gif)$/.test(n)) return 'image';
  if (/\.(mp4|webm|mkv|mov)$/.test(n)) return 'video';
  if (/\.(sh|x86_64|bin|run)$/.test(n) || !n.includes('.')) return 'binary';
  if (/lumos-update-.*\.zip$/.test(n)) return 'update';
  return 'file';
};
const ICON = { appimage: Package, flatpak: Package, image: ImageIcon, video: Film, binary: Cpu, update: Package, file: File };
const fileUrl = (p) => `lumosfile://local${p.split('/').map(encodeURIComponent).join('/')}`;

export default function FilesScreen({ mode = 'browse' }) {
  const [roots, setRoots] = useState([]);
  const [cwd, setCwd] = useState(null);
  const [entries, setEntries] = useState([]);
  const [sel, setSel] = useState(null);
  const activeId = useProfiles((s) => s.activeId);

  useEffect(() => {
    request('fs.roots').then((r) => {
      setRoots(r);
      setCwd(r.find((x) => /usb|media/i.test(x.path))?.path || r[0]?.path);
    }, (e) => toast({ title: e.message, kind: 'error' }));
  }, []);
  useEffect(() => {
    if (cwd) request('fs.list', { path: cwd }).then(setEntries, (e) => toast({ title: 'Ordner nicht lesbar', body: e.message, kind: 'error' }));
  }, [cwd]);

  const filter = (e) => {
    if (e.dir) return true;
    const k = kindOf(e.name);
    if (mode === 'sideload') return ['appimage', 'flatpak', 'binary'].includes(k);
    if (mode === 'background') return ['image', 'video'].includes(k);
    if (mode === 'avatar') return k === 'image';
    return true;
  };

  const choose = async (e) => {
    if (e.dir) return setCwd(e.path);
    const k = kindOf(e.name);
    if (!window.lumos?.isElectron && (k === 'image' || k === 'video')) return toast({ title: 'Lokale Dateien nur in der Lumos-Shell', kind: 'error' });
    if (mode === 'background' || (mode === 'browse' && (k === 'image' || k === 'video'))) {
      await idb.set('bg.custom', { url: fileUrl(e.path), type: k === 'video' ? 'video/mp4' : 'image/*', name: e.name });
      setSetting('background', 'custom');
      window.dispatchEvent(new Event('lumos:bg-custom-changed'));
      haptic('success');
      toast({ title: 'Hintergrund gesetzt', body: e.name, kind: 'success' });
      return mode === 'background' && back();
    }
    if (mode === 'avatar') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 512;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
        updateProfile(activeId, { image: c.toDataURL('image/webp', 0.9), imageKind: 'upload' });
        haptic('success');
        back();
      };
      img.src = fileUrl(e.path);
      return undefined;
    }
    if (['appimage', 'flatpak', 'binary'].includes(k)) {
      try {
        setSel({ ...e, info: await request('sideload.inspect', { path: e.path }) });
      } catch (err) {
        toast({ title: err.message, kind: 'error' });
      }
    }
    return undefined;
  };

  const add = async () => {
    try {
      const r = await request('sideload.add', { path: sel.path, name: sel.info?.name }, 10 * 60e3);
      haptic('success');
      toast({ title: 'Zur Bibliothek hinzugefügt', body: r.name, kind: 'success' });
      setSel(null);
      refreshLibrary();
    } catch (err) {
      haptic('error');
      toast({ title: 'Sideload fehlgeschlagen', body: err.message, kind: 'error' });
    }
  };

  const title = { sideload: 'App hinzufügen', background: 'Hintergrund wählen', avatar: 'Profilbild wählen' }[mode] || 'Dateien';
  const parent = cwd && cwd.split('/').slice(0, -1).join('/');
  return (
    <Screen title={title} icon={FolderOpen} subtitle={cwd} noPad hints={<><Hint k="a">Öffnen</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="flex h-full gap-5 px-10 pb-14">
        <aside className="glass w-[16rem] shrink-0 rounded-3xl p-2">
          {roots.map((r) => (
            <button key={r.path} data-nav="" onClick={() => setCwd(r.path)} className={`row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[0.85rem] ${cwd?.startsWith(r.path) ? 'bg-white/[0.08]' : ''}`}>
              {/usb|media|mnt/i.test(r.path) ? <Usb className="h-4 w-4" /> : <Home className="h-4 w-4" />}
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </aside>
        <section className="glass min-w-0 flex-1 overflow-y-auto rounded-3xl p-3">
          {parent && roots.every((r) => r.path !== cwd) && (
            <button data-nav="" onClick={() => setCwd(parent)} className="row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[0.85rem] text-mist-300">
              <ChevronUp className="h-4 w-4" /> Übergeordneter Ordner
            </button>
          )}
          <motion.div key={cwd} variants={listStagger} initial="initial" animate="animate">
            {entries.filter(filter).map((e) => {
              const k = e.dir ? 'dir' : kindOf(e.name);
              const I = e.dir ? Folder : ICON[k];
              return (
                <motion.button variants={itemRise} key={e.path} data-nav="" onClick={() => choose(e)} className="row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
                  <I className={`h-5 w-5 ${e.dir ? 'text-lumen-400' : 'text-mist-300'}`} />
                  <span className="min-w-0 flex-1 truncate text-[0.88rem]">{e.name}</span>
                  {!e.dir && <span className="text-[0.75rem] tabular-nums text-mist-500">{formatBytes(e.size)}</span>}
                </motion.button>
              );
            })}
          </motion.div>
          {entries.filter(filter).length === 0 && <div className="p-10 text-center text-[0.85rem] text-mist-500">Keine passenden Dateien</div>}
        </section>
      </div>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.info?.name || sel?.name}>
        <div className="space-y-1 text-[0.85rem] text-mist-300">
          <div>Typ: {{ appimage: 'AppImage', flatpak: 'Flatpak-Bundle', binary: 'Ausführbare Datei' }[sel?.info?.kind] || sel?.info?.kind}</div>
          {sel?.info?.version && <div>Version: {sel.info.version}</div>}
          {sel?.info?.arch && <div>Architektur: {sel.info.arch}</div>}
          <div className="truncate">Pfad: {sel?.path}</div>
          <div className="pt-2 text-[0.75rem] text-mist-500">AppImages werden nach ~/Applications kopiert und ausführbar gemacht; Flatpak-Bundles werden per „flatpak install --user“ installiert.</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSel(null)}>Abbrechen</Button>
          <Button variant="primary" autoFocus onClick={add}>Zur Bibliothek hinzufügen</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
