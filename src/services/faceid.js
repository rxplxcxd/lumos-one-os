// Renderer-initiated Face ID verification (store confirmations, lock screen, settings).
import { request } from './bridge.js';
import { useUI } from '@/store/ui.js';

export async function verifyFace(reason = 'Mit Face ID bestätigen', { timeout = 8 } = {}) {
  useUI.setState({ faceSheet: { reason, state: 'searching' } });
  try {
    const r = await request('faceid.verify', { reason, timeout }, (timeout + 6) * 1000);
    return r;
  } catch (e) {
    useUI.setState({ faceSheet: { reason, state: 'failed', detail: e.message } });
    setTimeout(() => useUI.setState({ faceSheet: null }), 1600);
    return { ok: false, reason: e.message };
  }
}
