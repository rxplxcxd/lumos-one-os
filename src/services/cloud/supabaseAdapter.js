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
  async uploadSave({ id, title, sha256, bytes, baseVersion, device, manifest }) {
    const uid = this.#uid();
    const path = `${uid}/${id}.tar.gz`;
    SupabaseAdapter.#check(await this.sb.storage.from('saves').upload(path, bytes, { upsert: true, contentType: 'application/gzip' }));
    const row = SupabaseAdapter.#check(
      await this.sb.rpc('lumos_put_save', { p_save_id: id, p_title: title, p_sha256: sha256, p_size: bytes.byteLength, p_base_version: baseVersion ?? null, p_device: device ?? null, p_manifest: manifest ?? null }),
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

  // ---------------------------------------------------------------- v1.1 social / media / manifests
  async me() {
    const uid = this.#uid();
    const d = SupabaseAdapter.#check(await this.sb.from('directory').select('friend_code, display_name').eq('user_id', uid).maybeSingle());
    return { ...this.session.user, friendCode: d?.friend_code, displayName: d?.display_name || this.session.user.displayName };
  }
  async listFriends() {
    const uid = this.#uid();
    const rows = SupabaseAdapter.#check(await this.sb.from('friends').select('*').or(`requester.eq.${uid},addressee.eq.${uid}`));
    const ids = rows.map((r) => (r.requester === uid ? r.addressee : r.requester));
    const dir = ids.length ? SupabaseAdapter.#check(await this.sb.from('directory').select('user_id, display_name, friend_code').in('user_id', ids)) : [];
    const unread = SupabaseAdapter.#check(await this.sb.from('messages').select('sender').eq('recipient', uid).is('read_at', null));
    return rows.map((r) => {
      const other = r.requester === uid ? r.addressee : r.requester;
      const d = dir.find((x) => x.user_id === other);
      return { id: other, name: d?.display_name || 'Freund', code: d?.friend_code, status: r.status === 'accepted' ? 'accepted' : r.requester === uid ? 'outgoing' : 'incoming', since: Date.parse(r.created_at), unread: unread.filter((u) => u.sender === other).length };
    });
  }
  async addFriend(code) {
    return SupabaseAdapter.#check(await this.sb.rpc('lumos_add_friend', { p_code: String(code).toUpperCase().replace(/[^A-Z0-9]/g, '') }));
  }
  async acceptFriend(id) {
    SupabaseAdapter.#check(await this.sb.from('friends').update({ status: 'accepted' }).eq('requester', id).eq('addressee', this.#uid()));
    return { status: 'accepted' };
  }
  async removeFriend(id) {
    const uid = this.#uid();
    SupabaseAdapter.#check(await this.sb.from('friends').delete().or(`and(requester.eq.${uid},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${uid})`));
  }
  async listMessages(friendId, after = 0) {
    const uid = this.#uid();
    const rows = SupabaseAdapter.#check(
      await this.sb.from('messages').select('*').or(`and(sender.eq.${uid},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${uid})`).gt('created_at', new Date(after || 0).toISOString()).order('created_at').limit(200),
    );
    const unread = rows.filter((r) => r.recipient === uid && !r.read_at).map((r) => r.id);
    if (unread.length) await this.sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', unread);
    return rows.map((r) => ({ id: r.id, from: r.sender, to: r.recipient, text: r.body, attachment: r.attachment, t: Date.parse(r.created_at), mine: r.sender === uid }));
  }
  async sendMessage(friendId, { text, attachment }) {
    const r = SupabaseAdapter.#check(await this.sb.from('messages').insert({ sender: this.#uid(), recipient: friendId, body: String(text || '').slice(0, 4000), attachment: attachment || null }).select().single());
    return { id: r.id, from: r.sender, to: r.recipient, text: r.body, attachment: r.attachment, t: Date.parse(r.created_at), mine: true };
  }
  async uploadMedia(blob, title = 'Clip') {
    const uid = this.#uid();
    const id = crypto.randomUUID();
    const path = `${uid}/${id}`;
    SupabaseAdapter.#check(await this.sb.storage.from('media').upload(path, blob, { contentType: blob.type || 'application/octet-stream' }));
    const signed = SupabaseAdapter.#check(await this.sb.storage.from('media').createSignedUrl(path, 60 * 60 * 24 * 14));
    return { id, mediaId: id, url: signed.signedUrl, kind: blob.type, name: title, size: blob.size };
  }
  async fetchMedia(id, attachment) {
    if (!attachment?.url) throw new Error('Kein Link zum Anhang');
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error('Anhang abgelaufen');
    return res.blob();
  }
  async putManifest() {
    return { ok: true }; // stored together with the save row (lumos_put_save p_manifest)
  }
  async getManifest(id) {
    const r = SupabaseAdapter.#check(await this.sb.from('saves').select('manifest').eq('user_id', this.#uid()).eq('save_id', id).maybeSingle());
    return r?.manifest || [];
  }
}
