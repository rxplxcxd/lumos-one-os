// Terminal: real login shell via lumosd (PTY over the WebSocket), ANSI colours, retro phosphor
// themes, controller-friendly command line + direct key mode, and a live system log view.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SquareTerminal, CornerDownLeft, Plus, X, Keyboard } from 'lucide-react';
import { Screen, Button, Segmented, TextField, Hint } from '@/components/ui/primitives.jsx';
import { request, on } from '@/services/bridge.js';
import { Screen as Term } from '@/lib/ansi.js';
import { haptic } from '@/services/haptics.js';
import { useTabs } from '@/hooks/useInputSystem.js';
import { toast } from '@/store/ui.js';

const THEMES = {
  green: { label: 'Phosphor', fg: '#7dff9c', bg: '#020a04', glow: 'rgba(80,255,140,0.45)' },
  amber: { label: 'Bernstein', fg: '#ffbf4d', bg: '#0b0600', glow: 'rgba(255,170,60,0.45)' },
  modern: { label: 'Modern', fg: '#e7ebf1', bg: '#0a0c10', glow: 'transparent' },
};

const KEYS = {
  ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F',
  Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
};

function Output({ term, version, theme, onKey, direct }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [version]);
  const t = THEMES[theme];
  return (
    <div className="relative min-h-0 flex-1">
    <div
      ref={ref}
      tabIndex={0}
      data-nav={direct ? '' : undefined}
      data-raw-keys={direct ? '' : undefined}
      onKeyDown={direct ? onKey : undefined}
      className="nav-focus absolute inset-0 overflow-y-auto rounded-2xl p-4 font-mono text-[0.82rem] leading-[1.35]"
      style={{ background: t.bg, color: t.fg, textShadow: `0 0 6px ${t.glow}` }}
    >
      {term.lines.map((line, i) => (
        <div key={i} className="min-h-[1.35em] whitespace-pre-wrap break-all">
          {term.runs(line).map((r, j) => {
            const fg = r.s.inverse ? t.bg : r.s.fg;
            const bg = r.s.inverse ? r.s.fg || t.fg : r.s.bg;
            return (
              <span key={j} style={{ color: theme === 'modern' || r.s.fg ? fg : undefined, background: bg, fontWeight: r.s.bold ? 700 : undefined, opacity: r.s.dim ? 0.6 : undefined, fontStyle: r.s.italic ? 'italic' : undefined, textDecoration: r.s.underline ? 'underline' : undefined }}>
                {r.text}
              </span>
            );
          })}
        </div>
      ))}
      <motion.span className="inline-block h-[1.1em] w-[0.6em] align-middle" style={{ background: t.fg }} animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1.1, repeat: Infinity }} />
    </div>
    {theme !== 'modern' && <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px)', boxShadow: 'inset 0 0 80px rgba(0,0,0,0.6)' }} />}
    </div>
  );
}

function ShellTab({ theme }) {
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [line, setLine] = useState('');
  const [direct, setDirect] = useState(false);
  const [, force] = useState(0);
  const terms = useRef(new Map());
  const history = useRef([]);
  const hIdx = useRef(-1);
  const inputRef = useRef(null);

  // physical keyboard: printable keys go straight into the command line instead of
  // triggering controller key bindings (e.g. M = quick menu)
  useEffect(() => {
    const onKey = (e) => {
      if (direct || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (e.target.matches?.('input, textarea, [data-raw-keys]') || !inputRef.current) return;
      e.stopImmediatePropagation();
      inputRef.current.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [direct]);

  const open = async () => {
    try {
      const r = await request('terminal.open', { cols: 110, rows: 32 });
      terms.current.set(r.id, new Term());
      setSessions((s) => [...s, { id: r.id, title: r.shell?.split('/').pop() || 'shell' }]);
      setActive(r.id);
      haptic('open');
    } catch (e) {
      toast({ title: 'Terminal nicht verfügbar', body: e.message, kind: 'error' });
    }
  };
  useEffect(() => {
    open();
    const offs = [
      on('terminal.data', ({ id, data }) => {
        terms.current.get(id)?.write(data);
        force((x) => x + 1);
      }),
      on('terminal.exit', ({ id }) => {
        terms.current.get(id)?.write('\r\n\x1b[90m[Sitzung beendet]\x1b[0m\r\n');
        setSessions((s) => s.map((x) => (x.id === id ? { ...x, dead: true } : x)));
        force((x) => x + 1);
      }),
    ];
    return () => {
      offs.forEach((f) => f());
      for (const id of terms.current.keys()) request('terminal.close', { id }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (data) => active && request('terminal.write', { id: active, data }).catch(() => {});
  const submit = () => {
    send(`${line}\r`);
    if (line.trim()) history.current = [line, ...history.current.filter((x) => x !== line)].slice(0, 100);
    hIdx.current = -1;
    setLine('');
    haptic('key');
  };
  const onKey = (e) => {
    if (e.ctrlKey && /^[a-z]$/i.test(e.key)) send(String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64));
    else if (KEYS[e.key]) send(KEYS[e.key]);
    else if (e.key.length === 1) send(e.key);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const term = terms.current.get(active);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        {sessions.map((s, i) => (
          <button key={s.id} data-nav="" onClick={() => setActive(s.id)} className={`nav-focus flex items-center gap-2 rounded-xl px-3 py-1.5 text-[0.78rem] ${active === s.id ? 'bg-white/15' : 'bg-white/[0.05] text-mist-400'} ${s.dead ? 'line-through opacity-60' : ''}`}>
            {s.title} {i + 1}
            <X
              className="h-3.5 w-3.5 opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                request('terminal.close', { id: s.id }).catch(() => {});
                setSessions((x) => x.filter((y) => y.id !== s.id));
                if (active === s.id) setActive(sessions.find((y) => y.id !== s.id)?.id || null);
              }}
            />
          </button>
        ))}
        <Button size="sm" variant="ghost" icon={Plus} onClick={open}>Neu</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={direct ? 'primary' : 'subtle'} icon={Keyboard} onClick={() => setDirect(!direct)}>{direct ? 'Direktmodus an' : 'Direktmodus'}</Button>
        </div>
      </div>
      {term ? <Output term={term} version={term.version} theme={theme} onKey={onKey} direct={direct} /> : <div className="m-auto text-mist-400">Keine Sitzung</div>}
      <div className="flex gap-2">
        <TextField
          ref={inputRef}
          value={line}
          onChange={setLine}
          onEnter={submit}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.current.length) {
              e.preventDefault();
              hIdx.current = Math.min(history.current.length - 1, hIdx.current + 1);
              setLine(history.current[hIdx.current]);
            } else if (e.key === 'Tab') {
              e.preventDefault();
              send(`${line}\t`);
              setLine('');
            } else if (e.key === 'Enter') submit();
          }}
          placeholder="Befehl eingeben …"
          className="font-mono"
          data-nav-trap="off"
        />
        <Button variant="primary" icon={CornerDownLeft} onClick={submit}>Ausführen</Button>
        <Button variant="subtle" onClick={() => send('\x03')}>Strg+C</Button>
        <Button variant="subtle" onClick={() => send('\t')}>Tab</Button>
        <Button variant="subtle" onClick={() => send('\x1b[A')}>↑</Button>
      </div>
    </div>
  );
}

function LogsTab({ theme }) {
  const [rows, setRows] = useState([]);
  const [level, setLevel] = useState('all');
  useEffect(() => {
    let alive = true;
    const load = () => request('system.logs', { limit: 400 }).then((r) => alive && setRows(r), () => {});
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const shown = useMemo(() => rows.filter((r) => level === 'all' || r.level === level), [rows, level]);
  const t = THEMES[theme];
  const color = { ERROR: '#ff7b7b', WARNING: '#f0c674', INFO: t.fg, DEBUG: '#7c8799' };
  return (
    <div className="flex h-full flex-col gap-3">
      <Segmented value={level} onChange={setLevel} options={[{ value: 'all', label: 'Alle' }, { value: 'ERROR', label: 'Fehler' }, { value: 'WARNING', label: 'Warnungen' }, { value: 'INFO', label: 'Info' }]} className="w-[28rem]" />
      <div data-nav="" tabIndex={0} className="nav-focus min-h-0 flex-1 overflow-y-auto rounded-2xl p-4 font-mono text-[0.75rem] leading-snug" style={{ background: t.bg, color: t.fg }}>
        {shown.map((r, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <span className="opacity-50">{new Date(r.t * 1000).toLocaleTimeString('de-DE')}</span> <span style={{ color: color[r.level] }}>{r.level.padEnd(7)}</span> <span className="opacity-70">{r.name}</span> {r.msg}
          </div>
        ))}
        {!shown.length && <div className="opacity-50">Keine Einträge</div>}
      </div>
    </div>
  );
}

export default function TerminalApp() {
  const [tab, setTab] = useState('shell');
  const [theme, setTheme] = useState(() => localStorage.getItem('lumos.term.theme') || 'green');
  useEffect(() => localStorage.setItem('lumos.term.theme', theme), [theme]);
  const TABS = [{ key: 'shell', label: 'Shell' }, { key: 'logs', label: 'System-Logs' }];
  useTabs((d) => setTab((t) => TABS[(TABS.findIndex((x) => x.key === t) + d + TABS.length) % TABS.length].key), []);
  return (
    <Screen
      title="Terminal"
      icon={SquareTerminal}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      noPad
      actions={<Segmented value={theme} onChange={setTheme} options={Object.entries(THEMES).map(([value, x]) => ({ value, label: x.label }))} className="w-[20rem]" />}
      hints={<><Hint k="lb">Tab</Hint><Hint k="a">Eingabe</Hint><Hint k="b">Zurück</Hint></>}
    >
      <div className="h-full px-10 pb-14">{tab === 'shell' ? <ShellTab theme={theme} /> : <LogsTab theme={theme} />}</div>
    </Screen>
  );
}

