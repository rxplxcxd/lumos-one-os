import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import LivingBackground from '@/components/background/LivingBackground.jsx';
import BootAnimation from '@/components/boot/BootAnimation.jsx';
import StatusBar from '@/components/shell/StatusBar.jsx';
import Toasts from '@/components/shell/Toasts.jsx';
import ControllerEdge from '@/components/shell/ControllerEdge.jsx';
import QuickMenu from '@/components/shell/QuickMenu.jsx';
import FaceIDSheet, { useFaceIdEvents } from '@/components/faceid/FaceIDSheet.jsx';
import LockScreen from '@/components/shell/LockScreen.jsx';
import HomeScreen from '@/components/home/HomeScreen.jsx';
import ErrorBoundary from '@/components/shell/ErrorBoundary.jsx';
import OnScreenKeyboard from '@/components/shell/OnScreenKeyboard.jsx';
import FocusLayer from '@/components/shell/FocusLayer.jsx';
import Ambient from '@/components/shell/Ambient.jsx';
import PowerWatcher from '@/components/shell/PowerWatcher.jsx';
import VirtualCursor from '@/components/shell/VirtualCursor.jsx';
import Spotlight from '@/components/shell/Spotlight.jsx';
import PerfHud from '@/components/shell/PerfHud.jsx';
import PinPrompt from '@/components/shell/PinPrompt.jsx';
import ProfilePicker, { openProfilePicker } from '@/components/shell/ProfilePicker.jsx';
import PipWindow from '@/components/shell/PipWindow.jsx';
import AutofillBar from '@/components/shell/AutofillBar.jsx';
import SeasonalLayer from '@/components/shell/SeasonalLayer.jsx';
import { pixelOffset } from '@/components/shell/Ambient.jsx';
import { startGameSession } from '@/services/gameSession.js';
import { saveClip, takeScreenshot } from '@/services/captureActions.js';
import { startFpsMeter } from '@/lib/fps.js';
import { useProfiles } from '@/store/profile.js';
import { open } from '@/store/ui.js';
import { applyUiTheme } from '@/lib/themes.js';
import { configureSounds } from '@/services/sounds.js';
import { setMotionSpeed } from '@/lib/motion.js';
import { setToastDuration } from '@/store/ui.js';
import { useUI, setBooted, setLocked } from '@/store/ui.js';
import { useSettings, startSettingsEffects } from '@/store/settings.js';
import { startSystemFeeds } from '@/store/system.js';
import { startDownloadFeeds } from '@/store/downloads.js';
import { startLibraryFeeds } from '@/store/library.js';
import { initBridge, request } from '@/services/bridge.js';
import { initCloud } from '@/services/cloud/cloudService.js';
import { useInputSystem } from '@/hooks/useInputSystem.js';
import { ensureFocus } from '@/lib/spatialNav.js';
import { screenVariants } from '@/lib/motion.js';

const SCREENS = {
  store: lazy(() => import('@/components/store/StoreScreen.jsx')),
  library: lazy(() => import('@/components/library/LibraryScreen.jsx')),
  settings: lazy(() => import('@/components/settings/SettingsScreen.jsx')),
  notes: lazy(() => import('@/components/apps/NotesApp.jsx')),
  calculator: lazy(() => import('@/components/apps/CalculatorApp.jsx')),
  keychain: lazy(() => import('@/components/keychain/KeychainApp.jsx')),
  avatar: lazy(() => import('@/components/avatar/AvatarStudio.jsx')),
  cloud: lazy(() => import('@/components/cloud/CloudScreen.jsx')),
  updater: lazy(() => import('@/components/updater/UpdaterScreen.jsx')),
  files: lazy(() => import('@/components/files/FilesScreen.jsx')),
  browser: lazy(() => import('@/components/apps/BrowserApp.jsx')),
  terminal: lazy(() => import('@/components/apps/TerminalApp.jsx')),
  taskmanager: lazy(() => import('@/components/apps/TaskManagerApp.jsx')),
  captures: lazy(() => import('@/components/apps/CapturesApp.jsx')),
  social: lazy(() => import('@/components/apps/SocialApp.jsx')),
  game: lazy(() => import('@/components/game/OrbitGame.jsx')),
};

// Global shortcuts: F10 clip (last 30 s), F11 screenshot, Strg+Alt+Entf / Strg+Umschalt+Esc task manager
function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'F10') (e.preventDefault(), saveClip());
      else if (e.code === 'F11') (e.preventDefault(), takeScreenshot());
      else if ((e.ctrlKey && e.altKey && (e.code === 'Delete' || e.code === 'Backspace')) || (e.ctrlKey && e.shiftKey && e.code === 'Escape')) {
        e.preventDefault();
        open('taskmanager');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function usePixelShift() {
  const [o, setO] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const f = (p) => setO({ x: p.x, y: p.y });
    pixelOffset.listeners.add(f);
    return () => pixelOffset.listeners.delete(f);
  }, []);
  return o;
}
const DevPanel = lazy(() => import('@/components/dev/DevPanel.jsx'));

export default function App() {
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const top = useUI((s) => s.stack.at(-1));
  const devPanel = useUI((s) => s.devPanel);
  const locked = useUI((s) => s.locked);
  const reduceMotion = useSettings((s) => s.values.reduceMotion);
  const uiScale = useSettings((s) => s.values.uiScale);
  const v = useSettings((s) => s.values);
  const navDir = useUI((s) => s.navDir);
  const transition = { style: reduceMotion ? 'fade' : v.transitionStyle, dir: navDir };
  setMotionSpeed(v.animationSpeed);

  useInputSystem();
  useFaceIdEvents();
  useGlobalShortcuts();
  const shift = usePixelShift();

  useEffect(() => {
    let offs = [];
    initBridge().then(() => {
      offs = [startSettingsEffects(), startSystemFeeds(), startDownloadFeeds(), startLibraryFeeds(), startGameSession(), startFpsMeter()];
      initCloud();
      setReady(true);
      // several profiles on this device → who's playing? (once per cold boot)
      if (useProfiles.getState().profiles.length > 1 && sessionStorage.getItem('lumos.booted') !== '1') setTimeout(openProfilePicker, 2600);
      // Face ID lock after a cold boot (only if a face is enrolled and the feature is on)
      if (useSettings.getState().values.faceIdUnlock && sessionStorage.getItem('lumos.booted') !== '1') {
        request('faceid.status')
          .then((s) => s?.available && s.models?.length && setLocked(true))
          .catch(() => {});
      }
    });
    return () => offs.forEach((f) => f?.());
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale || 1));
    document.documentElement.classList.toggle('reduce-motion', !!reduceMotion);
  }, [uiScale, reduceMotion]);

  useEffect(() => {
    applyUiTheme({ theme: v.uiTheme, glassOpacity: v.glassOpacity, glassBlur: v.glassBlur, reduceTransparency: v.reduceTransparency, highContrast: v.highContrast, boldText: v.boldText, focusStyle: v.focusStyle, lowPower: v.lowPower });
  }, [v.uiTheme, v.glassOpacity, v.glassBlur, v.reduceTransparency, v.highContrast, v.boldText, v.focusStyle, v.lowPower]);
  useEffect(() => configureSounds({ enabled: v.uiSounds, theme: v.uiSoundTheme, volume: v.uiSoundVolume }), [v.uiSounds, v.uiSoundTheme, v.uiSoundVolume]);
  useEffect(() => setToastDuration(() => useSettings.getState().values.toastDuration * 1000), []);
  useEffect(() => {
    if (v.bootAnimation === 'off') {
      setRevealed(true);
      setBoot(false);
      setBooted();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (revealed) setTimeout(() => ensureFocus(), 200);
  }, [revealed, top]);

  const Screen = top.screen === 'home' ? HomeScreen : SCREENS[top.screen];

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <LivingBackground />
      <SeasonalLayer />
      <motion.div
        className="fixed inset-0"
        style={{ x: shift.x, y: shift.y }}
        initial={{ opacity: 0, scale: 1.04, filter: 'brightness(2.2) blur(10px)' }}
        animate={revealed ? { opacity: 1, scale: 1, filter: 'brightness(1) blur(0px)', transitionEnd: { filter: 'none' } } : {}}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        {ready && (
          <>
            <StatusBar />
            <ErrorBoundary key={top.screen}>
              <AnimatePresence mode="popLayout" custom={transition}>
                <motion.div key={`${top.screen}:${JSON.stringify(top.params)}`} className="absolute inset-0" custom={transition} variants={screenVariants} initial="initial" animate="animate" exit="exit">
                  <Suspense fallback={null}>{Screen && <Screen {...top.params} />}</Suspense>
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
            <QuickMenu />
            <ControllerEdge />
            <Toasts />
            <Suspense fallback={null}>{devPanel && <DevPanel />}</Suspense>
            {locked && <LockScreen />}
            <OnScreenKeyboard />
            <Ambient />
            <PowerWatcher />
            <PerfHud />
            <PipWindow />
            <AutofillBar />
            <Spotlight />
            <ProfilePicker />
          </>
        )}
      </motion.div>
      <FaceIDSheet />
      <PinPrompt />
      <FocusLayer />
      <VirtualCursor />
      {boot && (
        <BootAnimation
          fast={reduceMotion || v.bootAnimation === 'short' || sessionStorage.getItem('lumos.booted') === '1'}
          onReveal={() => setRevealed(true)}
          onDone={() => {
            setBoot(false);
            setBooted();
            sessionStorage.setItem('lumos.booted', '1');
          }}
        />
      )}
    </MotionConfig>
  );
}
