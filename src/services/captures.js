// Captures (clips & screenshots) stored in IndexedDB: blob + metadata + thumbnail.
import { idb } from './storage.js';

const INDEX = 'captures.index';

async function thumbOf(blob, kind) {
  try {
    const url = URL.createObjectURL(blob);
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d');
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, 0, 320, 180);
    } else {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, playsInline: true });
      await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j), setTimeout(r, 2500)));
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise((r) => ((v.onseeked = r), setTimeout(r, 1500)));
      ctx.drawImage(v, 0, 0, 320, 180);
    }
    URL.revokeObjectURL(url);
    return c.toDataURL('image/webp', 0.7);
  } catch {
    return null;
  }
}

export async function listCaptures() {
  return ((await idb.get(INDEX)) || []).sort((a, b) => b.t - a.t);
}

export async function saveCapture({ blob, kind = 'video', name, source = 'Lumos', duration, trimStart = 0 }) {
  const id = crypto.randomUUID();
  const meta = { id, kind, name: name || `${kind === 'video' ? 'Clip' : 'Screenshot'} ${new Date().toLocaleString('de-DE')}`, t: Date.now(), size: blob.size, type: blob.type, source, duration, trimStart, thumb: await thumbOf(blob, kind) };
  await idb.set(`cap:${id}`, { blob, ...meta });
  await idb.set(INDEX, [meta, ...((await idb.get(INDEX)) || [])]);
  window.dispatchEvent(new CustomEvent('lumos:capture-saved', { detail: meta }));
  return meta;
}

export const getCapture = (id) => idb.get(`cap:${id}`);

export async function deleteCapture(id) {
  await idb.del(`cap:${id}`);
  await idb.set(INDEX, ((await idb.get(INDEX)) || []).filter((c) => c.id !== id));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
