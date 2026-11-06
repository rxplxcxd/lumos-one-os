// Minimal terminal screen model: SGR colours (16/256/truecolor), bold/dim/italic/underline/inverse,
// \r, \n, \b, \t, ESC[2J/ESC[H clear, ESC[K erase-line; other CSI/OSC sequences are swallowed.
const BASE16 = ['#1d1f21', '#cc6666', '#5fd69a', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6', '#666666', '#ff7b7b', '#8af5b8', '#ffe08a', '#a9c2ff', '#d7b4f0', '#a6f0e8', '#ffffff'];

function xterm256(n) {
  if (n < 16) return BASE16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

export class Screen {
  constructor(maxLines = 3000) {
    this.max = maxLines;
    this.lines = [[]];
    this.col = 0;
    this.style = {};
    this.pending = '';
    this.version = 0;
  }

  get line() {
    return this.lines[this.lines.length - 1];
  }

  clear() {
    this.lines = [[]];
    this.col = 0;
  }

  newline() {
    this.lines.push([]);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    this.col = 0;
  }

  putChar(ch) {
    const line = this.line;
    while (line.length < this.col) line.push({ ch: ' ', s: {} });
    line[this.col] = { ch, s: this.style };
    this.col++;
  }

  sgr(params) {
    const p = params.length ? params : [0];
    let s = { ...this.style };
    for (let i = 0; i < p.length; i++) {
      const n = p[i];
      if (n === 0) s = {};
      else if (n === 1) s.bold = true;
      else if (n === 2) s.dim = true;
      else if (n === 3) s.italic = true;
      else if (n === 4) s.underline = true;
      else if (n === 7) s.inverse = true;
      else if (n === 22) s.bold = s.dim = false;
      else if (n === 23) s.italic = false;
      else if (n === 24) s.underline = false;
      else if (n === 27) s.inverse = false;
      else if (n >= 30 && n <= 37) s.fg = BASE16[n - 30 + (s.bold ? 8 : 0)];
      else if (n === 39) delete s.fg;
      else if (n >= 40 && n <= 47) s.bg = BASE16[n - 40];
      else if (n === 49) delete s.bg;
      else if (n >= 90 && n <= 97) s.fg = BASE16[n - 90 + 8];
      else if (n >= 100 && n <= 107) s.bg = BASE16[n - 100 + 8];
      else if ((n === 38 || n === 48) && p[i + 1] === 5) {
        s[n === 38 ? 'fg' : 'bg'] = xterm256(p[i + 2] ?? 0);
        i += 2;
      } else if ((n === 38 || n === 48) && p[i + 1] === 2) {
        s[n === 38 ? 'fg' : 'bg'] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`;
        i += 4;
      }
    }
    this.style = s;
  }

  write(data) {
    let str = this.pending + data;
    this.pending = '';
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '\x1b') {
        if (i + 1 >= str.length) {
          this.pending = str.slice(i);
          break;
        }
        const nx = str[i + 1];
        if (nx === '[') {
          const m = /^\x1b\[([?>=]?)([\d;]*)([ -/]*)([@-~])/.exec(str.slice(i));
          if (!m) {
            if (str.length - i < 32) this.pending = str.slice(i);
            break;
          }
          const params = m[2] ? m[2].split(';').map((x) => parseInt(x || '0', 10)) : [];
          const fin = m[4];
          if (fin === 'm') this.sgr(params);
          else if (fin === 'J' && (params[0] === 2 || params[0] === 3)) this.clear();
          else if (fin === 'K') this.line.length = Math.min(this.line.length, this.col);
          else if (fin === 'D') this.col = Math.max(0, this.col - (params[0] || 1));
          else if (fin === 'C') this.col += params[0] || 1;
          else if (fin === 'G') this.col = Math.max(0, (params[0] || 1) - 1);
          i += m[0].length;
          continue;
        }
        if (nx === ']') {
          const end = str.slice(i).search(/\x07|\x1b\\/);
          if (end < 0) {
            this.pending = str.slice(i);
            break;
          }
          i += end + (str[i + end] === '\x07' ? 1 : 2);
          continue;
        }
        i += 2; // other two-byte escapes (charset selects, keypad modes)
        continue;
      }
      if (ch === '\n') this.newline();
      else if (ch === '\r') this.col = 0;
      else if (ch === '\b') this.col = Math.max(0, this.col - 1);
      else if (ch === '\t') this.col = (Math.floor(this.col / 8) + 1) * 8;
      else if (ch === '\x07' || ch < ' ') {
        /* bell / control: ignore */
      } else this.putChar(ch);
      i++;
    }
    this.version++;
  }

  /** Runs of equal style per line for rendering. */
  runs(line) {
    const out = [];
    for (const cell of line) {
      const last = out[out.length - 1];
      if (last && last.s === cell.s) last.text += cell.ch;
      else out.push({ text: cell.ch, s: cell.s });
    }
    return out;
  }
}
