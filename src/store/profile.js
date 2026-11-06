// Local user profiles (multi-user) with avatar config; the active profile syncs to Lumos Cloud.
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/services/storage.js';
import { profileChanged, registerSource } from '@/services/cloud/cloudService.js';

export const DEFAULT_AVATAR = {
  skin: '#e8b996',
  hair: 'swoop',
  hairColor: '#2b2420',
  eyes: 'round',
  eyeColor: '#2d3a4f',
  brows: 'soft',
  mouth: 'smile',
  nose: 'button',
  headShape: 1,
  headWidth: 1,
  glasses: 'none',
  top: 'hoodie',
  topColor: '#3d4b63',
  accessory: 'none',
  bg: '#1c212a',
};

const initial = loadJSON('lumos.profiles', null) || {
  activeId: 'p1',
  profiles: [{ id: 'p1', name: 'Spieler 1', role: 'owner', lock: 'faceid', avatar: DEFAULT_AVATAR, image: null, imageKind: 'avatar', createdAt: Date.now() }],
};

export const useProfiles = create(() => initial);

function persist(sync = true) {
  const s = useProfiles.getState();
  saveJSON('lumos.profiles', { activeId: s.activeId, profiles: s.profiles });
  if (sync) {
    const p = s.profiles.find((x) => x.id === s.activeId);
    if (p) profileChanged({ name: p.name, avatar: p.avatar, image: p.image, imageKind: p.imageKind });
  }
}

export const activeProfile = (s = useProfiles.getState()) => s.profiles.find((p) => p.id === s.activeId) || s.profiles[0];

export function updateProfile(id, patch) {
  useProfiles.setState((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  persist(id === useProfiles.getState().activeId);
}

export function addProfile(name, role = 'standard') {
  const id = `p${Date.now().toString(36)}`;
  const controls = role === 'child' ? { ageLimit: 12, dailyMinutes: 90, blocked: [], approved: [], allowOnlyApproved: false, storeNeedsPin: true } : undefined;
  useProfiles.setState((s) => ({ profiles: [...s.profiles, { id, name, role, lock: 'none', controls, avatar: { ...DEFAULT_AVATAR, skin: '#c98e6b', hair: 'buzz' }, image: null, imageKind: 'avatar', createdAt: Date.now() }] }));
  persist(false);
  return id;
}

export function removeProfile(id) {
  useProfiles.setState((s) => {
    const profiles = s.profiles.filter((p) => p.id !== id);
    return { profiles, activeId: s.activeId === id ? profiles[0]?.id : s.activeId };
  });
  persist(false);
}

export function switchProfile(id) {
  useProfiles.setState({ activeId: id });
  persist(false);
}

registerSource('profile', {
  apply(remote) {
    if (!remote) return;
    const s = useProfiles.getState();
    useProfiles.setState({ profiles: s.profiles.map((p) => (p.id === s.activeId ? { ...p, ...remote } : p)) });
    persist(false);
  },
});
