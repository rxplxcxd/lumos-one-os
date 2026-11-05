// Adapter for the self-hostable Lumos Cloud REST server (/cloud-server).
export class RestAdapter {
  constructor(baseUrl) {
    this.name = 'lumos';
    this.base = baseUrl.replace(/\/$/, '');
    this.session = null; // { accessToken, refreshToken, expiresAt, user }
    this.onSession = () => {};
  }

  setSession(s) {
    this.session = s;
    this.onSession(s);
  }

  async #fetch(path, { method = 'GET', json, body, headers = {}, auth = true, retry = true, raw = false } = {}) {
    if (auth && this.session && Date.now() > this.session.expiresAt - 30e3) await this.refresh();
    const h = { ...headers };
    if (json !== undefined) h['content-type'] = 'application/json';
    if (auth && this.session) h.authorization = `Bearer ${this.session.accessToken}`;
    let res;
    try {
      res = await fetch(this.base + path, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
    } catch (err) {
      const e = new Error('Cloud nicht erreichbar');
      e.offline = true;
      e.cause = err;
      throw e;
    }
    if (res.status === 401 && auth && retry && this.session?.refreshToken) {
      await this.refresh();
      return this.#fetch(path, { method, json, body, headers, auth, retry: false, raw });
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        msg = (await res.json()).error || msg;
      } catch {
        /* not json */
      }
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  #accept(r) {
    const s = { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: Date.now() + r.expiresIn * 1000, user: r.user };
    this.setSession(s);
    return s;
  }

  async signUp({ email, password, displayName }) {
    return this.#accept(await this.#fetch('/v1/auth/register', { method: 'POST', json: { email, password, displayName }, auth: false }));
  }
  async signIn({ email, password }) {
    return this.#accept(await this.#fetch('/v1/auth/login', { method: 'POST', json: { email, password }, auth: false }));
  }
  async refresh() {
    if (!this.session?.refreshToken) throw Object.assign(new Error('nicht angemeldet'), { status: 401 });
    try {
      return this.#accept(await this.#fetch('/v1/auth/refresh', { method: 'POST', json: { refreshToken: this.session.refreshToken }, auth: false }));
    } catch (e) {
      if (e.status === 401) this.setSession(null);
      throw e;
    }
  }
  async signOut() {
    const rt = this.session?.refreshToken;
    this.setSession(null);
    if (rt) await this.#fetch('/v1/auth/logout', { method: 'POST', json: { refreshToken: rt }, auth: false }).catch(() => {});
  }

  health() {
    return this.#fetch('/v1/health', { auth: false });
  }
  getProfile() {
    return this.#fetch('/v1/profile');
  }
  putProfile(profile, version) {
    return this.#fetch('/v1/profile', { method: 'PUT', json: { profile, version } });
  }
  getSettings() {
    return this.#fetch('/v1/settings');
  }
  putSettings(settings, version) {
    return this.#fetch('/v1/settings', { method: 'PUT', json: { settings, version } });
  }
  listSaves() {
    return this.#fetch('/v1/saves');
  }
  uploadSave({ id, title, sha256, bytes, baseVersion }) {
    return this.#fetch(`/v1/saves/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-lumos-title': encodeURIComponent(title), 'x-lumos-sha256': sha256, ...(baseVersion ? { 'if-match': String(baseVersion) } : {}) },
    });
  }
  async downloadSave(id) {
    const res = await this.#fetch(`/v1/saves/${encodeURIComponent(id)}/data`, { raw: true });
    return new Uint8Array(await res.arrayBuffer());
  }
  deleteSave(id) {
    return this.#fetch(`/v1/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  listEntitlements() {
    return this.#fetch('/v1/entitlements');
  }
  addEntitlement(e) {
    return this.#fetch('/v1/entitlements', { method: 'POST', json: e });
  }
  listDevices() {
    return this.#fetch('/v1/devices');
  }
  registerDevice(d) {
    return this.#fetch('/v1/devices', { method: 'POST', json: d });
  }
}
