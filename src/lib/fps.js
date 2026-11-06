// Shared frame-time meter (rAF): FPS, 1 % low, frametime history for HUD and developer panel.
const N = 240;
export const frames = { times: new Float32Array(N), i: 0, fps: 0, low1: 0, last: 0 };
let started = false;
const subs = new Set();
export const onFrameStats = (fn) => (subs.add(fn), () => subs.delete(fn));

export function startFpsMeter() {
  if (started) return;
  started = true;
  let acc = 0;
  let count = 0;
  const loop = (t) => {
    if (frames.last) {
      const dt = t - frames.last;
      frames.times[frames.i++ % N] = dt;
      acc += dt;
      count++;
      if (acc >= 500) {
        frames.fps = (count * 1000) / acc;
        const sorted = Array.from(frames.times).filter(Boolean).sort((a, b) => b - a);
        frames.low1 = sorted.length ? 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.01))] : 0;
        acc = 0;
        count = 0;
        subs.forEach((f) => f(frames));
      }
    }
    frames.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function memory() {
  const m = performance.memory;
  return m ? { used: m.usedJSHeapSize, total: m.jsHeapSizeLimit } : null;
}
