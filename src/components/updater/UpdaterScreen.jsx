// Lumos Sync & Update (on-device): OTA updates, USB ZIP updates, rollback, cleanup.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, Usb, RotateCcw, Sparkles, ShieldCheck, HardDrive, Trash2, Laptop } from 'lucide-react';
import { Screen, Hint, Button, Progress, ListGroup, ListRow, Sheet } from '@/components/ui/primitives.jsx';
import { request, on } from '@/services/bridge.js';
import { useSettings } from '@/store/settings.js';
import { formatBytes } from '@/services/flathub.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const STAGE = { download: 'Wird geladen', verify: 'Signatur & Prüfsummen prüfen', stage: 'Wird vorbereitet', apply: 'Wird installiert', cleanup: 'Aufräumen', done: 'Fertig' };

export default function UpdaterScreen() {
  const channel = useSettings((s) => s.values.updateChannel);
  const [st, setSt] = useState(null);
  const [checking, setChecking] = useState(false);
  const [prog, setProg] = useState(null);
  const [usb, setUsb] = useState([]);
  const [cleanup, setCleanup] = useState(null);
  const [pairing, setPairing] = useState(null);

  const refresh = () => request('update.status').then(setSt, () => {});
  useEffect(() => {
    refresh();
    request('update.usb_scan').then(setUsb, () => {});
    const offs = [
      on('update.progress', (p) => {
        setProg(p);
        if (p.stage === 'done') {
          haptic('success');
          refresh();
        }
      }),
      on('update.paired', (d) => {
        setPairing(null);
        haptic('success');
        toast({ title: 'PC gekoppelt', body: d?.name, kind: 'success' });
      }),
      on('update.uploaded', () => {
        haptic('notify');
        toast({ title: 'Updatepaket vom PC empfangen', kind: 'success' });
        request('update.usb_scan').then(setUsb, () => {});
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      const r = await request('update.check', { channel }, 30000);
      setSt((s) => ({ ...s, available: r }));
      if (!r) toast({ title: 'Lumos One ist auf dem neuesten Stand', kind: 'success' });
    } catch (e) {
      toast({ title: 'Updateprüfung fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setChecking(false);
    }
  };
  const step = (method, params) => request(method, params, 30 * 60e3).catch((e) => (haptic('error'), toast({ title: 'Update fehlgeschlagen', body: e.message, kind: 'error' }), setProg(null)));

  const avail = st?.available;
  return (
    <Screen title="Lumos Sync & Update" icon={RefreshCw} subtitle={`Version ${st?.current || '—'} · Kanal ${channel}`} hints={<><Hint k="a">Auswählen</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="mx-auto max-w-[50rem] space-y-6">
        <motion.div layout className="glass rounded-[2rem] p-7" transition={spring.soft}>
          <AnimatePresence mode="wait">
            {avail ? (
              <motion.div key="avail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-lumen-500/20"><Sparkles className="h-8 w-8 text-lumen" /></div>
                  <div>
                    <div className="text-xl font-semibold">Lumos One {avail.version}</div>
                    <div className="text-[0.8rem] text-mist-400">{formatBytes(avail.size)} · {avail.channel}</div>
                  </div>
                </div>
                <pre className="mt-4 whitespace-pre-wrap font-sans text-[0.85rem] leading-relaxed text-mist-200">{avail.notes}</pre>
                {prog ? (
                  <div className="mt-5">
                    <div className="mb-2 flex text-[0.85rem]"><span>{STAGE[prog.stage] || prog.stage}</span><span className="ml-auto font-semibold tabular-nums">{Math.round(prog.percent)}%</span></div>
                    <Progress value={prog.percent} />
                  </div>
                ) : (
                  <div className="mt-5 flex gap-3">
                    {!st.staged ? <Button variant="primary" icon={Download} autoFocus onClick={() => step('update.download')}>Laden und installieren</Button> : <Button variant="primary" icon={ShieldCheck} autoFocus onClick={() => step('update.apply')}>Jetzt installieren</Button>}
                  </div>
                )}
                {st?.staged && prog?.stage === 'verify' && <Button className="mt-4" variant="primary" icon={ShieldCheck} onClick={() => (setProg(null), step('update.apply'))}>Jetzt installieren</Button>}
              </motion.div>
            ) : (
              <motion.div key="none" className="flex items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ShieldCheck className="h-10 w-10 text-ok" />
                <div className="flex-1">
                  <div className="text-lg font-semibold">Lumos One {st?.current || ''}</div>
                  <div className="text-[0.8rem] text-mist-400">{prog?.stage === 'done' ? 'Update installiert – Neustart erforderlich' : 'Dein System ist auf dem neuesten Stand.'}</div>
                </div>
                {prog?.stage === 'done' ? <Button variant="primary" onClick={() => request('system.power', { action: 'reboot' })}>Neu starten</Button> : <Button variant="subtle" icon={RefreshCw} autoFocus onClick={check}>{checking ? 'Prüfe …' : 'Nach Updates suchen'}</Button>}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <ListGroup title="Manuelles Update per USB" footer="Lege eine signierte lumos-update-*.zip auf einen USB-Stick oder übertrage sie mit der PC-App „Lumos Sync & Update“.">
          {usb.length === 0 && <ListRow icon={Usb} iconBg="bg-[#6b7280]" label="Kein Update-Paket gefunden" onClick={() => request('update.usb_scan').then(setUsb)} />}
          {usb.map((u) => (
            <ListRow key={u.path} icon={Usb} iconBg="bg-[#3b82c4]" label={u.name} sub={`${u.version || '?'} · ${formatBytes(u.size)}`} onClick={() => step('update.apply', { archive: u.path })} />
          ))}
        </ListGroup>

        <ListGroup title="Lumos Sync & Update (PC-App)" footer="Verbinde den Handheld per USB-C (USB-Netzwerk 10.55.0.1) oder WLAN und starte lumos_sync.py auf dem PC.">
          <ListRow icon={Laptop} iconBg="bg-[#3b82c4]" label="Mit PC koppeln" sub="Zeigt einen 6-stelligen Code für die PC-App" onClick={() => request('update.pair_start').then(setPairing, (e) => toast({ title: e.message, kind: 'error' }))} />
        </ListGroup>

        <ListGroup title="Wartung">
          <ListRow
            icon={Trash2}
            iconBg="bg-[#3f9c6d]"
            label="Speicher aufräumen"
            sub={cleanup ? `${formatBytes(cleanup.freed_bytes)} freigegeben` : 'Alte Releases, Installations-Caches, ungenutzte Flatpak-Runtimes'}
            onClick={() => request('update.cleanup', {}, 10 * 60e3).then((r) => (setCleanup(r), haptic('success')), (e) => toast({ title: e.message, kind: 'error' }))}
          />
          <ListRow icon={RotateCcw} iconBg="bg-[#c27b3a]" label="Auf vorherige Version zurücksetzen" sub={st?.previous ? `Version ${st.previous}` : 'Keine vorherige Version vorhanden'} onClick={() => st?.previous && request('update.rollback').then(() => toast({ title: 'Zurückgesetzt – Neustart erforderlich', kind: 'success' }))} />
          <ListRow icon={HardDrive} iconBg="bg-[#6b7280]" label="Installierte Releases" value={st?.releases?.length ?? '—'} />
        </ListGroup>
      </div>
      <Sheet open={!!pairing} onClose={() => setPairing(null)} title="Mit PC koppeln">
        <p className="text-[0.85rem] text-mist-300">Gib diesen Code in „Lumos Sync & Update“ auf deinem PC ein. Er ist 3 Minuten gültig.</p>
        <div className="my-6 text-center font-mono text-[3rem] font-semibold tracking-[0.4em]">{pairing?.code}</div>
        <p className="text-center text-[0.75rem] text-mist-500">Port {pairing?.port} · USB-Netzwerk 10.55.0.1 oder WLAN-IP des Geräts</p>
        <div className="mt-5 flex justify-end"><Button variant="primary" autoFocus onClick={() => setPairing(null)}>Fertig</Button></div>
      </Sheet>
    </Screen>
  );
}
