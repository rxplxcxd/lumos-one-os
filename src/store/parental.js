// Multi-user roles + parental controls.
//  roles: owner (Face ID/PIN), standard, child (restricted), guest (no cloud / no keychain)
//  parental PIN (PBKDF2-SHA256, 150k iterations) gates purchases/installs, restricted screens, limits.
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/services/storage.js';
import { useProfiles, activeProfile } from './profile.js';

const LS = 'lumos.parental';
export const useParental = create(() => loadJSON(LS, { pin: null, usage: {} })); // usage: { [profileId]: { [yyyy-mm-dd]: minutes } }
const persist = () => saveJSON(LS, useParental.getState());

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(pin, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}

export async function verifyPin(stored, pin) {
  if (!stored) return false;
  const h = await hashPin(pin, stored.salt);
  return h.hash === stored.hash;
}

export async function setParentalPin(pin) {
  useParental.setState({ pin: pin ? await hashPin(pin) : null });
  persist();
}
export const checkParentalPin = (pin) => verifyPin(useParental.getState().pin, pin);
export const hasParentalPin = () => !!useParental.getState().pin;

export const ROLES = {
  owner: { label: 'Besitzer', desc: 'Volle Rechte, Face ID' },
  standard: { label: 'Standard', desc: 'Eigenes Profil ohne Systemrechte' },
  child: { label: 'Kind', desc: 'Altersfreigaben, Zeitlimits, Käufe nur mit Eltern-PIN' },
  guest: { label: 'Gast', desc: 'Ohne Cloud, Passwörter und Einstellungen' },
};

export const RESTRICTED = {
  child: new Set(['keychain', 'cloud', 'updater', 'terminal', 'files', 'taskmanager']),
  guest: new Set(['keychain', 'cloud', 'updater', 'terminal', 'settings', 'social', 'taskmanager']),
};

export const role = () => activeProfile(useProfiles.getState())?.role || 'owner';
export const isRestrictedScreen = (screen) => RESTRICTED[role()]?.has(screen) ?? false;

/** OARS content rating (Flathub) → approximate USK/PEGI age. */
export function oarsAge(rating) {
  if (!rating || typeof rating !== 'object') return 0;
  const lvl = { none: 0, mild: 1, moderate: 2, intense: 3 };
  let max = 0;
  for (const [k, v] of Object.entries(rating)) {
    if (k === 'type') continue;
    const n = lvl[v] ?? 0;
    const strong = /violence|sex|drugs|language-profanity/.test(k);
    max = Math.max(max, n === 3 ? 18 : n === 2 ? (strong ? 16 : 12) : n === 1 ? (strong ? 12 : 6) : 0);
  }
  return max;
}

const today = () => new Date().toISOString().slice(0, 10);
export const minutesToday = (pid) => useParental.getState().usage?.[pid]?.[today()] || 0;

export function addPlayMinute(pid) {
  const u = { ...(useParental.getState().usage || {}) };
  const d = today();
  u[pid] = { ...(u[pid] || {}), [d]: (u[pid]?.[d] || 0) + 1 };
  // keep two weeks of history
  for (const k of Object.keys(u[pid])) if (Date.now() - Date.parse(k) > 14 * 86400e3) delete u[pid][k];
  useParental.setState({ usage: u });
  persist();
}

export function canPlay(item) {
  const p = activeProfile(useProfiles.getState());
  if (!p || p.role !== 'child') return true;
  const c = p.controls || {};
  if (c.blocked?.includes(item.id)) return false;
  if (c.allowOnlyApproved && !c.approved?.includes(item.id)) return false;
  if (item.ageRating != null && item.ageRating > (c.ageLimit ?? 12)) return false;
  if (c.dailyMinutes > 0 && minutesToday(p.id) >= c.dailyMinutes) return false;
  return true;
}
