// Preload: exposes a minimal, typed bridge as window.lumos (context-isolated).
const { contextBridge, ipcRenderer } = require('electron');

const unwrap = async (p) => {
  const r = await p;
  if (r && r.ok === false) {
    const e = new Error(r.error);
    e.code = r.code;
    throw e;
  }
  return r && 'data' in r ? r.data : r;
};

function on(channel, cb) {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('lumos', {
  isElectron: true,
  daemon: {
    request: (method, params, timeout) => unwrap(ipcRenderer.invoke('daemon:request', method, params, timeout)),
    status: () => ipcRenderer.invoke('daemon:status'),
    onEvent: (cb) => on('daemon:event', cb),
    onStatus: (cb) => on('daemon:status', cb),
  },
  flathub: (req) => unwrap(ipcRenderer.invoke('flathub', req)),
  keychain: {
    status: () => unwrap(ipcRenderer.invoke('keychain:status')),
    setup: (o) => unwrap(ipcRenderer.invoke('keychain:setup', o)),
    unlock: (o) => unwrap(ipcRenderer.invoke('keychain:unlock', o)),
    lock: () => unwrap(ipcRenderer.invoke('keychain:lock')),
    list: () => unwrap(ipcRenderer.invoke('keychain:list')),
    get: (id) => unwrap(ipcRenderer.invoke('keychain:get', id)),
    upsert: (e) => unwrap(ipcRenderer.invoke('keychain:upsert', e)),
    remove: (id) => unwrap(ipcRenderer.invoke('keychain:remove', id)),
    setPin: (pin) => unwrap(ipcRenderer.invoke('keychain:setPin', pin)),
    autofill: (origin) => unwrap(ipcRenderer.invoke('keychain:autofill', origin)),
    totp: (id) => unwrap(ipcRenderer.invoke('keychain:totp', id)),
    generate: (o) => unwrap(ipcRenderer.invoke('keychain:generate', o)),
  },
  cache: {
    read: (file) => unwrap(ipcRenderer.invoke('cache:read', file)),
    write: (name, bytes) => unwrap(ipcRenderer.invoke('cache:write', name, bytes)),
  },
  window: {
    handoff: () => unwrap(ipcRenderer.invoke('window:handoff')),
    restore: () => unwrap(ipcRenderer.invoke('window:restore')),
  },
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => unwrap(ipcRenderer.invoke('shell:openExternal', url)),
  onFaceIdPrompt: (cb) => on('faceid:prompt', cb),
  onFaceIdPromptEnd: (cb) => on('faceid:prompt-end', cb),
});
