// Lumos Passwörter — Face-ID-gated password manager with generator, TOTP and autofill source.
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, Lock, Plus, Search, Copy, Eye, EyeOff, Trash2, Wand2, Globe, ShieldCheck, Timer } from 'lucide-react';
import { Screen, Hint, Button, TextField, Sheet, ListRow } from '@/components/ui/primitives.jsx';
import FaceIDGlyph from '@/components/faceid/FaceIDGlyph.jsx';
import { keychain } from '@/services/keychain.js';
import { useUI, toast } from '@/store/ui.js';
import { useAction } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const STRENGTH = ['Sehr schwach', 'Schwach', 'Okay', 'Stark', 'Sehr stark'];
const STRENGTH_C = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-ok', 'bg-ok'];

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    haptic('success');
    toast({ title: `${label} kopiert`, body: 'Wird in 60 s aus der Zwischenablage gelöscht', kind: 'success', duration: 2200 });
    setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 60000);
  } catch {
    toast({ title: 'Zwischenablage nicht verfügbar', kind: 'error' });
  }
}

function Editor({ entry, onClose, onSaved }) {
  const [e, setE] = useState(entry);
  const [show, setShow] = useState(!entry.id);
  const save = async () => {
    try {
      await keychain().upsert(e);
      haptic('success');
      onSaved();
    } catch (err) {
      toast({ title: err.message, kind: 'error' });
    }
  };
  const gen = async () => setE({ ...e, password: await keychain().generate({ length: 20 }) });
  return (
    <Sheet open onClose={onClose} title={entry.id ? 'Eintrag bearbeiten' : 'Neues Passwort'} className="w-[40rem]">
      <div className="space-y-3">
        <TextField autoFocus value={e.title || ''} onChange={(x) => setE({ ...e, title: x })} placeholder="Titel" />
        <TextField value={e.origin || ''} onChange={(x) => setE({ ...e, origin: x })} placeholder="Website (z. B. github.com)" />
        <TextField value={e.username || ''} onChange={(x) => setE({ ...e, username: x })} placeholder="Benutzername / E-Mail" />
        <div className="flex gap-2">
          <TextField type={show ? 'text' : 'password'} value={e.password || ''} onChange={(x) => setE({ ...e, password: x })} placeholder="Passwort" />
          <Button variant="subtle" icon={show ? EyeOff : Eye} onClick={() => setShow(!show)} />
          <Button variant="subtle" icon={Wand2} onClick={gen}>Generieren</Button>
        </div>
        <TextField value={e.totp || ''} onChange={(x) => setE({ ...e, totp: x })} placeholder="2FA-Geheimnis (Base32, optional)" />
        <TextField multiline value={e.notes || ''} onChange={(x) => setE({ ...e, notes: x })} placeholder="Notizen" className="h-20 resize-none" />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" onClick={save}>Sichern</Button>
      </div>
    </Sheet>
  );
}

function Detail({ id, onEdit, onDeleted }) {
  const [e, setE] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [totp, setTotp] = useState(null);
  useEffect(() => {
    setReveal(false);
    keychain().get(id).then(setE, () => setE(null));
  }, [id]);
  useEffect(() => {
    if (!e?.totp) return setTotp(null);
    const tick = () => keychain().totp(id).then(setTotp, () => setTotp(null));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [e, id]);
  if (!e) return null;
  return (
    <motion.div key={id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={spring.soft}>
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-xl font-semibold">{(e.title || '?')[0].toUpperCase()}</div>
        <div className="min-w-0">
          <div className="truncate text-[1.4rem] font-semibold">{e.title}</div>
          <div className="flex items-center gap-1.5 text-[0.8rem] text-mist-400"><Globe className="h-3.5 w-3.5" />{e.origin || '—'}</div>
        </div>
      </div>
      <div className="glass overflow-hidden rounded-2xl">
        <ListRow label="Benutzername" sub={e.username || '—'} chevron={false} onClick={() => copy(e.username, 'Benutzername')} right={<Copy className="h-4 w-4 text-mist-400" />} />
        <ListRow label="Passwort" sub={<span className="font-mono tracking-wider">{reveal ? e.password : '••••••••••••'}</span>} chevron={false} onClick={() => copy(e.password, 'Passwort')} right={<span className="flex gap-2"><button data-nav="" onClick={(ev) => (ev.stopPropagation(), setReveal(!reveal))} className="nav-focus rounded-full p-1.5">{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><Copy className="h-4 w-4 text-mist-400" /></span>} />
        {totp && (
          <ListRow label="Bestätigungscode" sub={<span className="font-mono text-[1.1rem] tracking-[0.3em] text-mist-50">{totp.code.replace(/(\d{3})/, '$1 ')}</span>} chevron={false} onClick={() => copy(totp.code, 'Code')} right={<span className="flex items-center gap-1 text-[0.8rem] tabular-nums text-mist-400"><Timer className="h-4 w-4" />{totp.remaining}s</span>} />
        )}
        {e.notes && <ListRow label="Notizen" sub={e.notes} chevron={false} />}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="subtle" onClick={() => onEdit(e)}>Bearbeiten</Button>
        <Button variant="danger" icon={Trash2} onClick={async () => (await keychain().remove(id), haptic('close'), onDeleted())}>Löschen</Button>
      </div>
      <div className="mt-3 text-[0.72rem] text-mist-500">Geändert {new Date(e.updatedAt).toLocaleString('de-DE')}</div>
    </motion.div>
  );
}

export default function KeychainApp() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState('');
  const faceState = useUI((s) => s.faceSheet?.state);

  const load = async () => {
    const st = await keychain().status();
    setStatus(st);
    if (st.unlocked) {
      const l = await keychain().list();
      setItems(l);
      if (!sel && l[0]) setSel(l[0].id);
    }
  };
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlock = async (method = 'faceid') => {
    try {
      await keychain().unlock(method === 'pin' ? { method: 'pin', pin } : { method: 'faceid' });
      haptic('faceid.success');
      setPinMode(false);
      await load();
    } catch (e) {
      if (method === 'pin') haptic('faceid.fail');
      toast({ title: e.message, kind: 'error' });
    }
  };
  useAction((a) => a === 'x' && status?.unlocked && setEdit({}), [status]);

  const list = useMemo(() => items.filter((i) => !q || `${i.title} ${i.origin} ${i.username}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.title.localeCompare(b.title, 'de')), [items, q]);

  if (!status?.unlocked)
    return (
      <Screen title="Passwörter" icon={KeyRound}>
        <div className="flex h-full flex-col items-center justify-center gap-5 pb-10 text-center">
          <FaceIDGlyph state={faceState || 'idle'} size="5.5rem" />
          <div>
            <div className="text-xl font-semibold">Passwörter sind gesperrt</div>
            <div className="mt-1 text-[0.85rem] text-mist-400">Entsperre mit Face ID, um deine gespeicherten Passwörter zu sehen.</div>
          </div>
          {!pinMode ? (
            <div className="flex gap-2">
              <Button variant="primary" icon={Lock} autoFocus onClick={() => unlock()}>Mit Face ID entsperren</Button>
              {status?.hasPin && <Button variant="subtle" onClick={() => setPinMode(true)}>Code verwenden</Button>}
            </div>
          ) : (
            <div className="flex w-[22rem] gap-2">
              <TextField autoFocus type="password" inputMode="numeric" value={pin} onChange={setPin} placeholder="Code" onEnter={() => unlock('pin')} />
              <Button variant="primary" onClick={() => unlock('pin')}>OK</Button>
            </div>
          )}
          <div className="mt-6 flex items-center gap-2 text-[0.72rem] text-mist-500"><ShieldCheck className="h-4 w-4" /> AES-256-GCM · Schlüssel im Systemschlüsselbund ({status?.backend || '—'})</div>
        </div>
      </Screen>
    );

  return (
    <Screen
      title="Passwörter"
      icon={KeyRound}
      noPad
      subtitle={`${items.length} Einträge`}
      actions={
        <>
          <Button size="sm" variant="subtle" icon={Lock} onClick={async () => (setStatus(await keychain().lock()), setItems([]))}>Sperren</Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setEdit({})}>Neu</Button>
        </>
      }
      hints={<><Hint k="x">Neu</Hint><Hint k="a">Kopieren</Hint><Hint k="b">Zurück</Hint></>}
    >
      <div className="flex h-full gap-5 px-10 pb-14">
        <aside className="flex w-[22rem] shrink-0 flex-col">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <TextField value={q} onChange={setQ} placeholder="Suchen" className="pl-10" />
          </div>
          <div className="glass flex-1 overflow-y-auto rounded-3xl p-2">
            {list.length === 0 && <div className="p-6 text-center text-[0.85rem] text-mist-500">Noch keine Passwörter</div>}
            {list.map((i) => (
              <button key={i.id} data-nav="" onFocus={() => setSel(i.id)} onClick={() => setSel(i.id)} className={`row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${sel === i.id ? 'bg-white/[0.08]' : ''}`}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 font-semibold">{(i.title || '?')[0].toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem] font-medium">{i.title}</span>
                  <span className="block truncate text-[0.72rem] text-mist-400">{i.username}</span>
                </span>
                <span className={`h-1.5 w-6 rounded-full ${STRENGTH_C[i.strength ?? 0]}`} title={STRENGTH[i.strength ?? 0]} />
              </button>
            ))}
          </div>
        </aside>
        <section className="glass min-w-0 flex-1 overflow-y-auto rounded-3xl p-6">
          <AnimatePresence mode="wait">{sel ? <Detail key={sel} id={sel} onEdit={setEdit} onDeleted={() => (setSel(null), load())} /> : <div className="text-mist-400">Wähle einen Eintrag</div>}</AnimatePresence>
        </section>
      </div>
      {edit && <Editor entry={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load())} />}
    </Screen>
  );
}
