import { describe, it, expect } from 'vitest';
import { Screen } from './ansi.js';

const text = (s) => s.lines.map((l) => l.map((c) => c.ch).join(''));

describe('ansi screen', () => {
  it('renders colours, carriage returns and clears', () => {
    const s = new Screen();
    s.write('\x1b[1;32mok\x1b[0m done\r\n');
    s.write('50%\r100%\r\n');
    s.write('ab\bc\r\n');
    expect(text(s).slice(0, 3)).toEqual(['ok done', '100%', 'ac']);
    expect(s.lines[0][0].s.fg).toBe('#8af5b8');
    s.write('\x1b[2J\x1b[Hfresh');
    expect(text(s)).toEqual(['fresh']);
  });
  it('handles sequences split across chunks and OSC titles', () => {
    const s = new Screen();
    s.write('\x1b]0;title\x07a\x1b[3');
    s.write('1mred');
    expect(text(s)).toEqual(['ared']);
    expect(s.lines[0][1].s.fg).toBe('#cc6666');
  });
});
