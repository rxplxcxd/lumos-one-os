// Battery warnings (20 % → 10 % → 1–2 % critical with safe shutdown) and Energiesparmodus logic.
// Low power is real: 60 Hz panel + FPS cap, silent 8 W profile, dimmer panel (daemon), plus a
// lighter shell (30 fps wallpaper at half resolution, no blur/ripples).
import { useEffect, useRef } from 'react';
import { useSystem } from '@/store/system.js';
import { useSettings, setSetting } from '@/store/settings.js';
import { toast, dismissToast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { request } from '@/services/bridge.js';

const STAGES = [
  { at: 20, kind: 'battery', title: 'Batteriestand niedrig', body: (p) => `${p} % verbleibend`, haptic: 'notify' },
  { at: 10, kind: 'battery', title: 'Energiesparmodus empfohlen', body: (p) => `Nur noch ${p} % – Leistung wird reduziert, wenn du ihn aktivierst`, haptic: 'error' },
  { at: 2, kind: 'critical', title: 'Kritischer Akkustand', body: () => 'Das System fährt in Kürze sicher herunter – Netzteil anschließen', haptic: 'faceid.fail' },
];

export default function PowerWatcher() {
  const battery = useSystem((s) => s.battery);
  const warned = useRef(new Set());
  const shutdown = useRef(null);

  useEffect(() => {
    const { percent, charging } = battery;
    if (percent == null) return;
    const v = useSettings.getState().values;
    const p = Math.round(percent);
    // re-arm thresholds once the battery recovers
    for (const st of STAGES) if (charging || p > st.at + 3) warned.current.delete(st.at);
    if (charging) {
      if (shutdown.current) {
        clearTimeout(shutdown.current.timer);
        dismissToast(shutdown.current.toast);
        shutdown.current = null;
        toast({ title: 'Netzteil erkannt', body: 'Herunterfahren abgebrochen', kind: 'success' });
      }
      if (v.lowPower && p >= 80) {
        setSetting('lowPower', false); // like iOS: low power turns off at 80 % while charging
        toast({ title: 'Energiesparmodus aus', body: 'Akku bei 80 % geladen', kind: 'success' });
      }
      return;
    }
    if (!v.batteryWarnings) return;
    const stage = [...STAGES].reverse().find((st) => p <= st.at && !warned.current.has(st.at));
    if (!stage) return;
    STAGES.filter((st) => st.at >= stage.at).forEach((st) => warned.current.add(st.at));
    haptic(stage.haptic);
    const actions = useSettings.getState().values.lowPower ? undefined : [{ label: 'Energiesparen', primary: true, run: () => setSetting('lowPower', true) }];
    const id = toast({ title: stage.title, body: stage.body(p), kind: stage.kind, actions: stage.at === 2 ? undefined : actions, duration: stage.at === 2 ? 60000 : 9000 });
    if (stage.at <= 10 && !useSettings.getState().values.lowPower) setSetting('lowPower', true);
    if (stage.at === 2 && v.autoShutdownCritical && !shutdown.current) {
      shutdown.current = {
        toast: id,
        timer: setTimeout(() => {
          shutdown.current = null;
          request('system.power', { action: 'shutdown' }).catch(() => {});
        }, 60000),
      };
    }
  }, [battery]);

  return null;
}
