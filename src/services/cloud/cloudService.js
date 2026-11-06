// Lumos Cloud — profiles, settings, cloud saves, entitlements, devices.
// Local-first: every write lands in the local cache + a persistent outbox first and is flushed
// to the active backend (self-hosted Lumos REST server or Supabase) when online. Pulls merge
// per-key last-writer-wins for settings and version-checked documents for the profile.
import { create } from 'zustand';
import { RestAdapter } from './restAdapter.js';
import { SupabaseAdapter } from './supabaseAdapter.js';
import { loadJSON, saveJSON } from '../storage.js';
import { request as daemon } from '../bridge.js';

const LS_SESSION = 'lumos.cloud.session';
const LS_CACHE = 'lumos.cloud.cache';
const LS_OUTBOX = 'lumos.cloud.outbox';
const LS_CONFIG = 'lumos.cloud.config';
const LS_DEVICE = 'lumos.deviceId';

export const useCloud = create(() => ({
  provider: null,
  status: 'signed-out', // signed-out | idle | syncing | offline | error
  user: null,
  lastSync: null,
  pending: 0,
  error: null,
  saves: [],
  entitlements: [],
  devices: [],
  config: loadJSON(LS_CONFIG, null),
  // v1.1
  me: null,
  friends: [],
  unread: 0,
  conflicts: {}, // save id → { local, remote }
}));

const set = (p) => useCloud.setState(p);
let adapter = null;
let cache = loadJSON(LS_CACHE, { settings: { values: {}, stamps: {}, version: 0 }, profile: { data: null, version: 0, dirtyAt: 0 }, saveVersions: {} });
cache.saveBase ||= {}; // save id → { version, sha } of the last successful sync (conflict detection)
let outbox = loadJSON(LS_OUTBOX, []);
let sources = { settings: null, profile: null };
let timer = null;
let syncing = null;

export function deviceId() {
  let id = localStorage.getItem(LS_DEVICE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_DEVICE, id);
  }
  return id;
}

function persist() {
  saveJSON(LS_CACHE, cache);
  saveJSON(LS_OUTBOX, outbox);
  set({ pending: outbox.length });
}

export function cloudConfig() {
  const env = import.meta.env;
  const saved = useCloud.getState().config;
  return {
    provider: saved?.provider || env.VITE_CLOUD_PROVIDER || 'lumos',
    lumosUrl: saved?.lumosUrl || env.VITE_LUMOS_CLOUD_URL || 'http://127.0.0.1:8787',
    supabaseUrl: saved?.supabaseUrl || env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: saved?.supabaseAnonKey || env.VITE_SUPABASE_ANON_KEY || '',
  };
}

export function setCloudConfig(cfg) {
  saveJSON(LS_CONFIG, cfg);
  set({ config: cfg });
  adapter = null;
  initCloud();
}

function makeAdapter() {
  const c = cloudConfig();
  if (c.provider === 'supabase' && c.supabaseUrl && c.supabaseAnonKey) return new SupabaseAdapter(c.supabaseUrl, c.supabaseAnonKey);
  return new RestAdapter(c.lumosUrl);
}

export function registerSource(kind, src) {
  sources[kind] = src;
}

export function initCloud() {
  if (adapter) return;
  adapter = makeAdapter();
  set({ provider: adapter.name });
  adapter.onSession = (s) => {
    if (adapter.name === 'lumos') saveJSON(LS_SESSION, s);
    set({ user: s?.user ?? null, status: s ? useCloud.getState().status === 'signed-out' ? 'idle' : useCloud.getState().status : 'signed-out' });
  };
  if (adapter.name === 'lumos') {
    const s = loadJSON(LS_SESSION, null);
    if (s) adapter.setSession(s);
  }
  set({ pending: outbox.length });
  clearInterval(timer);
  timer = setInterval(() => syncNow().catch(() => {}), 60e3);
  window.addEventListener('online', () => syncNow().catch(() => {}));
  setTimeout(() => syncNow().catch(() => {}), 1500);
  setTimeout(() => useCloud.getState().user && startSocialPolling(), 2500);
}

export async function signIn(creds) {
  initCloud();
  set({ error: null });
  await adapter.signIn(creds);
  await adapter.registerDevice({ deviceId: deviceId(), name: 'Lumos One', model: 'LUMOS-ONE-8' }).catch(() => {});
  await syncNow();
  startSocialPolling();
}

export async function signUp(creds) {
  initCloud();
  set({ error: null });
  await adapter.signUp(creds);
  await adapter.registerDevice({ deviceId: deviceId(), name: 'Lumos One', model: 'LUMOS-ONE-8' }).catch(() => {});
  await syncNow();
  startSocialPolling();
}

export async function signOut() {
  await adapter?.signOut();
  clearInterval(socialTimer);
  set({ user: null, status: 'signed-out', saves: [], entitlements: [], devices: [], me: null, friends: [], unread: 0 });
}

function enqueue(op) {
  // coalesce document writes: only the latest settings/profile write matters
  if (op.kind === 'settings' || op.kind === 'profile') outbox = outbox.filter((o) => o.kind !== op.kind);
  outbox.push({ ...op, t: Date.now() });
  persist();
  clearTimeout(enqueue.t);
  enqueue.t = setTimeout(() => syncNow().catch(() => {}), 2500);
}

/** Called by the settings store whenever a synced setting changes. */
export function settingsChanged(values, stamps) {
  cache.settings.values = { ...cache.settings.values, ...values };
  cache.settings.stamps = { ...cache.settings.stamps, ...stamps };
  enqueue({ kind: 'settings' });
}

export function profileChanged(profile) {
  cache.profile = { ...cache.profile, data: profile, dirtyAt: Date.now() };
  enqueue({ kind: 'profile' });
}

export function mergeSettings(local, remote) {
  const values = { ...local.values };
  const stamps = { ...local.stamps };
  for (const [k, v] of Object.entries(remote.values || {})) {
    if ((remote.stamps?.[k] ?? 0) > (stamps[k] ?? 0)) {
      values[k] = v;
      stamps[k] = remote.stamps[k];
    }
  }
  return { values, stamps };
}

async function flush() {
  while (outbox.length) {
    const op = outbox[0];
    if (op.kind === 'settings') {
      const doc = { values: cache.settings.values, stamps: cache.settings.stamps };
      try {
        const r = await adapter.putSettings(doc, cache.settings.version);
        cache.settings.version = r.version;
      } catch (e) {
        if (e.status !== 409) throw e;
        const remote = await adapter.getSettings();
        const merged = mergeSettings(doc, remote.settings || {});
        cache.settings = { ...merged, version: remote.version };
        const r = await adapter.putSettings(merged, remote.version);
        cache.settings.version = r.version;
        sources.settings?.apply(merged.values, merged.stamps);
      }
    } else if (op.kind === 'profile') {
      try {
        const r = await adapter.putProfile(cache.profile.data, cache.profile.version);
        cache.profile.version = r.version;
        cache.profile.dirtyAt = 0;
      } catch (e) {
        if (e.status !== 409) throw e;
        // profile conflict: local edit wins if it is newer than the remote document
        const remote = await adapter.getProfile();
        if ((remote.updatedAt ?? 0) > cache.profile.dirtyAt) {
          cache.profile = { data: remote.profile, version: remote.version, dirtyAt: 0 };
          sources.profile?.apply(remote.profile);
        } else {
          const r = await adapter.putProfile(cache.profile.data, remote.version);
          cache.profile.version = r.version;
        }
      }
    } else if (op.kind === 'entitlement') {
      await adapter.addEntitlement(op.data);
    }
    outbox.shift();
    persist();
  }
}

async function pull() {
  const [settings, profile, saves, entitlements, devices] = await Promise.all([
    adapter.getSettings(),
    adapter.getProfile(),
    adapter.listSaves(),
    adapter.listEntitlements(),
    adapter.listDevices().catch(() => []),
  ]);
  if (settings?.settings) {
    const merged = mergeSettings({ values: cache.settings.values, stamps: cache.settings.stamps }, settings.settings);
    cache.settings = { ...merged, version: settings.version };
    sources.settings?.apply(merged.values, merged.stamps);
  }
  if (profile?.profile && !cache.profile.dirtyAt) {
    cache.profile = { data: profile.profile, version: profile.version, dirtyAt: 0 };
    sources.profile?.apply(profile.profile);
  }
  persist();
  set({ saves, entitlements, devices });
}

export function syncNow() {
  if (!adapter || !useCloud.getState().user) return Promise.resolve();
  if (syncing) return syncing;
  set({ status: 'syncing', error: null });
  syncing = (async () => {
    try {
      await flush();
      await pull();
      set({ status: 'idle', lastSync: Date.now() });
    } catch (e) {
      if (e.status === 401) set({ status: 'signed-out', user: null });
      else set({ status: e.offline ? 'offline' : 'error', error: e.message });
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Packs a local save set via lumosd and uploads it. */
async function packLocal(save) {
  const packed = await daemon('saves.pack', { id: save.id }, 120000);
  let bytes;
  if (window.lumos?.cache && packed.archive) bytes = new Uint8Array(await window.lumos.cache.read(packed.archive));
  else if (packed.simulated) bytes = new TextEncoder().encode(JSON.stringify({ lumosSimulatedSave: save.id, title: save.title, hash: save.hash, t: save.mtime }));
  else throw new Error('Cloud-Saves benötigen die Lumos-Shell (Electron)');
  const sha = await sha256Hex(bytes);
  if (packed.sha256 && !packed.simulated && packed.sha256 !== sha) throw new Error('Prüfsumme des Archivs stimmt nicht');
  return { bytes, sha };
}

async function localManifest(id) {
  try {
    return await daemon('saves.manifest', { id }, 60000);
  } catch {
    return [];
  }
}

/** Packs a local save set via lumosd and uploads it (optionally forcing over a newer cloud version). */
export async function uploadSave(save, { force = false } = {}) {
  initCloud();
  const { bytes, sha } = await packLocal(save);
  const remote = useCloud.getState().saves.find((r) => r.id === save.id);
  const manifest = await localManifest(save.id);
  const baseVersion = force ? remote?.version : cache.saveBase[save.id]?.version ?? cache.saveVersions[save.id];
  const meta = await adapter.uploadSave({ id: save.id, title: save.title, sha256: sha, bytes, baseVersion, device: deviceId(), manifest });
  await adapter.putManifest?.(save.id, manifest).catch(() => {});
  cache.saveVersions[save.id] = meta.version;
  cache.saveBase[save.id] = { version: meta.version, sha: save.hash || sha };
  clearConflict(save.id);
  persist();
  await pull();
  return meta;
}

export async function restoreSave(id) {
  initCloud();
  const bytes = await adapter.downloadSave(id);
  const remote = useCloud.getState().saves.find((s) => s.id === id);
  if (remote?.sha256 && (await sha256Hex(bytes)) !== remote.sha256) throw new Error('Download beschädigt (SHA-256)');
  if (window.lumos?.cache) {
    const file = await window.lumos.cache.write(`${id.replace(/[^\w.-]/g, '_')}.tar.gz`, bytes);
    await daemon('saves.restore', { id, archive: file }, 120000);
  } else await daemon('saves.restore', { id, archive: null }, 120000);
  cache.saveVersions[id] = remote?.version;
  const local = (await daemon('saves.list').catch(() => [])).find((s) => s.id === id);
  cache.saveBase[id] = { version: remote?.version, sha: local?.hash || remote?.sha256 };
  clearConflict(id);
  persist();
}

function clearConflict(id) {
  const c = { ...useCloud.getState().conflicts };
  delete c[id];
  set({ conflicts: c });
}

/**
 * Steam/PS-Plus style sync of one save set: upload if only the local copy changed, offer the cloud copy if
 * only the cloud changed, and raise a conflict (side-by-side + file diff) if both changed since the last sync.
 */
export async function syncSave(local, { auto = false } = {}) {
  initCloud();
  if (!useCloud.getState().user) return { status: 'signed-out' };
  await pull().catch(() => {});
  const remote = useCloud.getState().saves.find((r) => r.id === local.id);
  const base = cache.saveBase[local.id];
  if (!remote) return { status: 'uploaded', meta: await uploadSave(local) };
  if (remote.sha256 === local.hash) {
    cache.saveBase[local.id] = { version: remote.version, sha: local.hash };
    persist();
    return { status: 'in-sync' };
  }
  const localChanged = !base || base.sha !== local.hash;
  const remoteChanged = !base || base.version !== remote.version;
  if (localChanged && !remoteChanged) return { status: 'uploaded', meta: await uploadSave(local) };
  if (remoteChanged && !localChanged) {
    set({ conflicts: { ...useCloud.getState().conflicts, [local.id]: { local, remote, kind: 'cloud-newer' } } });
    return { status: 'cloud-newer', remote };
  }
  set({ conflicts: { ...useCloud.getState().conflicts, [local.id]: { local, remote, kind: 'conflict' } } });
  return { status: 'conflict', remote, auto };
}

/** File-level diff between the local save set and the cloud manifest. */
export async function diffSave(id) {
  const [local, remote] = await Promise.all([localManifest(id), adapter.getManifest?.(id).catch(() => []) ?? []]);
  const L = new Map(local.map((f) => [f.path, f]));
  const R = new Map((remote || []).map((f) => [f.path, f]));
  const rows = [];
  for (const [path, f] of L) {
    const r = R.get(path);
    if (!r) rows.push({ path, change: 'local-only', local: f });
    else if (r.size !== f.size || (r.sha256 && f.sha256 && r.sha256 !== f.sha256) || Math.abs((r.mtime || 0) - (f.mtime || 0)) > 2000) rows.push({ path, change: 'changed', local: f, remote: r });
    else rows.push({ path, change: 'same', local: f, remote: r });
  }
  for (const [path, r] of R) if (!L.has(path)) rows.push({ path, change: 'cloud-only', remote: r });
  return rows.sort((a, b) => ({ changed: 0, 'local-only': 1, 'cloud-only': 2, same: 3 })[a.change] - ({ changed: 0, 'local-only': 1, 'cloud-only': 2, same: 3 })[b.change] || a.path.localeCompare(b.path));
}

export async function resolveConflict(id, keep) {
  const c = useCloud.getState().conflicts[id];
  if (!c) return;
  if (keep === 'local') await uploadSave(c.local, { force: true });
  else await restoreSave(id);
}

// ---------------------------------------------------------------- v1.1 friends & chat
let socialTimer = null;
export async function refreshSocial() {
  if (!adapter || !useCloud.getState().user || !adapter.listFriends) return;
  try {
    const [me, friends] = await Promise.all([useCloud.getState().me ? Promise.resolve(useCloud.getState().me) : adapter.me(), adapter.listFriends()]);
    const prevUnread = useCloud.getState().unread;
    const unread = friends.reduce((a, f) => a + (f.unread || 0), 0);
    set({ me, friends, unread });
    if (unread > prevUnread) window.dispatchEvent(new CustomEvent('lumos:new-message', { detail: { unread } }));
  } catch (e) {
    if (import.meta.env.DEV) console.debug('[social]', e.message);
  }
}
export function startSocialPolling() {
  clearInterval(socialTimer);
  socialTimer = setInterval(refreshSocial, 20000);
  refreshSocial();
}
export const addFriend = async (code) => {
  const r = await adapter.addFriend(code);
  await refreshSocial();
  return r;
};
export const acceptFriend = async (id) => (await adapter.acceptFriend(id), refreshSocial());
export const removeFriend = async (id) => (await adapter.removeFriend(id), refreshSocial());
export const adapterRef = () => adapter;
export const listMessages = (id, after) => adapter.listMessages(id, after);
export const sendTyping = (id) => adapter?.sendTyping?.(id)?.catch?.(() => {});
export const isTyping = (id) => (adapter?.isTyping ? adapter.isTyping(id).catch(() => false) : Promise.resolve(false));

/** Realtime delivery: Supabase pushes (websocket); the self-hosted server falls back to polling in the UI. */
export function subscribeRealtime(handlers) {
  return adapter?.subscribe ? adapter.subscribe(handlers) : null;
}
export const sendMessage = (id, msg) => adapter.sendMessage(id, msg);
export const uploadMedia = (blob, title) => adapter.uploadMedia(blob, title);
export const fetchMedia = (id, att) => adapter.fetchMedia(id, att);

export async function deleteCloudSave(id) {
  await adapter.deleteSave(id);
  await pull();
}

export function addEntitlement(e) {
  enqueue({ kind: 'entitlement', data: e });
}

export const cloudHealth = () => (initCloud(), adapter.health());
