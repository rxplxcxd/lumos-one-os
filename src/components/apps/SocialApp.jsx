// Freunde & Chat on Lumos Cloud: friend codes, requests, conversations, shared clips/screenshots.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserPlus, Send, Check, X, Copy, Paperclip, Film, Image as ImageIcon, Cloud } from 'lucide-react';
import { Screen, Button, TextField, Sheet, Hint, ListRow } from '@/components/ui/primitives.jsx';
import { useCloud, refreshSocial, addFriend, acceptFriend, removeFriend, listMessages, sendMessage, uploadMedia, fetchMedia } from '@/services/cloud/cloudService.js';
import { listCaptures, getCapture } from '@/services/captures.js';
import { open, toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

function Attachment({ att, mine }) {
  const [url, setUrl] = useState(att.url && !att.mediaId ? att.url : null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let u;
    let alive = true;
    fetchMedia(att.mediaId, att).then(
      (b) => alive && setUrl((u = URL.createObjectURL(b))),
      (e) => alive && setErr(e.message),
    );
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [att]);
  if (err) return <div className="text-[0.75rem] text-mist-400">Anhang nicht verfügbar ({err})</div>;
  if (!url) return <div className="h-32 w-56 animate-pulse rounded-xl bg-white/10" />;
  return String(att.kind).startsWith('video') ? (
    <video src={url} controls className={`max-h-56 rounded-xl ${mine ? '' : ''}`} />
  ) : (
    <img src={url} alt={att.name} className="max-h-56 rounded-xl" />
  );
}

function Conversation({ friend }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useRef(0);
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    last.current = 0;
    setMsgs([]);
    const load = async () => {
      try {
        const n = await listMessages(friend.id, last.current);
        if (!alive || !n.length) return;
        last.current = Math.max(...n.map((m) => m.t));
        setMsgs((m) => [...m, ...n.filter((x) => !m.some((y) => y.id === x.id))]);
        if (n.some((x) => !x.mine)) haptic('notify');
      } catch {
        /* offline */
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
      refreshSocial();
    };
  }, [friend.id]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length]);

  const send = async (attachment) => {
    if (!text.trim() && !attachment) return;
    setBusy(true);
    try {
      const m = await sendMessage(friend.id, { text: text.trim(), attachment });
      setMsgs((x) => [...x, m]);
      last.current = Math.max(last.current, m.t);
      setText('');
      haptic('success');
    } catch (e) {
      toast({ title: 'Nicht gesendet', body: e.message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const shareCapture = async (c) => {
    setPicker(false);
    setBusy(true);
    try {
      const rec = await getCapture(c.id);
      const media = await uploadMedia(rec.blob, c.name);
      await send({ ...media, mediaId: media.mediaId || media.id });
    } catch (e) {
      toast({ title: 'Upload fehlgeschlagen', body: e.message, kind: 'error' });
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lumen/20 font-semibold">{friend.name[0]}</span>
        <div>
          <div className="font-semibold">{friend.name}</div>
          <div className="text-[0.72rem] text-mist-400">Freundescode {friend.code}</div>
        </div>
      </div>
      <div ref={box} className="glass min-h-0 flex-1 space-y-2 overflow-y-auto rounded-3xl p-4">
        {!msgs.length && <div className="py-10 text-center text-[0.85rem] text-mist-500">Noch keine Nachrichten – sag Hallo!</div>}
        <AnimatePresence initial={false}>
          {msgs.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.snappy} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[0.9rem] ${m.mine ? 'rounded-br-md bg-lumen-500 text-white' : 'rounded-bl-md bg-white/10'}`}>
                {m.attachment && <Attachment att={m.attachment} mine={m.mine} />}
                {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
                <div className={`mt-0.5 text-[0.62rem] ${m.mine ? 'text-white/70' : 'text-mist-500'}`}>{new Date(m.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="subtle" icon={Paperclip} onClick={() => setPicker(true)} aria-label="Clip anhängen" />
        <TextField value={text} onChange={setText} onEnter={() => send()} placeholder={`Nachricht an ${friend.name}`} />
        <Button variant="primary" icon={Send} disabled={busy} onClick={() => send()}>Senden</Button>
      </div>
      <CapturePicker open={picker} onClose={() => setPicker(false)} onPick={shareCapture} />
    </div>
  );
}

function CapturePicker({ open: isOpen, onClose, onPick }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (isOpen) listCaptures().then(setItems);
  }, [isOpen]);
  return (
    <Sheet open={isOpen} onClose={onClose} title="Aufnahme teilen" className="w-[46rem]">
      {!items.length && <div className="py-8 text-center text-mist-400">Noch keine Aufnahmen – Clips speicherst du im Schnellzugriff oder mit F10.</div>}
      <div className="grid max-h-[24rem] grid-cols-3 gap-3 overflow-y-auto">
        {items.map((c) => (
          <button key={c.id} data-nav="" onClick={() => onPick(c)} className="nav-focus overflow-hidden rounded-2xl bg-white/[0.05] text-left">
            {c.thumb ? <img src={c.thumb} alt="" className="aspect-video w-full object-cover" /> : <div className="aspect-video bg-white/10" />}
            <div className="flex items-center gap-1.5 p-2 text-[0.75rem]">{c.kind === 'video' ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}{c.name}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default function SocialApp() {
  const c = useCloud();
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  useEffect(() => {
    refreshSocial();
  }, []);

  if (!c.user)
    return (
      <Screen title="Freunde & Chat" icon={Users}>
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <Cloud className="h-12 w-12 text-mist-400" />
          <div className="text-lg font-semibold">Melde dich bei Lumos Cloud an</div>
          <div className="max-w-[28rem] text-[0.85rem] text-mist-400">Freunde, Chat und geteilte Clips laufen über dein Cloud-Konto.</div>
          <Button variant="primary" autoFocus onClick={() => open('cloud')}>Zu Lumos Cloud</Button>
        </div>
      </Screen>
    );

  const accepted = c.friends.filter((f) => f.status === 'accepted');
  const incoming = c.friends.filter((f) => f.status === 'incoming');
  const outgoing = c.friends.filter((f) => f.status === 'outgoing');
  const friend = accepted.find((f) => f.id === sel);

  const doAdd = async () => {
    try {
      const r = await addFriend(code);
      haptic('success');
      toast({ title: r.status === 'accepted' ? 'Ihr seid jetzt befreundet' : 'Anfrage gesendet', body: r.name, kind: 'success' });
      setAdding(false);
      setCode('');
    } catch (e) {
      haptic('error');
      toast({ title: 'Nicht möglich', body: e.message, kind: 'error' });
    }
  };

  return (
    <Screen
      title="Freunde & Chat"
      icon={Users}
      noPad
      subtitle={c.me?.friendCode ? `Dein Freundescode: ${c.me.friendCode}` : undefined}
      actions={
        <>
          {c.me?.friendCode && <Button size="sm" variant="subtle" icon={Copy} onClick={() => navigator.clipboard?.writeText(c.me.friendCode).then(() => toast({ title: 'Code kopiert', kind: 'success' }))}>Code kopieren</Button>}
          <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>Freund hinzufügen</Button>
        </>
      }
      hints={<><Hint k="a">Öffnen</Hint><Hint k="b">Zurück</Hint></>}
    >
      <div className="flex h-full gap-5 px-10 pb-14">
        <aside className="w-[20rem] shrink-0 overflow-y-auto">
          {incoming.length > 0 && (
            <div className="glass mb-4 rounded-3xl p-2">
              <div className="label px-2 py-1">Anfragen</div>
              {incoming.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-2xl px-2 py-2">
                  <span className="flex-1 truncate text-[0.88rem]">{f.name}</span>
                  <Button size="sm" variant="primary" icon={Check} onClick={() => acceptFriend(f.id).then(() => haptic('success'))} />
                  <Button size="sm" variant="ghost" icon={X} onClick={() => removeFriend(f.id)} />
                </div>
              ))}
            </div>
          )}
          <div className="glass rounded-3xl p-2">
            <div className="label px-2 py-1">Freunde · {accepted.length}</div>
            {!accepted.length && <div className="p-4 text-[0.8rem] text-mist-500">Teile deinen Freundescode, um Freunde hinzuzufügen.</div>}
            {accepted.map((f) => (
              <button key={f.id} data-nav="" onClick={() => setSel(f.id)} className={`row-focus mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${sel === f.id ? 'bg-white/[0.08]' : ''}`}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lumen/20 text-[0.85rem] font-semibold">{f.name[0]}</span>
                <span className="min-w-0 flex-1 truncate text-[0.9rem]">{f.name}</span>
                {f.unread > 0 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1.5 text-[0.65rem] font-bold">{f.unread}</motion.span>}
              </button>
            ))}
            {outgoing.map((f) => (
              <ListRow key={f.id} label={f.name} sub="Anfrage gesendet" chevron={false} right={<Button size="sm" variant="ghost" icon={X} onClick={() => removeFriend(f.id)} />} />
            ))}
          </div>
        </aside>
        {friend ? <Conversation friend={friend} /> : <div className="glass m-auto flex h-full flex-1 items-center justify-center rounded-3xl text-mist-500">Wähle einen Freund aus</div>}
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Freund hinzufügen">
        <p className="mb-3 text-[0.85rem] text-mist-300">Gib den 8-stelligen Freundescode ein, den dein Freund in „Freunde & Chat“ sieht.</p>
        <TextField autoFocus value={code} onChange={(x) => setCode(x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="z. B. K7QM2XPA" className="text-center font-mono tracking-[0.3em]" onEnter={doAdd} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={doAdd} disabled={code.length < 8}>Anfrage senden</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
