import { describe, it, expect } from 'vitest';
import { easterSunday, autoSeason, activeSeason } from './seasons.js';
import { sunTimes, inWindow, nightShiftActive } from './sun.js';

describe('seasons', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2024).toDateString()).toBe(new Date(2024, 2, 31).toDateString());
    expect(easterSunday(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easterSunday(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
  });
  it('picks seasons by date', () => {
    expect(autoSeason(new Date(2026, 9, 31))).toBe('halloween');
    expect(autoSeason(new Date(2026, 11, 24))).toBe('christmas');
    expect(autoSeason(new Date(2026, 11, 31))).toBe('newyear');
    expect(autoSeason(new Date(2027, 0, 1))).toBe('newyear');
    expect(autoSeason(new Date(2026, 1, 14))).toBe('valentine');
    expect(autoSeason(new Date(2026, 3, 4))).toBe('easter');
    expect(autoSeason(new Date(2026, 6, 10))).toBe(null);
  });
  it('honours the setting', () => {
    expect(activeSeason('off', new Date(2026, 11, 24))).toBe(null);
    expect(activeSeason('halloween', new Date(2026, 6, 1))).toBe('halloween');
    expect(activeSeason('bogus')).toBe(null);
  });
});

describe('night shift', () => {
  it('computes plausible Berlin sun times', () => {
    const t = sunTimes(new Date(2026, 5, 21), 52.52, 13.405);
    const rise = t.sunrise.getUTCHours() + t.sunrise.getUTCMinutes() / 60;
    const set = t.sunset.getUTCHours() + t.sunset.getUTCMinutes() / 60;
    expect(rise).toBeGreaterThan(2.5); // ~02:43 UTC
    expect(rise).toBeLessThan(3.1);
    expect(set).toBeGreaterThan(19.1); // ~19:33 UTC
    expect(set).toBeLessThan(19.8);
  });
  it('handles schedule windows across midnight', () => {
    expect(inWindow(new Date(2026, 0, 1, 23, 0), '22:00', '07:00')).toBe(true);
    expect(inWindow(new Date(2026, 0, 1, 6, 59), '22:00', '07:00')).toBe(true);
    expect(inWindow(new Date(2026, 0, 1, 12, 0), '22:00', '07:00')).toBe(false);
    expect(inWindow(new Date(2026, 0, 1, 12, 0), '09:00', '17:00')).toBe(true);
  });
  it('resolves modes', () => {
    expect(nightShiftActive({ nightShiftMode: 'off', nightShift: 0.6 })).toBe(false);
    expect(nightShiftActive({ nightShiftMode: 'manual' })).toBe(true);
    expect(nightShiftActive({ nightShiftMode: 'schedule', nightShiftFrom: '00:00', nightShiftTo: '23:59' }, new Date(2026, 0, 1, 12))).toBe(true);
  });
});
