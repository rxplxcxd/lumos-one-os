// Library: Steam, Flatpak, emulators and sideloaded titles reported by lumosd.
import { create } from 'zustand';
import { on, request } from '@/services/bridge.js';
import { haptic } from '@/services/haptics.js';
import { toast } from './ui.js';
import { canPlay } from './parental.js';

export const useLibrary = create(() => ({ items: [], loading: false, error: null }));

export async function refreshLibrary() {
  useLibrary.setState({ loading: true });
  try {
    const items = await request('library.list');
    useLibrary.setState({ items, loading: false, error: null });
  } catch (e) {
    useLibrary.setState({ loading: false, error: e.message });
  }
}

export function startLibraryFeeds() {
  refreshLibrary();
  const offs = [on('flatpak.done', refreshLibrary), on('library.changed', refreshLibrary), on('library.exited', refreshLibrary)];
  return () => offs.forEach((f) => f());
}

export async function launch(item) {
  haptic('select');
  if (!canPlay(item)) {
    haptic('error');
    toast({ title: 'Gesperrt', body: 'Die Kindersicherung erlaubt diesen Titel nicht', kind: 'error' });
    return;
  }
  if (item.kind === 'builtin') {
    const { open } = await import('./ui.js');
    open('game', { id: item.id });
    return;
  }
  try {
    await request('library.launch', { id: item.id }, 30000);
    toast({ title: 'Wird gestartet', body: item.name, kind: 'info', duration: 2000 });
    // Give the game the Gamescope focus; the shell comes back on Home/exit.
    if (window.lumos?.window) setTimeout(() => window.lumos.window.handoff(), 700);
    refreshLibrary();
  } catch (e) {
    haptic('error');
    toast({ title: 'Start fehlgeschlagen', body: e.message, kind: 'error' });
  }
}

/** Artwork: Steam CDN for Steam titles, Flathub icons for flatpaks. */
export function artFor(item) {
  if (item.kind === 'steam' && item.appid) {
    const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}`;
    return { cover: `${base}/library_600x900_2x.jpg`, coverFallback: `${base}/library_600x900.jpg`, hero: `${base}/library_hero.jpg`, header: `${base}/header.jpg` };
  }
  if (item.flatpak) {
    const icon = item.icon || `https://dl.flathub.org/repo/appstream/x86_64/icons/128x128/${item.flatpak}.png`;
    return { icon, cover: null, hero: null };
  }
  return { icon: item.icon || null, cover: item.cover || null, hero: null };
}
