// Injected into web apps opened inside the Lumos browser (<webview>).
// Detects login forms and asks the host shell for Face-ID-gated autofill.
const { ipcRenderer } = require('electron');

function findLoginFields() {
  const pw = Array.from(document.querySelectorAll('input[type="password"]')).find((el) => el.offsetParent !== null);
  if (!pw) return null;
  const inputs = Array.from(document.querySelectorAll('input'));
  const idx = inputs.indexOf(pw);
  let user = null;
  for (let i = idx - 1; i >= 0; i--) {
    const t = (inputs[i].type || 'text').toLowerCase();
    if (['text', 'email', 'tel'].includes(t) && inputs[i].offsetParent !== null) {
      user = inputs[i];
      break;
    }
  }
  return { pw, user };
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

let announced = false;
function scan() {
  const f = findLoginFields();
  if (f && !announced) {
    announced = true;
    ipcRenderer.sendToHost('lumos:login-form', { origin: location.hostname });
    f.pw.addEventListener('focus', () => ipcRenderer.sendToHost('lumos:login-focus', { origin: location.hostname }));
  }
}

ipcRenderer.on('lumos:autofill', (_e, cred) => {
  const f = findLoginFields();
  if (!f || !cred) return;
  if (f.user && cred.username) setNativeValue(f.user, cred.username);
  setNativeValue(f.pw, cred.password);
});

// offer to save credentials after a login form is submitted
document.addEventListener(
  'submit',
  (e) => {
    const form = e.target;
    const pw = form?.querySelector?.('input[type="password"]');
    if (!pw || !pw.value) return;
    const user = Array.from(form.querySelectorAll('input')).find((i) => ['text', 'email', 'tel'].includes((i.type || 'text').toLowerCase()) && i.value);
    ipcRenderer.sendToHost('lumos:login-submit', { origin: location.hostname, username: user?.value || '', password: pw.value });
  },
  true,
);

window.addEventListener('DOMContentLoaded', () => {
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
});
