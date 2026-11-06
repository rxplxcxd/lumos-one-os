import { describe, it, expect, vi } from 'vitest';

vi.mock('./bridge.js', () => ({ request: vi.fn(), notify: vi.fn(), on: vi.fn(() => () => {}), bridgeMode: () => 'simulator' }));

const { normalizeHit, descriptionBlocks, formatBytes } = await import('./flathub.js');
const { mergeSettings } = await import('./cloud/cloudService.js');

describe('flathub normalisation', () => {
  it('maps meilisearch hits (app_id, sanitized id, string booleans)', () => {
    const h = normalizeHit({ id: 'org_libretro_RetroArch', name: 'RetroArch', summary: 's', icon: 'i.png', developer_name: 'Libretro', verification_verified: 'true', main_categories: 'Game' });
    expect(h).toMatchObject({ id: 'org.libretro.RetroArch', name: 'RetroArch', verified: true, developer: 'Libretro', categories: ['Game'] });
    expect(normalizeHit({ app_id: 'a.b.C', name: 'C' }).icon).toContain('/128x128/a.b.C.png');
  });

  it('turns AppStream HTML into safe text blocks', () => {
    const b = descriptionBlocks('<p>Hallo <b>Welt</b></p><ul><li>Eins</li><li>Zwei</li></ul><script>alert(1)</script>');
    expect(b).toEqual([
      { type: 'p', text: 'Hallo Welt' },
      { type: 'li', text: 'Eins' },
      { type: 'li', text: 'Zwei' },
    ]);
  });

  it('formats bytes', () => {
    expect(formatBytes(61234567)).toBe('61.2 MB');
    expect(formatBytes(null)).toBe('—');
  });
});

describe('cloud settings merge', () => {
  it('is per-key last-writer-wins', () => {
    const local = { values: { a: 1, b: 'local' }, stamps: { a: 10, b: 50 } };
    const remote = { values: { a: 2, b: 'remote', c: true }, stamps: { a: 20, b: 40, c: 5 } };
    expect(mergeSettings(local, remote)).toEqual({ values: { a: 2, b: 'local', c: true }, stamps: { a: 20, b: 50, c: 5 } });
  });
});
