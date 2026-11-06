import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/bridge.js', () => ({ request: vi.fn(), notify: vi.fn(), on: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}), bridgeMode: () => 'simulator' }));

const { resolveBindings, reverseBindings, assign, keyLabel, PRESETS, ACTIONS } = await import('./keybindings.js');
const { padFamily, glyphFor } = await import('./controllers.js');
const { readPad } = await import('@/hooks/useInputSystem.js');

const pad = (over = {}) => ({ id: 'x', index: 0, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0], ...over });

describe('keyboard bindings', () => {
  it('every controller input has at least one key in every preset', () => {
    for (const p of Object.values(PRESETS)) for (const a of ACTIONS) expect(p.map[a.id]?.length, `${a.id}`).toBeGreaterThan(0);
  });
  it('presets have no duplicate keys', () => {
    for (const p of Object.values(PRESETS)) {
      const all = Object.values(p.map).flat();
      expect(new Set(all).size).toBe(all.length);
    }
  });
  it('rebinding steals a key from its previous action', () => {
    const b = resolveBindings(null);
    const { bindings, stolenFrom } = assign(b, 'x', 0, 'Enter');
    expect(stolenFrom).toBe('a');
    expect(bindings.x[0]).toBe('Enter');
    expect(bindings.a).toEqual(['Space']);
    expect(reverseBindings(bindings).get('Enter')).toBe('x');
  });
  it('labels keys for a German keyboard', () => {
    expect(keyLabel('KeyY')).toBe('Z');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Numpad8')).toBe('Num 8');
  });
});

describe('third-party controllers', () => {
  it('detects controller families from Gamepad.id', () => {
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padFamily('USB Gamepad (Vendor: 0079 Product: 0006)')).toBe('generic');
    expect(glyphFor('a', 'playstation')).toBe('✕');
    expect(glyphFor('a', 'nintendo')).toBe('B');
  });
  it('reads standard pads, generic HID hats and custom mappings', () => {
    const std = pad();
    std.buttons[0] = { pressed: true, value: 1 };
    std.axes = [0, 0.9, 0, -0.8];
    expect([...readPad(std, {})].sort()).toEqual(['a', 'ls_down', 'rs_up']);

    const hid = pad({ id: 'generic', mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] });
    expect(readPad(hid, {}).size).toBe(0); // resting hat & triggers produce nothing
    hid.axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, -1];
    expect(readPad(hid, {}).has('up')).toBe(true);

    const custom = pad({ id: 'weird', mapping: '', buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })) });
    custom.buttons[7] = { pressed: true, value: 1 };
    expect(readPad(custom, { weird: { a: { type: 'button', index: 7 } } }).has('a')).toBe(true);
  });
});
