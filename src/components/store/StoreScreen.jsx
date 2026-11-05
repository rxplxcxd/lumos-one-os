// Lumos Store — native UI on top of the Flathub REST API.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, BadgeCheck, ShoppingBag, WifiOff } from 'lucide-react';
import { Screen, Hint, TextField, Img } from '@/components/ui/primitives.jsx';
import DownloadTray from '@/components/shell/DownloadTray.jsx';
import InstallButton from './InstallButton.jsx';
import AppDetail from './AppDetail.jsx';
import { STORE_CATEGORIES, collection, category, search, picks } from '@/services/flathub.js';
import { open } from '@/store/ui.js';
import { useTabs, useAction } from '@/hooks/useInputSystem.js';
import { refreshInstalled } from '@/store/downloads.js';
import { spring, listStagger, itemRise } from '@/lib/motion.js';

let lastTab = 'discover';

function AppCard({ app }) {
  return (
    <motion.div variants={itemRise} className="glass flex items-center gap-3.5 rounded-3xl p-3.5">
      <button data-nav="" onClick={() => open('store', { app: app.id })} className="nav-focus flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl text-left">
        <Img src={app.icon} alt="" className="h-14 w-14 shrink-0 rounded-2xl" fallback={<div className="h-14 w-14 shrink-0 rounded-2xl bg-white/10" />} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 truncate text-[0.92rem] font-semibold">
            {app.name} {app.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-lumen-400" />}
          </span>
          <span className="line-clamp-2 text-[0.75rem] text-mist-400">{app.summary}</span>
        </span>
      </button>
      <InstallButton app={app} />
    </motion.div>
  );
}

function Row({ title, items }) {
  if (!items?.length) return null;
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-[1.05rem] font-semibold tracking-tight">{title}</h2>
      <motion.div variants={listStagger} initial="initial" animate="animate" className="grid grid-cols-3 gap-3">
        {items.slice(0, 9).map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
      </motion.div>
    </section>
  );
}

function Hero({ items }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % Math.max(1, items.length)), 6500);
    return () => clearInterval(t);
  }, [items.length]);
  const a = items[i];
  if (!a) return null;
  return (
    <div className="relative mb-8 h-[13rem] overflow-hidden rounded-[2rem] bg-ink-800">
      <AnimatePresence mode="wait">
        <motion.div key={a.id} className="absolute inset-0" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
          <Img src={a.icon} alt="" className="absolute -right-10 top-1/2 h-[22rem] w-[22rem] -translate-y-1/2 opacity-25 blur-3xl" fallback={<div />} />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/80 to-transparent" />
          <div className="relative flex h-full items-center gap-6 px-8">
            <Img src={a.icon} alt="" className="h-28 w-28 rounded-[1.8rem] shadow-2xl" />
            <div className="min-w-0 max-w-[36rem]">
              <div className="label text-lumen-400">Empfohlen für Handhelds</div>
              <div className="mt-1 text-[1.9rem] font-semibold tracking-tight">{a.name}</div>
              <div className="line-clamp-2 text-[0.85rem] text-mist-300">{a.summary}</div>
              <div className="mt-4 flex gap-3">
                <InstallButton app={a} size="lg" />
                <button data-nav="" onClick={() => open('store', { app: a.id })} className="nav-focus glass h-12 rounded-full px-5 text-[0.9rem] font-medium">
                  Details
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-4 right-6 flex gap-1.5">
        {items.slice(0, 8).map((x, k) => (
          <span key={x.id} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-white' : 'w-1.5 bg-white/30'}`} />
        ))}
      </div>
    </div>
  );
}

function useAsync(fn, deps) {
  const [s, setS] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setS((p) => ({ ...p, loading: true, error: null }));
    fn().then(
      (data) => alive && setS({ loading: false, data, error: null }),
      (error) => alive && setS({ loading: false, data: null, error }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

function Discover() {
  const s = useAsync(async () => {
    const [p, popular, trending, added] = await Promise.allSettled([picks(), collection('popular', { perPage: 12 }), collection('trending', { perPage: 12 }), collection('recently-added', { perPage: 12 })]);
    const v = (r) => (r.status === 'fulfilled' ? r.value : null);
    if (![p, popular, trending, added].some((r) => r.status === 'fulfilled')) throw p.reason;
    return { picks: v(p) || [], popular: v(popular)?.items, trending: v(trending)?.items, added: v(added)?.items };
  }, []);
  if (s.error) return <Offline error={s.error} />;
  if (s.loading) return <Skeleton />;
  return (
    <>
      <Hero items={s.data.picks} />
      <Row title="Für Handhelds" items={s.data.picks} />
      <Row title="Beliebt" items={s.data.popular} />
      <Row title="Im Trend" items={s.data.trending} />
      <Row title="Neu auf Flathub" items={s.data.added} />
    </>
  );
}

function CategoryView({ cat }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const s = useAsync(() => category(cat, { page, perPage: 30 }), [cat, page]);
  useEffect(() => {
    if (s.data) setItems((prev) => (page === 1 ? s.data.items : [...prev, ...s.data.items]));
  }, [s.data, page]);
  useEffect(() => setPage(1), [cat]);
  if (s.error && !items.length) return <Offline error={s.error} />;
  if (s.loading && !items.length) return <Skeleton />;
  return (
    <>
      <motion.div variants={listStagger} initial="initial" animate="animate" className="grid grid-cols-3 gap-3">
        {items.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
      </motion.div>
      {s.data && s.data.items.length >= 30 && (
        <div className="mt-6 flex justify-center">
          <button data-nav="" onClick={() => setPage((p) => p + 1)} className="nav-focus glass rounded-full px-6 py-2.5 text-[0.85rem]">
            {s.loading ? 'Lädt …' : 'Mehr laden'}
          </button>
        </div>
      )}
    </>
  );
}

function SearchView({ q }) {
  const s = useAsync(() => search(q), [q]);
  if (s.loading) return <Skeleton />;
  if (s.error) return <Offline error={s.error} />;
  if (!s.data.items.length) return <div className="py-20 text-center text-mist-400">Keine Treffer für „{q}“</div>;
  return (
    <motion.div variants={listStagger} initial="initial" animate="animate" className="grid grid-cols-3 gap-3">
      {s.data.items.map((a) => (
        <AppCard key={a.id} app={a} />
      ))}
    </motion.div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 9 }, (_, i) => (
        <motion.div key={i} className="glass h-[5.6rem] rounded-3xl" animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.06 }} />
      ))}
    </div>
  );
}

function Offline({ error }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <WifiOff className="h-10 w-10 text-mist-400" />
      <div className="text-lg font-semibold">Flathub nicht erreichbar</div>
      <div className="max-w-[30rem] text-[0.8rem] text-mist-400">{String(error?.message || error)} — prüfe die Netzwerkverbindung. Bereits geladene Seiten werden aus dem Cache angezeigt.</div>
    </div>
  );
}

export default function StoreScreen({ app }) {
  const [tab, setTab] = useState(lastTab);
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const searchRef = useRef(null);
  useEffect(() => {
    lastTab = tab;
  }, [tab]);
  useEffect(() => {
    refreshInstalled();
  }, []);
  useTabs((dir) => {
    if (app) return;
    const i = STORE_CATEGORIES.findIndex((c) => c.key === tab);
    setTab(STORE_CATEGORIES[(i + dir + STORE_CATEGORIES.length) % STORE_CATEGORIES.length].key);
    setSubmitted('');
  }, [tab, app]);
  useAction((a) => a === 'x' && !app && searchRef.current?.focus(), [app]);

  if (app) return <AppDetail id={app} />;

  return (
    <Screen
      title="Store"
      icon={ShoppingBag}
      tabs={STORE_CATEGORIES}
      tab={submitted ? null : tab}
      onTab={(t) => (setTab(t), setSubmitted(''))}
      actions={
        <div className="relative w-[17rem]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
          <TextField ref={searchRef} value={q} onChange={setQ} placeholder="Flathub durchsuchen" className="h-10 rounded-full py-2 pl-10 text-[0.85rem]" onEnter={() => setSubmitted(q.trim())} />
        </div>
      }
      hints={
        <>
          <Hint k="lb">/ R Kategorie</Hint>
          <Hint k="x">Suchen</Hint>
          <Hint k="a">Auswählen</Hint>
          <Hint k="b">Zurück</Hint>
        </>
      }
    >
      <div className="mb-4 w-[24rem]">
        <DownloadTray />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={submitted || tab} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={spring.soft}>
          {submitted ? <SearchView q={submitted} /> : tab === 'discover' ? <Discover /> : <CategoryView cat={tab} />}
        </motion.div>
      </AnimatePresence>
      <p className="mt-10 text-center text-[0.68rem] text-mist-500">Inhalte & Metadaten: Flathub (flathub.org) · Installation über Flatpak im Hintergrund</p>
    </Screen>
  );
}
