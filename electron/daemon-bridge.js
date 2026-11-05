// WebSocket bridge between the Electron main process and the Python hardware daemon (lumosd).
// - authenticates with the per-boot token written by the daemon
// - JSON request/response with timeouts, auto-reconnect with exponential backoff
// - forwards every daemon event to all registered listeners (renderer windows)
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const TOKEN_PATHS = [
  process.env.LUMOS_DAEMON_TOKEN_FILE,
  '/run/lumos/daemon.token',
  path.join(os.homedir(), '.cache', 'lumos', 'daemon.token'),
].filter(Boolean);

function readToken() {
  if (process.env.LUMOS_DAEMON_TOKEN) return process.env.LUMOS_DAEMON_TOKEN.trim();
  for (const p of TOKEN_PATHS) {
    try {
      return fs.readFileSync(p, 'utf8').trim();
    } catch {
      /* try next */
    }
  }
  return null;
}

export class DaemonBridge extends EventEmitter {
  constructor(url = process.env.LUMOS_DAEMON_URL || 'ws://127.0.0.1:7420') {
    super();
    this.url = url;
    this.ws = null;
    this.seq = 1;
    this.pending = new Map();
    this.connected = false;
    this.backoff = 250;
    this.closed = false;
    this.queue = [];
  }

  start() {
    this.closed = false;
    this.#connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }

  #connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    this.ws = ws;

    ws.on('open', async () => {
      try {
        const token = readToken();
        await this.#rawRequest('auth.hello', { token, client: 'lumos-shell', version: process.env.npm_package_version || '1.0.0' }, 4000);
        this.connected = true;
        this.backoff = 250;
        this.emit('status', { connected: true });
        const q = this.queue.splice(0);
        q.forEach((fn) => fn());
      } catch (err) {
        this.emit('status', { connected: false, error: `auth failed: ${err.message}` });
        ws.close();
      }
    });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          const e = new Error(msg.error.message || 'daemon error');
          e.code = msg.error.code;
          reject(e);
        } else resolve(msg.result);
      } else if (msg.event) {
        this.emit('event', msg);
      }
    });

    const onDown = () => {
      if (this.ws !== ws) return;
      const wasConnected = this.connected;
      this.connected = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('daemon disconnected'));
      }
      this.pending.clear();
      if (wasConnected) this.emit('status', { connected: false });
      if (!this.closed) {
        setTimeout(() => this.#connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 5000);
      }
    };
    ws.on('close', onDown);
    ws.on('error', () => {
      /* close follows */
    });
  }

  #rawRequest(method, params, timeout) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('daemon not connected'));
      const id = this.seq++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`daemon timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /** Request with automatic wait for connection (up to `timeout`). */
  request(method, params = {}, timeout = 15000) {
    if (this.connected) return this.#rawRequest(method, params, timeout);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('daemon not connected')), Math.min(timeout, 4000));
      this.queue.push(() => {
        clearTimeout(t);
        this.#rawRequest(method, params, timeout).then(resolve, reject);
      });
    });
  }
}
