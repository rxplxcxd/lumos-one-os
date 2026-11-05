import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/services/storage.js';

const seed = [
  { id: 'n1', title: 'Willkommen bei Notizen', body: 'Notizen werden lokal gespeichert.\n\n• A: Öffnen  • X: Neue Notiz  • Y: Anheften\n• Unterstützt Checklisten: Zeilen mit "[ ]" oder "[x]" beginnen.\n\n[ ] Face ID einrichten\n[x] Lumos Cloud verbinden', pinned: true, updatedAt: Date.now() },
];

export const useNotes = create(() => ({ notes: loadJSON('lumos.notes', seed) }));
const persist = () => saveJSON('lumos.notes', useNotes.getState().notes);

export function createNote() {
  const n = { id: crypto.randomUUID(), title: '', body: '', pinned: false, updatedAt: Date.now() };
  useNotes.setState((s) => ({ notes: [n, ...s.notes] }));
  persist();
  return n.id;
}
export function updateNote(id, patch) {
  useNotes.setState((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) }));
  persist();
}
export function deleteNote(id) {
  useNotes.setState((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  persist();
}
export const sortedNotes = (notes) => [...notes].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);
