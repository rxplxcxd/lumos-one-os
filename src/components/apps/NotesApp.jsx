// Notes: pinned + recent notes, checklist rendering, controller shortcuts (X new, Y pin).
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StickyNote, Plus, Pin, Trash2, Search, CheckSquare, Square } from 'lucide-react';
import { Screen, Hint, Button, TextField } from '@/components/ui/primitives.jsx';
import { useNotes, createNote, updateNote, deleteNote, sortedNotes } from '@/store/notes.js';
import { useAction } from '@/hooks/useInputSystem.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

function ChecklistPreview({ note }) {
  const lines = note.body.split('\n');
  const toggle = (i) => {
    const l = lines[i];
    lines[i] = l.startsWith('[x]') ? `[ ]${l.slice(3)}` : `[x]${l.slice(3)}`;
    haptic(l.startsWith('[x]') ? 'toggle.off' : 'toggle.on');
    updateNote(note.id, { body: lines.join('\n') });
  };
  return (
    <div className="space-y-1">
      {lines.map((l, i) =>
        /^\[( |x)\]/.test(l) ? (
          <button key={i} data-nav="" data-nav-haptic="none" onClick={() => toggle(i)} className="row-focus flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[0.9rem]">
            {l.startsWith('[x]') ? <CheckSquare className="h-5 w-5 text-ok" /> : <Square className="h-5 w-5 text-mist-400" />}
            <span className={l.startsWith('[x]') ? 'text-mist-500 line-through' : ''}>{l.slice(3).trim()}</span>
          </button>
        ) : null,
      )}
    </div>
  );
}

export default function NotesApp() {
  const notes = useNotes((s) => s.notes);
  const [q, setQ] = useState('');
  const list = useMemo(() => sortedNotes(notes).filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase())), [notes, q]);
  const [sel, setSel] = useState(list[0]?.id);
  const note = notes.find((n) => n.id === sel);
  useEffect(() => {
    if (!note && list[0]) setSel(list[0].id);
  }, [note, list]);

  const add = () => {
    const id = createNote();
    setSel(id);
    haptic('success');
  };
  useAction((a) => {
    if (a === 'x') add();
    if (a === 'y' && note) {
      updateNote(note.id, { pinned: !note.pinned });
      haptic('toggle.on');
    }
  }, [note]);

  const hasChecklist = note && /^\[( |x)\]/m.test(note.body);
  return (
    <Screen title="Notizen" icon={StickyNote} noPad actions={<Button size="sm" variant="primary" icon={Plus} onClick={add}>Neue Notiz</Button>} hints={<><Hint k="x">Neu</Hint><Hint k="y">Anheften</Hint><Hint k="b">Zurück</Hint></>}>
      <div className="flex h-full gap-5 px-10 pb-14">
        <aside className="flex w-[22rem] shrink-0 flex-col">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <TextField value={q} onChange={setQ} placeholder="Suchen" className="pl-10" />
          </div>
          <div className="glass flex-1 overflow-y-auto rounded-3xl p-2">
            <AnimatePresence initial={false}>
              {list.map((n) => (
                <motion.button
                  layout
                  key={n.id}
                  data-nav=""
                  data-nav-autofocus={n.id === sel ? '' : undefined}
                  onClick={() => setSel(n.id)}
                  onFocus={() => setSel(n.id)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring.soft}
                  className={`row-focus mb-1 block w-full rounded-2xl px-3.5 py-2.5 text-left ${n.id === sel ? 'bg-white/[0.08]' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-warn" />}
                    <span className="truncate text-[0.88rem] font-semibold">{n.title || n.body.split('\n')[0] || 'Neue Notiz'}</span>
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[0.72rem] text-mist-400">
                    <span className="shrink-0">{new Date(n.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                    <span className="truncate">{n.body.split('\n').slice(1).join(' ') || 'Kein weiterer Text'}</span>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </aside>
        <section className="glass flex min-w-0 flex-1 flex-col rounded-3xl p-6">
          {note ? (
            <>
              <div className="flex items-center gap-2">
                <input data-nav="" value={note.title} onChange={(e) => updateNote(note.id, { title: e.target.value })} placeholder="Titel" className="nav-focus min-w-0 flex-1 rounded-xl bg-transparent px-2 py-1 text-[1.5rem] font-semibold tracking-tight placeholder:text-mist-500" />
                <Button size="sm" variant={note.pinned ? 'primary' : 'subtle'} icon={Pin} onClick={() => updateNote(note.id, { pinned: !note.pinned })}>{note.pinned ? 'Angeheftet' : 'Anheften'}</Button>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => (deleteNote(note.id), haptic('close'))} />
              </div>
              <div className="mb-3 px-2 text-[0.72rem] text-mist-500">{new Date(note.updatedAt).toLocaleString('de-DE')}</div>
              {hasChecklist && (
                <div className="mb-3 rounded-2xl bg-white/[0.04] p-2">
                  <ChecklistPreview note={note} />
                </div>
              )}
              <textarea data-nav="" value={note.body} onChange={(e) => updateNote(note.id, { body: e.target.value })} placeholder="Schreib etwas …" className="nav-focus min-h-0 flex-1 resize-none rounded-2xl bg-transparent px-2 py-1 text-[0.95rem] leading-relaxed text-mist-100 placeholder:text-mist-500" />
            </>
          ) : (
            <div className="m-auto text-mist-400">Keine Notiz ausgewählt</div>
          )}
        </section>
      </div>
    </Screen>
  );
}
