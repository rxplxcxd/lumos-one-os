// Tiny durable JSON document store with atomic writes (write → fsync → rename) and coalesced flushes.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
    try {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.db = {};
    }
    // v1.1 collections (also migrates older databases)
    for (const k of ['users', 'emails', 'refresh', 'docs', 'saves', 'entitlements', 'devices', 'codes', 'friends', 'messages', 'media', 'manifests']) this.db[k] ||= {};
    this.pending = null;
  }

  save() {
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const tmp = `${this.file}.${process.pid}.tmp`;
          const fd = fs.openSync(tmp, 'w', 0o600);
          fs.writeSync(fd, JSON.stringify(this.db));
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fs.renameSync(tmp, this.file);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          this.pending = null;
        }
      });
    });
    return this.pending;
  }

  mediaPath(id) {
    const d = path.join(this.dir, 'media');
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, `${id.replace(/[^\w.-]/g, '_')}.bin`);
  }

  blobPath(userId, saveId) {
    const safe = saveId.replace(/[^\w.-]/g, '_');
    const d = path.join(this.dir, 'blobs', userId);
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, `${safe}.bin`);
  }
}
