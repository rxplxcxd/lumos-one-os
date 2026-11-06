// Live install/uninstall queue with permanent percentages. Used on the home screen, in the
// library and in the store.
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Trash2 } from 'lucide-react';
import { useDownloads, cancel } from '@/store/downloads.js';
import { Progress } from '@/components/ui/primitives.jsx';
import { spring } from '@/lib/motion.js';

export default function DownloadTray({ compact = false, className = '' }) {
  const jobs = Object.values(useDownloads((s) => s.jobs));
  return (
    <AnimatePresence initial={false}>
      {jobs.length > 0 && (
        <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={spring.soft} className={`glass rounded-3xl p-3 ${className}`}>
          {!compact && <div className="label mb-2 px-1">Downloads · {jobs.length}</div>}
          <div className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {jobs.map((j) => (
                <motion.div key={j.job} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.soft} className="flex items-center gap-3 rounded-2xl px-1 py-1">
                  {j.icon ? <img src={j.icon} alt="" className="h-9 w-9 shrink-0 rounded-xl" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">{j.op === 'uninstall' ? <Trash2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[0.85rem] font-medium">{j.name}</span>
                      <span className="ml-auto shrink-0 text-[0.8rem] font-semibold tabular-nums">{Math.round(j.percent || 0)}%</span>
                    </div>
                    <Progress value={j.percent || 0} thin className="mt-1.5" />
                    {!compact && (
                      <div className="mt-1 flex text-[0.68rem] text-mist-400">
                        <span className="truncate">{j.stage}</span>
                        {j.speed && <span className="ml-auto tabular-nums">{j.speed}</span>}
                      </div>
                    )}
                  </div>
                  {!compact && (
                    <button data-nav="" aria-label="Abbrechen" onClick={() => cancel(j.job)} className="nav-focus flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07]">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
