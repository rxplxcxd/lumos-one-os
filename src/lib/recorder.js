// Replay buffer ("the last 30 seconds") with MediaRecorder. WebM chunks are not independently
// decodable, so three overlapping recorders with a 40 s lifetime are rotated 13.3 s apart: at any
// moment one of them holds ≥ 30 s ending *now*; the editor opens the clip trimmed to the last 30 s.
const LIFETIME = 40000;
const COUNT = 3;

function pickMime() {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  return '';
}

export class ReplayRecorder {
  constructor() {
    this.stream = null;
    this.slots = [];
    this.timers = [];
    this.mime = pickMime();
  }

  get active() {
    return !!this.stream;
  }

  start(stream) {
    this.stop();
    if (!window.MediaRecorder) throw new Error('MediaRecorder wird nicht unterstützt');
    this.stream = stream;
    for (let i = 0; i < COUNT; i++) this.timers.push(setTimeout(() => this.#spawn(i), (i * LIFETIME) / COUNT));
  }

  #spawn(i) {
    if (!this.stream) return;
    const old = this.slots[i];
    if (old?.rec.state === 'recording') old.rec.stop();
    const rec = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 8_000_000 });
    const slot = { rec, chunks: [], t0: performance.now() };
    rec.ondataavailable = (e) => e.data.size && slot.chunks.push(e.data);
    rec.start(1000);
    this.slots[i] = slot;
    this.timers[i] = setTimeout(() => this.#spawn(i), LIFETIME);
  }

  /** Returns { blob, duration, trimStart } covering up to the last `seconds`. */
  async save(seconds = 30) {
    const now = performance.now();
    const live = this.slots.filter((s) => s?.rec.state === 'recording');
    if (!live.length) throw new Error('Puffer leer – Aufnahme läuft noch nicht lange genug');
    const best = live.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    const duration = (now - best.t0) / 1000;
    await new Promise((r) => {
      best.rec.addEventListener('dataavailable', r, { once: true });
      best.rec.requestData();
    });
    const blob = new Blob(best.chunks, { type: this.mime || 'video/webm' });
    return { blob, duration, trimStart: Math.max(0, duration - seconds) };
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.slots.forEach((s) => s?.rec.state === 'recording' && s.rec.stop());
    this.slots = [];
    this.stream = null;
  }
}

// ---------------------------------------------------------------- shell-wide capture service
export const replay = new ReplayRecorder();
let source = null; // { kind: 'canvas'|'display', el?, stream }

/** Built-in games register their canvas so clips need no screen-capture permission. */
export function setCaptureCanvas(canvas) {
  if (!canvas) {
    if (source?.kind === 'canvas') {
      replay.stop();
      source = null;
    }
    return;
  }
  source = { kind: 'canvas', el: canvas, stream: canvas.captureStream(60) };
  replay.start(source.stream);
}

/** Whole-screen capture (Electron: no prompt via setDisplayMediaRequestHandler; browser: one prompt). */
export async function enableScreenCapture() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
  source = { kind: 'display', stream };
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (source?.stream === stream) {
      replay.stop();
      source = null;
    }
  });
  replay.start(stream);
}

export const captureSource = () => source;

export async function screenshotBlob() {
  if (source?.kind === 'canvas') return new Promise((r) => source.el.toBlob(r, 'image/png'));
  if (source?.kind === 'display') {
    const track = source.stream.getVideoTracks()[0];
    const v = document.createElement('video');
    v.srcObject = new MediaStream([track]);
    v.muted = true;
    await v.play();
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    v.pause();
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
  // fallback: the living wallpaper canvas
  const bg = document.querySelector('canvas');
  return bg ? new Promise((r) => bg.toBlob(r, 'image/png')) : null;
}
