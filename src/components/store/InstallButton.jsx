// Install / open / progress button that morphs between states with springs.
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useDownloads, install, uninstall, cancel, jobFor } from '@/store/downloads.js';
import { useSettings } from '@/store/settings.js';
import { verifyFace } from '@/services/faceid.js';
import { launch } from '@/store/library.js';
import { toast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

export default function InstallButton({ app, size = 'md', showUninstall = false }) {
  const jobs = useDownloads((s) => s.jobs);
  const installed = useDownloads((s) => !!s.installed[app.id]);
  const needFace = useSettings((s) => s.values.faceIdStore);
  const job = jobFor(jobs, app.id);
  const h = size === 'lg' ? 'h-12 min-w-[9.5rem] text-[0.95rem]' : 'h-9 min-w-[5.6rem] text-[0.8rem]';

  const doInstall = async () => {
    if (needFace) {
      const r = await verifyFace(`„${app.name}“ installieren`);
      if (!r.ok) return;
    }
    try {
      await install(app);
    } catch (e) {
      toast({ title: 'Installation nicht möglich', body: e.message, kind: 'error' });
    }
  };

  if (job) {
    const pct = Math.round(job.percent || 0);
    return (
      <motion.button layout data-nav="" onClick={() => cancel(job.job)} transition={spring.snappy} className={`nav-focus relative overflow-hidden rounded-full bg-white/10 px-4 font-semibold ${h}`} aria-label="Abbrechen">
        <motion.span className="absolute inset-y-0 left-0 bg-white/25" animate={{ width: `${pct}%` }} transition={spring.soft} />
        <span className="relative flex items-center justify-center gap-2 tabular-nums">
          {pct}% <X className="h-3.5 w-3.5 opacity-60" />
        </span>
      </motion.button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {installed ? (
          <motion.button key="open" layout data-nav="" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={spring.bouncy} onClick={() => launch({ id: `flatpak:${app.id}`, name: app.name })} className={`nav-focus flex items-center justify-center gap-1.5 rounded-full bg-white/[0.12] px-4 font-semibold ${h}`}>
            <Check className="h-4 w-4" /> Öffnen
          </motion.button>
        ) : (
          <motion.button key="get" layout data-nav="" data-nav-haptic="none" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={spring.bouncy} onClick={doInstall} className={`nav-focus rounded-full bg-mist-50 px-5 font-semibold text-ink-950 ${h}`}>
            Laden
          </motion.button>
        )}
      </AnimatePresence>
      {installed && showUninstall && (
        <button data-nav="" onClick={() => uninstall(app)} className={`nav-focus rounded-full border border-bad/30 bg-bad/10 px-4 font-medium text-bad ${h}`}>
          Entfernen
        </button>
      )}
    </div>
  );
}
