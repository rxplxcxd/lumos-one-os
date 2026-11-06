// Profile card sheet: opens with a spring from the focused row, shows the live game with cover art,
// session time, party status and the actions that platform supports.
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { MessageCircle, UserPlus, ExternalLink, X, Gamepad2, Users } from 'lucide-react';
import { Button } from '@/components/ui/primitives.jsx';
import { FriendAvatar, PlatformBadge, Cover, STATUS_COLOR } from './parts.jsx';
import { PLATFORMS, presenceText, openLink, duration } from '@/services/social/hub.js';
import { spring } from '@/lib/motion.js';

const PROFILE_URL = {
  steam: (f) => `https://steamcommunity.com/profiles/${f.id}`,
  xbox: (f) => `https://www.xbox.com/play/user/${encodeURIComponent(f.name)}`,
  psn: (f) => `https://my.playstation.com/profile/${encodeURIComponent(f.name)}`,
};

export default function ProfileCard({ f, onClose, onChat, onAdd, busy }) {
  return createPortal(
    <AnimatePresence>
      {f && (
        <motion.div key="pc" className="fixed inset-0 z-[70] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div data-nav-scope="70" className="glass-strong relative w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[2rem]" initial={{ scale: 0.86, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.92, y: 16, opacity: 0 }} transition={spring.bouncy}>
            <div className="relative h-36">
              {f.game ? <Cover game={f.game} className="h-full w-full" /> : <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${PLATFORMS[f.platform].color}, #0b0d12)` }} />}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d12] via-[#0b0d12]/40 to-transparent" />
              <button data-nav="" onClick={onClose} aria-label="Schließen" className="nav-focus absolute right-3 top-3 rounded-full bg-black/40 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="-mt-12 px-6 pb-6">
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.08 }}>
                <FriendAvatar f={f} size="5rem" />
              </motion.div>
              <div className="mt-3 flex items-center gap-2">
                <h2 className="text-xl font-semibold">{f.name}</h2>
                <PlatformBadge platform={f.platform} />
                <span className="text-[0.75rem] text-mist-400">{PLATFORMS[f.platform].label}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[0.85rem] text-mist-300">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[f.status] }} />
                {presenceText(f)}
              </div>
              {f.game && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/[0.06] p-3">
                  <Cover game={f.game} className="h-16 w-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[0.7rem] text-mist-400"><Gamepad2 className="h-3 w-3" /> Spielt gerade</div>
                    <div className="truncate font-medium">{f.game.name}</div>
                    {f.since && <div className="text-[0.72rem] text-mist-400">Session: {duration(f.since)}</div>}
                  </div>
                  {f.party && <div className="flex items-center gap-1 rounded-full bg-lumen/20 px-2.5 py-1 text-[0.72rem]"><Users className="h-3 w-3" /> {f.party.size}/{f.party.max}</div>}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {onChat && <Button variant="primary" icon={MessageCircle} autoFocus onClick={onChat}>Nachricht</Button>}
                {onAdd && <Button variant="primary" icon={UserPlus} disabled={busy} onClick={onAdd}>{f.platform === 'lumos' ? 'Freund hinzufügen' : f.platform === 'steam' ? 'In Steam hinzufügen' : 'Folgen / Hinzufügen'}</Button>}
                {PROFILE_URL[f.platform] && <Button variant="subtle" icon={ExternalLink} onClick={() => openLink(PROFILE_URL[f.platform](f))}>Profil</Button>}
              </div>
              <div className="mt-3 truncate text-[0.68rem] text-mist-500">ID {f.id}</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
