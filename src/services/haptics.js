// Haptics service — routes named patterns (shared/haptics.json) to the LRA actuators via
// lumosd → ESP32-S3 → DRV2605L. Generic controllers fall back to Gamepad API dual-rumble.
import catalog from '@shared/haptics.json';
import { notify, bridgeMode } from './bridge.js';

const MIN_GAP = { 'nav.tick': 28, 'slider.detent': 22, key: 18 };
const last = new Map();
let enabled = true;
let intensity = 0.8;
let rumbleFallback = true;

export const patterns = Object.keys(catalog.patterns);

export function configureHaptics(opts = {}) {
  if (opts.enabled != null) enabled = !!opts.enabled;
  if (opts.intensity != null) intensity = Math.max(0, Math.min(1, opts.intensity));
  if (opts.rumbleFallback != null) rumbleFallback = !!opts.rumbleFallback;
  notify('haptics.set', { enabled, intensity });
}

async function rumble(steps) {
  if (!rumbleFallback || typeof navigator.getGamepads !== 'function') return;
  const pads = Array.from(navigator.getGamepads()).filter((p) => p?.vibrationActuator && !/lumos/i.test(p.id));
  if (!pads.length) return;
  for (const s of steps) {
    if (s.strong || s.weak) {
      await Promise.all(
        pads.map((p) =>
          p.vibrationActuator
            .playEffect('dual-rumble', { duration: s.ms, strongMagnitude: s.strong * intensity, weakMagnitude: s.weak * intensity })
            .catch(() => {}),
        ),
      );
    } else await new Promise((r) => setTimeout(r, s.ms));
  }
}

/**
 * @param {string} name pattern name, e.g. 'nav.tick'
 * @param {{target?: 'all'|'left'|'right'|'body', scale?: number}} [opts]
 */
export function haptic(name, opts = {}) {
  if (!enabled) return;
  const p = catalog.patterns[name];
  if (!p) return;
  const t = performance.now();
  const gap = MIN_GAP[name] ?? 0;
  if (gap && t - (last.get(name) ?? 0) < gap) return;
  last.set(name, t);
  notify('haptics.play', { pattern: name, target: opts.target ?? 'all', intensity: intensity * (opts.scale ?? 1) });
  if (bridgeMode() !== 'electron' || rumbleFallback) rumble(p.rumble ?? []);
}
