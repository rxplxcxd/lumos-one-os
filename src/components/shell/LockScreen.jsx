// Lock screen with Face ID unlock (used after boot, resume and from the quick menu).
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { setLocked } from '@/store/ui.js';
import { verifyFace } from '@/services/faceid.js';
import { useNow, Button } from '@/components/ui/primitives.jsx';
import FaceIDGlyph from '@/components/faceid/FaceIDGlyph.jsx';
import { spring } from '@/lib/motion.js';

export default function LockScreen() {
  const now = useNow(1000);
  const [state, setState] = useState('idle');
  const attempt = async () => {
    setState('searching');
    const r = await verifyFace('Lumos One entsperren');
    if (r.ok) {
      setState('matched');
      setTimeout(() => setLocked(false), 700);
    } else setState('failed');
  };
  useEffect(() => {
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <motion.div data-nav-scope="90" className="fixed inset-0 z-[75] flex flex-col items-center bg-black/30 pt-[9rem] backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -40 }} transition={spring.soft}>
      <div className="text-[5.5rem] font-extralight tabular-nums leading-none">{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="mt-2 text-lg text-mist-200">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="mt-auto mb-16 flex flex-col items-center gap-4">
        <FaceIDGlyph state={state === 'idle' ? 'idle' : state} size="3.6rem" />
        <Button variant="glass" autoFocus onClick={attempt}>
          {state === 'failed' ? 'Erneut versuchen' : 'Mit Face ID entsperren'}
        </Button>
      </div>
    </motion.div>
  );
}
