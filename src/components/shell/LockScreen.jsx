// Lock screen with Face ID unlock (after a cold boot). After a failed scan the device code
// (keychain PIN) can be used, exactly like iOS. Without a configured code the device is not
// protected by a passcode, so it can be opened after failed attempts.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { setLocked } from '@/store/ui.js';
import { verifyFace } from '@/services/faceid.js';
import { keychain } from '@/services/keychain.js';
import { haptic } from '@/services/haptics.js';
import { useNow, Button, TextField } from '@/components/ui/primitives.jsx';
import FaceIDGlyph from '@/components/faceid/FaceIDGlyph.jsx';
import { spring } from '@/lib/motion.js';

export default function LockScreen() {
  const now = useNow(1000);
  const [state, setState] = useState('idle');
  const [fails, setFails] = useState(0);
  const [hasPin, setHasPin] = useState(null);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);

  const unlock = () => {
    setState('matched');
    setTimeout(() => setLocked(false), 650);
  };
  const attempt = async () => {
    setState('searching');
    const r = await verifyFace('Lumos One entsperren');
    if (r.ok) unlock();
    else {
      setState('failed');
      setFails((f) => f + 1);
    }
  };
  const tryPin = async () => {
    try {
      await keychain().unlock({ method: 'pin', pin });
      haptic('faceid.success');
      unlock();
    } catch {
      haptic('faceid.fail');
      setPinError(true);
      setPin('');
      setTimeout(() => setPinError(false), 600);
    }
  };

  useEffect(() => {
    keychain()
      .status()
      .then((s) => setHasPin(!!s.hasPin), () => setHasPin(false));
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div data-nav-scope="90" className="fixed inset-0 z-[75] flex flex-col items-center bg-black/30 pt-[9rem] backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -40 }} transition={spring.soft}>
      <div className="text-[5.5rem] font-extralight tabular-nums leading-none">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="mt-2 text-lg text-mist-200">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="mb-16 mt-auto flex flex-col items-center gap-4">
        <AnimatePresence mode="wait">
          {pinMode ? (
            <motion.div key="pin" className="flex w-[20rem] flex-col items-center gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, x: pinError ? [0, -12, 10, -6, 4, 0] : 0 }} exit={{ opacity: 0 }}>
              <div className="text-[0.9rem] text-mist-200">Code eingeben</div>
              <TextField autoFocus type="password" inputMode="numeric" value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} onEnter={tryPin} className="text-center tracking-[0.5em]" />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setPinMode(false)}>Face ID</Button>
                <Button variant="primary" onClick={tryPin}>Entsperren</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="face" className="flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FaceIDGlyph state={state === 'idle' ? 'idle' : state} size="3.6rem" />
              <div className="flex gap-2">
                <Button variant="glass" autoFocus onClick={attempt}>
                  {state === 'failed' ? 'Erneut versuchen' : 'Mit Face ID entsperren'}
                </Button>
                {fails > 0 && hasPin && <Button variant="subtle" onClick={() => setPinMode(true)}>Code eingeben</Button>}
                {fails > 1 && hasPin === false && <Button variant="subtle" onClick={unlock}>Ohne Face ID öffnen</Button>}
              </div>
              {fails > 1 && hasPin === false && <div className="text-[0.72rem] text-mist-500">Kein Gerätecode festgelegt – unter Einstellungen → Face ID &amp; Code einrichten.</div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
