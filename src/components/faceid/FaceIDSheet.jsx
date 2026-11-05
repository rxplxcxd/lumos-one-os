// Global Face ID sheet. Appears whenever a verification runs — triggered by the renderer
// (verifyFace()) or by the Electron main process (keychain autofill / unlock).
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import FaceIDGlyph from './FaceIDGlyph.jsx';
import { useUI } from '@/store/ui.js';
import { on } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const LABEL = {
  idle: 'Face ID',
  searching: 'Gesicht wird gesucht …',
  detected: 'Gesicht erkannt',
  matched: 'Entsperrt',
  failed: 'Nicht erkannt',
};

const setSheet = (p) => useUI.setState((s) => ({ faceSheet: p === null ? null : { ...(s.faceSheet || {}), ...p } }));

export function useFaceIdEvents() {
  useEffect(() => {
    let closeT;
    const offs = [
      on('faceid.state', (d) => {
        if (d.state === 'enrolling' || d.state === 'enrolled') return;
        const s = useUI.getState().faceSheet;
        if (!s) return;
        if (d.state === 'searching') haptic('faceid.scan');
        if (d.state === 'matched') haptic('faceid.success');
        if (d.state === 'failed') haptic('faceid.fail');
        setSheet({ state: d.state, detail: d.reason });
        clearTimeout(closeT);
        if (d.state === 'matched') closeT = setTimeout(() => setSheet(null), 950);
        if (d.state === 'failed') closeT = setTimeout(() => setSheet(null), 1800);
      }),
    ];
    if (window.lumos?.onFaceIdPrompt) {
      offs.push(window.lumos.onFaceIdPrompt(({ reason }) => setSheet({ reason, state: 'searching' })));
      offs.push(
        window.lumos.onFaceIdPromptEnd(() => {
          const s = useUI.getState().faceSheet;
          if (s && s.state !== 'matched' && s.state !== 'failed') setSheet(null);
        }),
      );
    }
    return () => offs.forEach((f) => f());
  }, []);
}

export default function FaceIDSheet() {
  const sheet = useUI((s) => s.faceSheet);
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div className="fixed inset-0 z-[80] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[3px]" />
          <motion.div
            data-nav-scope="80"
            className="glass-strong relative flex w-[15rem] flex-col items-center rounded-[2.2rem] px-6 pb-6 pt-8"
            initial={{ scale: 0.82, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={spring.bouncy}
          >
            <FaceIDGlyph state={sheet.state} size="6.5rem" />
            <AnimatePresence mode="wait">
              <motion.p key={sheet.state} className="mt-5 text-center text-[0.95rem] font-medium" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {LABEL[sheet.state] || 'Face ID'}
              </motion.p>
            </AnimatePresence>
            <p className="mt-1 min-h-[1.1rem] text-center text-[0.72rem] text-mist-400">{sheet.state === 'failed' ? sheet.detail || 'Erneut versuchen' : sheet.reason}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
