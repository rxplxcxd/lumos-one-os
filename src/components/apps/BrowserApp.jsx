// Lumos Web — web apps inside the shell (<webview> in Electron) with Face-ID autofill from the
// keychain. In a plain browser preview it falls back to an <iframe>.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, RotateCw, Globe, KeyRound, Home } from 'lucide-react';
import { Screen, TextField, Button } from '@/components/ui/primitives.jsx';
import { keychain } from '@/services/keychain.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const START = 'https://duckduckgo.com/';
const BOOKMARKS = [
  { name: 'YouTube', url: 'https://m.youtube.com/' },
  { name: 'Twitch', url: 'https://m.twitch.tv/' },
  { name: 'Wikipedia', url: 'https://de.m.wikipedia.org/' },
  { name: 'ProtonDB', url: 'https://www.protondb.com/' },
  { name: 'GitHub', url: 'https://github.com/login' },
];

function normalize(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

export default function BrowserApp({ url: initial }) {
  const wv = useRef(null);
  const [url, setUrl] = useState(initial || START);
  const [addr, setAddr] = useState(initial || START);
  const [login, setLogin] = useState(null);
  const electron = !!window.lumos?.isElectron;

  useEffect(() => {
    const v = wv.current;
    if (!v || !electron) return undefined;
    const onNav = (e) => {
      setAddr(e.url);
      setLogin(null);
    };
    const onMsg = (e) => {
      if (e.channel === 'lumos:login-form' || e.channel === 'lumos:login-focus') setLogin(e.args[0]);
    };
    v.addEventListener('did-navigate', onNav);
    v.addEventListener('did-navigate-in-page', onNav);
    v.addEventListener('ipc-message', onMsg);
    return () => {
      v.removeEventListener('did-navigate', onNav);
      v.removeEventListener('did-navigate-in-page', onNav);
      v.removeEventListener('ipc-message', onMsg);
    };
  }, [electron]);

  const fill = async () => {
    try {
      const creds = await keychain().autofill(login.origin);
      if (!creds.length) return toast({ title: 'Keine Anmeldedaten für diese Seite', body: login.origin, kind: 'info' });
      wv.current?.send?.('lumos:autofill', creds[0]);
      haptic('success');
      setLogin(null);
    } catch (e) {
      toast({ title: e.message, kind: 'error' });
    }
  };

  const go = (u) => {
    const n = normalize(u);
    setUrl(n);
    setAddr(n);
    if (electron && wv.current?.loadURL) wv.current.loadURL(n).catch(() => {});
  };

  return (
    <Screen
      title="Web"
      icon={Globe}
      noPad
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" icon={ArrowLeft} onClick={() => wv.current?.goBack?.()} />
          <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => wv.current?.goForward?.()} />
          <Button size="sm" variant="subtle" icon={RotateCw} onClick={() => wv.current?.reload?.()} />
          <Button size="sm" variant="subtle" icon={Home} onClick={() => go(START)} />
          <div className="w-[26rem]">
            <TextField value={addr} onChange={setAddr} onEnter={() => go(addr)} className="h-9 rounded-full py-1.5 text-[0.82rem]" />
          </div>
        </div>
      }
    >
      <div className="mb-2 flex gap-2 px-10">
        {BOOKMARKS.map((b) => (
          <Button key={b.url} size="sm" variant="ghost" onClick={() => go(b.url)}>{b.name}</Button>
        ))}
      </div>
      <div className="relative mx-10 mb-6 h-[calc(100%-3.5rem)] overflow-hidden rounded-3xl bg-white">
        {electron ? <webview ref={wv} src={url} partition="persist:lumos-web" allowpopups="false" style={{ width: '100%', height: '100%' }} /> : <iframe title="web" src={url} className="h-full w-full" sandbox="allow-scripts allow-same-origin allow-forms" />}
        <AnimatePresence>
          {login && (
            <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={spring.bouncy} className="absolute inset-x-0 bottom-5 flex justify-center">
              <Button variant="primary" size="lg" icon={KeyRound} autoFocus onClick={fill}>
                Passwort für {login.origin} mit Face ID einsetzen
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Screen>
  );
}
