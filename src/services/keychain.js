// Renderer-side keychain facade. In the Lumos shell all crypto happens in the Electron main
// process (electron/keychain.js). In a plain browser preview we use a WebCrypto vault with a
// non-extractable AES-GCM key in IndexedDB, gated by the same daemon Face ID verification.
import { idb } from './storage.js';
import { request } from './bridge.js';

function browserVault() {
  let unlocked = false;
  let entries = null;
  let lockTimer;

  async function key() {
    let k = await idb.get('keychain.key');
    if (!k) {
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idb.set('keychain.key', k);
    }
    return k;
  }
  async function load() {
    const box = await idb.get('keychain.vault');
    if (!box) return [];
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, await key(), box.ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function save() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(entries)));
    await idb.set('keychain.vault', { iv, ct });
  }
  const need = () => {
    if (!unlocked) throw Object.assign(new Error('Schlüsselbund gesperrt'), { code: 'LOCKED' });
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => api.lock(), 5 * 60e3);
  };
  const host = (o) => {
    try {
      return new URL(o.includes('://') ? o : `https://${o}`).hostname.replace(/^www\./, '');
    } catch {
      return o;
    }
  };
  const verify = async (reason) => {
    const r = await request('faceid.verify', { reason, timeout: 8 }, 15000);
    if (!r?.ok) throw Object.assign(new Error(r?.reason || 'Face ID nicht erkannt'), { code: 'FACE_REJECTED' });
  };
  const api = {
    status: async () => ({ exists: !!(await idb.get('keychain.vault')), unlocked, hasPin: false, backend: 'webcrypto', count: entries?.length ?? null }),
    setup: async () => ((entries = []), (unlocked = true), save()),
    unlock: async ({ reason = 'Schlüsselbund entsperren' } = {}) => {
      if (!unlocked) {
        await verify(reason);
        entries = await load();
        unlocked = true;
      }
      need();
      return api.status();
    },
    lock: async () => ((unlocked = false), (entries = null), api.status()),
    list: async () => (need(), entries.map(({ password, ...m }) => ({ ...m, strength: Math.min(4, Math.floor(password.length / 5)) }))),
    get: async (id) => (need(), { ...entries.find((e) => e.id === id) }),
    upsert: async (e) => {
      need();
      const now = Date.now();
      const item = { ...e, id: e.id || crypto.randomUUID(), origin: host(e.origin || ''), updatedAt: now, createdAt: e.createdAt || now };
      const i = entries.findIndex((x) => x.id === item.id);
      i >= 0 ? (entries[i] = { ...entries[i], ...item }) : entries.push(item);
      await save();
      return { ...item, password: undefined };
    },
    remove: async (id) => (need(), (entries = entries.filter((x) => x.id !== id)), save()),
    setPin: async () => {
      throw new Error('PIN nur in der Lumos-Shell');
    },
    autofill: async (origin) => {
      await verify(`Anmeldedaten für ${host(origin)} einsetzen`);
      if (!unlocked) {
        entries = await load();
        unlocked = true;
      }
      const h = host(origin);
      return entries.filter((e) => e.origin && (h === e.origin || h.endsWith(`.${e.origin}`)));
    },
    totp: async () => {
      throw new Error('TOTP nur in der Lumos-Shell');
    },
    generate: async ({ length = 20 } = {}) => {
      const cs = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.!?@#%+=';
      const r = crypto.getRandomValues(new Uint32Array(length));
      return Array.from(r, (x) => cs[x % cs.length]).join('');
    },
  };
  return api;
}

let impl;
export function keychain() {
  if (!impl) impl = window.lumos?.keychain ?? browserVault();
  return impl;
}
