// Unified daemon access for the renderer.
//  1. Electron: window.lumos.daemon (IPC → main → authenticated WebSocket → lumosd)
//  2. Browser dev (`npm run dev`): direct WebSocket to lumosd started with --dev (no token)
//  3. Neither reachable: the in-renderer hardware simulator (same API, marked as simulated)
import { createSimDaemon } from './simDaemon.js';

const listeners = new Map(); // event -> Set<fn>
const statusListeners = new Set();
let mode = 'connecting';
let impl = null;
let connected = false;

function dispatch(msg) {
  const set = listeners.get(msg.event);
  if (set) set.forEach((fn) => fn(msg.data, msg.event));
  const any = listeners.get('*');
  if (any) any.forEach((fn) => fn(msg.data, msg.event));
}

function setStatus(s) {
  connected = s.connected;
  statusListeners.forEach((fn) => fn({ ...s, mode }));
}

function wsImpl(url) {
  let ws;
  let seq = 1;
  const pending = new Map();
  let ready;
  let backoff = 300;
  let gaveUp = false;

  const open = () =>
    new Promise((resolve, reject) => {
      ws = new WebSocket(url);
      const t = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 1500);
      ws.onopen = () => {
        clearTimeout(t);
        const id = seq++;
        pending.set(id, {
          resolve: () => {
            setStatus({ connected: true });
            backoff = 300;
            resolve();
          },
          reject,
        });
        ws.send(JSON.stringify({ id, method: 'auth.hello', params: { client: 'lumos-web-dev' } }));
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error('ws error'));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : p.resolve(msg.result);
        } else if (msg.event) dispatch(msg);
      };
      ws.onclose = () => {
        pending.forEach((p) => p.reject(new Error('daemon disconnected')));
        pending.clear();
        if (connected && !gaveUp) setStatus({ connected: false }); // an abandoned probe socket must not override the simulator's status
        if (!gaveUp) setTimeout(() => (ready = open().catch(() => {})), (backoff = Math.min(backoff * 2, 5000)));
      };
    });

  ready = open();
  return {
    ready,
    request(method, params = {}, timeout = 15000) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) return reject(new Error('daemon not connected'));
        const id = seq++;
        const t = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }, timeout);
        pending.set(id, {
          resolve: (r) => (clearTimeout(t), resolve(r)),
          reject: (e) => (clearTimeout(t), reject(e)),
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    stop() {
      gaveUp = true;
      ws?.close();
    },
  };
}

export async function initBridge() {
  if (impl) return mode;
  if (window.lumos?.isElectron) {
    mode = 'electron';
    impl = { request: (m, p, t) => window.lumos.daemon.request(m, p, t) };
    window.lumos.daemon.onEvent(dispatch);
    window.lumos.daemon.onStatus(setStatus);
    const s = await window.lumos.daemon.status();
    setStatus(s);
    return mode;
  }
  const url = import.meta.env.VITE_DAEMON_URL || 'ws://127.0.0.1:7420';
  const ws = wsImpl(url);
  try {
    await ws.ready;
    mode = 'websocket';
    impl = ws;
  } catch {
    ws.stop();
    mode = 'simulator';
    impl = createSimDaemon(dispatch);
    setStatus({ connected: true, simulated: true });
  }
  return mode;
}

export function request(method, params = {}, timeout) {
  if (!impl) return Promise.reject(new Error('bridge not initialised'));
  return impl.request(method, params, timeout);
}

/** Fire-and-forget request (errors are swallowed but reported to the console once). */
export function notify(method, params = {}) {
  request(method, params).catch((e) => {
    if (import.meta.env.DEV) console.debug(`[bridge] ${method} failed: ${e.message}`);
  });
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn({ connected, mode });
  return () => statusListeners.delete(fn);
}

export const bridgeMode = () => mode;
export const isElectron = () => !!window.lumos?.isElectron;
