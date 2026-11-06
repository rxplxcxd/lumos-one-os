// In-renderer hardware simulator — used only when neither Electron nor a running lumosd is
// reachable (e.g. previewing the UI in a desktop browser). Implements the same request/event
// contract as daemon/lumosd so every screen is fully interactive. Real hardware always goes
// through the Python daemon; the Developer Panel drives this simulator via the same `sim.*` calls.
export function createSimDaemon(emit) {
  const ev = (event, data) => queueMicrotask(() => emit({ event, data }));
  const now = () => Date.now();
  const state = {
    battery: { percent: 78, charging: false, watts: 11.4, time_left_min: 214, health: 96 },
    dock: { docked: false, output: 'eDP-1', mode: 'handheld', resolution: '1920x1200', fsr: true },
    controllers: [
      { id: 'joy-l-sim', slot: 1, side: 'left', name: 'Lumos Joy (L)', transport: 'pogo', battery: 84, charging: true, connected: true, gyro: true, fw: '1.0.0' },
      { id: 'joy-r-sim', slot: 1, side: 'right', name: 'Lumos Joy (R)', transport: 'pogo', battery: 81, charging: true, connected: true, gyro: true, fw: '1.0.0' },
    ],
    externals: [],
    running: new Map(),
    terminals: new Map(),
    logs: [],
    faceOutcome: 'success',
    faceModels: [{ id: 1, label: 'Primäres Gesicht', created: now() - 86400e3 * 12 }],
    faceEnabled: true,
    installed: new Map([
      ['org.mozilla.firefox', { id: 'org.mozilla.firefox', name: 'Firefox', version: '132.0', size: 289e6, origin: 'flathub' }],
      ['org.libretro.RetroArch', { id: 'org.libretro.RetroArch', name: 'RetroArch', version: '1.19.1', size: 412e6, origin: 'flathub' }],
    ]),
    jobs: new Map(),
    power: { profile: 'balanced', tdp_w: 15, fan_mode: 'auto', fan_pct: 40 },
    display: { brightness: 72, fps_limit: 0, fsr_sharpness: 2, fsr: true, refresh: 165, hdr: false },
    audio: { volume: 62, muted: false, output: 'speakers', outputs: [{ id: 'speakers', name: 'Lautsprecher' }, { id: 'headphones', name: 'Kopfhörer (3,5 mm)' }] },
    wifi: { enabled: true, ssid: 'Lumos-Home', signal: 82 },
    bt: { enabled: true, devices: [{ address: 'A4:C1:38:22:9F:10', name: 'Lumos Buds', paired: true, connected: false }] },
    haptics: { intensity: 0.8, enabled: true },
    media: { player: 'spotify', title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", art: '', position: 64, length: 243, playing: false },
    library: [
      { id: 'builtin:orbit', kind: 'builtin', name: 'Lumos Orbit', lastPlayed: now() - 60e3, playtime: 42 },
      { id: 'steam:1145360', kind: 'steam', name: 'Hades', appid: 1145360, lastPlayed: now() - 3600e3 * 2, playtime: 3120 },
      { id: 'steam:367520', kind: 'steam', name: 'Hollow Knight', appid: 367520, lastPlayed: now() - 3600e3 * 26, playtime: 2210 },
      { id: 'steam:1086940', kind: 'steam', name: "Baldur's Gate 3", appid: 1086940, lastPlayed: now() - 3600e3 * 50, playtime: 8400 },
      { id: 'steam:1794680', kind: 'steam', name: 'Vampire Survivors', appid: 1794680, lastPlayed: now() - 3600e3 * 75, playtime: 960 },
      { id: 'steam:413150', kind: 'steam', name: 'Stardew Valley', appid: 413150, lastPlayed: now() - 3600e3 * 120, playtime: 5100 },
      { id: 'flatpak:org.libretro.RetroArch', kind: 'emulator', name: 'RetroArch', flatpak: 'org.libretro.RetroArch', lastPlayed: now() - 3600e3 * 98, playtime: 640 },
      { id: 'flatpak:org.mozilla.firefox', kind: 'flatpak', name: 'Firefox', flatpak: 'org.mozilla.firefox', lastPlayed: now() - 3600e3 * 200, playtime: 300 },
    ],
    update: { current: '1.0.0', channel: 'stable', available: null, staged: null },
  };
  let jobSeq = 1;


  function log(level, name, msg) {
    state.logs.push({ t: now() / 1000, level, name: `lumosd.${name}`, msg });
    if (state.logs.length > 1000) state.logs.shift();
  }
  log('INFO', 'server', 'Simulator gestartet (Browser-Vorschau)');
  const prompt = (id) => `\x1b[1;32mlumos@lumos-one\x1b[0m:\x1b[1;34m${(state.terminals.get(id)?.cwd || '~').replace('/home/lumos', '~')}\x1b[0m$ `;
  const FS = { '/home/lumos': ['Applications', 'Downloads', 'Videos', '.config'], '/home/lumos/Applications': ['Celeste.AppImage'], '/home/lumos/Downloads': ['wallpaper.jpg'], '/home/lumos/Videos': ['Lumos'] };
  function runFake(id, cmd) {
    const t = state.terminals.get(id);
    const [c, ...args] = cmd.split(/\s+/);
    const nl = (x) => `${x.replace(/\n/g, '\r\n')}\r\n`;
    switch (c) {
      case '':
        return '';
      case 'help':
        return nl('Befehle: help, ls, cd, pwd, echo, clear, whoami, uname, uptime, date, lumosfetch, logs, ps, flatpak list, lumosctl status, exit');
      case 'ls':
        return nl((FS[t.cwd] || []).map((f) => (f.includes('.') ? f : `\x1b[1;34m${f}\x1b[0m`)).join('  '));
      case 'cd': {
        const dest = !args[0] || args[0] === '~' ? '/home/lumos' : args[0] === '..' ? t.cwd.split('/').slice(0, -1).join('/') || '/' : `${t.cwd}/${args[0]}`;
        if (!FS[dest]) return nl(`cd: ${args[0]}: Datei oder Verzeichnis nicht gefunden`);
        t.cwd = dest;
        return '';
      }
      case 'pwd':
        return nl(t.cwd);
      case 'echo':
        return nl(args.join(' '));
      case 'clear':
        return '\x1b[2J\x1b[H';
      case 'whoami':
        return nl('lumos');
      case 'uname':
        return nl('Linux lumos-one 6.18.2-arch1-1 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux');
      case 'uptime':
        return nl(` ${new Date().toLocaleTimeString('de-DE')} up ${Math.round(performance.now() / 60000)} min, 1 user, load average: 0.42, 0.38, 0.31`);
      case 'date':
        return nl(new Date().toString());
      case 'lumosfetch':
      case 'neofetch':
        return nl(`\x1b[1;36m   ▄▄▄▄▄▄▄   \x1b[0m  \x1b[1mlumos\x1b[0m@\x1b[1mlumos-one\x1b[0m
\x1b[1;36m  █  ◉   █  \x1b[0m  OS: Lumos One 1.1 (Arch Linux)
\x1b[1;36m  █ ▄▄▄  █  \x1b[0m  Host: Lumos One 8″ OLED · Framework 13
\x1b[1;36m   ▀▀▀▀▀▀▀   \x1b[0m  CPU: AMD Ryzen 7 7840U · GPU: Radeon 780M
              Display: 1920×1200 @ 165 Hz · Akku: ${Math.round(state.battery.percent)} %`);
      case 'logs':
        return nl(state.logs.slice(-15).map((l) => `\x1b[90m${new Date(l.t * 1000).toLocaleTimeString('de-DE')}\x1b[0m ${l.level === 'WARNING' ? '\x1b[33m' : '\x1b[32m'}${l.level}\x1b[0m ${l.name}: ${l.msg}`).join('\n'));
      case 'ps':
        return nl(['  PID  NAME', ...[...state.running.entries()].map(([pid, r]) => `${String(pid).padStart(5)}  ${r.name}`), ' 1337  lumosd'].join('\n'));
      case 'flatpak':
        return nl([...state.installed.values()].map((a) => `${a.name}\t${a.id}\t${a.version}`).join('\n'));
      case 'lumosctl':
        return nl(`lumosd: \x1b[32maktiv (Simulation)\x1b[0m · Controller: ${state.controllers.filter((x) => x.connected).length + state.externals.length} · Dock: ${state.dock.docked ? 'TV' : 'Handheld'}`);
      case 'exit':
        state.terminals.delete(id);
        setTimeout(() => ev('terminal.exit', { id, status: 0 }), 10);
        return nl('logout');
      default:
        return nl(`${c}: Befehl nicht gefunden (Simulation – echte Shell mit lumosd)`);
    }
  }

  // Ambient telemetry
  setInterval(() => {
    const b = state.battery;
    b.percent = Math.max(1, Math.min(100, b.percent + (b.charging ? 0.05 : -0.01)));
    ev('battery', { ...b, percent: Math.round(b.percent) });
  }, 5000);
  let t = 0;
  setInterval(() => {
    t += 0.05;
    ev('gyro', { pitch: Math.sin(t * 0.7) * 1.5, roll: Math.cos(t * 0.5) * 1.5, yaw: 0, gx: 0, gy: 0, gz: 0, simulated: true });
  }, 50);

  const controllerList = () => {
    let slot = 2;
    return [...state.controllers.filter((c) => c.connected), ...state.externals.map((e) => ({ ...e, slot: e.assigned || slot++ }))];
  };
  const controllersChanged = () => ev('controllers.changed', controllerList());

  function runFlatpak(op, id, meta = {}) {
    const job = `job-${jobSeq++}`;
    const j = { job, id, op, percent: 0, stage: 'Abhängigkeiten auflösen', name: meta.name || id, icon: meta.icon, cancelled: false };
    state.jobs.set(job, j);
    ev('flatpak.progress', { ...j });
    const stages = op === 'install' ? ['Abhängigkeiten auflösen', 'Runtime herunterladen', 'App herunterladen', 'Installieren'] : ['Deinstallieren'];
    const tick = setInterval(() => {
      if (j.cancelled) {
        clearInterval(tick);
        state.jobs.delete(job);
        ev('flatpak.error', { job, id, op, message: 'Abgebrochen' });
        return;
      }
      j.percent = Math.min(100, j.percent + (op === 'install' ? 2 + Math.random() * 4 : 12));
      j.stage = stages[Math.min(stages.length - 1, Math.floor((j.percent / 100) * stages.length))];
      j.speed = op === 'install' ? `${(8 + Math.random() * 14).toFixed(1)} MB/s` : undefined;
      ev('flatpak.progress', { ...j, percent: Math.round(j.percent) });
      if (j.percent >= 100) {
        clearInterval(tick);
        state.jobs.delete(job);
        if (op === 'install') {
          state.installed.set(id, { id, name: j.name, version: '—', size: 0, origin: 'flathub' });
          state.library.push({ id: `flatpak:${id}`, kind: 'flatpak', name: j.name, flatpak: id, icon: j.icon, lastPlayed: 0, playtime: 0 });
        } else {
          state.installed.delete(id);
          state.library = state.library.filter((x) => x.flatpak !== id);
        }
        ev('flatpak.done', { job, id, op });
      }
    }, 180);
    return { job };
  }

  let faceBusy = false;
  async function faceVerify({ timeout = 6 } = {}) {
    if (faceBusy) throw new Error('Face ID beschäftigt');
    faceBusy = true;
    try {
      ev('faceid.state', { state: 'searching' });
      await sleep(900);
      if (state.faceOutcome === 'none') {
        await sleep(Math.min(timeout, 3) * 1000);
        ev('faceid.state', { state: 'failed', reason: 'Kein Gesicht gefunden' });
        return { ok: false, reason: 'Kein Gesicht gefunden' };
      }
      ev('faceid.state', { state: 'detected' });
      await sleep(550);
      if (state.faceOutcome === 'success' && state.faceModels.length) {
        ev('faceid.state', { state: 'matched', confidence: 0.94 });
        return { ok: true, confidence: 0.94, backend: 'sim' };
      }
      ev('faceid.state', { state: 'failed', reason: 'Gesicht nicht erkannt' });
      return { ok: false, reason: 'Gesicht nicht erkannt' };
    } finally {
      faceBusy = false;
    }
  }

  const handlers = {
    'auth.hello': () => ({ ok: true, simulated: true, version: '1.0.0' }),
    'system.info': () => ({ hostname: 'lumos-one', os: 'Lumos One (Simulator)', kernel: navigator.userAgent.split(') ')[0].split('(')[1] || 'browser', cpu: 'AMD Ryzen 7 7840U (simuliert)', gpu: 'Radeon 780M (simuliert)', ram_total: 32e9, storage: { total: 1e12, free: 612e9 }, version: state.update.current, simulated: true }),
    'system.stats': () => ({ net: { rx_bps: Math.round(20e3 + Math.random() * 400e3), tx_bps: Math.round(5e3 + Math.random() * 60e3) }, cpu: 18 + Math.random() * 20, gpu: 10 + Math.random() * 30, temp_cpu: 52 + Math.random() * 6, temp_gpu: 49 + Math.random() * 6, ram_used: 9.2e9 + Math.random() * 1e9, fan_rpm: 2400 + Math.random() * 300, tdp_w: state.power.tdp_w, power_w: state.battery.watts }),
    'system.power': ({ action }) => ({ ok: true, action, simulated: true }),
    'power.get': () => ({ ...state.power }),
    'power.battery': () => ({ ...state.battery, percent: Math.round(state.battery.percent) }),
    'power.set': (p) => Object.assign(state.power, p),
    'display.get': () => ({ ...state.display, ...state.dock }),
    'display.set': (p) => Object.assign(state.display, p),
    'audio.get': () => ({ ...state.audio }),
    'audio.set': (p) => Object.assign(state.audio, p),
    'network.status': () => ({ wifi: { ...state.wifi }, ethernet: null, ip: '192.168.1.42' }),
    'network.wifi_scan': async () => (await sleep(1200), [
      { ssid: 'Lumos-Home', signal: 82, security: 'WPA2', connected: true },
      { ssid: 'FRITZ!Box 7590 XY', signal: 64, security: 'WPA2', connected: false },
      { ssid: 'Vodafone-Hotspot', signal: 38, security: 'open', connected: false },
    ]),
    'network.wifi_connect': async ({ ssid }) => (await sleep(1500), Object.assign(state.wifi, { ssid }), { ok: true }),
    'network.set_wifi': ({ enabled }) => ((state.wifi.enabled = enabled), { ok: true }),
    'bluetooth.status': () => ({ ...state.bt }),
    'bluetooth.scan': async () => (await sleep(2500), [...state.bt.devices, { address: 'DC:2C:26:01:44:AA', name: 'Xbox Wireless Controller', paired: false, connected: false }]),
    'bluetooth.pair': async ({ address }) => (await sleep(1500), { ok: true, address }),
    'bluetooth.remove': ({ address }) => ((state.bt.devices = state.bt.devices.filter((d) => d.address !== address)), { ok: true }),
    'bluetooth.set': ({ enabled }) => ((state.bt.enabled = enabled), { ok: true }),
    'flatpak.list': () => [...state.installed.values()],
    'flatpak.install': ({ id, name, icon }) => runFlatpak('install', id, { name, icon }),
    'flatpak.uninstall': ({ id }) => runFlatpak('uninstall', id, { name: state.installed.get(id)?.name }),
    'flatpak.cancel': ({ job }) => {
      const j = state.jobs.get(job);
      if (j) j.cancelled = true;
      return { ok: !!j };
    },
    'flatpak.jobs': () => [...state.jobs.values()],
    'library.list': () => state.library.map((x) => ({ ...x })),
    'library.launch': async ({ id }) => {
      const g = state.library.find((x) => x.id === id);
      if (!g) throw new Error('Unbekannter Titel');
      g.lastPlayed = now();
      const pid = 4200 + jobSeq++ * 7;
      state.running.set(pid, { id, name: g.name, started: now() });
      ev('library.launched', { id, pid });
      return { ok: true, pid, simulated: true };
    },
    'steam.bigpicture': () => ({ ok: true, simulated: true }),
    'sideload.inspect': ({ path }) => ({ path, kind: path.endsWith('.AppImage') ? 'appimage' : path.endsWith('.flatpak') || path.endsWith('.flatpakref') ? 'flatpak' : 'binary', name: path.split('/').pop(), executable: true }),
    'sideload.add': ({ path, name }) => {
      const item = { id: `sideload:${path}`, kind: 'appimage', name: name || path.split('/').pop(), path, lastPlayed: 0, playtime: 0 };
      state.library.push(item);
      return item;
    },
    'sideload.remove': ({ id }) => ((state.library = state.library.filter((x) => x.id !== id)), { ok: true }),
    'fs.roots': () => [{ path: '/home/lumos', label: 'Home' }, { path: '/run/media/lumos/USB', label: 'USB-Stick' }],
    'fs.list': ({ path }) => [
      { name: 'Downloads', path: `${path}/Downloads`, dir: true },
      { name: 'Celeste.AppImage', path: `${path}/Celeste.AppImage`, dir: false, size: 712e6 },
      { name: 'org.example.Tool.flatpak', path: `${path}/org.example.Tool.flatpak`, dir: false, size: 38e6 },
      { name: 'wallpaper.jpg', path: `${path}/wallpaper.jpg`, dir: false, size: 4.2e6 },
    ],
    'faceid.status': () => ({ available: true, backend: 'sim', device: '/dev/video2 (simuliert)', models: state.faceModels, enabled: state.faceEnabled, ir_emitter: true }),
    'faceid.verify': faceVerify,
    'faceid.enroll': async ({ label }) => {
      for (let p = 0; p <= 100; p += 4) {
        ev('faceid.state', { state: 'enrolling', progress: p / 100, angle: (p / 100) * Math.PI * 2 });
        await sleep(90);
      }
      const m = { id: (state.faceModels.at(-1)?.id || 0) + 1, label: label || 'Alternatives Aussehen', created: now() };
      state.faceModels.push(m);
      ev('faceid.state', { state: 'enrolled', id: m.id });
      return { ok: true, ...m };
    },
    'faceid.remove': ({ id }) => ((state.faceModels = state.faceModels.filter((m) => m.id !== id)), { ok: true }),
    'faceid.clear': () => ((state.faceModels = []), { ok: true }),
    'faceid.set': (p) => ((state.faceEnabled = p.enabled ?? state.faceEnabled), { ok: true }),
    'faceid.preview': () => ({ ok: true, simulated: true }),
    'faceid.test': async () => (await sleep(600), { ok: true, detail: 'Simulierte IR-Kamera 640×360 @ 30 fps' }),
    'haptics.play': () => ({ ok: true }),
    'haptics.set': (p) => Object.assign(state.haptics, p),
    'controllers.list': () => controllerList(),
    'controllers.rumble': () => ({ ok: true, simulated: true }),
    'controllers.assign': ({ id, slot }) => {
      const e = state.externals.find((x) => x.id === id);
      if (e) e.assigned = slot;
      controllersChanged();
      return { ok: true };
    },
    'input.keyboard_pad': (p) => ({ mode: p.mode, keys: Object.values(p.bindings || {}).flat().length }),
    'input.shell_visible': () => ({ ok: true }),
    'sim.usb_controller': ({ model = 'xbox', connected = true }) => {
      const M = {
        xbox: { name: 'Xbox Wireless Controller', family: 'xbox', vendor: '045e', product: '0b13', transport: 'bt', battery: 72, driver: 'xpadneo' },
        dualsense: { name: 'DualSense', family: 'playstation', vendor: '054c', product: '0ce6', transport: 'usb', battery: 100, driver: 'hid-playstation' },
        pro: { name: 'Switch Pro Controller', family: 'nintendo', vendor: '057e', product: '2009', transport: 'bt', battery: 55, driver: 'hid-nintendo' },
        '8bitdo': { name: '8BitDo Controller', family: 'nintendo', vendor: '2dc8', product: '3106', transport: 'usb', battery: null, driver: 'xpad / hid-generic' },
        generic: { name: 'USB Gamepad (DragonRise)', family: 'generic', vendor: '0079', product: '0006', transport: 'usb', battery: null, driver: 'hid-generic' },
      }[model];
      if (!M) throw new Error('Unbekanntes Modell');
      const id = `ext-${M.vendor}${M.product}-sim`;
      const has = state.externals.find((x) => x.id === id);
      if (connected && !has) {
        if (state.controllers.filter((c) => c.connected).length + state.externals.length >= 4) throw new Error('Maximal 4 Controller');
        const e = { id, side: 'pro', ...M, charging: M.transport === 'usb', connected: true, gyro: M.family !== 'xbox' && M.family !== 'generic', rumble: true };
        state.externals.push(e);
        ev('controller.attached', { ...e });
      } else if (!connected && has) {
        state.externals = state.externals.filter((x) => x.id !== id);
        ev('controller.detached', { ...has, lost: true });
      }
      controllersChanged();
      return { ok: true };
    },
    'controllers.set': ({ id, ...rest }) => Object.assign(state.controllers.find((c) => c.id === id) || {}, rest),
    'controllers.identify': () => ({ ok: true }),
    'controllers.configure': (p) => ({ ok: true, ...p }),
    'controllers.calibrate': async () => (await sleep(2000), { ok: true }),
    'dock.status': () => ({ ...state.dock }),
    'saves.list': () => [
      { id: 'steam:1145360', title: 'Hades', path: '~/.local/share/Steam/userdata/…/1145360', size: 2.4e6, mtime: now() - 7200e3, hash: 'a1f9…' },
      { id: 'retroarch', title: 'RetroArch (alle Cores)', path: '~/.var/app/org.libretro.RetroArch/config/retroarch/saves', size: 18e6, mtime: now() - 86400e3, hash: 'c03e…' },
    ],
    'saves.pack': async ({ id }) => (await sleep(600), { id, archive: null, sha256: 'sim', size: 0, simulated: true }),
    'saves.restore': async () => (await sleep(600), { ok: true }),
    'update.status': () => ({ ...state.update }),
    'update.check': async ({ channel }) => {
      await sleep(1200);
      state.update.available = { version: '1.1.0', channel: channel || 'stable', size: 184e6, notes: '• Neue Hintergründe\n• Schnelleres Face ID\n• Fehlerbehebungen für Joy-Con-Hot-Plug' };
      return state.update.available;
    },
    'update.download': async () => {
      for (let p = 0; p <= 100; p += 5) {
        ev('update.progress', { stage: 'download', percent: p });
        await sleep(120);
      }
      ev('update.progress', { stage: 'verify', percent: 100 });
      state.update.staged = state.update.available;
      return { ok: true };
    },
    'update.apply': async () => {
      ev('update.progress', { stage: 'apply', percent: 50 });
      await sleep(800);
      state.update.current = state.update.staged?.version || state.update.current;
      state.update.staged = null;
      state.update.available = null;
      ev('update.progress', { stage: 'done', percent: 100 });
      return { ok: true, reboot_required: true };
    },
    'update.cleanup': async () => (await sleep(700), { freed_bytes: 1.37e9, removed: ['releases/0.9.4', 'cache/flatpak-unused', 'tmp/update-*'] }),
    'update.rollback': () => ({ ok: true }),
    'update.usb_scan': () => [],
    'update.pair_start': () => ({ code: String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), expires_in: 180, port: 7421, simulated: true }),
    'media.status': () => ({ ...state.media }),
    'media.control': ({ action }) => {
      if (action === 'toggle') state.media.playing = !state.media.playing;
      if (action === 'play') state.media.playing = true;
      if (action === 'pause') state.media.playing = false;
      ev('media.state', { ...state.media });
      return { ok: true };
    },

    // ---------------------------------------------------------------- v1.1
    'saves.manifest': ({ id }) => {
      const h = Math.floor(now() / 3600e3);
      return ['saves/Pokemon Emerald.srm', 'saves/Zelda Minish Cap.srm', 'states/Pokemon Emerald.state1', 'states/Metroid Fusion.state'].map((f, i) => ({ path: f, size: 65536 * (i + 1) + (f.includes('state1') ? h % 9 : 0), mtime: now() - i * 5400e3, sha256: `${id}-${f}-${f.includes('state1') ? h : 0}` }));
    },
    'system.logs': ({ limit = 300 } = {}) => state.logs.slice(-limit),
    'process.list': () => [
      ...[...state.running.entries()].map(([pid, r]) => ({ pid, id: r.id, name: r.name, kind: 'app', cpu: +(18 + Math.random() * 40).toFixed(1), rss: (0.6 + Math.random() * 1.8) * 1e9, threads: 24, uptime: Math.round((now() - r.started) / 1000), killable: true })),
      { pid: 1337, id: 'lumosd', name: 'lumosd (Hardware-Daemon, simuliert)', kind: 'daemon', cpu: 0.4, rss: 48e6, killable: false },
    ],
    'process.kill': ({ pid }) => {
      const r = state.running.get(pid);
      if (!r) throw new Error('Prozess nicht gefunden');
      state.running.delete(pid);
      ev('library.exited', { id: r.id, code: -15, killed: true });
      return { ok: true, signal: 'TERM' };
    },
    'permissions.apply': ({ id, perms }) => (log('INFO', 'apps', `Berechtigungen für ${id}: ${JSON.stringify(perms)}`), { ok: true, simulated: true }),
    'profiles.set': ({ profiles }) => ({ ok: true, count: Object.keys(profiles || {}).length }),
    'capture.status': () => ({ backend: 'browser', buffering: false }),
    'capture.buffer': () => ({ ok: false, reason: 'Im Browser übernimmt die Shell die Aufnahme' }),
    'hud.configure': (p) => ({ ok: true, ...p }),
    'audio.eq': (p) => (log('INFO', 'audio', `Equalizer ${p.enabled ? 'an' : 'aus'}: ${(p.bands || []).join(' / ')} dB`), { ...p, simulated: true }),
    'terminal.open': () => {
      const id = `t${jobSeq++}`;
      state.terminals.set(id, { cwd: '/home/lumos' });
      setTimeout(() => ev('terminal.data', { id, data: `\x1b[1;36mLumos One Terminal\x1b[0m (Simulation – ohne lumosd im Browser)\r\nTippe \x1b[33mhelp\x1b[0m für Befehle.\r\n${prompt(id)}` }), 50);
      return { id, shell: 'lumos-sim', pid: 0 };
    },
    'terminal.write': ({ id, data }) => {
      const t = state.terminals.get(id);
      if (!t) throw new Error('Sitzung beendet');
      t.line = (t.line || '') + data;
      if (data.includes('\x03')) {
        t.line = '';
        ev('terminal.data', { id, data: `^C\r\n${prompt(id)}` });
      } else if (/[\r\n]/.test(data)) {
        const cmd = t.line.replace(/[\r\n]+/g, '').trim();
        t.line = '';
        ev('terminal.data', { id, data: `${cmd}\r\n${runFake(id, cmd)}${state.terminals.has(id) ? prompt(id) : ''}` });
      }
      return { ok: true };
    },
    'terminal.resize': () => ({ ok: true }),
    'terminal.close': ({ id }) => (state.terminals.delete(id), { ok: true }),
    // --- Developer panel ---
    'sim.state': () => ({ faceOutcome: state.faceOutcome, battery: state.battery, dock: state.dock, controllers: state.controllers }),
    'sim.faceid': ({ outcome }) => ((state.faceOutcome = outcome), { ok: true }),
    'sim.battery': (p) => (Object.assign(state.battery, p), ev('battery', { ...state.battery }), { ok: true }),
    'sim.controller': ({ side, attached, battery, transport }) => {
      const c = state.controllers.find((x) => x.side === side);
      if (!c) return { ok: false };
      if (battery != null) c.battery = battery;
      if (transport) c.transport = transport;
      if (attached != null && attached !== (c.transport === 'pogo' && c.connected)) {
        c.transport = attached ? 'pogo' : 'ble';
        c.charging = attached;
        ev(attached ? 'controller.attached' : 'controller.detached', { ...c });
      }
      controllersChanged();
      return { ok: true };
    },
    'sim.controller_power': ({ side, connected }) => {
      const c = state.controllers.find((x) => x.side === side);
      if (c) {
        c.connected = connected;
        ev(connected ? 'controller.attached' : 'controller.detached', { ...c, lost: !connected });
        controllersChanged();
      }
      return { ok: true };
    },
    'sim.dock': ({ docked }) => {
      Object.assign(state.dock, docked ? { docked: true, output: 'DP-1', mode: 'tv', resolution: '3840x2160', fsr: true } : { docked: false, output: 'eDP-1', mode: 'handheld', resolution: '1920x1200' });
      ev('dock.changed', { ...state.dock });
      return { ok: true };
    },
    'sim.button': ({ button, pressed }) => (ev('input.button', { button, pressed, source: 'virtual' }), button === 'home' && pressed && ev('input.home', {}), { ok: true }),
    'sim.gyro': ({ pitch, roll }) => (ev('gyro', { pitch, roll, yaw: 0 }), { ok: true }),
  };

  return {
    simulated: true,
    async request(method, params = {}) {
      const h = handlers[method];
      if (!h) throw Object.assign(new Error(`Unbekannte Methode: ${method}`), { code: 'ENOMETHOD' });
      return h(params);
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
