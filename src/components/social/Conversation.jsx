// One conversation. LumosOS chats are realtime (Supabase websockets, polling fallback on the
// self-hosted server) with typing + read receipts; Xbox is bridged through lumosd; Steam opens the
// Steam client; PSN / Nintendo expose no messaging API and say so.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Paperclip, Smile, PartyPopper, Check, CheckCheck, ExternalLink, Info, Film, Image as ImageIcon } from 'lucide-react';
import { Button, TextField, Sheet } from '@/components/ui/primitives.jsx';
import { FriendAvatar, Cover } from './parts.jsx';
import { listMessages, sendMessage, sendTyping, isTyping, uploadMedia, fetchMedia, refreshSocial, useCloud } from '@/services/cloud/cloudService.js';
import { listCaptures, getCapture } from '@/services/captures.js';
import { request } from '@/services/bridge.js';
import { PLATFORMS, presenceText, openLink, useHub } from '@/services/social/hub.js';
import { useSystem } from '@/store/system.js';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const EMOJI = ['😀', '😂', '😍', '🤔', '😎', '🥳', '😭', '😡', '👍', '👎', '🔥', '❤️', '🎮', '🏆', '💀', '🙌', '👀', '🤝', '😴', '🤯', '✨', '🎉', '🍕', '☕'];
const PARTY = '⟦party⟧';

function Attachment({ att }) {
  const [url, setUrl] = useState(att.url && !att.mediaId ? att.url : null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let u;
    let alive = true;
    fetchMedia(att.mediaId, att).then((b) => alive && setUrl((u = URL.createObjectURL(b))), (e) => alive && setErr(e.message));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [att]);
  if (err) return <div className="text-[0.75rem] text-mist-400">Anhang nicht verfügbar ({err})</div>;
  if (!url) return <div className="h-32 w-56 animate-pulse rounded-xl bg-white/10" />;
  return String(att.kind).startsWith('video') ? <video src={url} controls className="max-h-56 rounded-xl" /> : <img src={url} alt={att.name} className="max-h-56 rounded-xl" />;
}

function PartyCard({ game, mine }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl p-2 ${mine ? 'bg-black/20' : 'bg-white/10'}`}>
      <Cover game={{ name: game }} className="h-14 w-11 rounded-lg" />
      <div>
        <div className="flex items-center gap-1 text-[0.7rem] opacity-80"><PartyPopper className="h-3 w-3" /> Party-Einladung</div>
        <div className="text-[0.88rem] font-medium">{game}</div>
        {!mine && <Button size="sm" variant="primary" className="mt-1" onClick={() => toast({ title: 'Party beigetreten', body: game, kind: 'success' })}>Beitreten</Button>}
      </div>
    </div>
  );
}

function Bubble({ m, friend, index }) {
  const party = m.text?.startsWith(PARTY);
  const via = friend.platform === 'xbox';
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring.snappy, delay: Math.min(index, 6) * 0.01 }} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-[0.9rem] ${m.mine ? 'rounded-br-md bg-lumen-500 text-white' : 'rounded-bl-md bg-white/10'}`}>
        {m.attachment && <Attachment att={m.attachment} />}
        {party ? <PartyCard game={m.text.slice(PARTY.length)} mine={m.mine} /> : m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
        <div className={`mt-0.5 flex items-center justify-end gap-1 text-[0.62rem] ${m.mine ? 'text-white/70' : 'text-mist-500'}`}>
          {via && <span>{m.mine ? 'Über Xbox gesendet' : 'Über Xbox'} ·</span>}
          {new Date(m.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          {m.mine && friend.platform === 'lumos' && (m.read ? <span className="flex items-center gap-0.5 text-[#9ff0c3]"><CheckCheck className="h-3 w-3" />Gelesen</span> : <span className="flex items-center gap-0.5"><Check className="h-3 w-3" />Gesendet</span>)}
        </div>
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="flex items-center gap-1.5 text-[0.75rem] text-mist-400">
      <span className="flex gap-1 rounded-full bg-white/10 px-2.5 py-1.5">
        {[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-mist-300" animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />)}
      </span>
      Tippt gerade …
    </motion.div>
  );
}

function CapturePicker({ open, onClose, onPick }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (open) listCaptures().then(setItems);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Aufnahme teilen" className="w-[46rem]">
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

function Header({ friend }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <FriendAvatar f={friend} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{friend.name}</div>
        <div className="truncate text-[0.72rem] text-mist-400">{PLATFORMS[friend.platform].label} · {presenceText(friend)}</div>
      </div>
    </div>
  );
}

function Unsupported({ friend }) {
  const steam = friend.platform === 'steam';
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Header friend={friend} />
      <div className="glass flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-3xl p-8 text-center">
        <Info className="h-9 w-9 text-mist-400" />
        <div className="max-w-[26rem] text-[0.88rem] text-mist-300">
          {steam ? 'Steam bietet keine öffentliche Chat-Schnittstelle. Die Unterhaltung öffnet sich im Steam-Client.' : `${PLATFORMS[friend.platform].label} bietet keine Schnittstelle für Nachrichten. Du siehst Status und Spiel live – schreiben kannst du in der ${PLATFORMS[friend.platform].label}-App.`}
        </div>
        {steam && <Button variant="primary" icon={ExternalLink} autoFocus onClick={() => openLink(`steam://friends/message/${friend.id}`)}>In Steam chatten</Button>}
      </div>
    </div>
  );
}

export default function Conversation({ friend }) {
  if (friend.chat === 'none' || friend.chat === 'deeplink') return <Unsupported friend={friend} />;
  return <Thread friend={friend} />;
}

function Thread({ friend }) {
  const native = friend.platform === 'lumos';
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const box = useRef(null);
  const typingTimer = useRef(0);
  const lastTypingSent = useRef(0);
  const running = useSystem((s) => s.running);
  const user = useCloud((s) => s.user);

  const merge = useCallback((list) => {
    setMsgs((cur) => {
      const map = new Map(cur.map((m) => [m.id, m]));
      list.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m })); // updates read flags too
      return [...map.values()].sort((a, b) => a.t - b.t);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const list = native ? await listMessages(friend.id, 0) : (await request('social.messages', { platform: friend.platform, friendId: friend.id })).messages;
      if (list.some((x) => !x.mine && !msgsRef.current.has(x.id))) haptic('notify');
      merge(list);
    } catch {
      /* offline */
    }
  }, [friend.id, friend.platform, native, merge]);
  const msgsRef = useRef(new Set());
  useEffect(() => {
    msgsRef.current = new Set(msgs.map((m) => m.id));
  }, [msgs]);

  useEffect(() => {
    setMsgs([]);
    setTyping(false);
    load();
    const t = setInterval(load, native ? 3000 : 5000);
    const onRt = ({ detail: d }) => {
      if (d.type === 'message' && d.m.from === friend.id) (merge([d.m]), haptic('notify'), listMessages(friend.id, d.m.t - 1)); // second call marks it read
      if (d.type === 'read' && d.m.to === friend.id) merge([d.m]);
      if (d.type === 'typing' && d.from === friend.id) {
        setTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 4000);
      }
    };
    window.addEventListener('lumos:rt', onRt);
    // self-hosted server: poll the typing flag
    const tp = native && user ? setInterval(() => isTyping(friend.id).then(setTyping), 2000) : null;
    return () => {
      clearInterval(t);
      clearInterval(tp);
      clearTimeout(typingTimer.current);
      window.removeEventListener('lumos:rt', onRt);
      refreshSocial();
    };
  }, [friend.id, native, load, merge, user]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, typing]);

  const onType = (v) => {
    setText(v);
    if (native && v && Date.now() - lastTypingSent.current > 2500) {
      lastTypingSent.current = Date.now();
      sendTyping(friend.id);
    }
  };

  const send = async (override) => {
    const body = (override ?? text).trim();
    if (!body && !override?.attachment) return;
    setBusy(true);
    try {
      if (native) merge([await sendMessage(friend.id, { text: body })]);
      else {
        await request('social.send', { platform: friend.platform, friendId: friend.id, text: body });
        merge([{ id: `local-${Date.now()}`, text: body, t: Date.now(), mine: true }]);
      }
      if (override == null) setText('');
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
      merge([await sendMessage(friend.id, { text: '', attachment: { ...media, mediaId: media.mediaId || media.id } })]);
      haptic('success');
    } catch (e) {
      toast({ title: 'Upload fehlgeschlagen', body: e.message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const inviteGame = useMemo(() => running?.name || 'Lumos Orbit', [running]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Header friend={friend} />
      <div ref={box} className="glass min-h-0 flex-1 space-y-2 overflow-y-auto rounded-3xl p-4">
        {!msgs.length && <div className="py-10 text-center text-[0.85rem] text-mist-500">Noch keine Nachrichten – sag Hallo!</div>}
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => <Bubble key={m.id} m={m} friend={friend} index={i} />)}
          {typing && <TypingDots key="typing" />}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {emoji && (
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={spring.snappy} className="glass mt-2 grid grid-cols-12 gap-1 rounded-2xl p-2">
            {EMOJI.map((e) => <button key={e} data-nav="" onClick={() => (setText((t) => t + e), haptic('toggle.on'))} className="nav-focus rounded-lg py-1 text-[1.25rem]">{e}</button>)}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3 flex gap-2">
        {native && <Button variant="subtle" icon={Paperclip} onClick={() => setPicker(true)} aria-label="Clip anhängen" />}
        <Button variant="subtle" icon={Smile} onClick={() => setEmoji((v) => !v)} aria-label="Emojis" />
        {native && <Button variant="subtle" icon={PartyPopper} onClick={() => send(`${PARTY}${inviteGame}`)} aria-label="Party-Einladung" />}
        <TextField value={text} onChange={onType} onEnter={() => send()} placeholder={`Nachricht an ${friend.name}`} />
        <Button variant="primary" icon={Send} disabled={busy} onClick={() => send()}>Senden</Button>
      </div>
      <CapturePicker open={picker} onClose={() => setPicker(false)} onPick={shareCapture} />
    </div>
  );
}
