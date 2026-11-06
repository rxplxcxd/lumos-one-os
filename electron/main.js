// Lumos One — Electron main process.
// Runs fullscreen inside a Gamescope kiosk session. Owns: daemon bridge, keychain,
// Flathub proxy (CORS-free, cached), local file protocol for custom backgrounds,
// and window hand-off when games are launched.
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell, powerSaveBlocker } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DaemonBridge } from './daemon-bridge.js';
import { Keychain, generatePassword } from './keychain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.LUMOS_DEV_URL;
const inGamescope = !!process.env.GAMESCOPE_WAYLAND_DISPLAY || process.env.XDG_CURRENT_DESKTOP === 'gamescope';
const kiosk = process.env.LUMOS_KIOSK === '1' || inGamescope;

// --- Chromium tuning for a 165 Hz OLED panel ------------------------------------------------
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecodeLinuxGL,CanvasOopRasterization,UseOzonePlatform');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
if (process.env.LUMOS_UNCAPPED_FPS === '1') app.commandLine.appendSwitch('disable-frame-rate-limit');

protocol.registerSchemesAsPrivileged([
  { scheme: 'lumosfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

const daemon = new DaemonBridge();
let win = null;
let daemonProc = null;

const FILE_ROOTS = [os.homedir(), '/run/media', '/media', '/mnt', '/usr/share/lumos', path.join(__dirname, '..', 'dist')];
function isAllowedPath(p) {
  const real = path.resolve(p);
  return FILE_ROOTS.some((r) => real === r || real.startsWith(r + path.sep));
}

const CACHE_DIR = path.join(os.homedir(), '.cache', 'lumos');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function maybeSpawnDaemon() {
  if (process.env.LUMOS_SPAWN_DAEMON !== '1') return;
  const daemonDir = app.isPackaged ? path.join(process.resourcesPath, 'daemon') : path.join(__dirname, '..', 'daemon');
  const args = ['-m', 'lumosd', ...(process.env.LUMOS_SIMULATE === '1' ? ['--simulate'] : [])];
  daemonProc = spawn(process.env.LUMOS_PYTHON || 'python3', args, { cwd: daemonDir, stdio: ['ignore', 'inherit', 'inherit'] });
  daemonProc.on('exit', (code) => console.warn(`[lumosd] exited with ${code}`));
}

// --- Flathub proxy with a small on-disk cache -------------------------------------------------
const FLATHUB = 'https://flathub.org/api/v2';
const flathubCacheDir = path.join(CACHE_DIR, 'flathub');
fs.mkdirSync(flathubCacheDir, { recursive: true });

async function flathubRequest({ path: p, method = 'GET', body, ttl = 15 * 60 * 1000 }) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('..')) throw new Error('invalid flathub path');
  const key = Buffer.from(`${method}:${p}:${body ? JSON.stringify(body) : ''}`).toString('base64url').slice(0, 180);
  const cacheFile = path.join(flathubCacheDir, `${key}.json`);
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < ttl) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    /* miss */
  }
  try {
    const res = await net.fetch(FLATHUB + p, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), 'user-agent': 'LumosOne/1.0 (+https://github.com/rxplxcxd/lumos-one-os)' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Flathub ${res.status} for ${p}`);
    const data = await res.json();
    fs.writeFile(cacheFile, JSON.stringify(data), () => {});
    return data;
  } catch (err) {
    // offline fallback: stale cache beats nothing
    if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    throw err;
  }
}

// --- Keychain -------------------------------------------------------------------------------
const keychain = new Keychain({
  dir: path.join(app.getPath('userData'), 'keychain'),
  safeStorage,
  verifyFace: async (reason) => {
    send('faceid:prompt', { reason });
    try {
      return await daemon.request('faceid.verify', { reason, timeout: 8 }, 15000);
    } catch (err) {
      return { ok: false, reason: err.message };
    } finally {
      send('faceid:prompt-end', {});
    }
  },
});

function wrap(fn) {
  return async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  };
}

function registerIpc() {
  ipcMain.handle('daemon:request', wrap((method, params, timeout) => daemon.request(method, params, timeout)));
  ipcMain.handle('daemon:status', () => ({ connected: daemon.connected }));
  ipcMain.handle('flathub', wrap((req) => flathubRequest(req)));

  ipcMain.handle('keychain:status', wrap(() => keychain.status()));
  ipcMain.handle('keychain:setup', wrap((o) => keychain.setup(o)));
  ipcMain.handle('keychain:unlock', wrap((o) => keychain.unlock(o)));
  ipcMain.handle('keychain:lock', wrap(() => keychain.lock()));
  ipcMain.handle('keychain:list', wrap(() => keychain.list()));
  ipcMain.handle('keychain:get', wrap((id) => keychain.get(id)));
  ipcMain.handle('keychain:upsert', wrap((e) => keychain.upsert(e)));
  ipcMain.handle('keychain:remove', wrap((id) => keychain.remove(id)));
  ipcMain.handle('keychain:setPin', wrap((pin) => keychain.setPin(pin)));
  ipcMain.handle('keychain:autofill', wrap((origin) => keychain.autofill(origin)));
  ipcMain.handle('keychain:totp', wrap((id) => keychain.totp(id)));
  ipcMain.handle('keychain:generate', wrap((o) => generatePassword(o)));

  // Save-archive I/O for the cloud client (restricted to the Lumos cache directory).
  ipcMain.handle('cache:read', wrap((file) => {
    const p = path.resolve(file);
    if (!p.startsWith(CACHE_DIR + path.sep)) throw new Error('path outside cache');
    return fs.readFileSync(p);
  }));
  ipcMain.handle('cache:write', wrap((name, bytes) => {
    const p = path.join(CACHE_DIR, 'downloads', path.basename(name));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(bytes));
    return p;
  }));

  ipcMain.handle('window:handoff', wrap(() => {
    win?.hide();
    return true;
  }));
  ipcMain.handle('window:restore', wrap(() => restoreWindow()));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    kiosk,
    inGamescope,
    safeStorageBackend: safeStorage.getSelectedStorageBackend?.() ?? null,
  }));
  ipcMain.handle('shell:openExternal', wrap((url) => {
    if (!/^https:\/\//.test(url)) throw new Error('only https');
    return shell.openExternal(url);
  }));
}

function restoreWindow() {
  if (!win) return false;
  win.show();
  win.focus();
  if (kiosk) win.setFullScreen(true);
  return true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 1200,
    backgroundColor: '#000000',
    show: false,
    frame: false,
    fullscreen: kiosk,
    kiosk,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    // web apps inside the shell: isolated, no node, our autofill preload only
    prefs.preload = path.join(__dirname, 'webview-preload.cjs');
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  if (isDev) win.loadURL(process.env.LUMOS_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  protocol.handle('lumosfile', (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname);
    if (!isAllowedPath(p)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));

  registerIpc();
  maybeSpawnDaemon();
  daemon.on('event', (msg) => {
    send('daemon:event', msg);
    if (msg.event === 'input.home' || msg.event === 'library.exited') restoreWindow();
  });
  daemon.on('status', (s) => send('daemon:status', s));
  daemon.start();
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
});

app.on('window-all-closed', () => {
  daemon.stop();
  daemonProc?.kill('SIGTERM');
  app.quit();
});
