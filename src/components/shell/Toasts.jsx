import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, BatteryWarning, BatteryLow } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useUI, dismissToast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info, battery: BatteryLow, critical: BatteryWarning };
const TINT = { success: 'text-ok', error: 'text-bad', info: 'text-lumen-400', battery: 'text-warn', critical: 'text-bad' };

export default function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[3.8rem] z-[92] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const I = ICON[t.kind] || Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              transition={spring.bouncy}
              className={`glass-strong flex min-w-[18rem] max-w-[40rem] items-center gap-3 py-2 pl-2.5 ${t.actions ? 'pointer-events-auto rounded-[1.6rem] pr-2.5' : 'rounded-full pr-5'} ${t.kind === 'critical' ? 'ring-1 ring-bad/60' : ''}`}
            >
              {t.icon ? <img src={t.icon} alt="" className="h-8 w-8 rounded-xl" /> : <I className={`h-6 w-6 ${TINT[t.kind]}`} />}
              <div className="min-w-0">
                <div className="truncate text-[0.85rem] font-semibold">{t.title}</div>
                {t.body && <div className="truncate text-[0.75rem] text-mist-300">{t.body}</div>}
              </div>
              {t.actions && (
                <div className="ml-3 flex shrink-0 gap-1.5">
                  {t.actions.map((a) => (
                    <button key={a.label} data-nav="" onClick={() => (a.run(), dismissToast(t.id))} className={`nav-focus rounded-full px-3.5 py-1.5 text-[0.78rem] font-semibold ${a.primary ? 'bg-mist-50 text-ink-950' : 'bg-white/10'}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
