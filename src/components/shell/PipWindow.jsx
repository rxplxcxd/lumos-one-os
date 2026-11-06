// Picture-in-Picture: floating, translucent mini browser (guides, YouTube) that stays above
// every screen. In the Lumos shell it is a separate always-on-top window marked as a Gamescope
// overlay, so it also floats above running games. R3 toggles "PiP-Steuerung": the right stick
// then moves the window, L/R resize it; otherwise the right stick scrolls its page.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Move, Minus, Plus, Maximize2 } from 'lucide-react';
import { haptic } from '@/services/haptics.js';
import { toast } from '@/store/ui.js';

export const usePip = create(() => ({ url: null, title: '' }));

export function toEmbed(url) {
  try {
    const u = new URL(url);
    let id = null;
    if (/youtube\.com$/.test(u.hostname.replace(/^www\.|^m\./, '')) && u.searchParams.get('v')) id = u.searchParams.get('v');
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    if (id) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`;
    const tw = /twitch\.tv$/.test(u.hostname.replace(/^www\.|^m\./, '')) && u.pathname.split('/')[1];
    if (tw) return `https://player.twitch.tv/?channel=${tw}&parent=${location.hostname || 'localhost'}`;
  } catch {
    /* not a URL */
  }
  return url;
}

export async function openPip(url, title = '') {
  if (window.lumos?.pip) {
    await window.lumos.pip.open(toEmbed(url));
    usePip.setState({ url, title, native: true });
  } else usePip.setState({ url, title, native: false });
  haptic('open');
  toast({ title: 'Bild-in-Bild', body: 'R3 drücken für PiP-Steuerung (verschieben/Größe)', kind: 'info', duration: 3500 });
}
export function closePip() {
  window.lumos?.pip?.close();
  usePip.setState({ url: null });
  haptic('close');
}

export default function PipWindow() {
  const { url, native } = usePip();
  const [rect, setRect] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 330, w: 480, h: 270 });
  const [opacity, setOpacity] = useState(0.95);
  const [control, setControl] = useState(false);
  const frame = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    if (!url) return undefined;
    const onAction = (e) => {
      const a = e.detail.action;
      if (a === 'r3') {
        setControl((c) => !c);
        haptic('toggle.on');
      }
      if (control && (a === 'lb' || a === 'rb')) setRect((r) => ({ ...r, w: Math.max(280, Math.min(1100, r.w * (a === 'rb' ? 1.12 : 0.89))), h: Math.max(158, Math.min(620, r.h * (a === 'rb' ? 1.12 : 0.89))) }));
    };
    const onScroll = (e) => {
      const { dx, dy, x, y } = e.detail;
      const inside = x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
      if (control) {
        e.preventDefault();
        setRect((r) => ({ ...r, x: Math.max(0, Math.min(window.innerWidth - r.w, r.x + dx * 0.8)), y: Math.max(0, Math.min(window.innerHeight - r.h, r.y + dy * 0.8)) }));
      } else if (inside && frame.current?.executeJavaScript) {
        e.preventDefault();
        frame.current.executeJavaScript(`scrollBy(${dx}, ${dy})`).catch(() => {});
      }
    };
    const onClose = () => closePip();
    window.addEventListener('lumos:action', onAction);
    window.addEventListener('lumos:rs-scroll', onScroll);
    window.addEventListener('lumos:pip-close', onClose);
    return () => {
      window.removeEventListener('lumos:action', onAction);
      window.removeEventListener('lumos:rs-scroll', onScroll);
      window.removeEventListener('lumos:pip-close', onClose);
    };
  }, [url, control, rect]);

  if (native) return null; // the shell renders it as its own overlay window
  return createPortal(
    <AnimatePresence>
      {url && (
        <motion.div
          data-pip=""
          className={`fixed z-[91] overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ${control ? 'ring-2 ring-lumen' : 'ring-1 ring-white/15'}`}
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          <div
            className="absolute inset-x-0 top-0 z-10 flex h-8 cursor-move items-center gap-1 bg-gradient-to-b from-black/80 to-transparent px-2 opacity-0 transition-opacity hover:opacity-100"
            style={{ opacity: control ? 1 : undefined }}
            onPointerDown={(e) => {
              drag.current = { sx: e.clientX, sy: e.clientY, x: rect.x, y: rect.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => drag.current && setRect((r) => ({ ...r, x: drag.current.x + e.clientX - drag.current.sx, y: drag.current.y + e.clientY - drag.current.sy }))}
            onPointerUp={() => (drag.current = null)}
          >
            <Move className="h-3.5 w-3.5 text-white/70" />
            <span className="flex-1 truncate text-[0.7rem] text-white/70">{control ? 'PiP-Steuerung: Rechter Stick bewegt · L/R Größe · R3 beendet' : 'Bild-in-Bild'}</span>
            <button className="rounded p-1 hover:bg-white/15" onClick={() => setOpacity((o) => Math.max(0.35, o - 0.15))} aria-label="Transparenter"><Minus className="h-3.5 w-3.5" /></button>
            <button className="rounded p-1 hover:bg-white/15" onClick={() => setOpacity((o) => Math.min(1, o + 0.15))} aria-label="Deckender"><Plus className="h-3.5 w-3.5" /></button>
            <button className="rounded p-1 hover:bg-white/15" onClick={() => setRect((r) => ({ ...r, w: r.w > 700 ? 480 : 860, h: r.w > 700 ? 270 : 484 }))} aria-label="Größe"><Maximize2 className="h-3.5 w-3.5" /></button>
            <button className="rounded p-1 hover:bg-white/15" onClick={closePip} aria-label="Schließen"><X className="h-3.5 w-3.5" /></button>
          </div>
          {window.lumos?.isElectron ? (
            <webview ref={frame} src={toEmbed(url)} partition="persist:lumos-web" style={{ width: '100%', height: '100%' }} />
          ) : (
            <iframe title="PiP" src={toEmbed(url)} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation" />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
