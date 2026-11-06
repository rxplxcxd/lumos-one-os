// 3D avatar creator (React Three Fiber). Renders a 512 px portrait for the profile picture;
// alternatively an own image can be imported from USB / the file system.
import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { UserRound, Shuffle, Save, ImagePlus, FolderOpen } from 'lucide-react';
import { Screen, Hint, Button, TextField } from '@/components/ui/primitives.jsx';
import AvatarModel from './AvatarModel.jsx';
import { useProfiles, activeProfile, updateProfile, DEFAULT_AVATAR } from '@/store/profile.js';
import { useTabs } from '@/hooks/useInputSystem.js';
import { open, toast, back } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';
import { spring } from '@/lib/motion.js';

const SKIN = ['#f6d7c3', '#e8b996', '#d49a74', '#b9785a', '#8d5a3f', '#5e3b29'];
const HAIRC = ['#151417', '#2b2420', '#5a3a24', '#a0703f', '#d8b36a', '#c4c7cf', '#8f3b2f', '#3c4f8f'];
const CLOTH = ['#3d4b63', '#1f2229', '#e9ebef', '#7a2e3a', '#2f5d4a', '#c7a24a', '#5b4b8a', '#2f6fa8'];
const EYEC = ['#2d3a4f', '#3e2a1f', '#2f5a3e', '#4b6b8c', '#1b1b1f'];

const CATS = [
  { key: 'face', label: 'Gesicht' },
  { key: 'eyes', label: 'Augen' },
  { key: 'hair', label: 'Haare' },
  { key: 'style', label: 'Kleidung' },
  { key: 'extras', label: 'Extras' },
];

function Chips({ value, options, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <button key={v} data-nav="" data-nav-haptic="none" onClick={() => (haptic('toggle.on'), onChange(v))} className={`nav-focus rounded-xl px-3.5 py-2 text-[0.82rem] ${value === v ? 'bg-mist-50 font-semibold text-ink-950' : 'bg-white/[0.07] text-mist-200'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
function Swatches({ value, colors, onChange }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {colors.map((c) => (
        <motion.button key={c} data-nav="" data-nav-haptic="none" whileFocus={{ scale: 1.15 }} transition={spring.bouncy} onClick={() => (haptic('toggle.on'), onChange(c))} aria-label={c} className={`nav-focus h-9 w-9 rounded-full ${value === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''}`} style={{ background: c }} />
      ))}
    </div>
  );
}
const Field = ({ label, children }) => (
  <div className="mb-5">
    <div className="label mb-2">{label}</div>
    {children}
  </div>
);

export default function AvatarStudio() {
  const profile = useProfiles(activeProfile);
  const [a, setA] = useState({ ...DEFAULT_AVATAR, ...(profile?.avatar || {}) });
  const [name, setName] = useState(profile?.name || '');
  const [cat, setCat] = useState('face');
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const set = (k) => (v) => setA((x) => ({ ...x, [k]: v }));
  useTabs((dir) => {
    const i = CATS.findIndex((c) => c.key === cat);
    setCat(CATS[(i + dir + CATS.length) % CATS.length].key);
  }, [cat]);

  const randomize = () => {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    setA({
      ...a,
      skin: pick(SKIN), hairColor: pick(HAIRC), topColor: pick(CLOTH), eyeColor: pick(EYEC),
      hair: pick(['swoop', 'buzz', 'bob', 'spiky', 'long', 'bun', 'none']), eyes: pick(['round', 'almond', 'happy', 'sleepy']),
      brows: pick(['soft', 'straight', 'arched', 'bold']), mouth: pick(['smile', 'grin', 'neutral', 'open']), nose: pick(['button', 'pointed', 'wide']),
      glasses: pick(['none', 'none', 'round', 'square']), top: pick(['hoodie', 'tee', 'jacket']), accessory: pick(['none', 'none', 'headphones', 'cap']),
      headShape: 0.92 + Math.random() * 0.18, headWidth: 0.92 + Math.random() * 0.16,
    });
    haptic('success');
  };

  const snapshot = () => {
    const src = canvasRef.current;
    const out = document.createElement('canvas');
    out.width = out.height = 512;
    const ctx = out.getContext('2d');
    ctx.fillStyle = a.bg;
    ctx.fillRect(0, 0, 512, 512);
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2 - s * 0.04, s, s, 0, 0, 512, 512);
    return out.toDataURL('image/webp', 0.9);
  };

  const save = () => {
    updateProfile(profile.id, { name: name || profile.name, avatar: a, image: snapshot(), imageKind: 'avatar' });
    haptic('success');
    toast({ title: 'Avatar gespeichert', body: 'Wird mit Lumos Cloud synchronisiert', kind: 'success' });
    back();
  };

  const onFile = (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
      updateProfile(profile.id, { image: c.toDataURL('image/webp', 0.9), imageKind: 'upload' });
      URL.revokeObjectURL(img.src);
      toast({ title: 'Profilbild übernommen', kind: 'success' });
      haptic('success');
    };
    img.src = URL.createObjectURL(f);
  };

  return (
    <Screen
      title="Avatar-Studio"
      icon={UserRound}
      noPad
      tabs={CATS}
      tab={cat}
      onTab={setCat}
      actions={
        <>
          <Button size="sm" variant="subtle" icon={Shuffle} onClick={randomize}>Zufall</Button>
          <Button size="sm" variant="subtle" icon={ImagePlus} onClick={() => fileRef.current?.click()}>Eigenes Bild</Button>
          <Button size="sm" variant="subtle" icon={FolderOpen} onClick={() => open('files', { mode: 'avatar' })}>Von USB</Button>
          <Button size="sm" variant="primary" icon={Save} onClick={save}>Sichern</Button>
        </>
      }
      hints={<><Hint k="lb">Kategorie</Hint><Hint k="a">Auswählen</Hint><Hint k="b">Zurück</Hint></>}
    >
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex h-full gap-6 px-10 pb-14">
        <div className="relative flex-1 overflow-hidden rounded-[2rem]" style={{ background: `radial-gradient(circle at 50% 35%, ${a.bg}, #07080b 80%)` }}>
          <Canvas ref={canvasRef} dpr={[1, 2]} camera={{ position: [0, 0.1, 5.2], fov: 32 }} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}>
            <ambientLight intensity={0.45} />
            <hemisphereLight args={['#dfe7ff', '#1a1c22', 0.6]} />
            <directionalLight position={[3, 4, 5]} intensity={1.6} />
            <directionalLight position={[-4, 2, -3]} intensity={0.8} color="#9fb6ff" />
            <Suspense fallback={null}>
              <group position={[0, 0.35, 0]}>
                <AvatarModel a={a} />
              </group>
              <ContactShadows position={[0, -2.05, 0]} opacity={0.5} scale={6} blur={2.6} far={3} />
            </Suspense>
            <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} minAzimuthAngle={-0.9} maxAzimuthAngle={0.9} />
          </Canvas>
          <div className="absolute bottom-4 left-1/2 w-[18rem] -translate-x-1/2">
            <TextField value={name} onChange={setName} placeholder="Name" className="text-center" />
          </div>
        </div>
        <div className="glass w-[26rem] shrink-0 overflow-y-auto rounded-[2rem] p-6">
          <AnimatePresence mode="wait">
            <motion.div key={cat} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring.soft}>
              {cat === 'face' && (
                <>
                  <Field label="Hautton"><Swatches value={a.skin} colors={SKIN} onChange={set('skin')} /></Field>
                  <Field label="Kopfform"><Chips value={Math.round(a.headShape * 100)} options={[[92, 'Rund'], [100, 'Oval'], [108, 'Lang']]} onChange={(v) => set('headShape')(v / 100)} /></Field>
                  <Field label="Breite"><Chips value={Math.round(a.headWidth * 100)} options={[[92, 'Schmal'], [100, 'Normal'], [108, 'Breit']]} onChange={(v) => set('headWidth')(v / 100)} /></Field>
                  <Field label="Nase"><Chips value={a.nose} options={[['button', 'Knopf'], ['pointed', 'Spitz'], ['wide', 'Breit']]} onChange={set('nose')} /></Field>
                  <Field label="Mund"><Chips value={a.mouth} options={[['smile', 'Lächeln'], ['grin', 'Grinsen'], ['neutral', 'Neutral'], ['open', 'Offen']]} onChange={set('mouth')} /></Field>
                </>
              )}
              {cat === 'eyes' && (
                <>
                  <Field label="Augenform"><Chips value={a.eyes} options={[['round', 'Rund'], ['almond', 'Mandel'], ['happy', 'Fröhlich'], ['sleepy', 'Müde']]} onChange={set('eyes')} /></Field>
                  <Field label="Augenfarbe"><Swatches value={a.eyeColor} colors={EYEC} onChange={set('eyeColor')} /></Field>
                  <Field label="Augenbrauen"><Chips value={a.brows} options={[['soft', 'Weich'], ['straight', 'Gerade'], ['arched', 'Gebogen'], ['bold', 'Kräftig']]} onChange={set('brows')} /></Field>
                </>
              )}
              {cat === 'hair' && (
                <>
                  <Field label="Frisur"><Chips value={a.hair} options={[['swoop', 'Seitenscheitel'], ['buzz', 'Kurz'], ['bob', 'Bob'], ['spiky', 'Stachelig'], ['long', 'Lang'], ['bun', 'Dutt'], ['none', 'Keine']]} onChange={set('hair')} /></Field>
                  <Field label="Haarfarbe"><Swatches value={a.hairColor} colors={HAIRC} onChange={set('hairColor')} /></Field>
                </>
              )}
              {cat === 'style' && (
                <>
                  <Field label="Oberteil"><Chips value={a.top} options={[['hoodie', 'Hoodie'], ['tee', 'T-Shirt'], ['jacket', 'Jacke']]} onChange={set('top')} /></Field>
                  <Field label="Farbe"><Swatches value={a.topColor} colors={CLOTH} onChange={set('topColor')} /></Field>
                  <Field label="Hintergrund"><Swatches value={a.bg} colors={['#1c212a', '#2a1f2e', '#1d2a24', '#2b2619', '#16222f', '#26262a']} onChange={set('bg')} /></Field>
                </>
              )}
              {cat === 'extras' && (
                <>
                  <Field label="Brille"><Chips value={a.glasses} options={[['none', 'Keine'], ['round', 'Rund'], ['square', 'Eckig']]} onChange={set('glasses')} /></Field>
                  <Field label="Accessoire"><Chips value={a.accessory} options={[['none', 'Keins'], ['headphones', 'Kopfhörer'], ['cap', 'Kappe']]} onChange={set('accessory')} /></Field>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Screen>
  );
}
