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
  uiSounds: false,
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
  nightShift: 0,
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
};

// never leave this device (hardware-specific or private)
const LOCAL_ONLY = new Set(['brightness', 'volume', 'deviceName', 'tdp', 'fanMode', 'fanPct', 'refreshRate', 'wifiEnabled', 'bluetoothEnabled', 'padMappings']);

const stored = loadJSON('lumos.settings', {});
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
const pushDisplay = debounce((v) => notify('display.set', { brightness: v.brightness, fps_limit: v.fpsLimit, fsr: v.fsrEnabled, fsr_sharpness: v.fsrSharpness, refresh: v.refreshRate, hdr: v.hdr, tv_resolution: v.tvResolution, tv_upscaler: v.tvUpscaler, auto_brightness: v.autoBrightness }), 120);
const pushPower = debounce((v) => notify('power.set', { profile: v.powerProfile, tdp_w: v.tdp, fan_mode: v.fanMode, fan_pct: v.fanPct, charge_limit: v.chargeLimit }), 250);
const pushAudio = debounce((v) => notify('audio.set', { volume: v.volume }), 60);
const pushCtl = debounce((v) => notify('controllers.configure', { gyro_enabled: v.gyroEnabled, gyro_sensitivity: v.gyroSensitivity, gyro_as_mouse: v.gyroAsMouse, stick_deadzone: v.stickDeadzone, swap_ab: v.swapAB }), 200);
const pushFace = debounce((v) => notify('faceid.set', { enabled: v.faceIdUnlock, attention: v.faceIdAttention }), 200);

const pushKeypad = debounce((v) => notify('input.keyboard_pad', { mode: v.keyboardPad, bindings: resolveBindings(v.keyBindings) }), 300);

const GROUPS = [
  [['keyBindings', 'keyboardPad'], pushKeypad],
  [['brightness', 'fpsLimit', 'fsrEnabled', 'fsrSharpness', 'refreshRate', 'hdr', 'tvResolution', 'tvUpscaler', 'autoBrightness'], pushDisplay],
  [['powerProfile', 'tdp', 'fanMode', 'fanPct', 'chargeLimit'], pushPower],
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
