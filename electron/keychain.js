// Lumos Keychain — encrypted password vault living in the Electron main process.
// The renderer never sees the master key. Secrets are only released after a Face ID
// verification performed *here* (main → daemon → Howdy), or a PIN check.
//
// Crypto: AES-256-GCM per vault write (random 96-bit IV), master key = 32 random bytes,
// wrapped with Electron safeStorage (libsecret / kwallet) when available, otherwise with a
// key derived via scrypt from the machine-id (device binding) + optional user PIN.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VAULT_VERSION = 1;
const AUTO_LOCK_MS = 5 * 60 * 1000;

function machineSecret() {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      return fs.readFileSync(p, 'utf8').trim();
    } catch {
      /* next */
    }
  }
  return `lumos-${process.platform}-${process.arch}`;
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function open(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
}

export function normalizeOrigin(input) {
  if (!input) return '';
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(input).toLowerCase();
  }
}

export function generatePassword({ length = 20, symbols = true } = {}) {
  const groups = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (symbols) groups.push('-_.!?@#%+=');
  const all = groups.join('');
  const out = groups.map((g) => g[crypto.randomInt(g.length)]);
  while (out.length < length) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

export class Keychain {
  /**
   * @param {object} opts
   * @param {string} opts.dir           storage directory (app userData)
   * @param {object} [opts.safeStorage] electron safeStorage
   * @param {(reason:string)=>Promise<{ok:boolean, reason?:string}>} opts.verifyFace
   */
  constructor({ dir, safeStorage, verifyFace }) {
    this.dir = dir;
    this.file = path.join(dir, 'keychain.vault');
    this.safeStorage = safeStorage;
    this.verifyFace = verifyFace;
    this.key = null;
    this.entries = null;
    this.lockTimer = null;
    fs.mkdirSync(dir, { recursive: true });
  }

  #readVault() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  #wrapKey(key, pin) {
    if (!pin && this.safeStorage?.isEncryptionAvailable?.()) {
      const backend = this.safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
      if (backend !== 'basic_text') {
        return { kind: 'safeStorage', backend, blob: this.safeStorage.encryptString(key.toString('base64')).toString('base64') };
      }
    }
    const salt = crypto.randomBytes(16);
    const kek = crypto.scryptSync(`${machineSecret()}::${pin ?? ''}`, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return { kind: pin ? 'scrypt-pin' : 'scrypt-device', salt: salt.toString('base64'), box: seal(kek, { k: key.toString('base64') }) };
  }

  #unwrapKey(wrap, pin) {
    if (wrap.kind === 'safeStorage') {
      return Buffer.from(this.safeStorage.decryptString(Buffer.from(wrap.blob, 'base64')), 'base64');
    }
    const kek = crypto.scryptSync(`${machineSecret()}::${pin ?? ''}`, Buffer.from(wrap.salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return Buffer.from(open(kek, wrap.box).k, 'base64');
  }

  #persist() {
    const vault = this.#readVault() ?? {};
    const out = { v: VAULT_VERSION, wrap: vault.wrap, pinWrap: vault.pinWrap, data: seal(this.key, { entries: this.entries }), updatedAt: Date.now() };
    atomicWrite(this.file, JSON.stringify(out));
  }

  #armAutoLock() {
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.lock(), AUTO_LOCK_MS);
  }

  status() {
    const v = this.#readVault();
    return { exists: !!v, unlocked: !!this.key, hasPin: !!v?.pinWrap, backend: v?.wrap?.kind ?? null, count: this.entries?.length ?? null };
  }

  /** Creates the vault if needed; optional PIN enables a Face-ID-less fallback unlock. */
  setup({ pin } = {}) {
    if (this.#readVault()) throw new Error('vault already exists');
    const key = crypto.randomBytes(32);
    this.key = key;
    this.entries = [];
    const out = { v: VAULT_VERSION, wrap: this.#wrapKey(key), pinWrap: pin ? this.#wrapKey(key, pin) : null, data: seal(key, { entries: [] }), updatedAt: Date.now() };
    atomicWrite(this.file, JSON.stringify(out));
    this.#armAutoLock();
    return this.status();
  }

  async unlock({ method = 'faceid', pin, reason = 'Schlüsselbund entsperren' } = {}) {
    const vault = this.#readVault();
    if (!vault) this.setup();
    else if (!this.key) {
      let key;
      if (method === 'pin') {
        if (!vault.pinWrap) throw new Error('Kein PIN festgelegt');
        try {
          key = this.#unwrapKey(vault.pinWrap, pin);
        } catch {
          throw new Error('PIN falsch');
        }
      } else {
        const res = await this.verifyFace(reason);
        if (!res?.ok) {
          const e = new Error(res?.reason || 'Face ID nicht erkannt');
          e.code = 'FACE_REJECTED';
          throw e;
        }
        key = this.#unwrapKey(vault.wrap);
      }
      this.entries = open(key, vault.data).entries;
      this.key = key;
    }
    this.#armAutoLock();
    return this.status();
  }

  lock() {
    clearTimeout(this.lockTimer);
    if (this.key) this.key.fill(0);
    this.key = null;
    this.entries = null;
    return this.status();
  }

  #need() {
    if (!this.key) {
      const e = new Error('Schlüsselbund gesperrt');
      e.code = 'LOCKED';
      throw e;
    }
    this.#armAutoLock();
  }

  list() {
    this.#need();
    return this.entries.map(({ password, ...meta }) => ({ ...meta, strength: scoreStrength(password) }));
  }

  get(id) {
    this.#need();
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new Error('Eintrag nicht gefunden');
    return { ...e };
  }

  upsert(entry) {
    this.#need();
    const now = Date.now();
    const clean = {
      id: entry.id || crypto.randomUUID(),
      title: String(entry.title || normalizeOrigin(entry.origin) || 'Login').slice(0, 120),
      username: String(entry.username || '').slice(0, 320),
      password: String(entry.password || ''),
      origin: normalizeOrigin(entry.origin),
      notes: String(entry.notes || '').slice(0, 4000),
      totp: entry.totp ? String(entry.totp).replace(/\s+/g, '') : '',
      createdAt: entry.createdAt || now,
      updatedAt: now,
    };
    const i = this.entries.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...clean, createdAt: this.entries[i].createdAt };
    else this.entries.push(clean);
    this.#persist();
    return { ...clean, password: undefined };
  }

  remove(id) {
    this.#need();
    this.entries = this.entries.filter((x) => x.id !== id);
    this.#persist();
    return true;
  }

  setPin(pin) {
    this.#need();
    const vault = this.#readVault();
    vault.pinWrap = pin ? this.#wrapKey(this.key, pin) : null;
    atomicWrite(this.file, JSON.stringify(vault));
    return this.status();
  }

  /** Autofill: verifies Face ID (even when unlocked, like iOS) and returns matching credentials. */
  async autofill(origin) {
    const host = normalizeOrigin(origin);
    const res = await this.verifyFace(`Anmeldedaten für ${host} einsetzen`);
    if (!res?.ok) {
      const e = new Error(res?.reason || 'Face ID nicht erkannt');
      e.code = 'FACE_REJECTED';
      throw e;
    }
    if (!this.key) {
      const vault = this.#readVault();
      if (!vault) return [];
      this.key = this.#unwrapKey(vault.wrap);
      this.entries = open(this.key, vault.data).entries;
    }
    this.#armAutoLock();
    return this.entries
      .filter((e) => e.origin && (host === e.origin || host.endsWith(`.${e.origin}`)))
      .map((e) => ({ id: e.id, username: e.username, password: e.password, title: e.title }));
  }

  /** RFC 6238 TOTP for an entry (6 digits / 30 s / SHA-1). */
  totp(id, now = Date.now()) {
    const e = this.get(id);
    if (!e.totp) throw new Error('Kein TOTP-Geheimnis');
    return { code: totpCode(e.totp, now), remaining: 30 - (Math.floor(now / 1000) % 30) };
  }
}

export function scoreStrength(pw = '') {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, Math.floor((s * 4) / 6));
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of str.toUpperCase().replace(/=+$/, '')) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, now = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(now / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
