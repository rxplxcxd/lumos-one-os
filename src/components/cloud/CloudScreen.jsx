// Lumos Cloud: account, sync status, cloud saves (backup/restore), purchased content, devices.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, CloudUpload, CloudDownload, RefreshCw, LogOut, HardDrive, ShoppingBag, MonitorSmartphone, Trash2, CheckCircle2, CloudOff } from 'lucide-react';
import { Screen, Hint, Button, TextField, Segmented, ListGroup, ListRow } from '@/components/ui/primitives.jsx';
import { useCloud, signIn, signUp, signOut, syncNow, syncSave, restoreSave, deleteCloudSave, deviceId, diffSave, resolveConflict } from '@/services/cloud/cloudService.js';
import { Sheet } from '@/components/ui/primitives.jsx';
import { GitCompare, Laptop, CloudCog } from 'lucide-react';
import { request } from '@/services/bridge.js';
import { formatBytes } from '@/services/flathub.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';
import { offerSave } from '@/components/shell/AutofillBar.jsx';

function Login() {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'in') await signIn({ email, password: pw });
      else await signUp({ email, password: pw, displayName: name });
      haptic('success');
      offerSave('lumos-cloud', email, pw);
    } catch (e) {
      haptic('error');
      toast({ title: mode === 'in' ? 'Anmeldung fehlgeschlagen' : 'Registrierung fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="mx-auto mt-4 w-[30rem]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-gradient-to-b from-lumen-400/30 to-lumen-600/10 ring-1 ring-white/10"><Cloud className="h-10 w-10" strokeWidth={1.5} /></div>
        <h2 className="text-2xl font-semibold tracking-tight">Lumos Cloud</h2>
        <p className="mt-1 text-[0.85rem] text-mist-400">Profile, Spielstände, gekaufte Inhalte und Einstellungen – auf allen deinen Geräten.</p>
      </div>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'in', label: 'Anmelden' }, { value: 'up', label: 'Konto erstellen' }]} className="mb-4" />
      <div className="space-y-3">
        {mode === 'up' && <TextField value={name} onChange={setName} placeholder="Anzeigename" />}
        <TextField autoFocus type="email" value={email} onChange={setEmail} placeholder="E-Mail" data-autofill="lumos-cloud" data-autofill-role="user" />
        <TextField type="password" value={pw} onChange={setPw} placeholder="Passwort (min. 8 Zeichen)" onEnter={submit} data-autofill="lumos-cloud" data-autofill-role="password" />
        <Button variant="primary" className="w-full" onClick={submit} disabled={busy}>{busy ? 'Bitte warten …' : mode === 'in' ? 'Anmelden' : 'Konto erstellen'}</Button>
      </div>
    </motion.div>
  );
}


const CHANGE = { changed: ['Geändert', 'text-warn'], 'local-only': ['Nur lokal', 'text-lumen-400'], 'cloud-only': ['Nur Cloud', 'text-ok'], same: ['Gleich', 'text-mist-500'] };

function ConflictSheet({ id, onClose }) {
  const c = useCloud((s) => s.conflicts[id]);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id) diffSave(id).then(setRows, () => setRows([]));
  }, [id]);
  if (!c) return null;
  const choose = async (keep) => {
    setBusy(true);
    try {
      await resolveConflict(id, keep);
      haptic('success');
      toast({ title: keep === 'local' ? 'Lokaler Stand hochgeladen' : 'Cloud-Stand wiederhergestellt', kind: 'success' });
      onClose();
    } catch (e) {
      toast({ title: 'Fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const Side = ({ icon: I, title, when, size, extra, newer }) => (
    <div className={`flex-1 rounded-2xl p-4 ${newer ? 'bg-lumen/10 ring-1 ring-lumen/40' : 'bg-white/[0.05]'}`}>
      <div className="flex items-center gap-2 font-semibold"><I className="h-4 w-4" /> {title} {newer && <span className="ml-auto rounded-full bg-lumen/30 px-2 py-0.5 text-[0.65rem]">neuer</span>}</div>
      <div className="mt-2 text-[0.82rem]">{new Date(when).toLocaleString('de-DE')}</div>
      <div className="text-[0.75rem] text-mist-400">{formatBytes(size)}{extra ? ` · ${extra}` : ''}</div>
    </div>
  );
  const localNewer = c.local.mtime > c.remote.updatedAt;
  return (
    <Sheet open={!!id} onClose={onClose} title={c.kind === 'conflict' ? `Konflikt: ${c.local.title}` : `Neuerer Cloud-Stand: ${c.local.title}`} className="w-[52rem]">
      <div className="flex gap-3">
        <Side icon={Laptop} title="Dieses Gerät" when={c.local.mtime} size={c.local.size} extra={`${c.local.files ?? '?'} Dateien`} newer={localNewer} />
        <div className="flex items-center"><GitCompare className="h-5 w-5 text-mist-400" /></div>
        <Side icon={CloudCog} title="Lumos Cloud" when={c.remote.updatedAt} size={c.remote.size} extra={`v${c.remote.version}${c.remote.device === deviceId() ? ' · dieses Gerät' : ' · anderes Gerät'}`} newer={!localNewer} />
      </div>
      <div className="mt-4 max-h-[14rem] overflow-y-auto rounded-2xl bg-black/30 p-2 font-mono text-[0.72rem]">
        {!rows && <div className="p-3 text-mist-500">Vergleiche Dateien …</div>}
        {rows?.length === 0 && <div className="p-3 text-mist-500">Keine Dateiliste in der Cloud (älterer Upload) – Vergleich nur nach Datum möglich.</div>}
        {rows?.map((r) => (
          <div key={r.path} className="grid grid-cols-[6rem_1fr_6rem_6rem] gap-2 px-2 py-1">
            <span className={CHANGE[r.change][1]}>{CHANGE[r.change][0]}</span>
            <span className="truncate">{r.path}</span>
            <span className="text-right text-mist-400">{r.local ? formatBytes(r.local.size) : '—'}</span>
            <span className="text-right text-mist-400">{r.remote ? formatBytes(r.remote.size) : '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Später</Button>
        <Button variant="subtle" icon={CloudDownload} disabled={busy} onClick={() => choose('cloud')}>Cloud-Stand laden</Button>
        <Button variant="primary" icon={CloudUpload} disabled={busy} autoFocus onClick={() => choose('local')}>Diesen Stand behalten</Button>
      </div>
    </Sheet>
  );
}

function SyncBadge({ status, lastSync, pending, error }) {
  const map = {
    idle: [CheckCircle2, 'text-ok', 'Alles synchronisiert'],
    syncing: [RefreshCw, 'text-lumen-400 animate-spin', 'Synchronisiere …'],
    offline: [CloudOff, 'text-warn', 'Offline – Änderungen werden lokal gespeichert'],
    error: [CloudOff, 'text-bad', error || 'Fehler'],
  };
  const [I, cls, label] = map[status] || map.idle;
  return (
    <div className="glass flex items-center gap-4 rounded-3xl p-5">
      <I className={`h-8 w-8 ${cls}`} />
      <div className="flex-1">
        <div className="text-[0.95rem] font-semibold">{label}</div>
        <div className="text-[0.75rem] text-mist-400">{lastSync ? `Zuletzt ${new Date(lastSync).toLocaleString('de-DE')}` : 'Noch nicht synchronisiert'}{pending ? ` · ${pending} ausstehend` : ''}</div>
      </div>
      <Button variant="subtle" icon={RefreshCw} onClick={() => syncNow().catch(() => {})}>Jetzt synchronisieren</Button>
    </div>
  );
}

export default function CloudScreen({ conflict }) {
  const c = useCloud();
  const [openConflict, setOpenConflict] = useState(conflict || null);
  const [local, setLocal] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (c.user) request('saves.list').then(setLocal, () => setLocal([]));
  }, [c.user]);

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      await fn();
      haptic('success');
      toast({ title: okMsg, kind: 'success' });
    } catch (e) {
      haptic('error');
      toast({ title: 'Fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Lumos Cloud" icon={Cloud} subtitle={c.user ? `${c.user.email} · ${c.provider}` : undefined} actions={c.user && <Button size="sm" variant="subtle" icon={LogOut} onClick={signOut}>Abmelden</Button>} hints={<><Hint k="a">Auswählen</Hint><Hint k="b">Zurück</Hint></>}>
      {!c.user ? (
        <Login />
      ) : (
        <div className="mx-auto max-w-[56rem] space-y-6">
          <SyncBadge {...c} />
          {Object.keys(c.conflicts).length > 0 && (
            <div className="glass flex items-center gap-3 rounded-3xl p-4 ring-1 ring-warn/40">
              <GitCompare className="h-6 w-6 text-warn" />
              <div className="flex-1 text-[0.88rem]">{Object.keys(c.conflicts).length} Spielstand-Konflikt(e) – lokal und Cloud wurden beide geändert.</div>
              <Button size="sm" variant="primary" onClick={() => setOpenConflict(Object.keys(c.conflicts)[0])}>Vergleichen</Button>
            </div>
          )}
          <ListGroup title="Spielstände auf diesem Gerät" footer="Archive werden vom Daemon gepackt (tar.gz), per SHA-256 geprüft und versioniert hochgeladen.">
            {local.length === 0 && <ListRow label="Keine Spielstand-Ordner gefunden" />}
            {local.map((s) => {
              const remote = c.saves.find((r) => r.id === s.id);
              const inSync = remote && remote.sha256 === s.hash;
              return (
                <ListRow
                  key={s.id}
                  icon={HardDrive}
                  iconBg="bg-[#4a90d9]"
                  label={s.title}
                  sub={`${formatBytes(s.size)} · geändert ${new Date(s.mtime).toLocaleString('de-DE')}${remote ? ` · Cloud v${remote.version ?? '?'}` : ''}`}
                  chevron={false}
                  right={
                    <span className="flex items-center gap-2">
                      {inSync && <CheckCircle2 className="h-4 w-4 text-ok" />}
                      {c.conflicts[s.id] && <Button size="sm" variant="danger" icon={GitCompare} onClick={() => setOpenConflict(s.id)}>Konflikt</Button>}
                      <Button
                        size="sm"
                        variant="subtle"
                        icon={CloudUpload}
                        disabled={busy === s.id}
                        onClick={() =>
                          run(s.id, async () => {
                            const r = await syncSave(s);
                            if (r.status === 'conflict' || r.status === 'cloud-newer') setOpenConflict(s.id);
                          }, `${s.title} synchronisiert`)
                        }
                      >
                        {busy === s.id ? '…' : 'Sync'}
                      </Button>
                    </span>
                  }
                />
              );
            })}
          </ListGroup>
          <ListGroup title={`In der Cloud · ${c.saves.length}`}>
            {c.saves.length === 0 && <ListRow label="Noch keine Cloud-Spielstände" />}
            {c.saves.map((s) => (
              <ListRow
                key={s.id}
                icon={Cloud}
                iconBg="bg-[#4a90d9]"
                label={s.title}
                sub={`${formatBytes(s.size)} · ${new Date(s.updatedAt).toLocaleString('de-DE')}${s.device === deviceId() ? ' · dieses Gerät' : ''}`}
                chevron={false}
                right={
                  <span className="flex gap-2">
                    <Button size="sm" variant="subtle" icon={CloudDownload} onClick={() => run(`r${s.id}`, () => restoreSave(s.id), `${s.title} wiederhergestellt`)}>Wiederherstellen</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run(`d${s.id}`, () => deleteCloudSave(s.id), 'Gelöscht')} />
                  </span>
                }
              />
            ))}
          </ListGroup>
          <div className="grid grid-cols-2 gap-6">
            <ListGroup title="Gekaufte Inhalte">
              {c.entitlements.length === 0 && <ListRow icon={ShoppingBag} iconBg="bg-[#7c6bb0]" label="Keine Käufe" />}
              {c.entitlements.map((e) => (
                <ListRow key={e.sku} icon={ShoppingBag} iconBg="bg-[#7c6bb0]" label={e.title} sub={`${e.kind} · ${new Date(e.grantedAt).toLocaleDateString('de-DE')}`} />
              ))}
            </ListGroup>
            <ListGroup title="Geräte">
              {c.devices.map((d) => (
                <ListRow key={d.device_id || d.deviceId} icon={MonitorSmartphone} iconBg="bg-[#6b7280]" label={d.name} sub={`${d.model} · ${(d.device_id || d.deviceId) === deviceId() ? 'dieses Gerät' : `zuletzt ${new Date(d.last_seen || d.lastSeen).toLocaleDateString('de-DE')}`}`} />
              ))}
            </ListGroup>
          </div>
        </div>
      )}
      {openConflict && c.conflicts[openConflict] && <ConflictSheet id={openConflict} onClose={() => setOpenConflict(null)} />}
    </Screen>
  );
}
