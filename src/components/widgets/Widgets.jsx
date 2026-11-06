// iOS-inspired widgets. Each widget renders a different, richer layout per size (2, 4, 6).
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sun, Cloud, CloudSun, CloudRain, CloudSnow, CloudFog, CloudDrizzle, CloudLightning, Moon, Play, Pause, SkipForward, SkipBack, Music2, Cpu, Thermometer, Fan, Zap, Gamepad2, RefreshCw, CloudOff, StickyNote, Store, Library, Calculator, KeyRound, Settings, Download } from 'lucide-react';
import { useSystem } from '@/store/system.js';
import { useSettings } from '@/store/settings.js';
import { useCloud, syncNow } from '@/services/cloud/cloudService.js';
import { forecast, describe } from '@/services/weather.js';
import { request, on } from '@/services/bridge.js';
import { useNow, Progress } from '@/components/ui/primitives.jsx';
import { BatteryGlyph } from '@/components/shell/StatusBar.jsx';
import { useNotes, sortedNotes } from '@/store/notes.js';
import { useDownloads } from '@/store/downloads.js';
import { open } from '@/store/ui.js';
import { useHub, unifiedFriends, presenceText } from '@/services/social/hub.js';
import { FriendAvatar, Cover, STATUS_COLOR } from '@/components/social/parts.jsx';
import { spring } from '@/lib/motion.js';

const W_ICON = { sun: Sun, 'cloud-sun': CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const fmtT = (t) => `${Math.round(t)}°`;

function Ring({ value, size = 64, stroke = 6, color = '#f5f7fa', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }} transition={spring.soft} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function SystemWidget({ size }) {
  const b = useSystem((s) => s.battery);
  const stats = useSystem((s) => s.stats);
  const controllers = useSystem((s) => s.controllers);
  const pct = b.percent ?? 0;
  const color = b.charging ? '#5fd69a' : pct <= 15 ? '#ff6b6b' : '#f5f7fa';
  const eta = b.time_left_min ? `${Math.floor(b.time_left_min / 60)} h ${b.time_left_min % 60} min` : '—';
  if (size === 2)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Ring value={pct / 100} size={88} stroke={8} color={color}>
          <span className="text-lg font-semibold tabular-nums">{Math.round(pct)}%</span>
        </Ring>
        <span className="text-[0.72rem] text-mist-400">{b.charging ? 'Lädt' : eta}</span>
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      <div className="label">Akku & System</div>
      <div className="mt-3 flex items-center gap-4">
        <Ring value={pct / 100} size={96} stroke={8} color={color}>
          <span className="text-xl font-semibold tabular-nums">{Math.round(pct)}%</span>
        </Ring>
        <div className="space-y-1 text-[0.8rem]">
          <div className="text-mist-50">{b.charging ? `Lädt · ${b.watts?.toFixed?.(1) ?? '—'} W` : `Noch ${eta}`}</div>
          <div className="text-mist-400">Zustand {b.health ?? '—'}%</div>
          <div className="text-mist-400">Verbrauch {stats?.power_w?.toFixed?.(1) ?? '—'} W</div>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 text-[0.75rem]">
        {[
          [Cpu, 'CPU', stats ? `${Math.round(stats.cpu)}%` : '—'],
          [Thermometer, 'Temp', stats ? `${Math.round(stats.temp_cpu)} °C` : '—'],
          [Fan, 'Lüfter', stats?.fan_rpm ? `${Math.round(stats.fan_rpm)} rpm` : '—'],
          [Zap, 'TDP', stats?.tdp_w ? `${stats.tdp_w} W` : '—'],
        ].map(([I, l, v]) => (
          <div key={l} className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-2.5 py-1.5">
            <I className="h-3.5 w-3.5 text-mist-400" />
            <span className="text-mist-400">{l}</span>
            <span className="ml-auto tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      {size === 6 && (
        <div className="mt-3 space-y-2">
          <div className="label">Controller</div>
          {controllers.length === 0 && <div className="text-[0.8rem] text-mist-400">Keine verbunden</div>}
          {controllers.map((c) => (
            <div key={c.id} className="flex items-center gap-3 text-[0.8rem]">
              <Gamepad2 className="h-4 w-4 text-mist-300" />
              <span className="flex-1 truncate">{c.name}</span>
              <BatteryGlyph percent={c.battery} charging={c.charging} />
              <span className="w-9 text-right tabular-nums text-mist-300">{c.battery}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WeatherWidget({ size }) {
  const loc = useSettings((s) => s.values.weatherLocation);
  const [w, setW] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      forecast(loc)
        .then((d) => alive && (setW(d), setErr(null)))
        .catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 15 * 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [loc]);
  if (!w)
    return (
      <div className="flex h-full flex-col">
        <div className="label">{loc.name}</div>
        <div className="m-auto text-[0.8rem] text-mist-400">{err ? 'Wetter offline' : 'Lädt …'}</div>
      </div>
    );
  const d = describe(w.current.code);
  const I = !w.current.isDay && d.icon === 'sun' ? Moon : W_ICON[d.icon] || Cloud;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[0.85rem] font-medium">{loc.name}</div>
          <div className={size === 2 ? 'text-[2.2rem] font-light leading-none' : 'text-[3rem] font-extralight leading-none'}>{fmtT(w.current.temp)}</div>
        </div>
        <I className={size === 2 ? 'h-7 w-7' : 'h-9 w-9'} strokeWidth={1.6} />
      </div>
      <div className="mt-1 text-[0.75rem] text-mist-300">{d.label}</div>
      <div className="text-[0.72rem] text-mist-400">
        H {fmtT(w.daily[0].max)} T {fmtT(w.daily[0].min)}
      </div>
      {size >= 4 && (
        <div className="mt-auto flex justify-between">
          {w.hourly.slice(0, size === 6 ? 8 : 6).map((h) => {
            const HI = W_ICON[describe(h.code).icon] || Cloud;
            return (
              <div key={h.t} className="flex flex-col items-center gap-1 text-[0.7rem]">
                <span className="text-mist-400">{new Date(h.t).getHours()}</span>
                <HI className="h-4 w-4" strokeWidth={1.8} />
                <span className="tabular-nums">{fmtT(h.temp)}</span>
              </div>
            );
          })}
        </div>
      )}
      {size === 6 && (
        <div className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3">
          {w.daily.slice(1, 6).map((dd) => {
            const DI = W_ICON[describe(dd.code).icon] || Cloud;
            return (
              <div key={dd.t} className="flex items-center gap-3 text-[0.78rem]">
                <span className="w-10 text-mist-300">{new Date(dd.t).toLocaleDateString('de-DE', { weekday: 'short' })}</span>
                <DI className="h-4 w-4" />
                <span className="ml-auto w-9 text-right tabular-nums text-mist-400">{fmtT(dd.min)}</span>
                <div className="h-1 w-20 rounded-full bg-gradient-to-r from-lumen-500/60 to-warn/70" />
                <span className="w-9 tabular-nums">{fmtT(dd.max)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MusicWidget({ size }) {
  const media = useSystem((s) => s.media);
  const [pos, setPos] = useState(media?.position ?? 0);
  useEffect(() => setPos(media?.position ?? 0), [media]);
  useEffect(() => {
    if (!media?.playing) return undefined;
    const t = setInterval(() => setPos((p) => Math.min(media.length || p + 1, p + 1)), 1000);
    return () => clearInterval(t);
  }, [media]);
  const ctl = (action) => request('media.control', { action }).catch(() => {});
  if (!media?.title)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-mist-400">
        <Music2 className="h-7 w-7" />
        <span className="text-[0.8rem]">Keine Wiedergabe</span>
      </div>
    );
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const Art = ({ cls }) => (media.art ? <img src={media.art} alt="" className={`${cls} rounded-2xl object-cover`} /> : <div className={`${cls} flex items-center justify-center rounded-2xl bg-gradient-to-br from-ink-600 to-ink-800`}><Music2 className="h-1/3 w-1/3 text-mist-400" /></div>);
  const Controls = () => (
    <div className="flex items-center justify-center gap-3">
      <button data-nav="" onClick={() => ctl('previous')} className="nav-focus rounded-full p-2"><SkipBack className="h-5 w-5" /></button>
      <button data-nav="" onClick={() => ctl('toggle')} className="nav-focus flex h-11 w-11 items-center justify-center rounded-full bg-mist-50 text-ink-950">{media.playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}</button>
      <button data-nav="" onClick={() => ctl('next')} className="nav-focus rounded-full p-2"><SkipForward className="h-5 w-5" /></button>
    </div>
  );
  if (size === 2)
    return (
      <div className="flex h-full flex-col">
        <Art cls="h-14 w-14" />
        <div className="mt-auto truncate text-[0.82rem] font-semibold">{media.title}</div>
        <div className="truncate text-[0.72rem] text-mist-400">{media.artist}</div>
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      <div className={size === 6 ? 'flex flex-col items-center gap-4' : 'flex items-center gap-4'}>
        <Art cls={size === 6 ? 'h-44 w-44' : 'h-20 w-20'} />
        <div className={`min-w-0 ${size === 6 ? 'text-center' : ''}`}>
          <div className="truncate text-[0.95rem] font-semibold">{media.title}</div>
          <div className="truncate text-[0.8rem] text-mist-300">{media.artist}</div>
          <div className="truncate text-[0.72rem] text-mist-500">{media.player}</div>
        </div>
      </div>
      <div className="mt-auto">
        <Progress value={media.length ? (pos / media.length) * 100 : 0} thin />
        <div className="mt-1 flex justify-between text-[0.68rem] tabular-nums text-mist-400">
          <span>{fmt(pos)}</span>
          <span>{media.length ? fmt(media.length) : ''}</span>
        </div>
        <div className="mt-1"><Controls /></div>
      </div>
    </div>
  );
}

export function ClockWidget({ size }) {
  const now = useNow(1000);
  const h24 = useSettings((s) => s.values.clock24h);
  const sec = now.getSeconds() + now.getMilliseconds() / 1000;
  if (size === 2) {
    const hr = ((now.getHours() % 12) + now.getMinutes() / 60) * 30;
    const mn = (now.getMinutes() + sec / 60) * 6;
    return (
      <div className="flex h-full items-center justify-center">
        <svg viewBox="0 0 100 100" className="h-full max-h-[7rem] w-full">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="50" y1="6" x2="50" y2={i % 3 ? 10 : 13} stroke="rgba(255,255,255,0.5)" strokeWidth={i % 3 ? 1.5 : 2.5} transform={`rotate(${i * 30} 50 50)`} strokeLinecap="round" />
          ))}
          <line x1="50" y1="50" x2="50" y2="27" stroke="#fff" strokeWidth="4" strokeLinecap="round" transform={`rotate(${hr} 50 50)`} />
          <line x1="50" y1="50" x2="50" y2="15" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${mn} 50 50)`} />
          <line x1="50" y1="58" x2="50" y2="12" stroke="#ff6b6b" strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${sec * 6} 50 50)`} />
          <circle cx="50" cy="50" r="2.5" fill="#ff6b6b" />
        </svg>
      </div>
    );
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  return (
    <div className="flex h-full flex-col">
      <div className="text-[2.6rem] font-extralight tabular-nums leading-none">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: !h24 })}</div>
      <div className="mt-1 text-[0.85rem] text-mist-300">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="mt-auto grid grid-cols-7 gap-y-1 text-center text-[0.68rem]">
        {['M', 'D', 'M', 'D', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="text-mist-500">{d}</span>
        ))}
        {Array.from({ length: first }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => (
          <span key={i} className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full tabular-nums ${i + 1 === now.getDate() ? 'bg-bad font-semibold text-white' : 'text-mist-200'}`}>{i + 1}</span>
        ))}
      </div>
    </div>
  );
}

export function ControllersWidget({ size }) {
  const controllers = useSystem((s) => s.controllers);
  return (
    <div className="flex h-full flex-col">
      <div className="label">Controller</div>
      {controllers.length === 0 && <div className="m-auto text-[0.8rem] text-mist-400">Keine verbunden</div>}
      <div className={`mt-2 ${size === 2 ? 'flex flex-1 items-center justify-around' : 'space-y-2.5'}`}>
        {controllers.slice(0, 4).map((c) =>
          size === 2 ? (
            <div key={c.id} className="flex flex-col items-center gap-1.5">
              <Ring value={(c.battery ?? 0) / 100} size={46} stroke={4} color={c.charging ? '#5fd69a' : '#f5f7fa'}>
                <span className="text-[0.62rem] font-bold">{c.side === 'right' ? 'R' : c.side === 'left' ? 'L' : 'P'}</span>
              </Ring>
              <span className="text-[0.68rem] tabular-nums text-mist-300">{c.battery}%</span>
            </div>
          ) : (
            <div key={c.id} className="flex items-center gap-3 text-[0.8rem]">
              <Gamepad2 className="h-4 w-4" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.name}</div>
                <div className="text-[0.7rem] text-mist-400">{{ pogo: 'Angedockt', ble: 'Bluetooth LE', usb: 'USB', bt: 'Bluetooth' }[c.transport]}</div>
              </div>
              <BatteryGlyph percent={c.battery} charging={c.charging} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function CloudWidget({ size }) {
  const c = useCloud((s) => s);
  const label = { 'signed-out': 'Nicht angemeldet', idle: 'Synchronisiert', syncing: 'Synchronisiere …', offline: 'Offline', error: 'Fehler' }[c.status];
  const I = c.status === 'offline' || c.status === 'error' ? CloudOff : c.status === 'syncing' ? RefreshCw : Cloud;
  return (
    <button data-nav="" onClick={() => (c.status === 'signed-out' ? open('cloud') : syncNow().catch(() => {}))} className="nav-focus -m-1 flex h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] flex-col rounded-2xl p-1 text-left">
      <div className="label">Lumos Cloud</div>
      <I className={`mt-3 h-8 w-8 ${c.status === 'syncing' ? 'animate-spin' : ''}`} strokeWidth={1.6} />
      <div className="mt-auto text-[0.85rem] font-medium">{label}</div>
      <div className="text-[0.72rem] text-mist-400">{c.lastSync ? `zuletzt ${new Date(c.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : c.user?.email || 'Tippen zum Anmelden'}</div>
      {size >= 4 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[0.7rem]">
          <div className="rounded-xl bg-white/[0.05] py-2"><div className="text-base font-semibold">{c.saves.length}</div>Saves</div>
          <div className="rounded-xl bg-white/[0.05] py-2"><div className="text-base font-semibold">{c.entitlements.length}</div>Inhalte</div>
          <div className="rounded-xl bg-white/[0.05] py-2"><div className="text-base font-semibold">{c.pending}</div>Ausstehend</div>
        </div>
      )}
    </button>
  );
}

// Friends of every linked network: most active first, with avatar, platform badge and game.
export function SocialWidget({ size }) {
  const cloudFriends = useCloud((s) => s.friends);
  const unread = useCloud((s) => s.unread);
  const { presence, external } = useHub();
  const all = unifiedFriends({ cloudFriends, presence, external });
  const active = all.filter((f) => f.status !== 'offline');
  const shown = (active.length ? active : all).slice(0, size === 2 ? 4 : size === 4 ? 4 : 7);
  const go = () => open('social');
  return (
    <button data-nav="" onClick={go} className="nav-focus -m-1 flex h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] flex-col rounded-2xl p-1 text-left">
      <div className="flex items-center justify-between">
        <div className="label">Freunde</div>
        <span className="flex items-center gap-1.5 text-[0.7rem] text-mist-400">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR.online }} />{active.length} online
          {unread > 0 && <span className="rounded-full bg-bad px-1.5 font-bold text-white">{unread}</span>}
        </span>
      </div>
      {!all.length && <div className="m-auto text-center text-[0.75rem] text-mist-500">Verknüpfe Konten unter<br />Einstellungen → Konten</div>}
      {size === 2 ? (
        <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-3">
          {shown.map((f, i) => (
            <motion.div key={f.key} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 22, delay: i * 0.05 }} className="flex flex-col items-center gap-1">
              <FriendAvatar f={f} size="2.6rem" />
              <span className="max-w-full truncate text-[0.62rem] text-mist-300">{f.name}</span>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
          {shown.map((f, i) => (
            <motion.div key={f.key} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 26, delay: i * 0.04 }} className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-2 py-1.5">
              <FriendAvatar f={f} size="2rem" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8rem]">{f.name}</span>
                <span className="block truncate text-[0.66rem] text-mist-400">{presenceText(f)}</span>
              </span>
              {f.game && size >= 4 && <Cover game={f.game} className="h-9 w-7 shrink-0 rounded-md" />}
            </motion.div>
          ))}
        </div>
      )}
    </button>
  );
}

export function NotesWidget({ size }) {
  const notes = sortedNotes(useNotes((s) => s.notes)).slice(0, size === 6 ? 5 : size === 4 ? 3 : 1);
  return (
    <button data-nav="" onClick={() => open('notes')} className="nav-focus -m-1 flex h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] flex-col rounded-2xl p-1 text-left">
      <div className="label flex items-center gap-1.5 text-warn"><StickyNote className="h-3.5 w-3.5" /> Notizen</div>
      <div className="mt-2 space-y-2 overflow-hidden">
        {notes.map((n) => (
          <div key={n.id} className="border-b border-white/[0.05] pb-1.5 last:border-0">
            <div className="truncate text-[0.82rem] font-medium">{n.title || n.body.split('\n')[0] || 'Neue Notiz'}</div>
            <div className="line-clamp-2 text-[0.72rem] text-mist-400">{n.body}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

export function DownloadsWidget({ size }) {
  const jobs = Object.values(useDownloads((s) => s.jobs));
  return (
    <div className="flex h-full flex-col">
      <div className="label flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Downloads</div>
      {jobs.length === 0 && <div className="m-auto text-[0.8rem] text-mist-400">Alles aktuell</div>}
      <div className="mt-2 space-y-2.5">
        {jobs.slice(0, size === 4 ? 4 : 1).map((j) => (
          <div key={j.job}>
            <div className="flex text-[0.78rem]">
              <span className="truncate">{j.name}</span>
              <span className="ml-auto font-semibold tabular-nums">{Math.round(j.percent)}%</span>
            </div>
            <Progress value={j.percent} thin className="mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

const QUICK = [
  { icon: Store, label: 'Store', screen: 'store' },
  { icon: Library, label: 'Bibliothek', screen: 'library' },
  { icon: StickyNote, label: 'Notizen', screen: 'notes' },
  { icon: Calculator, label: 'Rechner', screen: 'calculator' },
  { icon: KeyRound, label: 'Passwörter', screen: 'keychain' },
  { icon: Settings, label: 'Einstellungen', screen: 'settings' },
  { icon: Cloud, label: 'Cloud', screen: 'cloud' },
  { icon: Gamepad2, label: 'Controller', screen: 'settings', params: { section: 'controllers' } },
  { icon: RefreshCw, label: 'Update', screen: 'updater' },
];

export function QuickWidget({ size }) {
  const n = size === 2 ? 4 : size === 4 ? 6 : 9;
  return (
    <div className={`grid h-full ${size === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
      {QUICK.slice(0, n).map((q) => (
        <button key={q.label} data-nav="" onClick={() => open(q.screen, q.params)} className="nav-focus flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.06]">
          <q.icon className="h-5 w-5" />
          {size !== 2 && <span className="text-[0.7rem] text-mist-300">{q.label}</span>}
        </button>
      ))}
    </div>
  );
}

export const WIDGETS = {
  system: SystemWidget,
  weather: WeatherWidget,
  music: MusicWidget,
  clock: ClockWidget,
  controllers: ControllersWidget,
  cloud: CloudWidget,
  social: SocialWidget,
  notes: NotesWidget,
  downloads: DownloadsWidget,
  quick: QuickWidget,
};

/** keeps media widget fresh even if the daemon only pushes changes */
export function useMediaPolling() {
  useEffect(() => {
    const t = setInterval(() => request('media.status').then((m) => useSystem.setState({ media: m }), () => {}), 5000);
    const off = on('media.state', () => {});
    return () => {
      clearInterval(t);
      off();
    };
  }, []);
}
