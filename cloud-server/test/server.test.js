// Integration test: the real UI client (src/services/cloud/restAdapter.js) against the real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { RestAdapter } from '../../src/services/cloud/restAdapter.js';

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-cloud-'));
  const server = createServer({ dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, dir };
}

test('auth, documents with optimistic concurrency, saves, devices', async () => {
  const { server, url, dir } = await start();
  try {
    const a = new RestAdapter(url);
    assert.equal((await a.health()).ok, true);
    await assert.rejects(a.signUp({ email: 'bad', password: 'x' }), /E-Mail/);
    const s = await a.signUp({ email: 'Spieler@Example.com', password: 'correct horse', displayName: 'Spieler' });
    assert.equal(s.user.email, 'spieler@example.com');
    await assert.rejects(new RestAdapter(url).signIn({ email: 'spieler@example.com', password: 'wrong pass' }), /falsch/);

    // settings: version 0 → 1, stale write → 409
    const empty = await a.getSettings();
    assert.equal(empty.version, 0);
    const w1 = await a.putSettings({ values: { background: 'aurora' }, stamps: { background: 1 } }, 0);
    assert.equal(w1.version, 1);
    await assert.rejects(a.putSettings({ values: {} }, 0), (e) => e.status === 409);
    assert.equal((await a.getSettings()).settings.values.background, 'aurora');

    await a.putProfile({ name: 'Spieler', avatar: { hair: 'bob' } }, 0);
    assert.equal((await a.getProfile()).profile.avatar.hair, 'bob');

    // cloud save round trip with sha256 verification
    const bytes = crypto.randomBytes(200_000);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const meta = await a.uploadSave({ id: 'retroarch', title: 'RetroArch Saves', sha256: sha, bytes });
    assert.equal(meta.version, 1);
    assert.equal(meta.size, bytes.length);
    const back = await a.downloadSave('retroarch');
    assert.equal(Buffer.compare(Buffer.from(back), bytes), 0);
    await assert.rejects(a.uploadSave({ id: 'retroarch', title: 'x', sha256: sha, bytes, baseVersion: 7 }), (e) => e.status === 409);
    await assert.rejects(a.uploadSave({ id: 'x', title: 'x', sha256: 'deadbeef', bytes }), /SHA-256/);
    assert.equal((await a.listSaves()).length, 1);
    await a.deleteSave('retroarch');
    assert.equal((await a.listSaves()).length, 0);

    await a.registerDevice({ deviceId: '6f9619ff-8b86-d011-b42d-00c04fc964ff', name: 'Lumos One', model: 'LUMOS-ONE-8' });
    assert.equal((await a.listDevices())[0].name, 'Lumos One');
    await a.addEntitlement({ sku: 'theme.aurora-pro', title: 'Aurora Pro', kind: 'free' });
    await assert.rejects(a.addEntitlement({ sku: 'game.x', title: 'X', kind: 'purchase' }), (e) => e.status === 403);
    assert.equal((await a.listEntitlements()).length, 1);

    // refresh rotation: old refresh token is single-use
    const oldRt = a.session.refreshToken;
    await a.refresh();
    assert.notEqual(a.session.refreshToken, oldRt);
    const stale = new RestAdapter(url);
    stale.setSession({ ...a.session, refreshToken: oldRt, expiresAt: 0 });
    await assert.rejects(stale.refresh(), (e) => e.status === 401);

    // persistence across restarts
    server.close();
    const again = createServer({ dataDir: dir });
    await new Promise((r) => again.listen(0, '127.0.0.1', r));
    const b = new RestAdapter(`http://127.0.0.1:${again.address().port}`);
    await b.signIn({ email: 'spieler@example.com', password: 'correct horse' });
    assert.equal((await b.getProfile()).profile.name, 'Spieler');
    again.close();
  } finally {
    server.close();
  }
});
