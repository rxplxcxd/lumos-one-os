// "Wer spielt?" – profile picker with per-profile locks (Face ID / PIN), Switch-style.
import { motion, AnimatePresence } from 'framer-motion';
import { create } from 'zustand';
import { UserPlus, Lock, ScanFace } from 'lucide-react';
import { useProfiles, switchProfile, addProfile } from '@/store/profile.js';
import { ROLES, verifyPin } from '@/store/parental.js';
import { verifyFace } from '@/services/faceid.js';
import { askPin } from './PinPrompt.jsx';
import { haptic } from '@/services/haptics.js';
import { toast } from '@/store/ui.js';
import { spring } from '@/lib/motion.js';

export const usePicker = create(() => ({ open: false }));
export const openProfilePicker = () => usePicker.setState({ open: true });

export async function unlockProfile(p) {
  if (p.lock === 'faceid') return (await verifyFace(`Als ${p.name} anmelden`)).ok;
  if (p.lock === 'pin' && p.pinHash) return askPin({ title: `PIN für ${p.name}`, check: (pin) => verifyPin(p.pinHash, pin) });
  return true;
}

export default function ProfilePicker() {
  const open = usePicker((s) => s.open);
  const { profiles, activeId } = useProfiles();
  const choose = async (p) => {
    if (p.id !== activeId && !(await unlockProfile(p))) return;
    switchProfile(p.id);
    haptic('success');
    usePicker.setState({ open: false });
    toast({ title: `Hallo, ${p.name}`, body: ROLES[p.role || 'owner']?.label, kind: 'success', duration: 1800 });
  };
  const guest = () => {
    const existing = profiles.find((p) => p.role === 'guest');
    if (existing) return choose(existing);
    const id = addProfile('Gast', 'guest');
    switchProfile(id);
    usePicker.setState({ open: false });
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div data-nav-scope="88" className="fixed inset-0 z-[88] flex flex-col items-center justify-center bg-black/60 backdrop-blur-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.h1 className="mb-10 text-3xl font-semibold tracking-tight" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.soft}>
            Wer spielt?
          </motion.h1>
          <div className="flex flex-wrap justify-center gap-8">
            {profiles.map((p, i) => (
              <motion.button
                key={p.id}
                data-nav=""
                data-nav-autofocus={p.id === activeId ? '' : undefined}
                onClick={() => choose(p)}
                initial={{ y: 40, opacity: 0, scale: 0.8 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                whileFocus={{ scale: 1.1, y: -6 }}
                transition={{ ...spring.bouncy, delay: i * 0.06 }}
                className="nav-focus flex w-36 flex-col items-center gap-3 rounded-[2rem] p-3"
              >
                <span className="relative h-28 w-28 overflow-hidden rounded-full bg-ink-700 ring-2 ring-white/15">
                  {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-4xl font-semibold">{p.name[0]}</span>}
                  {p.lock !== 'none' && p.lock && (
                    <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70">{p.lock === 'faceid' ? <ScanFace className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</span>
                  )}
                </span>
                <span className="text-[0.95rem] font-medium">{p.name}</span>
                <span className="-mt-2 text-[0.7rem] text-mist-400">{ROLES[p.role || 'owner']?.label}</span>
              </motion.button>
            ))}
            {!profiles.some((p) => p.role === 'guest') && (
              <motion.button data-nav="" onClick={guest} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} whileFocus={{ scale: 1.1, y: -6 }} transition={spring.bouncy} className="nav-focus flex w-36 flex-col items-center gap-3 rounded-[2rem] p-3">
                <span className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-white/25">
                  <UserPlus className="h-9 w-9 text-mist-300" />
                </span>
                <span className="text-[0.95rem] font-medium">Gast</span>
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
