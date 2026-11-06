// Lumos Cloud — self-hostable REST server (Node ≥ 20, zero dependencies).
//
//   POST /v1/auth/register|login|refresh|logout     GET /v1/me
//   GET|PUT /v1/profile    GET|PUT /v1/settings       (optimistic concurrency via `version`)
//   GET /v1/saves   PUT|DELETE /v1/saves/:id   GET /v1/saves/:id/data   (binary, SHA-256 verified)
//   GET|POST /v1/entitlements   GET|POST /v1/devices   GET /v1/health
//
// Env: PORT=8787 HOST=0.0.0.0 LUMOS_CLOUD_DATA=./data LUMOS_JWT_SECRET=… LUMOS_ADMIN_TOKEN=… MAX_SAVE_MB=256 CORS_ORIGIN=*
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, signJwt, verifyJwt, newRefreshToken, sha256 } from './auth.js';
import { Store } from './store.js';

const VERSION = '1.0.0';
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 30 * 24 * 3600 * 1000;

const REPLY = Symbol('reply');
const reply = (status, body) => ({ [REPLY]: true, status, body });

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function loadSecret(dir) {
  if (process.env.LUMOS_JWT_SECRET) return process.env.LUMOS_JWT_SECRET;
  const f = path.join(dir, 'jwt.secret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}

export function createServer({ dataDir = process.env.LUMOS_CLOUD_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'), maxSaveMb = Number(process.env.MAX_SAVE_MB || 256), corsOrigin = process.env.CORS_ORIGIN || '*', adminToken = process.env.LUMOS_ADMIN_TOKEN } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  const secret = loadSecret(dataDir);
  const db = store.db;
  const hits = new Map();

  const rateLimit = (ip, key, max = 20, windowMs = 60_000) => {
    const k = `${key}:${ip}`;
    const now = Date.now();
    const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) throw new HttpError(429, 'Zu viele Versuche – bitte kurz warten');
    h.push(now);
    hits.set(k, h);
  };

  const publicUser = (u) => ({ id: u.id, email: u.email, displayName: u.displayName });

  const issue = (u) => {
    const refreshToken = newRefreshToken();
    db.refresh[sha256(refreshToken)] = { userId: u.id, exp: Date.now() + REFRESH_TTL };
    return { user: publicUser(u), accessToken: signJwt({ sub: u.id }, secret, ACCESS_TTL), refreshToken, expiresIn: ACCESS_TTL };
  };

  const readBody = (req, limit) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'Zu groß'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const json = async (req) => {
    const b = await readBody(req, 2 * 1024 * 1024);
    if (!b.length) return {};
    try {
      return JSON.parse(b.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Ungültiges JSON');
    }
  };

  const auth = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const p = m && verifyJwt(m[1], secret);
    if (!p || !db.users[p.sub]) throw new HttpError(401, 'Nicht angemeldet');
    return db.users[p.sub];
  };

  const doc = (kind, uid) => db.docs[`${kind}:${uid}`] || { data: null, version: 0, updatedAt: 0 };

  const putDoc = async (kind, uid, data, version) => {
    const cur = doc(kind, uid);
    if (version != null && Number(version) !== cur.version) throw new HttpError(409, 'Versionskonflikt', { version: cur.version });
    const size = Buffer.byteLength(JSON.stringify(data ?? null));
    if (size > 1024 * 1024) throw new HttpError(413, 'Dokument zu groß (max. 1 MB)');
    const next = { data, version: cur.version + 1, updatedAt: Date.now() };
    db.docs[`${kind}:${uid}`] = next;
    await store.save();
    return { version: next.version, updatedAt: next.updatedAt };
  };

  const routes = [
    ['GET', /^\/v1\/health$/, async () => ({ ok: true, version: VERSION, provider: 'lumos', time: Date.now() })],

    ['POST', /^\/v1\/auth\/register$/, async (req, _m, ip) => {
      rateLimit(ip, 'register', 10);
      const { email, password, displayName } = await json(req);
      const e = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'Ungültige E-Mail-Adresse');
      if (String(password || '').length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben');
      if (db.emails[e]) throw new HttpError(409, 'E-Mail ist bereits registriert');
      const u = { id: crypto.randomUUID(), email: e, displayName: String(displayName || e.split('@')[0]).slice(0, 40), pw: hashPassword(password), createdAt: Date.now() };
      db.users[u.id] = u;
      db.emails[e] = u.id;
      const r = issue(u);
      await store.save();
      return reply(201, r);
    }],

    ['POST', /^\/v1\/auth\/login$/, async (req, _m, ip) => {
      rateLimit(ip, 'login', 20);
      const { email, password } = await json(req);
      const u = db.users[db.emails[String(email || '').trim().toLowerCase()]];
      if (!u || !verifyPassword(String(password || ''), u.pw)) throw new HttpError(401, 'E-Mail oder Passwort falsch');
      const r = issue(u);
      await store.save();
      return r;
    }],

    ['POST', /^\/v1\/auth\/refresh$/, async (req, _m, ip) => {
      rateLimit(ip, 'refresh', 60);
      const { refreshToken } = await json(req);
      const key = sha256(String(refreshToken || ''));
      const rt = db.refresh[key];
      delete db.refresh[key]; // rotation: every refresh token is single-use
      if (!rt || rt.exp < Date.now() || !db.users[rt.userId]) {
        await store.save();
        throw new HttpError(401, 'Sitzung abgelaufen');
      }
      const r = issue(db.users[rt.userId]);
      await store.save();
      return r;
    }],

    ['POST', /^\/v1\/auth\/logout$/, async (req) => {
      const { refreshToken } = await json(req);
      delete db.refresh[sha256(String(refreshToken || ''))];
      await store.save();
      return reply(204, null);
    }],

    ['GET', /^\/v1\/me$/, async (req) => ({ user: publicUser(auth(req)) })],

    ['GET', /^\/v1\/profile$/, async (req) => {
      const d = doc('profile', auth(req).id);
      return { profile: d.data, version: d.version, updatedAt: d.updatedAt };
    }],
    ['PUT', /^\/v1\/profile$/, async (req) => {
      const u = auth(req);
      const { profile, version } = await json(req);
      return putDoc('profile', u.id, profile, version);
    }],
    ['GET', /^\/v1\/settings$/, async (req) => {
      const d = doc('settings', auth(req).id);
      return { settings: d.data, version: d.version, updatedAt: d.updatedAt };
    }],
    ['PUT', /^\/v1\/settings$/, async (req) => {
      const u = auth(req);
      const { settings, version } = await json(req);
      return putDoc('settings', u.id, settings, version);
    }],

    ['GET', /^\/v1\/saves$/, async (req) => {
      const u = auth(req);
      return Object.values(db.saves[u.id] || {}).sort((a, b) => b.updatedAt - a.updatedAt);
    }],
    ['PUT', /^\/v1\/saves\/([\w.-]{1,96})$/, async (req, m) => {
      const u = auth(req);
      const id = m[1];
      const cur = db.saves[u.id]?.[id];
      const ifMatch = req.headers['if-match'];
      if (cur && ifMatch != null && Number(ifMatch) !== cur.version) throw new HttpError(409, 'Spielstand wurde auf einem anderen Gerät geändert', { version: cur.version });
      const body = await readBody(req, maxSaveMb * 1024 * 1024);
      const digest = crypto.createHash('sha256').update(body).digest('hex');
      const claimed = req.headers['x-lumos-sha256'];
      if (claimed && claimed !== digest) throw new HttpError(400, 'SHA-256 stimmt nicht mit den Daten überein');
      const file = store.blobPath(u.id, id);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, file);
      const meta = {
        id,
        title: decodeURIComponent(String(req.headers['x-lumos-title'] || id)).slice(0, 120),
        sha256: digest,
        size: body.length,
        version: (cur?.version || 0) + 1,
        updatedAt: Date.now(),
        device: String(req.headers['x-lumos-device'] || '').slice(0, 64) || null,
      };
      (db.saves[u.id] ||= {})[id] = meta;
      await store.save();
      return meta;
    }],
    ['GET', /^\/v1\/saves\/([\w.-]{1,96})\/data$/, async (req, m, _ip, res) => {
      const u = auth(req);
      const meta = db.saves[u.id]?.[m[1]];
      if (!meta) throw new HttpError(404, 'Spielstand nicht gefunden');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': meta.size, 'x-lumos-sha256': meta.sha256, etag: `"${meta.sha256}"` });
      fs.createReadStream(store.blobPath(u.id, m[1])).pipe(res);
      return undefined;
    }],
    ['DELETE', /^\/v1\/saves\/([\w.-]{1,96})$/, async (req, m) => {
      const u = auth(req);
      if (!db.saves[u.id]?.[m[1]]) throw new HttpError(404, 'Spielstand nicht gefunden');
      delete db.saves[u.id][m[1]];
      fs.rmSync(store.blobPath(u.id, m[1]), { force: true });
      await store.save();
      return reply(204, null);
    }],

    ['GET', /^\/v1\/entitlements$/, async (req) => Object.values(db.entitlements[auth(req).id] || {})],
    ['POST', /^\/v1\/entitlements$/, async (req) => {
      const u = auth(req);
      const { sku, title, kind = 'free' } = await json(req);
      if (!/^[\w.:-]{1,80}$/.test(String(sku || ''))) throw new HttpError(400, 'Ungültige SKU');
      // purchases must be granted by the store backend (admin token); free items can be claimed by users
      if (kind !== 'free' && (!adminToken || req.headers['x-lumos-admin'] !== adminToken)) throw new HttpError(403, 'Kauf muss vom Store bestätigt werden');
      const e = { sku, title: String(title || sku).slice(0, 120), kind, grantedAt: Date.now() };
      (db.entitlements[u.id] ||= {})[sku] = e;
      await store.save();
      return reply(201, e);
    }],

    ['GET', /^\/v1\/devices$/, async (req) => Object.values(db.devices[auth(req).id] || {})],
    ['POST', /^\/v1\/devices$/, async (req) => {
      const u = auth(req);
      const { deviceId, name, model } = await json(req);
      if (!/^[\w-]{8,64}$/.test(String(deviceId || ''))) throw new HttpError(400, 'Ungültige Geräte-ID');
      const d = { deviceId, device_id: deviceId, name: String(name || 'Gerät').slice(0, 60), model: String(model || '').slice(0, 40), lastSeen: Date.now(), last_seen: new Date().toISOString() };
      (db.devices[u.id] ||= {})[deviceId] = d;
      await store.save();
      return d;
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || '?';
    res.setHeader('access-control-allow-origin', corsOrigin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type, if-match, x-lumos-title, x-lumos-sha256, x-lumos-device, x-lumos-admin');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-expose-headers', 'x-lumos-sha256, etag');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url, 'http://x');
    try {
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (m && method === req.method) {
          const out = await handler(req, m, ip, res);
          if (out === undefined) return; // streamed
          const { status, body } = out?.[REPLY] ? out : { status: 200, body: out };
          if (body === null) res.writeHead(status).end();
          else res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
          return;
        }
      }
      throw new HttpError(404, 'Nicht gefunden');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[lumos-cloud]', e);
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: status === 500 ? 'Interner Fehler' : e.message, ...(e.extra || {}) }));
    }
  });

  // purge expired refresh tokens hourly
  const gc = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of Object.entries(db.refresh)) if (v.exp < now) delete db.refresh[k];
  }, 3600_000);
  gc.unref();
  server.on('close', () => clearInterval(gc));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => console.log(`Lumos Cloud ${VERSION} listening on http://${host}:${port}`));
}
