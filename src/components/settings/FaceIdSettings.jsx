// iOS-style "Face ID & Code": enrol / re-scan / delete faces, choose where Face ID is used,
// attention awareness, keychain PIN fallback. Backed by Howdy via lumosd.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Lock, KeyRound, ShoppingBag, Eye, Plus, RotateCcw, Trash2, Camera } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, Button, Sheet, TextField } from '@/components/ui/primitives.jsx';
import { EnrollRing } from '@/components/faceid/FaceIDGlyph.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { request, on } from '@/services/bridge.js';
import { verifyFace } from '@/services/faceid.js';
import { keychain } from '@/services/keychain.js';
import { haptic } from '@/services/haptics.js';
import { toast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

function EnrollSheet({ open, label, replaceId, onClose, onDone }) {
  const [phase, setPhase] = useState('intro'); // intro | scanning | done | error
  const [progress, setProgress] = useState(0);
  const [angle, setAngle] = useState(0);
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setPhase('intro');
    setProgress(0);
    setFrame(null);
    setError(null);
    const offs = [
      on('faceid.state', (d) => {
        if (d.state === 'enrolling') {
          setProgress(d.progress ?? 0);
          if (d.angle != null) setAngle(d.angle);
          if ((d.progress ?? 0) > 0 && Math.round((d.progress ?? 0) * 100) % 8 === 0) haptic('faceid.scan');
        }
      }),
      on('faceid.frame', (f) => setFrame(`data:image/jpeg;base64,${f.jpeg}`)),
    ];
    request('faceid.preview', { on: true }).catch(() => {});
    return () => {
      offs.forEach((f) => f());
      request('faceid.preview', { on: false }).catch(() => {});
    };
  }, [open]);

  const start = async () => {
    setPhase('scanning');
    try {
      if (replaceId != null) await request('faceid.remove', { id: replaceId });
      await request('faceid.enroll', { label }, 90000);
      setPhase('done');
      haptic('faceid.success');
      onDone?.();
    } catch (e) {
      setError(e.message);
      setPhase('error');
      haptic('faceid.fail');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} className="w-[40rem]">
      <div className="flex flex-col items-center text-center">
        <EnrollRing progress={progress} angle={angle} frame={frame} done={phase === 'done'} size="17rem" />
        <AnimatePresence mode="wait">
          <motion.div key={phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.soft} className="mt-5">
            {phase === 'intro' && (
              <>
                <h3 className="text-xl font-semibold">So richtest du Face ID ein</h3>
                <p className="mx-auto mt-2 max-w-[28rem] text-[0.85rem] text-mist-300">Halte das Gerät auf Augenhöhe und bewege deinen Kopf langsam im Kreis, bis der Ring vollständig ist. Die IR-Kamera funktioniert auch im Dunkeln.</p>
                <Button className="mt-5" variant="primary" autoFocus onClick={start}>Los geht&apos;s</Button>
              </>
            )}
            {phase === 'scanning' && (
              <>
                <h3 className="text-xl font-semibold">Kopf langsam bewegen …</h3>
                <p className="mt-2 text-[0.85rem] tabular-nums text-mist-300">{Math.round(progress * 100)}%</p>
              </>
            )}
            {phase === 'done' && (
              <>
                <h3 className="text-xl font-semibold">Face ID ist eingerichtet</h3>
                <p className="mt-2 text-[0.85rem] text-mist-300">Du kannst Face ID jetzt zum Entsperren, für Passwörter und den Store verwenden.</p>
                <Button className="mt-5" variant="primary" autoFocus onClick={onClose}>Fertig</Button>
              </>
            )}
            {phase === 'error' && (
              <>
                <h3 className="text-xl font-semibold text-bad">Einrichtung fehlgeschlagen</h3>
                <p className="mt-2 text-[0.85rem] text-mist-300">{error}</p>
                <div className="mt-5 flex justify-center gap-2">
                  <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                  <Button variant="primary" autoFocus onClick={start}>Erneut versuchen</Button>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

export default function FaceIdSettings() {
  const v = useSettings((s) => s.values);
  const [status, setStatus] = useState(null);
  const [enroll, setEnroll] = useState(null);
  const [kc, setKc] = useState(null);
  const [pinSheet, setPinSheet] = useState(false);
  const [pin, setPin] = useState('');
  const refresh = () => request('faceid.status').then(setStatus, (e) => setStatus({ available: false, error: e.message, models: [] }));
  useEffect(() => {
    refresh();
    keychain().status().then(setKc, () => {});
  }, []);

  const guarded = async (fn, reason) => {
    const r = await verifyFace(reason);
    if (r.ok) await fn();
  };

  const models = status?.models || [];
  return (
    <>
      <div className="glass mb-6 flex items-center gap-5 rounded-3xl p-5">
        <ScanFace className="h-12 w-12 text-ok" strokeWidth={1.5} />
        <div className="flex-1 text-[0.82rem] text-mist-300">
          {status?.available ? (
            <>IR-Kamera <span className="text-mist-50">{status.device}</span> · Backend <span className="text-mist-50">{status.backend}</span>{status.ir_emitter ? ' · IR-Emitter aktiv' : ''}</>
          ) : (
            <>Face ID ist nicht verfügbar{status?.error ? `: ${status.error}` : ''}. Prüfe Howdy (`howdy test`) und die IR-Kamera.</>
          )}
        </div>
        <Button size="sm" variant="subtle" icon={Camera} onClick={() => request('faceid.test', {}, 20000).then((r) => toast({ title: r.ok ? 'Kamera OK' : 'Kamerafehler', body: r.detail, kind: r.ok ? 'success' : 'error' }), (e) => toast({ title: e.message, kind: 'error' }))}>Kamera testen</Button>
      </div>

      <ListGroup title="Face ID verwenden für">
        <ToggleRow icon={Lock} iconBg="bg-[#3fa66b]" label="Lumos One entsperren" checked={v.faceIdUnlock} onChange={(x) => setSetting('faceIdUnlock', x)} />
        <ToggleRow icon={KeyRound} iconBg="bg-[#3fa66b]" label="Passwörter & automatisches Ausfüllen" checked={v.faceIdKeychain} onChange={(x) => setSetting('faceIdKeychain', x)} />
        <ToggleRow icon={ShoppingBag} iconBg="bg-[#3fa66b]" label="Store-Installationen bestätigen" checked={v.faceIdStore} onChange={(x) => setSetting('faceIdStore', x)} />
      </ListGroup>

      <ListGroup title="Gesichter" footer="Howdy speichert Gesichtsmodelle lokal unter /etc/howdy/models — sie verlassen das Gerät nie.">
        {models.map((m) => (
          <ListRow
            key={m.id}
            icon={ScanFace}
            iconBg="bg-[#3fa66b]"
            label={m.label}
            sub={m.created ? `Hinzugefügt am ${new Date(m.created).toLocaleDateString('de-DE')}` : undefined}
            chevron={false}
            right={
              <span className="flex gap-2">
                <Button size="sm" variant="subtle" icon={RotateCcw} onClick={() => guarded(async () => setEnroll({ label: m.label, replaceId: m.id }), 'Erneut scannen bestätigen')}>Neu scannen</Button>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => guarded(async () => (await request('faceid.remove', { id: m.id }), refresh(), haptic('success')), 'Gesicht löschen bestätigen')} />
              </span>
            }
          />
        ))}
        <ListRow icon={Plus} iconBg="bg-[#3fa66b]" label={models.length ? 'Alternatives Erscheinungsbild konfigurieren' : 'Face ID konfigurieren'} onClick={() => setEnroll({ label: models.length ? `Erscheinungsbild ${models.length + 1}` : 'Primäres Gesicht' })} />
      </ListGroup>

      <ListGroup title="Aufmerksamkeit">
        <ToggleRow icon={Eye} iconBg="bg-[#3fa66b]" label="Aufmerksamkeit für Face ID erforderlich" sub="Augen müssen geöffnet und auf das Display gerichtet sein" checked={v.faceIdAttention} onChange={(x) => setSetting('faceIdAttention', x)} />
      </ListGroup>

      <ListGroup title="Code" footer="Der Code entsperrt den Schlüsselbund, wenn Face ID nicht verfügbar ist.">
        <ListRow icon={KeyRound} iconBg="bg-[#6b7280]" label={kc?.hasPin ? 'Code ändern' : 'Code festlegen'} onClick={() => setPinSheet(true)} />
        {models.length > 0 && <ListRow label="Face ID zurücksetzen" danger onClick={() => guarded(async () => (await request('faceid.clear'), refresh(), toast({ title: 'Face ID zurückgesetzt', kind: 'success' })), 'Face ID zurücksetzen')} />}
      </ListGroup>

      <EnrollSheet open={!!enroll} label={enroll?.label} replaceId={enroll?.replaceId} onClose={() => (setEnroll(null), refresh())} onDone={refresh} />
      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title="Code für den Schlüsselbund">
        <TextField autoFocus type="password" inputMode="numeric" value={pin} onChange={(x) => setPin(x.replace(/\D/g, '').slice(0, 8))} placeholder="4–8 Ziffern" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPinSheet(false)}>Abbrechen</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (pin.length < 4) return toast({ title: 'Mindestens 4 Ziffern', kind: 'error' });
              try {
                await keychain().unlock({ reason: 'Code festlegen' });
                setKc(await keychain().setPin(pin));
                setPinSheet(false);
                setPin('');
                toast({ title: 'Code gespeichert', kind: 'success' });
              } catch (e) {
                toast({ title: e.message, kind: 'error' });
              }
            }}
          >
            Speichern
          </Button>
        </div>
      </Sheet>
    </>
  );
}
