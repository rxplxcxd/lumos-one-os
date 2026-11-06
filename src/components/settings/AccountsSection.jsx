// Einstellungen → Konten & Verknüpfungen: LumosOS, Steam, Xbox, PlayStation, Nintendo.
// Tokens never stay in the UI: they go to lumosd, which stores them AES-256-GCM encrypted.
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Unlink, ExternalLink, Loader2, Info, AlertTriangle } from 'lucide-react';
import { ListGroup, ListRow, Sheet, TextField, Button } from '@/components/ui/primitives.jsx';
import { PlatformBadge } from '@/components/social/parts.jsx';
import { useHub, PLATFORMS, EXTERNAL, refreshAccounts, linkAccount, unlinkAccount, openLink } from '@/services/social/hub.js';
import { useCloud } from '@/services/cloud/cloudService.js';
import { request } from '@/services/bridge.js';
import { open as openScreen, toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';

const GUIDE = {
  steam: {
    title: 'Steam verknüpfen',
    intro: 'Steam nutzt die offizielle Web API. Du brauchst einen kostenlosen API-Schlüssel und dein Profil muss „Spieldetails“ und „Freundesliste“ öffentlich anzeigen.',
    link: ['API-Schlüssel erzeugen', 'https://steamcommunity.com/dev/apikey'],
    fields: [['key', 'Web-API-Schlüssel', 'password'], ['user', 'Profil-URL, Vanity-Name oder SteamID64', 'text']],
    note: 'Chat: Steam bietet keine öffentliche Chat-API – Nachrichten öffnen sich im Steam-Client. Freunde hinzufügen ebenfalls über den Client.',
  },
  psn: {
    title: 'PlayStation Network verknüpfen',
    intro: 'Sony hat keine offizielle API. Lumos nutzt dieselben Endpunkte wie die Open-Source-Bibliothek „psn-api“ mit deinem NPSSO-Token (gilt ~2 Monate).',
    link: ['NPSSO-Token abrufen (nach Anmeldung bei PlayStation)', 'https://ca.account.sony.com/api/v1/ssocookie'],
    fields: [['npsso', 'NPSSO-Token (64 Zeichen)', 'password']],
    note: 'Experimentell: Suche, Freunde und Präsenz. Nachrichten und Freundschaftsanfragen bietet die Plattform nicht an.',
  },
  nintendo: {
    title: 'Nintendo Switch Online verknüpfen',
    intro: 'Nintendo hat keine öffentliche API. Lumos spricht den lokalen HTTP-Server von „nxapi“ an (`nxapi nso http-server`), der sich mit deinem Nintendo-Konto anmeldet.',
    link: ['nxapi-Projekt', 'https://github.com/samuelthomas2774/nxapi'],
    fields: [['bridgeUrl', 'nxapi-Server (z. B. http://127.0.0.1:12345)', 'text'], ['token', 'Token (optional)', 'password']],
    note: 'Experimentell: Freunde & Präsenz (Spiel, Online-Status). Keine Suche per Name (nur Freundescode), keine Nachrichten.',
  },
};

function LinkSheet({ platform, onClose }) {
  const g = GUIDE[platform];
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await linkAccount(platform, vals);
      haptic('success');
      toast({ title: `${PLATFORMS[platform].label} verknüpft`, body: r.name, kind: 'success' });
      setVals({});
      onClose();
    } catch (e) {
      haptic('error');
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={g.title} className="w-[34rem]">
      <p className="mb-3 text-[0.85rem] text-mist-300">{g.intro}</p>
      <Button size="sm" variant="subtle" icon={ExternalLink} onClick={() => openLink(g.link[1])} className="mb-3">{g.link[0]}</Button>
      {g.fields.map(([k, label, type], i) => (
        <div key={k} className="mb-2">
          <div className="label mb-1">{label}</div>
          <TextField autoFocus={i === 0} type={type} value={vals[k] || ''} onChange={(v) => setVals((x) => ({ ...x, [k]: v }))} onEnter={submit} />
        </div>
      ))}
      <div className="mt-2 flex items-start gap-2 text-[0.72rem] text-mist-500"><Info className="mt-0.5 h-3 w-3 shrink-0" />{g.note}</div>
      {err && <div className="mt-3 flex items-start gap-2 rounded-xl bg-bad/15 px-3 py-2 text-[0.78rem] text-bad"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{err}</div>}
      <div className="mt-4 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[0.7rem] text-mist-500"><ShieldCheck className="h-3.5 w-3.5" /> Verschlüsselt auf dem Gerät gespeichert (AES-256-GCM)</span>
        <Button variant="primary" disabled={busy || g.fields.some(([k]) => k !== 'token' && !vals[k])} onClick={submit}>{busy ? 'Prüfe …' : 'Verknüpfen'}</Button>
      </div>
    </Sheet>
  );
}

// Xbox: official Microsoft device-code flow (needs your own free Azure app registration).
function XboxSheet({ onClose }) {
  const [cid, setCid] = useState(() => localStorage.getItem('lumos.xbox.cid') || '');
  const [step, setStep] = useState(null); // {userCode,url}
  const [err, setErr] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => (alive.current = false), []);
  const start = async () => {
    setErr(null);
    try {
      localStorage.setItem('lumos.xbox.cid', cid.trim());
      const s = await request('social.xbox_device_start', { clientId: cid.trim() });
      setStep(s);
      const t0 = Date.now();
      while (alive.current && Date.now() - t0 < s.expiresIn * 1000) {
        await new Promise((r) => setTimeout(r, Math.max(2, s.interval) * 1000));
        const r = await request('social.xbox_device_poll', {}, 30000);
        if (r.status === 'linked') {
          haptic('success');
          toast({ title: 'Xbox verknüpft', body: r.name, kind: 'success' });
          await refreshAccounts();
          return onClose();
        }
      }
      setErr('Zeit abgelaufen – bitte neu starten.');
      setStep(null);
    } catch (e) {
      setErr(e.message);
      setStep(null);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Xbox Live verknüpfen" className="w-[34rem]">
      <p className="mb-3 text-[0.85rem] text-mist-300">Anmeldung über den offiziellen Microsoft-Gerätecode. Dafür brauchst du einmalig eine kostenlose Azure-App-Registrierung („Persönliche Microsoft-Konten“, öffentlicher Client, Geräte-Flow aktiviert) und deren Anwendungs-ID.</p>
      <Button size="sm" variant="subtle" icon={ExternalLink} onClick={() => openLink('https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade')} className="mb-3">Azure-App registrieren</Button>
      {!step ? (
        <>
          <div className="label mb-1">Anwendungs-ID (Client-ID)</div>
          <TextField autoFocus value={cid} onChange={setCid} onEnter={start} placeholder="00000000-0000-0000-0000-000000000000" />
          <div className="mt-4 flex justify-end"><Button variant="primary" disabled={cid.trim().length < 36} onClick={start}>Code anfordern</Button></div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="text-[0.85rem] text-mist-300">Öffne die Seite und gib diesen Code ein:</div>
          <div className="rounded-2xl bg-white/10 px-6 py-3 font-mono text-3xl tracking-[0.3em]">{step.userCode}</div>
          <Button size="sm" variant="primary" icon={ExternalLink} onClick={() => openLink(step.url)}>{step.url.replace('https://', '')}</Button>
          <div className="flex items-center gap-2 text-[0.75rem] text-mist-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Warte auf Bestätigung …</div>
        </div>
      )}
      {err && <div className="mt-3 flex items-start gap-2 rounded-xl bg-bad/15 px-3 py-2 text-[0.78rem] text-bad"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{err}</div>}
    </Sheet>
  );
}

export default function AccountsSection() {
  const accounts = useHub((s) => s.accounts);
  const cloudUser = useCloud((s) => s.user);
  const [sheet, setSheet] = useState(null);
  useEffect(() => {
    refreshAccounts();
  }, []);
  return (
    <>
      <ListGroup title="LumosOS" footer="Eigenes Netzwerk mit Echtzeit-Chat, Präsenz und geteilten Clips.">
        <ListRow icon={() => <PlatformBadge platform="lumos" size="1.2rem" />} iconBg="bg-[#3b5bc4]" label="Lumos Cloud" sub={cloudUser ? `Angemeldet als ${cloudUser.displayName || cloudUser.email}` : 'Nicht angemeldet'} value={cloudUser ? 'Verbunden' : undefined} onClick={() => openScreen('cloud')} />
      </ListGroup>
      <ListGroup title="Spielenetzwerke" footer="Zugangsdaten werden im Daemon verschlüsselt (AES-256-GCM, Schlüsseldatei 0600) gespeichert, nie in den Einstellungen oder der Cloud. Xbox, PSN und Nintendo nutzen teils inoffizielle Schnittstellen – siehe Hinweise je Netzwerk.">
        {EXTERNAL.map((p) => {
          const a = accounts[p] || {};
          return (
            <ListRow
              key={p}
              icon={() => <PlatformBadge platform={p} size="1.2rem" />}
              iconBg="bg-white/10"
              label={`${PLATFORMS[p].label}${a.experimental ? ' · experimentell' : ''}`}
              sub={a.linked ? `Verknüpft als ${a.name}` : 'Nicht verknüpft'}
              onClick={() => setSheet(p)}
              right={a.linked ? <Button size="sm" variant="ghost" icon={Unlink} onClick={(e) => (e.stopPropagation(), unlinkAccount(p).then(() => toast({ title: `${PLATFORMS[p].label} getrennt`, kind: 'info' })))}>Trennen</Button> : <span className="text-[0.8rem] text-lumen-400">Verknüpfen</span>}
            />
          );
        })}
      </ListGroup>
      {sheet === 'xbox' && <XboxSheet onClose={() => setSheet(null)} />}
      {sheet && sheet !== 'xbox' && <LinkSheet platform={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}
