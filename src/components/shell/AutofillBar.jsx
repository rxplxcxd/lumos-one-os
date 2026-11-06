// iPhone-style password suggestion: focusing a field marked with data-autofill="<origin>" shows a
// key pill; Face ID releases the stored credentials and fills user + password fields.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound } from 'lucide-react';
import { keychain } from '@/services/keychain.js';
import { useSettings } from '@/store/settings.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';

function setNative(el, v) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function fillFields(origin, cred) {
  const fields = document.querySelectorAll(`[data-autofill="${CSS.escape(origin)}"]`);
  fields.forEach((f) => {
    if (f.dataset.autofillRole === 'password') setNative(f, cred.password);
    else if (cred.username) setNative(f, cred.username);
  });
}

/** After a successful in-OS login: offer to store the credentials (Face ID unlock). */
export function offerSave(origin, username, password) {
  if (!password) return;
  toast({
    title: 'Passwort im Schlüsselbund sichern?',
    body: `${username} · ${origin}`,
    kind: 'info',
    duration: 10000,
    actions: [
      {
        label: 'Sichern',
        primary: true,
        run: async () => {
          try {
            await keychain().unlock({ reason: 'Passwort sichern' });
            await keychain().upsert({ title: origin, origin, username, password });
            haptic('success');
          } catch (e) {
            toast({ title: e.message, kind: 'error' });
          }
        },
      },
      { label: 'Nein', run: () => {} },
    ],
  });
}

export default function AutofillBar() {
  const [origin, setOrigin] = useState(null);
  const enabled = useSettings((s) => s.values.faceIdKeychain);
  useEffect(() => {
    const onIn = (e) => {
      const o = e.target?.dataset?.autofill;
      if (o) setOrigin(o);
    };
    const onOut = () => setTimeout(() => !document.activeElement?.dataset?.autofill && !document.activeElement?.closest?.('[data-autofill-bar]') && setOrigin(null), 150);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  const fill = async () => {
    try {
      const creds = await keychain().autofill(origin);
      if (!creds.length) return toast({ title: 'Keine gespeicherten Anmeldedaten', body: origin, kind: 'info' });
      fillFields(origin, creds[0]);
      haptic('success');
      setOrigin(null);
    } catch (e) {
      toast({ title: e.message, kind: 'error' });
    }
  };
  return createPortal(
    <AnimatePresence>
      {origin && enabled && (
        <div className="pointer-events-none fixed inset-x-0 top-[4.4rem] z-[86] flex justify-center">
          <motion.button
            data-autofill-bar=""
            data-nav=""
            onPointerDown={(e) => e.preventDefault()}
            onClick={fill}
            initial={{ y: -30, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="nav-focus glass-strong pointer-events-auto flex items-center gap-2.5 rounded-full py-2 pl-3 pr-4 text-[0.85rem]"
          >
            <KeyRound className="h-4 w-4 text-lumen" /> Anmeldedaten für <b>{origin}</b> mit Face ID einsetzen
          </motion.button>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
