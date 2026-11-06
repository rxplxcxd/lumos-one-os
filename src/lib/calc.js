// Safe expression evaluator for the Calculator app (shunting-yard, no eval()).
const OPS = {
  '+': { p: 1, a: 'L', f: (a, b) => a + b },
  '-': { p: 1, a: 'L', f: (a, b) => a - b },
  '*': { p: 2, a: 'L', f: (a, b) => a * b },
  '/': { p: 2, a: 'L', f: (a, b) => (b === 0 ? NaN : a / b) },
  '^': { p: 4, a: 'R', f: (a, b) => Math.pow(a, b) },
  'u-': { p: 3, a: 'R', u: true, f: (a) => -a },
};
const FN = {
  sin: (x, deg) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (x, deg) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (x, deg) => Math.tan(deg ? (x * Math.PI) / 180 : x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  sqrt: (x) => Math.sqrt(x),
};
const CONST = { pi: Math.PI, e: Math.E };

export function tokenize(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/,/g, '.');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' && /[-+0-9]/.test(s[j + 1] || '')) {
        j++;
        if (/[-+]/.test(s[j])) j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const n = Number(s.slice(i, j));
      if (Number.isNaN(n)) throw new Error('Ungültige Zahl');
      out.push({ t: 'num', v: n });
      i = j;
    } else if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      const w = s.slice(i, j).toLowerCase();
      if (w in FN) out.push({ t: 'fn', v: w });
      else if (w in CONST) out.push({ t: 'num', v: CONST[w] });
      else throw new Error(`Unbekannt: ${w}`);
      i = j;
    } else if (c === '%') {
      out.push({ t: 'pct' });
      i++;
    } else if ('+-*/^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(' || c === ')') {
      out.push({ t: c });
      i++;
    } else throw new Error(`Unerwartetes Zeichen ${c}`);
  }
  // implicit multiplication: 2(3), 2pi, (1)(2), 3sqrt(4)
  const res = [];
  for (const tk of out) {
    const prev = res[res.length - 1];
    if (prev && (prev.t === 'num' || prev.t === ')' || prev.t === 'pct') && (tk.t === 'num' || tk.t === '(' || tk.t === 'fn')) res.push({ t: 'op', v: '*' });
    res.push(tk);
  }
  return res;
}

export function evaluate(src, { deg = true } = {}) {
  const tokens = tokenize(src);
  const out = [];
  const st = [];
  let prev = null;
  const apply = (op) => {
    if (op.t === 'fn') {
      if (!out.length) throw new Error('Syntaxfehler');
      out.push(FN[op.v](out.pop(), deg));
      return;
    }
    const o = OPS[op.v];
    if (o.u) {
      if (!out.length) throw new Error('Syntaxfehler');
      out.push(o.f(out.pop()));
    } else {
      if (out.length < 2) throw new Error('Syntaxfehler');
      const b = out.pop();
      const a = out.pop();
      out.push(o.f(a, b));
    }
  };
  for (const tk of tokens) {
    if (tk.t === 'num') out.push(tk.v);
    else if (tk.t === 'pct') {
      if (!out.length) throw new Error('Syntaxfehler');
      out.push(out.pop() / 100);
    } else if (tk.t === 'fn') st.push(tk);
    else if (tk.t === 'op') {
      const unary = tk.v === '-' && (!prev || prev.t === 'op' || prev.t === '(' || prev.t === 'fn');
      if (tk.v === '+' && (!prev || prev.t === 'op' || prev.t === '(')) {
        prev = tk;
        continue;
      }
      const cur = unary ? { t: 'op', v: 'u-' } : tk;
      const o = OPS[cur.v];
      while (st.length) {
        const top = st[st.length - 1];
        if (top.t === 'fn') {
          apply(st.pop());
          continue;
        }
        if (top.t !== 'op') break;
        const to = OPS[top.v];
        if (!o.u && (to.p > o.p || (to.p === o.p && o.a === 'L'))) apply(st.pop());
        else break;
      }
      st.push(cur);
    } else if (tk.t === '(') st.push(tk);
    else if (tk.t === ')') {
      while (st.length && st[st.length - 1].t !== '(') apply(st.pop());
      if (!st.length) throw new Error('Klammerfehler');
      st.pop();
      if (st.length && st[st.length - 1].t === 'fn') apply(st.pop());
    }
    prev = tk;
  }
  while (st.length) {
    const op = st.pop();
    if (op.t === '(') continue; // tolerate unclosed parentheses like a phone calculator
    apply(op);
  }
  if (out.length !== 1 || !Number.isFinite(out[0])) throw new Error('Fehler');
  return out[0];
}

export function format(n) {
  if (!Number.isFinite(n)) return 'Fehler';
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(8).replace('.', ',');
  const r = Math.round(n * 1e10) / 1e10;
  return r.toLocaleString('de-DE', { maximumFractionDigits: 10 });
}
