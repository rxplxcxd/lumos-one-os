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
};
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

  useEffect(() => {
    let offs = [];
    initBridge().then(() => {
      offs = [startSettingsEffects(), startSystemFeeds(), startDownloadFeeds(), startLibraryFeeds()];
      initCloud();
      setReady(true);
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
    applyUiTheme({ theme: v.uiTheme, glassOpacity: v.glassOpacity, glassBlur: v.glassBlur, reduceTransparency: v.reduceTransparency, highContrast: v.highContrast, boldText: v.boldText, focusStyle: v.focusStyle });
  }, [v.uiTheme, v.glassOpacity, v.glassBlur, v.reduceTransparency, v.highContrast, v.boldText, v.focusStyle]);
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
      <motion.div
        className="fixed inset-0"
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
          </>
        )}
      </motion.div>
      <FaceIDSheet />
      <FocusLayer />
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
