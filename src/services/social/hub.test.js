import { describe, it, expect } from 'vitest';
import { unifiedFriends, presenceText, ago, duration } from './hub.js';

const now = Date.now();
describe('unified friends', () => {
  const cloudFriends = [
    { id: 'u1', name: 'Ben', status: 'accepted', unread: 2, code: 'ABCD2345' },
    { id: 'u2', name: 'Pending', status: 'incoming' },
  ];
  const presence = { u1: { status: 'online', game: 'Lumos Orbit', since: now - 26 * 60000, party: { size: 2, max: 4 } } };
  const external = [
    { platform: 'steam', id: '1', name: 'Zed', status: 'offline', game: null, lastSeen: now - 3 * 3600e3 },
    { platform: 'xbox', id: '2', name: 'Amy', status: 'online', game: { name: 'Halo' }, text: '' },
    { platform: 'psn', id: '3', name: 'Kai', status: 'away', game: null },
  ];
  const list = unifiedFriends({ cloudFriends, presence, external });

  it('merges all networks, drops pending requests and sorts online first', () => {
    expect(list.map((f) => f.key)).toEqual(['lumos:u1', 'xbox:2', 'psn:3', 'steam:1']);
    expect(list.find((f) => f.platform === 'lumos').unread).toBe(2);
  });
  it('knows which networks can chat', () => {
    expect(Object.fromEntries(list.map((f) => [f.platform, f.chat]))).toEqual({ lumos: 'native', xbox: 'native', psn: 'none', steam: 'deeplink' });
  });
  it('formats rich presence', () => {
    expect(presenceText(list[0])).toBe('Lumos Orbit · seit 26 Min. · In Voice-Party (2/4)');
    expect(presenceText(list.find((f) => f.platform === 'psn'))).toBe('Abwesend');
    expect(presenceText(list.find((f) => f.platform === 'steam'))).toBe('Zuletzt online vor 3 Std.');
    expect(presenceText({ status: 'offline' })).toBe('Offline');
  });
  it('formats durations', () => {
    expect(ago(Date.now() - 20000)).toBe('gerade eben');
    expect(ago(Date.now() - 5 * 60000)).toBe('vor 5 Min.');
    expect(ago(Date.now() - 3 * 86400e3)).toBe('vor 3 Tagen');
    expect(duration(Date.now() - 95 * 60000)).toBe('1 Std. 35 Min.');
  });
});
