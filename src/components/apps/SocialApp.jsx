// Universal Social Hub: unified inbox, friends of every linked network with rich presence and the
// Smart Friend Finder (one user name → LumosOS, Steam, Xbox, PSN, Nintendo at once).
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { Users, UserPlus, Copy, Search, Inbox, Link2, RefreshCw, Loader2, AlertTriangle, Check } from 'lucide-react';
import { Screen, Button, TextField, Sheet, Hint } from '@/components/ui/primitives.jsx';
import { useCloud, acceptFriend, removeFriend, addFriend } from '@/services/cloud/cloudService.js';
import { useHub, PLATFORMS, EXTERNAL, unifiedFriends, presenceText, refreshHub, searchAll, addFriendOn } from '@/services/social/hub.js';
import { FriendAvatar, PlatformBadge, Cover, STATUS_COLOR } from '@/components/social/parts.jsx';
import ProfileCard from '@/components/social/ProfileCard.jsx';
import Conversation from '@/components/social/Conversation.jsx';
import { open, toast } from '@/store/ui.js';
import { useTabs } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const TABS = [
  { key: 'inbox', label: 'Posteingang', icon: Inbox },
  { key: 'friends', label: 'Freunde', icon: Users },
];

function Row({ f, active, onClick, index, onProfile }) {
  return (
    <motion.button
      layout="position"
      data-nav=""
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ ...spring.snappy, delay: Math.min(index, 8) * 0.02 }}
      onClick={onClick}
      onContextMenu={(e) => (e.preventDefault(), onProfile(f))}
      onKeyDown={(e) => (e.key === 'y' || e.key === 'Y') && onProfile(f)}
      className={`row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${active ? 'bg-white/[0.09]' : ''}`}
    >
      <FriendAvatar f={f} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9rem]">{f.name}</span>
        <span className="block truncate text-[0.72rem]" style={{ color: f.status === 'offline' ? undefined : STATUS_COLOR[f.status] }}>
          {presenceText(f)}
        </span>
      </span>
      {f.game && <Cover game={f.game} className="h-9 w-7 shrink-0 rounded-md" />}
      {f.unread > 0 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1.5 text-[0.65rem] font-bold">{f.unread}</motion.span>}
    </motion.button>
  );
}

function Group({ title, children }) {
  return children.length ? (
    <>
      <div className="label px-3 pb-1 pt-3">{title} · {children.length}</div>
      {children}
    </>
  ) : null;
}

function SearchResults({ q, platforms, onProfile }) {
  const [state, setState] = useState({ loading: true, results: [], errors: {} });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => searchAll(q, platforms).then((r) => alive && setState({ loading: false, ...r }), (e) => alive && setState({ loading: false, results: [], errors: { all: e.message } })), 450);
    return () => (alive = false, clearTimeout(t));
  }, [q, platforms]);
  const errs = Object.entries(state.errors);
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-[0.75rem] text-mist-400">
        {state.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        {state.loading ? `Suche „${q}“ in allen Netzwerken …` : `${state.results.length} Treffer für „${q}“`}
      </div>
      <AnimatePresence initial={false}>
        {state.results.map((r, i) => (
          <motion.div key={r.key} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: i * 0.02 }} className="mb-1 flex items-center gap-2 rounded-2xl px-2 py-1.5">
            <button data-nav="" onClick={() => onProfile(r)} className="row-focus flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left">
              <FriendAvatar f={r} dot={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9rem]">{r.name}</span>
                <span className="block truncate text-[0.68rem] text-mist-500">{PLATFORMS[r.platform].label} · {r.id}</span>
              </span>
            </button>
            {r.isFriend ? <span className="flex items-center gap-1 text-[0.7rem] text-ok"><Check className="h-3 w-3" />Freund</span> : <SearchAdd r={r} />}
          </motion.div>
        ))}
      </AnimatePresence>
      {!state.loading && !state.results.length && <div className="p-4 text-center text-[0.8rem] text-mist-500">Keine Treffer. Steam findet Profile über die Vanity-URL / SteamID oder Namen deiner Freunde; Xbox und PSN suchen per Gamertag.</div>}
      {errs.map(([p, e]) => (
        <div key={p} className="mx-2 mt-1 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[0.7rem] text-warn"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span><b>{PLATFORMS[p]?.label || p}:</b> {e}</span></div>
      ))}
    </div>
  );
}

function SearchAdd({ r }) {
  const [st, setSt] = useState('idle');
  return (
    <Button size="sm" variant="primary" icon={st === 'done' ? Check : UserPlus} disabled={st !== 'idle'} onClick={async () => {
      setSt('busy');
      try {
        await addFriendOn(r);
        haptic('success');
        toast({ title: r.platform === 'lumos' ? 'Anfrage gesendet' : r.platform === 'steam' ? 'Steam-Client geöffnet' : 'Hinzugefügt / gefolgt', body: r.name, kind: 'success' });
        setSt('done');
      } catch (e) {
        haptic('error');
        toast({ title: 'Nicht möglich', body: e.message, kind: 'error' });
        setSt('idle');
      }
    }}>
      {r.platform === 'lumos' ? 'Hinzufügen' : 'Folgen'}
    </Button>
  );
}

export default function SocialApp() {
  const c = useCloud();
  const hub = useHub();
  const [tab, setTab] = useState('inbox');
  const [filter, setFilter] = useState(null); // platform | null
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [card, setCard] = useState(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  useTabs((d) => setTab((t) => TABS[(TABS.findIndex((x) => x.key === t) + d + TABS.length) % TABS.length].key), []);
  useEffect(() => {
    refreshHub();
  }, []);

  const all = useMemo(() => unifiedFriends({ cloudFriends: c.friends, presence: hub.presence, external: hub.external }), [c.friends, hub.presence, hub.external]);
  const list = all.filter((f) => !filter || f.platform === filter);
  const friend = all.find((f) => f.key === sel);
  const incoming = c.friends.filter((f) => f.status === 'incoming');
  const outgoing = c.friends.filter((f) => f.status === 'outgoing');
  const linkedCount = EXTERNAL.filter((p) => hub.accounts[p]?.linked).length + (c.user ? 1 : 0);
  const term = q.trim();
  const chatCapable = list.filter((f) => f.chat !== 'none');

  const isMine = !!card && all.some((f) => f.key === card.key);
  const doAdd = async () => {
    try {
      const r = await addFriend(code);
      haptic('success');
      toast({ title: r.status === 'accepted' ? 'Ihr seid jetzt befreundet' : 'Anfrage gesendet', body: r.name, kind: 'success' });
      setAdding(false);
      setCode('');
    } catch (e) {
      haptic('error');
      toast({ title: 'Nicht möglich', body: e.message, kind: 'error' });
    }
  };
  const addFromCard = async () => {
    try {
      await addFriendOn(card);
      haptic('success');
      toast({ title: 'Erledigt', body: card.name, kind: 'success' });
      setCard(null);
    } catch (e) {
      toast({ title: 'Nicht möglich', body: e.message, kind: 'error' });
    }
  };

  const online = list.filter((f) => f.status !== 'offline');
  const playing = online.filter((f) => f.game);
  const idle = online.filter((f) => !f.game);
  const offline = list.filter((f) => f.status === 'offline');
  const rows = (arr, offset = 0) => arr.map((f, i) => <Row key={f.key} f={f} index={i + offset} active={sel === f.key} onClick={() => (setSel(f.key), haptic('select'))} onProfile={setCard} />);

  return (
    <Screen
      title="Freunde & Chat"
      icon={Users}
      noPad
      subtitle={`${linkedCount} Netzwerk${linkedCount === 1 ? '' : 'e'} verbunden${c.me?.friendCode ? ` · Lumos-Code ${c.me.friendCode}` : ''}`}
      actions={
        <>
          <Button size="sm" variant="subtle" icon={hub.loading ? Loader2 : RefreshCw} onClick={refreshHub} aria-label="Aktualisieren" />
          <Button size="sm" variant="subtle" icon={Link2} onClick={() => open('settings', { section: 'accounts' })}>Konten</Button>
          {c.me?.friendCode && <Button size="sm" variant="subtle" icon={Copy} onClick={() => navigator.clipboard?.writeText(c.me.friendCode).then(() => toast({ title: 'Code kopiert', kind: 'success' }))}>Code</Button>}
          {c.user && <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>Per Code</Button>}
        </>
      }
      hints={<><Hint k="lb">Tab</Hint><Hint k="a">Öffnen</Hint><Hint k="y">Profil</Hint><Hint k="b">Zurück</Hint></>}
    >
      <div className="flex h-full gap-5 px-10 pb-14">
        <aside className="flex w-[22rem] shrink-0 flex-col">
          <TextField value={q} onChange={setQ} placeholder="Nutzername in allen Netzwerken suchen …" className="mb-3" data-nav-trap="off" />
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button data-nav="" data-nav-haptic="none" onClick={() => setFilter(null)} className={`nav-focus rounded-full px-3 py-1 text-[0.72rem] ${!filter ? 'bg-mist-50 font-semibold text-ink-950' : 'bg-white/[0.07]'}`}>Alle</button>
            {['lumos', ...EXTERNAL].map((p) => (
              <button key={p} data-nav="" data-nav-haptic="none" onClick={() => setFilter(filter === p ? null : p)} className={`nav-focus flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] ${filter === p ? 'bg-mist-50 font-semibold text-ink-950' : 'bg-white/[0.07]'} ${p !== 'lumos' && !hub.accounts[p]?.linked ? 'opacity-45' : ''}`}>
                <PlatformBadge platform={p} size="0.95rem" />{PLATFORMS[p].label}
              </button>
            ))}
          </div>
          {!term && (
            <LayoutGroup id="social-tabs">
              <div className="mb-2 flex gap-1 rounded-2xl bg-white/[0.06] p-1">
                {TABS.map((t) => (
                  <button key={t.key} data-nav="" data-nav-haptic="none" onClick={() => (setTab(t.key), haptic('nav.page'))} className={`nav-focus relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-[0.8rem] ${tab === t.key ? 'text-ink-950' : 'text-mist-300'}`}>
                    {tab === t.key && <motion.span layoutId="social-tab" transition={spring.snappy} className="absolute inset-0 rounded-xl bg-mist-50" />}
                    <span className="relative flex items-center gap-1.5"><t.icon className="h-3.5 w-3.5" />{t.label}{t.key === 'inbox' && c.unread > 0 && <span className="rounded-full bg-bad px-1.5 text-[0.6rem] font-bold text-white">{c.unread}</span>}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          )}
          <div className="glass min-h-0 flex-1 overflow-y-auto rounded-3xl p-2">
            {term.length >= 2 ? (
              <SearchResults q={term} platforms={filter ? [filter] : null} onProfile={setCard} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab + filter} initial={{ opacity: 0, x: tab === 'inbox' ? -14 : 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={spring.soft}>
                  {incoming.length > 0 && (!filter || filter === 'lumos') && (
                    <div className="mb-2 rounded-2xl bg-white/[0.05] p-1">
                      <div className="label px-2 py-1">Anfragen</div>
                      {incoming.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 px-2 py-1.5">
                          <span className="flex-1 truncate text-[0.88rem]">{f.name}</span>
                          <Button size="sm" variant="primary" icon={Check} onClick={() => acceptFriend(f.id).then(() => haptic('success'))} />
                          <Button size="sm" variant="ghost" icon={Users} onClick={() => removeFriend(f.id)} aria-label="Ablehnen" />
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'inbox' ? (
                    <>
                      {rows([...chatCapable].sort((a, b) => b.unread - a.unread))}
                      {!chatCapable.length && <Empty linked={linkedCount} loading={hub.loading} />}
                    </>
                  ) : (
                    <>
                      <Group title="Spielt gerade">{rows(playing)}</Group>
                      <Group title="Online">{rows(idle, playing.length)}</Group>
                      <Group title="Offline">{rows(offline, online.length)}</Group>
                      {!list.length && <Empty linked={linkedCount} loading={hub.loading} />}
                    </>
                  )}
                  {outgoing.map((f) => <div key={f.id} className="px-3 py-1.5 text-[0.75rem] text-mist-500">Anfrage an {f.name} ausstehend</div>)}
                  {Object.entries(hub.errors).map(([p, e]) => (
                    <div key={p} className="mt-1 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[0.68rem] text-warn"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span><b>{PLATFORMS[p]?.label || p}:</b> {e}</span></div>
                  ))}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </aside>
        <AnimatePresence mode="wait" initial={false}>
          {friend ? (
            <motion.div key={friend.key} className="flex min-w-0 flex-1" initial={{ opacity: 0, x: 24, scale: 0.99 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -12 }} transition={spring.soft}>
              <Conversation friend={friend} />
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass flex h-full flex-1 flex-col items-center justify-center gap-2 rounded-3xl text-center text-mist-500">
              <Inbox className="h-9 w-9" />
              Wähle eine Unterhaltung – oder suche oben nach einem Nutzernamen.
              <span className="text-[0.72rem]">Y bzw. Rechtsklick auf einen Freund öffnet die Profilkarte.</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ProfileCard
        f={card}
        onClose={() => setCard(null)}
        onChat={isMine ? () => (setSel(card.key), setCard(null)) : null}
        onAdd={card && !isMine ? addFromCard : null}
      />
      <Sheet open={adding} onClose={() => setAdding(false)} title="Lumos-Freund per Code hinzufügen">
        <p className="mb-3 text-[0.85rem] text-mist-300">Gib den 8-stelligen Freundescode ein, den dein Freund in „Freunde & Chat“ sieht.</p>
        <TextField autoFocus value={code} onChange={(x) => setCode(x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="z. B. K7QM2XPA" className="text-center font-mono tracking-[0.3em]" onEnter={doAdd} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={doAdd} disabled={code.length < 8}>Anfrage senden</Button>
        </div>
      </Sheet>
    </Screen>
  );
}

function Empty({ linked, loading }) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center text-[0.8rem] text-mist-500">
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      {linked === 0 ? 'Noch kein Netzwerk verbunden.' : 'Keine Freunde in dieser Ansicht.'}
      <Button size="sm" variant="primary" icon={Link2} onClick={() => open('settings', { section: 'accounts' })}>Konten verknüpfen</Button>
    </div>
  );
}
