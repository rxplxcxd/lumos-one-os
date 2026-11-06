// Aufnahmen: gallery of clips/screenshots, editor (trim, crop, filters) with real re-encoding
// (canvas + MediaRecorder), export to file and instant share to friends over Lumos Cloud.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clapperboard, Film, Image as ImageIcon, Trash2, Download, Share2, Scissors, Wand2, MonitorUp, Camera, Save } from 'lucide-react';
import { Screen, Button, Segmented, Sheet, Hint, Progress, Slider } from '@/components/ui/primitives.jsx';
import { listCaptures, getCapture, deleteCapture, saveCapture, downloadBlob } from '@/services/captures.js';
import { enableScreenCapture, replay } from '@/lib/recorder.js';
import { saveClip, takeScreenshot } from '@/services/captureActions.js';
import { useCloud, uploadMedia, sendMessage } from '@/services/cloud/cloudService.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const FILTERS = {
  none: { label: 'Original', css: 'none' },
  vivid: { label: 'Lebendig', css: 'saturate(1.45) contrast(1.08)' },
  noir: { label: 'Noir', css: 'grayscale(1) contrast(1.25)' },
  warm: { label: 'Warm', css: 'sepia(0.35) saturate(1.2) hue-rotate(-8deg)' },
  cool: { label: 'Kühl', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
  retro: { label: 'Retro', css: 'sepia(0.5) contrast(1.15) saturate(0.85)' },
};
const CROPS = { full: { label: 'Original', r: null }, '16:9': { label: '16:9', r: 16 / 9 }, '1:1': { label: '1:1', r: 1 }, '9:16': { label: '9:16 Story', r: 9 / 16 }, '4:3': { label: '4:3', r: 4 / 3 } };

function cropRect(w, h, ratio) {
  if (!ratio) return { sx: 0, sy: 0, sw: w, sh: h };
  if (w / h > ratio) {
    const sw = h * ratio;
    return { sx: (w - sw) / 2, sy: 0, sw, sh: h };
  }
  const sh = w / ratio;
  return { sx: 0, sy: (h - sh) / 2, sw: w, sh };
}

/** Real re-encode: plays the trimmed range into a canvas with crop + filter and records it. */
async function renderVideo(src, { start, end, crop, filter }, onProgress) {
  const v = document.createElement('video');
  Object.assign(v, { src, muted: true, playsInline: true });
  await new Promise((r) => (v.onloadedmetadata = r));
  const { sx, sy, sw, sh } = cropRect(v.videoWidth, v.videoHeight, CROPS[crop].r);
  const c = document.createElement('canvas');
  c.width = Math.round(sw / 2) * 2;
  c.height = Math.round(sh / 2) * 2;
  const ctx = c.getContext('2d');
  ctx.filter = FILTERS[filter].css;
  const rec = new MediaRecorder(c.captureStream(60), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  v.currentTime = start;
  await new Promise((r) => (v.onseeked = r));
  rec.start(250);
  await v.play();
  await new Promise((resolve) => {
    const draw = () => {
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
      onProgress?.((v.currentTime - start) / (end - start));
      if (v.currentTime >= end || v.ended) return resolve();
      requestAnimationFrame(draw);
    };
    draw();
  });
  v.pause();
  await new Promise((r) => ((rec.onstop = r), rec.stop()));
  return new Blob(chunks, { type: 'video/webm' });
}

async function renderImage(src, { crop, filter }) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const { sx, sy, sw, sh } = cropRect(img.naturalWidth, img.naturalHeight, CROPS[crop].r);
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  ctx.filter = FILTERS[filter].css;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

function ShareSheet({ capture, open, onClose }) {
  const friends = useCloud((s) => s.friends.filter((f) => f.status === 'accepted'));
  const user = useCloud((s) => s.user);
  const [busy, setBusy] = useState(null);
  const share = async (f) => {
    setBusy(f.id);
    try {
      const rec = await getCapture(capture.id);
      const media = await uploadMedia(rec.blob, capture.name);
      await sendMessage(f.id, { text: '', attachment: { ...media, mediaId: media.mediaId || media.id } });
      haptic('success');
      toast({ title: 'Geteilt', body: `an ${f.name}`, kind: 'success' });
      onClose();
    } catch (e) {
      toast({ title: 'Teilen fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Mit Freunden teilen">
      {!user && <div className="py-6 text-center text-mist-400">Melde dich bei Lumos Cloud an, um zu teilen.</div>}
      {user && !friends.length && <div className="py-6 text-center text-mist-400">Noch keine Freunde – füge welche in „Freunde & Chat“ hinzu.</div>}
      <div className="grid grid-cols-3 gap-3">
        {friends.map((f, i) => (
          <Button key={f.id} variant="subtle" autoFocus={i === 0} disabled={!!busy} onClick={() => share(f)}>
            {busy === f.id ? 'Lädt hoch …' : f.name}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

function Editor({ meta, onDone }) {
  const [rec, setRec] = useState(null);
  const [url, setUrl] = useState(null);
  const [dur, setDur] = useState(meta.duration || 0);
  const [range, setRange] = useState([meta.trimStart || 0, meta.duration || 30]);
  const [crop, setCrop] = useState('full');
  const [filter, setFilter] = useState('none');
  const [progress, setProgress] = useState(null);
  const [share, setShare] = useState(false);
  const vid = useRef(null);
  useEffect(() => {
    let u;
    getCapture(meta.id).then((r) => {
      setRec(r);
      setUrl((u = URL.createObjectURL(r.blob)));
    });
    return () => u && URL.revokeObjectURL(u);
  }, [meta.id]);
  useEffect(() => {
    const v = vid.current;
    if (!v) return undefined;
    const t = () => v.currentTime > range[1] && (v.currentTime = range[0]);
    v.addEventListener('timeupdate', t);
    return () => v.removeEventListener('timeupdate', t);
  }, [range, url]);

  const onMeta = (e) => {
    const d = Number.isFinite(e.target.duration) ? e.target.duration : meta.duration || 30;
    setDur(d);
    setRange([Math.min(meta.trimStart || 0, d), d]);
    e.target.currentTime = Math.min(meta.trimStart || 0, d);
  };
  const exportIt = async () => {
    try {
      setProgress(0);
      const blob = meta.kind === 'video' ? await renderVideo(url, { start: range[0], end: range[1], crop, filter }, setProgress) : await renderImage(url, { crop, filter });
      const saved = await saveCapture({ blob, kind: meta.kind, name: `${meta.name} (bearbeitet)`, duration: meta.kind === 'video' ? range[1] - range[0] : undefined, source: meta.source });
      haptic('success');
      toast({ title: 'Bearbeitung gespeichert', kind: 'success' });
      onDone(saved);
    } catch (e) {
      toast({ title: 'Export fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setProgress(null);
    }
  };
  const ratio = CROPS[crop].r;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring.soft} className="flex h-full gap-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl bg-black">
          {url && meta.kind === 'video' && <video ref={vid} src={url} autoPlay loop muted onLoadedMetadata={onMeta} className="max-h-full max-w-full" style={{ filter: FILTERS[filter].css }} />}
          {url && meta.kind === 'image' && <img src={url} alt="" className="max-h-full max-w-full" style={{ filter: FILTERS[filter].css }} />}
          {ratio && <div className="pointer-events-none absolute inset-y-0 border-x-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" style={ratio >= 1 ? { aspectRatio: String(ratio), height: '100%' } : { aspectRatio: String(ratio), height: '100%' }} />}
        </div>
        {meta.kind === 'video' && (
          <div className="glass mt-3 rounded-2xl p-4">
            <div className="mb-2 flex items-center gap-2 text-[0.85rem]"><Scissors className="h-4 w-4" /> Schneiden <span className="ml-auto tabular-nums text-mist-400">{range[0].toFixed(1)} s – {range[1].toFixed(1)} s · {(range[1] - range[0]).toFixed(1)} s</span></div>
            <div className="grid grid-cols-2 gap-4">
              <Slider label="Start" value={range[0]} min={0} max={Math.max(0.1, dur)} step={0.1} detents={20} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => (setRange([Math.min(x, range[1] - 0.5), range[1]]), vid.current && (vid.current.currentTime = x))} />
              <Slider label="Ende" value={range[1]} min={0} max={Math.max(0.1, dur)} step={0.1} detents={20} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => setRange([range[0], Math.max(x, range[0] + 0.5)])} />
            </div>
          </div>
        )}
      </div>
      <div className="glass w-[20rem] shrink-0 space-y-5 overflow-y-auto rounded-3xl p-5">
        <div>
          <div className="label mb-2">Zuschnitt</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CROPS).map(([k, x]) => (
              <Button key={k} size="sm" variant={crop === k ? 'primary' : 'subtle'} onClick={() => setCrop(k)}>{x.label}</Button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2 flex items-center gap-1.5"><Wand2 className="h-3.5 w-3.5" /> Filter</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FILTERS).map(([k, x]) => (
              <Button key={k} size="sm" variant={filter === k ? 'primary' : 'subtle'} onClick={() => setFilter(k)}>{x.label}</Button>
            ))}
          </div>
        </div>
        {progress != null ? (
          <div>
            <div className="mb-2 text-[0.85rem]">Wird gerendert … {Math.round(progress * 100)}%</div>
            <Progress value={progress * 100} />
          </div>
        ) : (
          <div className="space-y-2">
            <Button variant="primary" icon={Save} className="w-full" onClick={exportIt} disabled={!url}>Als neue Aufnahme sichern</Button>
            <Button variant="subtle" icon={Share2} className="w-full" onClick={() => setShare(true)}>Original teilen</Button>
            <Button variant="subtle" icon={Download} className="w-full" onClick={() => rec && downloadBlob(rec.blob, `${meta.name}.${meta.kind === 'video' ? 'webm' : 'png'}`)}>Exportieren</Button>
            <Button variant="ghost" className="w-full" onClick={() => onDone()}>Zurück zur Galerie</Button>
          </div>
        )}
      </div>
      <ShareSheet capture={meta} open={share} onClose={() => setShare(false)} />
    </motion.div>
  );
}

export default function CapturesApp({ edit }) {
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(null);
  const [del, setDel] = useState(null);
  const load = () => listCaptures().then((l) => {
    setItems(l);
    if (edit && !sel) setSel(l.find((x) => x.id === edit) || null);
  });
  useEffect(() => {
    load();
    const fn = () => load();
    window.addEventListener('lumos:capture-saved', fn);
    return () => window.removeEventListener('lumos:capture-saved', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      title="Aufnahmen"
      icon={Clapperboard}
      noPad
      subtitle={`${items.length} Clips & Screenshots · Puffer ${replay.active ? 'aktiv (letzte 30 s)' : 'inaktiv'}`}
      actions={
        !sel && (
          <>
            {!replay.active && <Button size="sm" variant="subtle" icon={MonitorUp} onClick={() => enableScreenCapture().then(() => toast({ title: 'Bildschirmaufnahme aktiv', body: 'Die letzten 30 s werden gepuffert', kind: 'success' }), (e) => toast({ title: 'Nicht erlaubt', body: e.message, kind: 'error' }))}>Bildschirmaufnahme aktivieren</Button>}
            <Button size="sm" variant="subtle" icon={Camera} onClick={takeScreenshot}>Screenshot</Button>
            <Button size="sm" variant="primary" icon={Film} onClick={saveClip}>Letzte 30 s speichern</Button>
          </>
        )
      }
      hints={<><Hint k="a">Öffnen</Hint><Hint k="b">Zurück</Hint></>}
    >
      <div className="h-full px-10 pb-14">
        <AnimatePresence mode="wait">
          {sel ? (
            <Editor key={sel.id} meta={sel} onDone={(n) => (setSel(n || null), load())} />
          ) : (
            <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-4 gap-4">
              {!items.length && <div className="col-span-4 py-20 text-center text-mist-400">Noch keine Aufnahmen. Starte „Lumos Orbit“ und speichere mit F10 oder im Schnellzugriff einen Clip.</div>}
              {items.map((c) => (
                <motion.div key={c.id} layout className="glass overflow-hidden rounded-3xl">
                  <button data-nav="" onClick={() => setSel(c)} className="nav-focus block w-full text-left">
                    {c.thumb ? <img src={c.thumb} alt="" className="aspect-video w-full object-cover" /> : <div className="aspect-video bg-white/10" />}
                    <div className="flex items-center gap-2 p-3 text-[0.8rem]">
                      {c.kind === 'video' ? <Film className="h-4 w-4 text-lumen" /> : <ImageIcon className="h-4 w-4 text-lumen" />}
                      <span className="truncate">{c.source}</span>
                      <span className="ml-auto shrink-0 text-mist-500">{c.duration ? `${Math.round(Math.min(c.duration, 30))} s` : new Date(c.t).toLocaleDateString('de-DE')}</span>
                    </div>
                  </button>
                  <div className="flex justify-end px-2 pb-2">
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(c)} aria-label="Löschen" />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Sheet open={!!del} onClose={() => setDel(null)} title="Aufnahme löschen?">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDel(null)}>Abbrechen</Button>
          <Button variant="danger" autoFocus onClick={async () => (await deleteCapture(del.id), setDel(null), load(), haptic('close'))}>Löschen</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
