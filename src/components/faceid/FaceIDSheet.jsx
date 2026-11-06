// Global Face ID sheet. Appears whenever a verification runs — triggered by the renderer
// (verifyFace()) or by the Electron main process (keychain autofill / unlock).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
        if (d.state === 'matched') closeT = setTimeout(() => setSheet(null), 1900);
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

// Dynamic-Island-style presentation: a black pill drops in from the top edge, morphs into the
// Face ID card while scanning and collapses back into the pill (with a check) before it slides
// out again – centred by a flex wrapper so framer-motion transforms never shift it sideways.
function Island({ sheet }) {
  const [expanded, setExpanded] = useState(false);
  const shownAt = useRef(performance.now());
  const done = sheet.state === 'matched';
  useEffect(() => {
    const t = setTimeout(() => setExpanded(true), 140);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!done) return undefined;
    // keep the card on screen long enough to read (fast scans would otherwise just flash)
    const t = setTimeout(() => setExpanded(false), Math.max(480, 1000 - (performance.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [done]);
  const big = expanded;
  return (
    <motion.div
      data-nav-scope="80"
      className="relative flex flex-col items-center overflow-hidden bg-black text-white shadow-[0_18px_60px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/10"
      initial={{ y: -70, width: 120, height: 36, borderRadius: 18, opacity: 0 }}
      animate={{ y: 0, opacity: 1, width: big ? 240 : done ? 168 : 120, height: big ? 236 : 36, borderRadius: big ? 38 : 18 }}
      exit={{ y: -70, width: 110, height: 34, borderRadius: 17, opacity: 0, transition: { type: 'spring', stiffness: 380, damping: 32 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {big ? (
          <motion.div key="card" className="flex flex-col items-center px-6 pb-6 pt-8" initial={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.85, filter: 'blur(6px)' }} transition={{ duration: 0.22 }}>
            <FaceIDGlyph state={sheet.state} size="6.5rem" />
            <AnimatePresence mode="wait">
              <motion.p key={sheet.state} className="mt-5 text-center text-[0.95rem] font-medium" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {LABEL[sheet.state] || 'Face ID'}
              </motion.p>
            </AnimatePresence>
            <p className="mt-1 min-h-[1.1rem] max-w-[12rem] truncate text-center text-[0.72rem] text-mist-400">{sheet.state === 'failed' ? sheet.detail || 'Erneut versuchen' : sheet.reason}</p>
          </motion.div>
        ) : (
          <motion.div key="pill" className="flex h-[36px] items-center gap-2 px-3 text-[0.75rem] font-medium" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <FaceIDGlyph state={sheet.state} size="1.3rem" />
            {done && <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="text-ok">Entsperrt</motion.span>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FaceIDSheet() {
  const sheet = useUI((s) => s.faceSheet);
  return createPortal(
    <AnimatePresence>
      {sheet && (
        <motion.div key="faceid" className="pointer-events-none fixed inset-0 z-[80]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.1 } }}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div className="pointer-events-auto absolute inset-x-0 top-2.5 flex justify-center">
            <Island sheet={sheet} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
