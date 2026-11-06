// Lumos Cloud: account, sync status, cloud saves (backup/restore), purchased content, devices.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, CloudUpload, CloudDownload, RefreshCw, LogOut, HardDrive, ShoppingBag, MonitorSmartphone, Trash2, CheckCircle2, CloudOff } from 'lucide-react';
import { Screen, Hint, Button, TextField, Segmented, ListGroup, ListRow } from '@/components/ui/primitives.jsx';
import { useCloud, signIn, signUp, signOut, syncNow, uploadSave, restoreSave, deleteCloudSave, deviceId } from '@/services/cloud/cloudService.js';
import { request } from '@/services/bridge.js';
import { formatBytes } from '@/services/flathub.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

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
        <TextField autoFocus type="email" value={email} onChange={setEmail} placeholder="E-Mail" />
        <TextField type="password" value={pw} onChange={setPw} placeholder="Passwort (min. 8 Zeichen)" onEnter={submit} />
        <Button variant="primary" className="w-full" onClick={submit} disabled={busy}>{busy ? 'Bitte warten …' : mode === 'in' ? 'Anmelden' : 'Konto erstellen'}</Button>
      </div>
    </motion.div>
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

export default function CloudScreen() {
  const c = useCloud();
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
                      <Button size="sm" variant="subtle" icon={CloudUpload} disabled={busy === s.id} onClick={() => run(s.id, () => uploadSave(s), `${s.title} gesichert`)}>{busy === s.id ? '…' : 'Sichern'}</Button>
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
    </Screen>
  );
}
