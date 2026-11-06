// Controller-first spatial navigation over the DOM.
// Any element with [data-nav] is focusable; the top-most visible [data-nav-scope] confines focus
// (modals, sheets, overlays). Focused elements may intercept directions by calling
// preventDefault() on the 'lumos:navkey' CustomEvent (sliders, carousels, steppers).
import { haptic } from '@/services/haptics.js';

const SEL = '[data-nav]:not([disabled]):not([aria-disabled="true"])';

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

export function activeScope() {
  const scopes = Array.from(document.querySelectorAll('[data-nav-scope]')).filter(visible);
  if (!scopes.length) return document.body;
  scopes.sort((a, b) => (Number(b.dataset.navScope) || 0) - (Number(a.dataset.navScope) || 0));
  return scopes[0];
}

function focusables(scope = activeScope()) {
  return Array.from(scope.querySelectorAll(SEL)).filter((el) => {
    // only elements whose nearest scope is the active one (nested scopes are separate layers)
    const s = el.closest('[data-nav-scope]');
    return (scope === document.body ? !s : s === scope) && visible(el);
  });
}

export function focusEl(el, { silent = false, scroll = true } = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (scroll && !el.hasAttribute('data-nav-noscroll')) el.scrollIntoView({ block: el.dataset.navBlock || 'nearest', inline: el.dataset.navInline || 'nearest', behavior: 'smooth' });
  if (!silent) haptic('nav.tick');
  el.dispatchEvent(new CustomEvent('lumos:focus', { bubbles: true }));
}

export function currentFocus() {
  const scope = activeScope();
  const a = document.activeElement;
  if (a && a.matches?.(SEL) && scope.contains(a) && visible(a)) return a;
  return null;
}

export function ensureFocus() {
  if (currentFocus()) return currentFocus();
  const scope = activeScope();
  const list = focusables(scope);
  const auto = list.find((el) => el.hasAttribute('data-nav-autofocus')) || list[0];
  if (auto) focusEl(auto, { silent: true });
  return auto;
}

export function move(dir) {
  const cur = currentFocus();
  if (!cur) return ensureFocus();
  const ev = new CustomEvent('lumos:navkey', { bubbles: true, cancelable: true, detail: { dir } });
  if (!cur.dispatchEvent(ev)) return cur;

  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of focusables()) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    let primary;
    let secondary;
    if (dir === 'right') [primary, secondary] = [b.left - r.right, by - cy];
    else if (dir === 'left') [primary, secondary] = [r.left - b.right, by - cy];
    else if (dir === 'down') [primary, secondary] = [b.top - r.bottom, bx - cx];
    else [primary, secondary] = [r.top - b.bottom, bx - cx];
    // must lie in the requested half-plane (allow slight overlap)
    const centerOk = dir === 'right' ? bx > cx + 1 : dir === 'left' ? bx < cx - 1 : dir === 'down' ? by > cy + 1 : by < cy - 1;
    if (!centerOk || primary < -Math.min(r.width, r.height) * 0.5) continue;
    // overlap on the orthogonal axis is strongly preferred
    const overlap = dir === 'left' || dir === 'right' ? !(b.bottom < r.top || b.top > r.bottom) : !(b.right < r.left || b.left > r.right);
    const score = Math.max(0, primary) + Math.abs(secondary) * (overlap ? 0.6 : 2.5) + (overlap ? 0 : 60);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    focusEl(best);
    return best;
  }
  haptic('nav.edge');
  cur.dispatchEvent(new CustomEvent('lumos:edge', { bubbles: true, detail: { dir } }));
  return cur;
}

export function activate() {
  const cur = currentFocus() || ensureFocus();
  if (!cur) return;
  if (cur.dataset.navHaptic !== 'none') haptic(cur.dataset.navHaptic || 'select');
  window.dispatchEvent(new CustomEvent('lumos:activate', { detail: { el: cur } }));
  if (cur.matches('input:not([type=checkbox]):not([type=range]), textarea')) {
    cur.focus();
    window.dispatchEvent(new CustomEvent('lumos:osk', { detail: { target: cur } }));
  } else cur.click();
}
