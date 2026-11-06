// Persistent system settings with per-key timestamps (for cloud LWW merge) and side effects
// that push hardware-relevant values to lumosd.
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/services/storage.js';
import { notify } from '@/services/bridge.js';
import { configureHaptics } from '@/services/haptics.js';
import { registerSource, settingsChanged } from '@/services/cloud/cloudService.js';
import { resolveBindings } from '@/lib/keybindings.js';

export const DEFAULTS = {
  // appearance
  background: 'tide',
  bgIntensity: 0.75,
  bgGyro: true,
  reduceMotion: false,
  clock24h: true,
  uiScale: 1,
  // haptics
  hapticsEnabled: true,
  hapticsIntensity: 0.8,
  hapticsRumbleFallback: true,
  // display & docking
  brightness: 72,
  autoBrightness: false,
  fpsLimit: 0,
  refreshRate: 165,
  fsrEnabled: true,
  fsrSharpness: 2,
  tvResolution: 'auto',
  tvUpscaler: 'fsr',
  hdr: false,
  // audio
  volume: 62,
  uiSounds: true,
  // performance
  powerProfile: 'balanced',
  tdp: 15,
  fanMode: 'auto',
  fanPct: 45,
  chargeLimit: 85,
  // controllers & gyro
  gyroEnabled: true,
  gyroSensitivity: 1,
  gyroAsMouse: false,
  stickDeadzone: 0.08,
  swapAB: false,
  // face id
  faceIdUnlock: true,
  faceIdKeychain: true,
  faceIdStore: true,
  faceIdAttention: true,
  // network
  wifiEnabled: true,
  bluetoothEnabled: true,
  // cloud
  cloudSyncSettings: true,
  cloudSyncSaves: true,
  // system
  deviceName: 'Lumos One',
  language: 'de',
  weatherLocation: { name: 'Berlin', lat: 52.52, lon: 13.405 },
  devPanelShortcut: true,
  updateChannel: 'stable',
  autoUpdate: true,
  // look & feel
  uiTheme: 'lumen',
  glassOpacity: 0.52,
  glassBlur: 28,
  reduceTransparency: false,
  highContrast: false,
  boldText: false,
  focusStyle: 'halo', // halo | ring
  bgSpeed: 1,
  bgParticles: 1,
  // animations
  transitionStyle: 'spring', // spring | zoom | slide | fade | flip | rise
  animationSpeed: 1,
  pressRipples: true,
  tileTilt: 0.6,
  chargeAnimation: true,
  bootAnimation: 'full', // full | short | off
  // input
  keyBindings: null, // null → defaults (src/lib/keybindings.js)
  keyboardPad: 'games', // off | games — keyboard drives the virtual gamepad while a game runs
  glyphStyle: 'auto', // auto | xbox | playstation | nintendo
  padMappings: {}, // custom mappings for non-standard USB controllers, keyed by Gamepad.id
  navRepeatDelay: 380,
  navRepeatRate: 85,
  // sounds
  uiSoundTheme: 'soft', // soft | crisp | glass
  uiSoundVolume: 0.5,
  // display extras
  nightShift: 0.5, // tint strength (0–1); when it applies is set by nightShiftMode
  screensaverMin: 5, // 0 = off
  screensaverStyle: 'clock', // clock | ambient | photo
  screensaverDim: true,
  autoSleepMin: 0,
  // home & status bar
  showGreeting: true,
  tileSize: 'm', // s | m | l
  recentCount: 12,
  heroArtwork: true,
  statusBatteryPct: true,
  statusSeconds: false,
  // notifications
  toastDuration: 3.8,
  notifyDownloads: true,
  notifyControllers: true,
  // v1.1 — power
  lowPower: false,
  batteryWarnings: true,
  autoShutdownCritical: true,
  // v1.1 — controller cursor & scrolling
  stickCursor: true,
  cursorSpeed: 1,
  scrollSpeed: 1,
  // v1.1 — apps
  appPermissions: {}, // appId → { sensors, controller, storage, cloud, network, push }
  gameProfiles: {}, // appId → { fps, tdp, refresh }
  autoCloudSave: true,
  // v1.1 — overlays & capture
  hudMode: 'off', // off | minimal | full
  hudPosition: 'tr', // tl | tr | bl | br
  replayBuffer: true,
  // v1.1 — audio DSP
  eqEnabled: false,
  eqPreset: 'neutral',
  eqBands: [0, 0, 0, 0, 0], // dB at 60 Hz, 250 Hz, 1 kHz, 3.5 kHz, 10 kHz
  // v1.1 — display health
  nightShiftMode: 'off', // off | manual | auto (sunset → sunrise) | schedule
  nightShiftFrom: '22:00',
  nightShiftTo: '07:00',
  pixelShift: true,
  dimStatic: true,
  // v1.1 — seasonal themes
  seasonal: 'auto', // auto | off | halloween | christmas | newyear | easter | valentine
};

// never leave this device (hardware-specific or private)
const LOCAL_ONLY = new Set(['brightness', 'volume', 'deviceName', 'tdp', 'fanMode', 'fanPct', 'refreshRate', 'wifiEnabled', 'bluetoothEnabled', 'padMappings', 'lowPower']);

const stored = loadJSON('lumos.settings', {});
// v1.0 → v1.1: a night-shift strength > 0 used to mean "always on"
if (stored.values?.nightShift > 0 && !stored.values.nightShiftMode) stored.values.nightShiftMode = 'manual';
export const useSettings = create(() => ({ values: { ...DEFAULTS, ...(stored.values || {}) }, stamps: stored.stamps || {} }));

export function setSetting(key, value) {
  setSettings({ [key]: value });
}

export function setSettings(patch, { fromCloud = false, stamps: remoteStamps } = {}) {
  const now = Date.now();
  useSettings.setState((s) => {
    const stamps = { ...s.stamps };
    for (const k of Object.keys(patch)) stamps[k] = remoteStamps?.[k] ?? now;
    return { values: { ...s.values, ...patch }, stamps };
  });
  const { values, stamps } = useSettings.getState();
  saveJSON('lumos.settings', { values, stamps });
  if (!fromCloud && values.cloudSyncSettings) {
    const synced = Object.fromEntries(Object.entries(patch).filter(([k]) => !LOCAL_ONLY.has(k)));
    if (Object.keys(synced).length) settingsChanged(synced, Object.fromEntries(Object.keys(synced).map((k) => [k, stamps[k]])));
  }
}

export const useSetting = (key) => useSettings((s) => s.values[key]);

registerSource('settings', {
  apply(values, stamps) {
    const local = useSettings.getState();
    const patch = {};
    for (const [k, v] of Object.entries(values)) if (!LOCAL_ONLY.has(k) && (stamps[k] ?? 0) > (local.stamps[k] ?? 0)) patch[k] = v;
    if (Object.keys(patch).length) setSettings(patch, { fromCloud: true, stamps });
  },
});

// --- side effects → daemon ---------------------------------------------------------------
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
// Energiesparmodus: 60 Hz panel, FPS cap 60, silent profile at 8 W, dimmer panel — real savings, not cosmetics
const lp = (v) => !!v.lowPower;
const pushDisplay = debounce(
  (v) =>
    notify('display.set', {
      brightness: lp(v) ? Math.min(v.brightness, 55) : v.brightness,
      fps_limit: lp(v) ? (v.fpsLimit && v.fpsLimit < 60 ? v.fpsLimit : 60) : v.fpsLimit,
      fsr: v.fsrEnabled,
      fsr_sharpness: v.fsrSharpness,
      refresh: lp(v) ? 60 : v.refreshRate,
      hdr: lp(v) ? false : v.hdr,
      tv_resolution: v.tvResolution,
      tv_upscaler: v.tvUpscaler,
      auto_brightness: v.autoBrightness,
    }),
  120,
);
const pushPower = debounce((v) => notify('power.set', { profile: lp(v) ? 'silent' : v.powerProfile, tdp_w: lp(v) ? Math.min(8, v.tdp) : v.tdp, fan_mode: lp(v) ? 'quiet' : v.fanMode, fan_pct: v.fanPct, charge_limit: v.chargeLimit, low_power: lp(v) }), 250);
const pushEq = debounce((v) => notify('audio.eq', { enabled: v.eqEnabled, bands: v.eqBands, preset: v.eqPreset }), 400);
const pushAudio = debounce((v) => notify('audio.set', { volume: v.volume }), 60);
const pushCtl = debounce((v) => notify('controllers.configure', { gyro_enabled: v.gyroEnabled, gyro_sensitivity: v.gyroSensitivity, gyro_as_mouse: v.gyroAsMouse, stick_deadzone: v.stickDeadzone, swap_ab: v.swapAB }), 200);
const pushFace = debounce((v) => notify('faceid.set', { enabled: v.faceIdUnlock, attention: v.faceIdAttention }), 200);

const pushKeypad = debounce((v) => notify('input.keyboard_pad', { mode: v.keyboardPad, bindings: resolveBindings(v.keyBindings) }), 300);

const pushProfiles = debounce((v) => notify('profiles.set', { profiles: v.gameProfiles }), 300);
const pushHud = debounce((v) => notify('hud.configure', { mode: v.hudMode, position: v.hudPosition }), 300);

const GROUPS = [
  [['gameProfiles'], pushProfiles],
  [['hudMode', 'hudPosition'], pushHud],
  [['keyBindings', 'keyboardPad'], pushKeypad],
  [['brightness', 'fpsLimit', 'fsrEnabled', 'fsrSharpness', 'refreshRate', 'hdr', 'tvResolution', 'tvUpscaler', 'autoBrightness', 'lowPower'], pushDisplay],
  [['powerProfile', 'tdp', 'fanMode', 'fanPct', 'chargeLimit', 'lowPower'], pushPower],
  [['eqEnabled', 'eqBands', 'eqPreset'], pushEq],
  [['volume'], pushAudio],
  [['gyroEnabled', 'gyroSensitivity', 'gyroAsMouse', 'stickDeadzone', 'swapAB'], pushCtl],
  [['faceIdUnlock', 'faceIdAttention'], pushFace],
];

export function startSettingsEffects() {
  const apply = (v, prev) => {
    for (const [keys, fn] of GROUPS) if (!prev || keys.some((k) => v[k] !== prev[k])) fn(v);
    if (!prev || v.hapticsEnabled !== prev.hapticsEnabled || v.hapticsIntensity !== prev.hapticsIntensity || v.hapticsRumbleFallback !== prev.hapticsRumbleFallback)
      configureHaptics({ enabled: v.hapticsEnabled, intensity: v.hapticsIntensity, rumbleFallback: v.hapticsRumbleFallback });
  };
  apply(useSettings.getState().values, null);
  return useSettings.subscribe((s, p) => apply(s.values, p.values));
}
