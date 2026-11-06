// Adapter for Supabase (Postgres + Auth + Storage). Schema & RLS: cloud-server/supabase/schema.sql
import { createClient } from '@supabase/supabase-js';

export class SupabaseAdapter {
  constructor(url, anonKey) {
    this.name = 'supabase';
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lumos.supabase.auth' } });
    this.session = null;
    this.onSession = () => {};
    this.sb.auth.onAuthStateChange((_evt, s) => {
      this.session = s ? { user: { id: s.user.id, email: s.user.email, displayName: s.user.user_metadata?.display_name || '' }, expiresAt: s.expires_at * 1000 } : null;
      this.onSession(this.session);
    });
  }

  #uid() {
    if (!this.session) throw Object.assign(new Error('nicht angemeldet'), { status: 401 });
    return this.session.user.id;
  }

  static #check({ data, error }) {
    if (error) {
      const e = new Error(error.message);
      e.status = error.status || (error.code === 'PGRST116' ? 404 : 400);
      if (/fetch|network/i.test(error.message)) e.offline = true;
      throw e;
    }
    return data;
  }

  async signUp({ email, password, displayName }) {
    SupabaseAdapter.#check(await this.sb.auth.signUp({ email, password, options: { data: { display_name: displayName } } }));
    return this.session;
  }
  async signIn({ email, password }) {
    SupabaseAdapter.#check(await this.sb.auth.signInWithPassword({ email, password }));
    return this.session;
  }
  async refresh() {
    SupabaseAdapter.#check(await this.sb.auth.refreshSession());
    return this.session;
  }
  async signOut() {
    await this.sb.auth.signOut();
  }
  async health() {
    return { ok: true, provider: 'supabase' };
  }

  async #getDoc(table) {
    const uid = this.#uid();
    const data = SupabaseAdapter.#check(await this.sb.from(table).select('data, version, updated_at').eq('user_id', uid).maybeSingle());
    return data ? { data: data.data, version: data.version, updatedAt: Date.parse(data.updated_at) } : { data: null, version: 0, updatedAt: 0 };
  }

  async #putDoc(table, data, version) {
    const uid = this.#uid();
    // optimistic concurrency via RPC (see schema.sql: lumos_put_doc)
    const res = SupabaseAdapter.#check(await this.sb.rpc('lumos_put_doc', { p_table: table, p_data: data, p_version: version ?? 0 }));
    if (res?.conflict) {
      const e = new Error('version conflict');
      e.status = 409;
      throw e;
    }
    return { version: res.version, updatedAt: Date.parse(res.updated_at), uid };
  }

  async getProfile() {
    const d = await this.#getDoc('profiles');
    return { profile: d.data, version: d.version, updatedAt: d.updatedAt };
  }
  putProfile(profile, version) {
    return this.#putDoc('profiles', profile, version);
  }
  async getSettings() {
    const d = await this.#getDoc('settings');
    return { settings: d.data, version: d.version, updatedAt: d.updatedAt };
  }
  putSettings(settings, version) {
    return this.#putDoc('settings', settings, version);
  }

  async listSaves() {
    const rows = SupabaseAdapter.#check(await this.sb.from('saves').select('*').eq('user_id', this.#uid()).order('updated_at', { ascending: false }));
    return rows.map((r) => ({ id: r.save_id, title: r.title, sha256: r.sha256, size: r.size, version: r.version, updatedAt: Date.parse(r.updated_at), device: r.device }));
  }
  async uploadSave({ id, title, sha256, bytes, baseVersion, device }) {
    const uid = this.#uid();
    const path = `${uid}/${id}.tar.gz`;
    SupabaseAdapter.#check(await this.sb.storage.from('saves').upload(path, bytes, { upsert: true, contentType: 'application/gzip' }));
    const row = SupabaseAdapter.#check(
      await this.sb.rpc('lumos_put_save', { p_save_id: id, p_title: title, p_sha256: sha256, p_size: bytes.byteLength, p_base_version: baseVersion ?? null, p_device: device ?? null }),
    );
    if (row?.conflict) throw Object.assign(new Error('version conflict'), { status: 409 });
    return { id, version: row.version, sha256, size: bytes.byteLength };
  }
  async downloadSave(id) {
    const blob = SupabaseAdapter.#check(await this.sb.storage.from('saves').download(`${this.#uid()}/${id}.tar.gz`));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async deleteSave(id) {
    const uid = this.#uid();
    await this.sb.storage.from('saves').remove([`${uid}/${id}.tar.gz`]);
    SupabaseAdapter.#check(await this.sb.from('saves').delete().eq('user_id', uid).eq('save_id', id));
  }
  async listEntitlements() {
    return SupabaseAdapter.#check(await this.sb.from('entitlements').select('sku, title, kind, granted_at').eq('user_id', this.#uid())).map((r) => ({ sku: r.sku, title: r.title, kind: r.kind, grantedAt: Date.parse(r.granted_at) }));
  }
  async addEntitlement({ sku, title, kind }) {
    return SupabaseAdapter.#check(await this.sb.from('entitlements').upsert({ user_id: this.#uid(), sku, title, kind }).select().single());
  }
  async listDevices() {
    return SupabaseAdapter.#check(await this.sb.from('devices').select('*').eq('user_id', this.#uid()));
  }
  async registerDevice({ deviceId, name, model }) {
    return SupabaseAdapter.#check(await this.sb.from('devices').upsert({ user_id: this.#uid(), device_id: deviceId, name, model, last_seen: new Date().toISOString() }).select().single());
  }
}
