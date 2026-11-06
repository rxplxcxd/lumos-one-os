// Universal Social Hub: one unified model over LumosOS (cloud) + Steam / Xbox / PSN / Nintendo
// (daemon `social.*`). Friends, presence, search, chat routing, account linking.
//
// Unified friend:
//   { key: 'steam:7656…', platform, id, name, avatar, status: online|away|busy|offline,
//     game: {name, cover}|null, since?, text, lastSeen, party: {size,max}|null, unread, chat }
import { create } from 'zustand';
import { request } from '@/services/bridge.js';
import { useCloud, refreshSocial, adapterRef, subscribeRealtime, addFriend as lumosAdd } from '@/services/cloud/cloudService.js';
import { useSystem } from '@/store/system.js';
import { toast } from '@/store/ui.js';

export const PLATFORMS = {
  lumos: { label: 'LumosOS', short: 'L', color: '#7aa7ff', chat: 'native' },
  steam: { label: 'Steam', short: 'S', color: '#2a475e', chat: 'deeplink' },
  xbox: { label: 'Xbox', short: 'X', color: '#107c10', chat: 'native' },
  psn: { label: 'PlayStation', short: 'P', color: '#0070d1', chat: 'none' },
  nintendo: { label: 'Nintendo', short: 'N', color: '#e60012', chat: 'none' },
};
export const EXTERNAL = ['steam', 'xbox', 'psn', 'nintendo'];

export const useHub = create(() => ({
  accounts: {}, // platform → {linked, name, id, experimental}
  external: [], // normalised friends from the daemon
  presence: {}, // lumos friend id → presence
  errors: {}, // platform → last error
  loading: false,
  typing: {}, // key → timestamp (lumos friends typing to us)
  last: {}, // key → last message preview {text, t, mine}
  xbox: { unread: 0 },
}));
const set = (p) => useHub.setState(p);

export async function refreshAccounts() {
  try {
    set({ accounts: await request('social.accounts') });
  } catch {
    /* daemon offline */
  }
}
export async function linkAccount(platform, credentials) {
  const r = await request('social.link', { platform, credentials }, 60000);
  await refreshAccounts();
  refreshHub();
  return r;
}
export async function unlinkAccount(platform) {
  await request('social.unlink', { platform });
  await refreshAccounts();
  set({ external: useHub.getState().external.filter((f) => f.platform !== platform) });
}

let inflight = null;
export function refreshHub() {
  if (inflight) return inflight;
  set({ loading: true });
  inflight = (async () => {
    try {
      const [fr, pres] = await Promise.all([
        request('social.friends', {}, 45000).catch((e) => ({ friends: [], errors: { all: e.message } })),
        useCloud.getState().user && adapterRef()?.listPresence ? adapterRef().listPresence().catch(() => ({})) : Promise.resolve({}),
      ]);
      set({ external: fr.friends || [], errors: fr.errors || {}, presence: pres });
      refreshSocial();
    } finally {
      set({ loading: false });
      inflight = null;
    }
  })();
  return inflight;
}

const STATUS_RANK = { online: 0, busy: 1, away: 2, offline: 3 };
const byActivity = (a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (b.unread || 0) - (a.unread || 0) || a.name.localeCompare(b.name);

/** All friends of all networks as one list (selector helper – call inside useMemo). */
export function unifiedFriends({ cloudFriends, presence, external }) {
  const lumos = cloudFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const p = presence[f.id] || {};
      return { key: `lumos:${f.id}`, platform: 'lumos', id: f.id, name: f.name, avatar: null, status: p.status || 'offline', game: p.game ? { name: p.game, cover: p.cover } : null, since: p.since, text: p.game ? `Spielt ${p.game}` : '', lastSeen: p.lastSeen || null, party: p.party || null, unread: f.unread || 0, code: f.code, chat: 'native' };
    });
  const ext = external.map((f) => ({ ...f, key: `${f.platform}:${f.id}`, unread: 0, chat: PLATFORMS[f.platform]?.chat || 'none' }));
  return [...lumos, ...ext].sort(byActivity);
}

export function presenceText(f) {
  if (f.status === 'offline') return f.lastSeen ? `Zuletzt online ${ago(f.lastSeen)}` : 'Offline';
  if (f.game) return `${f.game.name}${f.since ? ` · seit ${duration(f.since)}` : ''}${f.party ? ` · In Voice-Party (${f.party.size}/${f.party.max})` : ''}`;
  return f.status === 'away' ? 'Abwesend' : f.status === 'busy' ? 'Beschäftigt' : f.text || 'Online';
}
export function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  return h < 48 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tagen`;
}
export function duration(since) {
  const m = Math.max(1, Math.round((Date.now() - since) / 60000));
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
}

// ------------------------------------------------------------------------- search
/** Searches every linked network (and the LumosOS directory) simultaneously by user name. */
export async function searchAll(query, platforms) {
  const want = (p) => !platforms || platforms.includes(p);
  const jobs = [];
  const cloud = useCloud.getState();
  const lumos = want('lumos') && cloud.user && adapterRef()?.searchUsers
    ? adapterRef().searchUsers(query).then((r) => r.map((u) => ({ platform: 'lumos', id: u.id, name: u.name, avatar: null, status: 'offline', game: null, text: `Freundescode ${u.code}`, code: u.code, friend: u.friend })))
    : Promise.resolve([]);
  jobs.push(lumos.then((r) => ({ platform: 'lumos', r }), (e) => ({ platform: 'lumos', err: e.message })));
  const ext = EXTERNAL.filter(want);
  jobs.push(
    request('social.search', { query, platforms: ext }, 45000).then(
      (r) => ({ ext: r }),
      (e) => ({ ext: { results: [], errors: Object.fromEntries(ext.map((p) => [p, e.message])) } }),
    ),
  );
  const out = await Promise.all(jobs);
  const results = [];
  const errors = {};
  for (const o of out) {
    if (o.platform === 'lumos') o.err ? (errors.lumos = o.err) : results.push(...o.r);
    else (results.push(...o.ext.results), Object.assign(errors, o.ext.errors));
  }
  const friendKeys = new Set(unifiedFriends({ cloudFriends: cloud.friends, presence: useHub.getState().presence, external: useHub.getState().external }).map((f) => f.key));
  return { results: results.map((r) => ({ ...r, key: `${r.platform}:${r.id}`, isFriend: r.friend || friendKeys.has(`${r.platform}:${r.id}`) })), errors };
}

export async function addFriendOn(item) {
  if (item.platform === 'lumos') return lumosAdd(item.code);
  const r = await request('social.add', { platform: item.platform, id: item.id });
  if (r.deeplink) openLink(r.deeplink);
  return r;
}
export function openLink(url) {
  if (window.lumos?.openExternal) window.lumos.openExternal(url).catch((e) => toast({ title: 'Konnte nicht öffnen', body: e.message, kind: 'error' }));
  else window.open(url, '_blank', 'noopener');
}

// -------------------------------------------------------------- own rich presence
let presenceTimer = null;
export function startHub() {
  refreshAccounts();
  refreshHub();
  const publish = () => {
    const a = adapterRef();
    if (!a?.setPresence || !useCloud.getState().user) return;
    const run = useSystem.getState().running;
    a.setPresence({ status: document.hidden ? 'away' : 'online', game: run?.name || null, since: run?.started || null, cover: null, party: null }).catch(() => {});
  };
  publish();
  presenceTimer = setInterval(() => (publish(), refreshHub()), 60000);
  const unsub = useSystem.subscribe((s, p) => s.running !== p.running && publish());
  // push delivery (Supabase Realtime websockets) → window events the open conversation listens to
  let off = null;
  const wire = () => {
    off?.();
    off = useCloud.getState().user
      ? subscribeRealtime({
          onMessage: (m) => (window.dispatchEvent(new CustomEvent('lumos:rt', { detail: { type: 'message', m } })), refreshSocial()),
          onRead: (m) => window.dispatchEvent(new CustomEvent('lumos:rt', { detail: { type: 'read', m } })),
          onTyping: (from) => window.dispatchEvent(new CustomEvent('lumos:rt', { detail: { type: 'typing', from } })),
          onPresence: () => refreshHub(),
        })
      : null;
  };
  wire();
  const unsubUser = useCloud.subscribe((s, p) => s.user?.id !== p.user?.id && (wire(), publish()));
  return () => (clearInterval(presenceTimer), unsub(), unsubUser(), off?.());
}
