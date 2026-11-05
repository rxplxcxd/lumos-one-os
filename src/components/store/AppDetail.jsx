import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BadgeCheck, Globe, HardDrive, Download, Scale, Users, Tag } from 'lucide-react';
import { Screen, Hint, Img } from '@/components/ui/primitives.jsx';
import InstallButton from './InstallButton.jsx';
import { appDetails, formatBytes } from '@/services/flathub.js';
import { spring } from '@/lib/motion.js';

export default function AppDetail({ id }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    let alive = true;
    appDetails(id).then((d) => alive && setA(d), (e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [id]);

  if (err)
    return (
      <Screen title="App">
        <div className="py-24 text-center text-mist-400">Details konnten nicht geladen werden: {err.message}</div>
      </Screen>
    );
  if (!a)
    return (
      <Screen title="">
        <div className="flex gap-6">
          <motion.div className="glass h-32 w-32 rounded-[2rem]" animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ repeat: Infinity, duration: 1.4 }} />
          <div className="flex-1 space-y-3 pt-4">
            <div className="glass h-8 w-72 rounded-xl" />
            <div className="glass h-4 w-96 rounded-lg" />
          </div>
        </div>
      </Screen>
    );

  const facts = [
    [Tag, 'Version', a.version || '—'],
    [Download, 'Download', formatBytes(a.downloadSize)],
    [HardDrive, 'Installiert', formatBytes(a.installedSize)],
    [Users, 'Installationen', a.installs != null ? a.installs.toLocaleString('de-DE') : '—'],
    [Scale, 'Lizenz', (a.license || '—').replace(/LicenseRef-proprietary.*/, 'Proprietär')],
  ];

  return (
    <Screen title={a.name} subtitle={a.developer} hints={<><Hint k="a">Auswählen</Hint><Hint k="b">Zurück</Hint></>}>
      <motion.div className="flex items-center gap-7" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <Img src={a.icon} alt="" className="h-32 w-32 rounded-[2rem] shadow-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[2rem] font-semibold tracking-tight">
            {a.name}
            {a.verified && <BadgeCheck className="h-6 w-6 text-lumen-400" />}
          </div>
          <div className="text-[0.95rem] text-mist-300">{a.summary}</div>
          <div className="mt-4 flex items-center gap-3">
            <InstallButton app={a} size="lg" showUninstall />
            {a.homepage && (
              <button data-nav="" onClick={() => window.lumos?.openExternal?.(a.homepage)} className="nav-focus glass flex h-12 items-center gap-2 rounded-full px-5 text-[0.85rem]">
                <Globe className="h-4 w-4" /> Website
              </button>
            )}
          </div>
        </div>
      </motion.div>

      <div className="mt-6 grid grid-cols-5 gap-3">
        {facts.map(([I, l, v]) => (
          <div key={l} className="glass rounded-2xl px-4 py-3">
            <div className="flex items-center gap-1.5 text-[0.7rem] text-mist-400"><I className="h-3.5 w-3.5" />{l}</div>
            <div className="mt-1 truncate text-[0.9rem] font-medium">{v}</div>
          </div>
        ))}
      </div>

      {a.screenshots.length > 0 && (
        <div className="-mx-10 mt-6 flex gap-4 overflow-x-auto px-10 pb-2">
          {a.screenshots.map((s, i) => (
            <motion.button key={s.src} data-nav="" onClick={() => setZoom(i)} whileFocus={{ scale: 1.03 }} transition={spring.snappy} className="nav-focus shrink-0 overflow-hidden rounded-2xl bg-ink-800">
              <Img src={s.src} alt={s.caption} className="h-[14rem] w-auto object-cover" />
            </motion.button>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-[1fr_20rem] gap-6">
        <div className="glass rounded-3xl p-6 text-[0.88rem] leading-relaxed text-mist-200">
          {a.description.map((b, i) =>
            b.type === 'li' ? (
              <div key={i} className="ml-2 flex gap-2"><span className="text-mist-500">•</span><span>{b.text}</span></div>
            ) : (
              <p key={i} className="mb-3">{b.text}</p>
            ),
          )}
        </div>
        <div className="glass self-start rounded-3xl p-5">
          <div className="label">Neuigkeiten</div>
          <div className="mt-2 text-[0.85rem] font-medium">Version {a.version || '—'}</div>
          <div className="text-[0.72rem] text-mist-400">{a.releaseDate ? new Date(a.releaseDate).toLocaleDateString('de-DE') : ''}</div>
          <div className="mt-2 space-y-1 text-[0.78rem] text-mist-300">
            {a.releaseNotes.slice(0, 8).map((b, i) => (
              <div key={i}>{b.type === 'li' ? '• ' : ''}{b.text}</div>
            ))}
            {!a.releaseNotes.length && <div className="text-mist-500">Keine Versionshinweise</div>}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {zoom != null && (
          <motion.div data-nav-scope="60" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoom(null)}>
            <motion.img key={zoom} src={a.screenshots[zoom].src} alt="" className="max-h-full max-w-full rounded-2xl" initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={spring.soft} />
            <button data-nav="" data-nav-autofocus="" className="nav-focus glass absolute bottom-8 rounded-full px-5 py-2 text-[0.85rem]" onClick={() => setZoom(null)}>
              Schließen
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Screen>
  );
}
