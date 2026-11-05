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
    if (revealed) setTimeout(() => ensureFocus(), 200);
  }, [revealed, top]);

  const Screen = top.screen === 'home' ? HomeScreen : SCREENS[top.screen];

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <LivingBackground />
      <motion.div
        className="fixed inset-0"
        initial={{ opacity: 0, scale: 1.04, filter: 'brightness(2.2) blur(10px)' }}
        animate={revealed ? { opacity: 1, scale: 1, filter: 'brightness(1) blur(0px)' } : {}}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        {ready && (
          <>
            <StatusBar />
            <ErrorBoundary key={top.screen}>
              <AnimatePresence mode="popLayout">
                <motion.div key={`${top.screen}:${JSON.stringify(top.params)}`} className="absolute inset-0" variants={screenVariants} initial="initial" animate="animate" exit="exit">
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
          </>
        )}
      </motion.div>
      <FaceIDSheet />
      {boot && (
        <BootAnimation
          fast={reduceMotion || sessionStorage.getItem('lumos.booted') === '1'}
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
