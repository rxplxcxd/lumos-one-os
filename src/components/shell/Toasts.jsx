import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useUI } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const TINT = { success: 'text-ok', error: 'text-bad', info: 'text-lumen-400' };

export default function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed left-1/2 top-[3.8rem] z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
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
              className="glass-strong flex min-w-[18rem] max-w-[34rem] items-center gap-3 rounded-full py-2 pl-2.5 pr-5"
            >
              {t.icon ? <img src={t.icon} alt="" className="h-8 w-8 rounded-xl" /> : <I className={`h-6 w-6 ${TINT[t.kind]}`} />}
              <div className="min-w-0">
                <div className="truncate text-[0.85rem] font-semibold">{t.title}</div>
                {t.body && <div className="truncate text-[0.75rem] text-mist-300">{t.body}</div>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
