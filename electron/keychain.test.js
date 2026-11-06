// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keychain, totpCode, normalizeOrigin, generatePassword } from './keychain.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-kc-'));

describe('keychain vault', () => {
  it('releases secrets only after a successful Face ID check and persists encrypted', async () => {
    let allow = false;
    const dir = tmp();
    const kc = new Keychain({ dir, safeStorage: null, verifyFace: async () => ({ ok: allow, reason: 'Gesicht nicht erkannt' }) });
    await expect(kc.unlock()).resolves.toMatchObject({ unlocked: true }); // first run creates the vault
    kc.upsert({ title: 'GitHub', origin: 'https://www.github.com/login', username: 'lumos', password: 'S3cret!pass' });
    kc.lock();
    expect(fs.readFileSync(path.join(dir, 'keychain.vault'), 'utf8')).not.toContain('S3cret');

    await expect(kc.unlock()).rejects.toMatchObject({ code: 'FACE_REJECTED' });
    expect(() => kc.list()).toThrow(/gesperrt/);
    allow = true;
    await kc.unlock();
    expect(kc.list()).toEqual([expect.objectContaining({ title: 'GitHub', origin: 'github.com' })]);
    expect(kc.list()[0].password).toBeUndefined();

    kc.lock();
    const creds = await kc.autofill('https://gist.github.com/');
    expect(creds).toEqual([expect.objectContaining({ username: 'lumos', password: 'S3cret!pass' })]);
  });

  it('supports a PIN fallback', async () => {
    const kc = new Keychain({ dir: tmp(), safeStorage: null, verifyFace: async () => ({ ok: true }) });
    kc.setup({ pin: '2468' });
    kc.lock();
    await expect(kc.unlock({ method: 'pin', pin: '0000' })).rejects.toThrow(/PIN falsch/);
    await expect(kc.unlock({ method: 'pin', pin: '2468' })).resolves.toMatchObject({ unlocked: true });
  });
});

describe('helpers', () => {
  it('computes RFC 6238 TOTP', () => {
    // RFC 6238 Appendix B, SHA-1, T = 59 s → 94287082 (last 6 digits)
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
  });
  it('normalises origins and generates strong passwords', () => {
    expect(normalizeOrigin('https://www.Example.com/path')).toBe('example.com');
    const pw = generatePassword({ length: 24 });
    expect(pw).toHaveLength(24);
    expect(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)).toBe(true);
  });
});
