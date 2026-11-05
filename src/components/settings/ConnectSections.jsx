import { useEffect, useState } from 'react';
import { Wifi, Lock, Bluetooth, BluetoothSearching, Cloud, Server, Database, RefreshCw, Code2, FlaskConical, UserRound, Users, Plus, Trash2, Check } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, Segmented, TextField, Button, Sheet, Toggle } from '@/components/ui/primitives.jsx';
import { useSettings, setSetting } from '@/store/settings.js';
import { useSystem } from '@/store/system.js';
import { useCloud, cloudConfig, setCloudConfig, cloudHealth } from '@/services/cloud/cloudService.js';
import { useProfiles, addProfile, removeProfile, switchProfile, activeProfile } from '@/store/profile.js';
import { request, bridgeMode } from '@/services/bridge.js';
import { open, toast, toggleDevPanel } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';

const useV = () => useSettings((s) => s.values);

function Bars({ signal }) {
  return (
    <span className="flex items-end gap-[2px]">
      {[25, 50, 75].map((t, i) => (
        <span key={t} className={`w-[3px] rounded-sm ${signal >= t ? 'bg-white' : 'bg-white/25'}`} style={{ height: `${6 + i * 4}px` }} />
      ))}
    </span>
  );
}

export function NetworkSection() {
  const v = useV();
  const net = useSystem((s) => s.network);
  const [nets, setNets] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [join, setJoin] = useState(null);
  const [pw, setPw] = useState('');
  const [bt, setBt] = useState(null);
  const [btScan, setBtScan] = useState(false);

  const scan = () => {
    setScanning(true);
    request('network.wifi_scan', {}, 20000).then(setNets, (e) => toast({ title: 'WLAN-Suche fehlgeschlagen', body: e.message, kind: 'error' })).finally(() => setScanning(false));
  };
  const scanBt = () => {
    setBtScan(true);
    request('bluetooth.scan', { seconds: 6 }, 20000).then((d) => setBt(d), (e) => toast({ title: e.message, kind: 'error' })).finally(() => setBtScan(false));
  };
  useEffect(() => {
    if (v.wifiEnabled) scan();
    request('bluetooth.status').then((s) => setBt(s.devices || []), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (n, password) => {
    setJoin(null);
    try {
      await request('network.wifi_connect', { ssid: n.ssid, password }, 40000);
      haptic('success');
      toast({ title: 'Verbunden', body: n.ssid, kind: 'success' });
      useSystem.setState({ network: await request('network.status') });
      scan();
    } catch (e) {
      haptic('error');
      toast({ title: 'Verbindung fehlgeschlagen', body: e.message, kind: 'error' });
    }
  };

  return (
    <>
      <ListGroup title="WLAN" footer={net?.ip ? `IP-Adresse ${net.ip}` : undefined}>
        <ToggleRow icon={Wifi} iconBg="bg-[#2f7fe0]" label="WLAN" checked={v.wifiEnabled} onChange={(x) => (setSetting('wifiEnabled', x), request('network.set_wifi', { enabled: x }).then(() => x && scan()))} />
        {v.wifiEnabled &&
          (nets || []).map((n) => (
            <ListRow
              key={n.ssid}
              label={n.ssid}
              sub={n.connected ? 'Verbunden' : n.security === 'open' ? 'Ungesichert' : n.security}
              right={<span className="flex items-center gap-3">{n.connected && <Check className="h-4 w-4 text-ok" />}{n.security !== 'open' && <Lock className="h-3.5 w-3.5 text-mist-400" />}<Bars signal={n.signal} /></span>}
              chevron={false}
              onClick={() => (n.connected ? null : n.security === 'open' ? connect(n) : (setPw(''), setJoin(n)))}
            />
          ))}
        {v.wifiEnabled && <ListRow label={scanning ? 'Suche läuft …' : 'Erneut suchen'} onClick={scan} chevron={false} />}
      </ListGroup>
      <ListGroup title="Bluetooth">
        <ToggleRow icon={Bluetooth} iconBg="bg-[#2f7fe0]" label="Bluetooth" checked={v.bluetoothEnabled} onChange={(x) => (setSetting('bluetoothEnabled', x), request('bluetooth.set', { enabled: x }))} />
        {(bt || []).map((d) => (
          <ListRow
            key={d.address}
            label={d.name || d.address}
            sub={d.connected ? 'Verbunden' : d.paired ? 'Gekoppelt' : 'Verfügbar'}
            chevron={false}
            right={d.paired ? <Button size="sm" variant="ghost" icon={Trash2} onClick={(e) => (e.stopPropagation(), request('bluetooth.remove', { address: d.address }).then(scanBt))}>Entfernen</Button> : null}
            onClick={() => !d.paired && request('bluetooth.pair', { address: d.address }, 40000).then(() => (haptic('success'), toast({ title: 'Gekoppelt', body: d.name, kind: 'success' }), scanBt()), (e) => toast({ title: 'Koppeln fehlgeschlagen', body: e.message, kind: 'error' }))}
          />
        ))}
        {v.bluetoothEnabled && <ListRow icon={BluetoothSearching} iconBg="bg-[#2f7fe0]" label={btScan ? 'Suche läuft …' : 'Nach Geräten suchen'} onClick={scanBt} chevron={false} />}
      </ListGroup>
      <Sheet open={!!join} onClose={() => setJoin(null)} title={`Passwort für „${join?.ssid}“`}>
        <TextField autoFocus type="password" value={pw} onChange={setPw} placeholder="Passwort" onEnter={() => connect(join, pw)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setJoin(null)}>Abbrechen</Button>
          <Button variant="primary" onClick={() => connect(join, pw)}>Verbinden</Button>
        </div>
      </Sheet>
    </>
  );
}

export function CloudSection() {
  const v = useV();
  const cloud = useCloud((s) => s);
  const [cfg, setCfg] = useState(cloudConfig());
  const [health, setHealth] = useState(null);
  const test = () => cloudHealth().then((h) => setHealth({ ok: true, ...h }), (e) => setHealth({ ok: false, error: e.message }));
  return (
    <>
      <ListGroup title="Konto">
        <ListRow icon={Cloud} iconBg="bg-[#4a90d9]" label={cloud.user ? cloud.user.email : 'Bei Lumos Cloud anmelden'} sub={cloud.user ? `Anbieter: ${cloud.provider}` : 'Profile, Spielstände & Einstellungen synchronisieren'} onClick={() => open('cloud')} />
      </ListGroup>
      <ListGroup title="Synchronisieren">
        <ToggleRow label="Einstellungen" checked={v.cloudSyncSettings} onChange={(x) => setSetting('cloudSyncSettings', x)} />
        <ToggleRow label="Spielstände automatisch sichern" checked={v.cloudSyncSaves} onChange={(x) => setSetting('cloudSyncSaves', x)} />
      </ListGroup>
      <ListGroup title="Backend" footer="Lumos Cloud kann selbst gehostet werden (cloud-server/) oder Supabase nutzen. Der Supabase-Anon-Key ist öffentlich; Daten sind per Row-Level-Security geschützt.">
        <div className="space-y-3 px-4 py-3">
          <Segmented value={cfg.provider} onChange={(p) => setCfg({ ...cfg, provider: p })} options={[{ value: 'lumos', label: 'Lumos Server' }, { value: 'supabase', label: 'Supabase' }]} />
          {cfg.provider === 'lumos' ? (
            <TextField value={cfg.lumosUrl} onChange={(x) => setCfg({ ...cfg, lumosUrl: x })} placeholder="https://cloud.example.com" />
          ) : (
            <>
              <TextField value={cfg.supabaseUrl} onChange={(x) => setCfg({ ...cfg, supabaseUrl: x })} placeholder="https://xyz.supabase.co" />
              <TextField value={cfg.supabaseAnonKey} onChange={(x) => setCfg({ ...cfg, supabaseAnonKey: x })} placeholder="Anon Key" />
            </>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" icon={Server} onClick={() => (setCloudConfig(cfg), toast({ title: 'Backend gespeichert', kind: 'success' }))}>Speichern</Button>
            <Button size="sm" variant="subtle" icon={Database} onClick={test}>Verbindung testen</Button>
            {health && <span className={`text-[0.78rem] ${health.ok ? 'text-ok' : 'text-bad'}`}>{health.ok ? `OK · ${health.version || health.provider || ''}` : health.error}</span>}
          </div>
        </div>
      </ListGroup>
    </>
  );
}

export function UpdatesSection() {
  const v = useV();
  return (
    <>
      <ListGroup>
        <ListRow icon={RefreshCw} iconBg="bg-[#6b7280]" label="Lumos Sync & Update öffnen" onClick={() => open('updater')} />
        <ToggleRow label="Automatische Updates" sub="Laden im Hintergrund, Installation beim nächsten Neustart" checked={v.autoUpdate} onChange={(x) => setSetting('autoUpdate', x)} />
      </ListGroup>
      <ListGroup title="Kanal">
        <div className="px-4 py-3">
          <Segmented value={v.updateChannel} onChange={(x) => setSetting('updateChannel', x)} options={[{ value: 'stable', label: 'Stabil' }, { value: 'beta', label: 'Beta' }, { value: 'dev', label: 'Entwicklung' }]} />
        </div>
      </ListGroup>
    </>
  );
}

export function DeveloperSection() {
  const v = useV();
  const daemon = useSystem((s) => s.daemon);
  return (
    <>
      <ListGroup title="Hardware-Simulator" footer="Strg + Umschalt + D oder F12 öffnet das Test-Overlay überall im System.">
        <ListRow icon={FlaskConical} iconBg="bg-[#4b5563]" label="Entwickler-Panel öffnen" onClick={() => toggleDevPanel(true)} />
        <ToggleRow icon={Code2} iconBg="bg-[#4b5563]" label="Tastenkürzel aktiv" checked={v.devPanelShortcut} onChange={(x) => setSetting('devPanelShortcut', x)} />
      </ListGroup>
      <ListGroup title="Daemon (lumosd)">
        <ListRow label="Verbindung" value={daemon.connected ? 'Verbunden' : 'Getrennt'} />
        <ListRow label="Modus" value={{ electron: 'Electron IPC → WebSocket', websocket: 'WebSocket (direkt)', simulator: 'In-Browser-Simulator' }[bridgeMode()] || bridgeMode()} />
      </ListGroup>
    </>
  );
}

export function AboutSection() {
  const info = useSystem((s) => s.info);
  const [app, setApp] = useState(null);
  useEffect(() => {
    window.lumos?.appInfo?.().then(setApp);
  }, []);
  return (
    <ListGroup>
      <ListRow label="Name" value="Lumos One" />
      <ListRow label="Systemversion" value={info?.version || '1.0.0'} />
      <ListRow label="Modell" value="LUMOS-ONE-8 · 8″ OLED 165 Hz" />
      <ListRow label="Mainboard" value="Framework Laptop 13" />
      <ListRow label="Betriebssystem" value={info?.os || 'Arch Linux'} />
      {app && <ListRow label="Electron / Chromium" value={`${app.electron} / ${app.chrome}`} />}
      {app && <ListRow label="Schlüsselspeicher" value={app.safeStorageBackend || '—'} />}
      <ListRow label="Seriennummer" value={info?.serial || '—'} />
    </ListGroup>
  );
}

export function ProfileSection() {
  const { profiles, activeId } = useProfiles();
  const active = useProfiles(activeProfile);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="glass mb-6 flex items-center gap-5 rounded-3xl p-5">
        <div className="h-20 w-20 overflow-hidden rounded-full bg-ink-700 ring-2 ring-white/10">{active?.image && <img src={active.image} alt="" className="h-full w-full object-cover" />}</div>
        <div className="flex-1">
          <div className="text-xl font-semibold">{active?.name}</div>
          <div className="text-[0.8rem] text-mist-400">Aktives Profil</div>
        </div>
        <Button variant="primary" icon={UserRound} onClick={() => open('avatar')}>Avatar bearbeiten</Button>
      </div>
      <ListGroup title="Profile auf diesem Gerät">
        {profiles.map((p) => (
          <ListRow
            key={p.id}
            label={p.name}
            sub={p.id === activeId ? 'Aktiv' : undefined}
            icon={Users}
            iconBg="bg-[#5b6b8c]"
            chevron={false}
            onClick={() => (switchProfile(p.id), haptic('success'))}
            right={profiles.length > 1 && p.id !== activeId ? <Button size="sm" variant="ghost" icon={Trash2} onClick={(e) => (e.stopPropagation(), removeProfile(p.id))} /> : p.id === activeId ? <Toggle checked onChange={() => {}} label="aktiv" disabled /> : null}
          />
        ))}
        <ListRow icon={Plus} iconBg="bg-[#3f9c6d]" label="Profil hinzufügen" onClick={() => setAdding(true)} />
      </ListGroup>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Neues Profil">
        <TextField autoFocus value={name} onChange={setName} placeholder="Name" onEnter={() => name && (addProfile(name), setAdding(false), setName(''))} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => name && (addProfile(name), setAdding(false), setName(''))}>Erstellen</Button>
        </div>
      </Sheet>
    </>
  );
}
