// Stylised, Mii-inspired 3D character built from primitives — every part is parametric.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { gyro } from '@/store/system.js';

const M = ({ color, rough = 0.55, metal = 0, ...p }) => <meshStandardMaterial color={color} roughness={rough} metalness={metal} {...p} />;

function Eyes({ a }) {
  const y = 0.12;
  const x = 0.27;
  if (a.eyes === 'happy')
    return [-x, x].map((px) => (
      <mesh key={px} position={[px, y, 0.83]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.08, 0.022, 12, 24, Math.PI]} />
        <M color="#1d1d22" />
      </mesh>
    ));
  const sy = a.eyes === 'almond' ? 0.7 : a.eyes === 'sleepy' ? 0.45 : 1;
  return [-x, x].map((px) => (
    <group key={px} position={[px, y, 0.8]}>
      <mesh scale={[1, sy, 0.6]}>
        <sphereGeometry args={[0.105, 24, 24]} />
        <M color="#fbfbfd" rough={0.25} />
      </mesh>
      <mesh position={[0, -0.005, 0.06]} scale={[1, sy, 0.6]}>
        <sphereGeometry args={[0.065, 24, 24]} />
        <M color={a.eyeColor} rough={0.2} />
      </mesh>
      <mesh position={[0.02, 0.025 * sy, 0.1]}>
        <sphereGeometry args={[0.016, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {a.eyes === 'sleepy' && (
        <mesh position={[0, 0.045, 0.02]} scale={[1.1, 0.5, 0.7]}>
          <sphereGeometry args={[0.11, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <M color={a.skin} />
        </mesh>
      )}
    </group>
  ));
}

function Brows({ a }) {
  const [tilt, r] = { soft: [0.06, 0.025], straight: [0, 0.022], arched: [0.25, 0.024], bold: [0.08, 0.04] }[a.brows] || [0.06, 0.025];
  return [-1, 1].map((s) => (
    <mesh key={s} position={[0.27 * s, 0.31, 0.83]} rotation={[0, 0, Math.PI / 2 - s * tilt]}>
      <capsuleGeometry args={[r, 0.12, 6, 12]} />
      <M color={a.hairColor} />
    </mesh>
  ));
}

function Nose({ a }) {
  if (a.nose === 'pointed')
    return (
      <mesh position={[0, -0.04, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.06, 0.16, 20]} />
        <M color={a.skin} />
      </mesh>
    );
  return (
    <mesh position={[0, -0.04, 0.88]} scale={a.nose === 'wide' ? [1.5, 0.9, 0.9] : [1, 1, 1]}>
      <sphereGeometry args={[0.07, 20, 20]} />
      <M color={a.skin} />
    </mesh>
  );
}

function Mouth({ a }) {
  if (a.mouth === 'open')
    return (
      <mesh position={[0, -0.25, 0.83]} scale={[1, 0.7, 0.4]}>
        <sphereGeometry args={[0.08, 20, 20]} />
        <M color="#4a1f25" />
      </mesh>
    );
  if (a.mouth === 'neutral')
    return (
      <mesh position={[0, -0.25, 0.84]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.016, 0.14, 6, 12]} />
        <M color="#5a2a2f" />
      </mesh>
    );
  return (
    <mesh position={[0, -0.21, 0.83]} rotation={[0, 0, Math.PI]}>
      <torusGeometry args={[a.mouth === 'grin' ? 0.14 : 0.11, a.mouth === 'grin' ? 0.03 : 0.02, 12, 32, Math.PI]} />
      <M color="#5a2a2f" />
    </mesh>
  );
}

function Hair({ a }) {
  const c = a.hairColor;
  const cap = (
    <mesh position={[0, 0.12, -0.02]} scale={[1.06, 1.0, 1.06]}>
      <sphereGeometry args={[0.92, 40, 40, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
      <M color={c} rough={0.7} />
    </mesh>
  );
  switch (a.hair) {
    case 'none':
      return null;
    case 'buzz':
      return (
        <mesh position={[0, 0.06, 0]} scale={[1.02, 1.0, 1.02]}>
          <sphereGeometry args={[0.92, 40, 40, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
          <M color={c} rough={0.9} />
        </mesh>
      );
    case 'bob':
      return (
        <group>
          {cap}
          <mesh position={[0, -0.12, -0.08]}>
            <cylinderGeometry args={[0.98, 0.9, 0.7, 40, 1, true, Math.PI * 0.18, Math.PI * 1.64]} />
            <M color={c} rough={0.7} side={2} />
          </mesh>
        </group>
      );
    case 'spiky':
      return (
        <group>
          {cap}
          {Array.from({ length: 9 }, (_, i) => {
            const ang = (i / 9) * Math.PI - Math.PI / 2;
            return (
              <mesh key={i} position={[Math.sin(ang) * 0.5, 0.85, Math.cos(ang) * 0.2 - 0.1]} rotation={[0.2, 0, -Math.sin(ang) * 0.6]}>
                <coneGeometry args={[0.16, 0.42, 12]} />
                <M color={c} rough={0.7} />
              </mesh>
            );
          })}
        </group>
      );
    case 'long':
      return (
        <group>
          {cap}
          <mesh position={[0, -0.45, -0.45]}>
            <capsuleGeometry args={[0.62, 0.9, 8, 24]} />
            <M color={c} rough={0.7} />
          </mesh>
        </group>
      );
    case 'bun':
      return (
        <group>
          {cap}
          <mesh position={[0, 1.0, -0.25]}>
            <sphereGeometry args={[0.3, 28, 28]} />
            <M color={c} rough={0.7} />
          </mesh>
        </group>
      );
    default: // swoop
      return (
        <group>
          {cap}
          <mesh position={[0.25, 0.6, 0.55]} rotation={[0.9, 0.2, -0.5]} scale={[1.4, 0.5, 0.7]}>
            <sphereGeometry args={[0.35, 28, 28]} />
            <M color={c} rough={0.7} />
          </mesh>
        </group>
      );
  }
}

function Glasses({ a }) {
  if (a.glasses === 'none') return null;
  const frame = '#15161a';
  return (
    <group position={[0, 0.12, 0.9]}>
      {[-0.27, 0.27].map((x) =>
        a.glasses === 'round' ? (
          <mesh key={x} position={[x, 0, 0]}>
            <torusGeometry args={[0.15, 0.018, 12, 40]} />
            <M color={frame} rough={0.3} metal={0.4} />
          </mesh>
        ) : (
          <group key={x} position={[x, 0, 0]}>
            {[[0, 0.12, 0.34, 0.03], [0, -0.12, 0.34, 0.03], [-0.16, 0, 0.03, 0.27], [0.16, 0, 0.03, 0.27]].map(([px, py, w, h], i) => (
              <mesh key={i} position={[px, py, 0]}>
                <boxGeometry args={[w, h, 0.03]} />
                <M color={frame} rough={0.3} />
              </mesh>
            ))}
          </group>
        ),
      )}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.12, 0.025, 0.02]} />
        <M color={frame} />
      </mesh>
    </group>
  );
}

export function Accessory({ a }) {
  if (a.accessory === 'headphones')
    return (
      <group position={[0, 0.15, 0]}>
        <mesh rotation={[0, 0, 0]}>
          <torusGeometry args={[1.0, 0.05, 12, 48, Math.PI]} />
          <M color="#22252c" rough={0.35} metal={0.3} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.98, -0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.22, 0.22, 0.14, 32]} />
            <M color="#2a2e36" rough={0.4} />
          </mesh>
        ))}
      </group>
    );
  if (a.accessory === 'cap')
    return (
      <group position={[0, 0.25, 0]}>
        <mesh scale={[1.08, 0.9, 1.08]}>
          <sphereGeometry args={[0.93, 40, 40, 0, Math.PI * 2, 0, Math.PI / 2.3]} />
          <M color={a.topColor} rough={0.8} />
        </mesh>
        <mesh position={[0, 0.0, 0.85]} rotation={[-0.15, 0, 0]} scale={[1, 0.08, 0.7]}>
          <cylinderGeometry args={[0.55, 0.55, 0.3, 32, 1, false, -Math.PI / 2, Math.PI]} />
          <M color={a.topColor} rough={0.8} />
        </mesh>
      </group>
    );
  if (a.accessory === 'crown')
    return (
      <group position={[0, 0.88, 0]}>
        <mesh>
          <cylinderGeometry args={[0.42, 0.46, 0.22, 8, 1, true]} />
          <M color="#e6b94a" metal={0.85} rough={0.25} side={2} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[Math.sin((i / 8) * Math.PI * 2) * 0.43, 0.2, Math.cos((i / 8) * Math.PI * 2) * 0.43]}>
            <coneGeometry args={[0.07, 0.2, 4]} />
            <M color="#e6b94a" metal={0.85} rough={0.25} />
          </mesh>
        ))}
        <mesh position={[0, 0.02, 0.45]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <M color="#c22a4a" metal={0.2} rough={0.1} />
        </mesh>
      </group>
    );
  if (a.accessory === 'santa')
    return (
      <group position={[0, 0.74, 0]}>
        <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.8, 0.14, 16, 48]} />
          <M color="#f4f4f4" rough={1} />
        </mesh>
        <mesh position={[0.15, 0.55, -0.05]} rotation={[0, 0, -0.35]}>
          <coneGeometry args={[0.84, 1.15, 40]} />
          <M color="#c4202c" rough={0.85} />
        </mesh>
        <mesh position={[0.55, 1.0, -0.05]}>
          <sphereGeometry args={[0.14, 20, 20]} />
          <M color="#f4f4f4" rough={1} />
        </mesh>
      </group>
    );
  if (a.accessory === 'witch')
    return (
      <group position={[0, 0.66, 0]}>
        <mesh rotation={[0.05, 0, 0]}>
          <cylinderGeometry args={[1.35, 1.35, 0.04, 48]} />
          <M color="#1d1424" rough={0.8} />
        </mesh>
        <mesh position={[0, 0.62, -0.05]} rotation={[-0.12, 0, 0.08]}>
          <coneGeometry args={[0.62, 1.3, 40]} />
          <M color="#1d1424" rough={0.8} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.63, 0.65, 0.12, 40]} />
          <M color="#ff8a2a" rough={0.5} />
        </mesh>
      </group>
    );
  if (a.accessory === 'bunny')
    return (
      <group position={[0, 0.8, 0]}>
        {[-1, 1].map((sd) => (
          <group key={sd} position={[sd * 0.32, 0.45, -0.05]} rotation={[0, 0, sd * -0.18]}>
            <mesh scale={[0.18, 0.62, 0.08]}>
              <sphereGeometry args={[1, 24, 24]} />
              <M color="#f2eef0" rough={0.9} />
            </mesh>
            <mesh position={[0, 0, 0.05]} scale={[0.1, 0.48, 0.04]}>
              <sphereGeometry args={[1, 20, 20]} />
              <M color="#f1a7bd" rough={0.9} />
            </mesh>
          </group>
        ))}
      </group>
    );
  if (a.accessory === 'halo')
    return (
      <mesh position={[0, 1.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.05, 16, 48]} />
        <M color="#ffe58a" emissive="#ffd34d" emissiveIntensity={1.4} rough={0.3} />
      </mesh>
    );
  if (a.accessory === 'horns')
    return (
      <group position={[0, 0.7, 0]}>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * 0.42, 0.18, 0.05]} rotation={[0, 0, sd * -0.45]}>
            <coneGeometry args={[0.12, 0.45, 20]} />
            <M color="#8a1620" rough={0.35} />
          </mesh>
        ))}
      </group>
    );
  return null;
}

function Body({ a }) {
  return (
    <group position={[0, -1.45, 0]}>
      <mesh scale={[1.25, 1, 0.9]}>
        <capsuleGeometry args={[0.55, 0.5, 12, 32]} />
        <M color={a.top === 'astronaut' ? '#eceef2' : a.topColor} rough={a.top === 'jacket' ? 0.4 : 0.85} />
      </mesh>
      {a.top === 'hoodie' && (
        <mesh position={[0, 0.62, -0.18]} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.45, 0.13, 16, 40]} />
          <M color={a.topColor} rough={0.85} />
        </mesh>
      )}
      {a.top === 'suit' && (
        <>
          <mesh position={[0, 0.2, 0.52]} rotation={[0.1, 0, 0]}>
            <coneGeometry args={[0.18, 0.7, 3]} />
            <M color="#f1f2f4" rough={0.6} />
          </mesh>
          <mesh position={[0, 0.25, 0.6]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.06, 0.5, 4]} />
            <M color="#8f1d2c" rough={0.5} />
          </mesh>
        </>
      )}
      {a.top === 'armor' && (
        <>
          <mesh position={[0, 0.1, 0.12]} scale={[1.3, 1.02, 0.95]}>
            <capsuleGeometry args={[0.56, 0.42, 8, 24]} />
            <M color="#9aa3b2" metal={0.9} rough={0.25} />
          </mesh>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[sd * 0.78, 0.55, 0]} scale={[1, 0.6, 1]}>
              <sphereGeometry args={[0.3, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <M color="#7d8696" metal={0.9} rough={0.3} />
            </mesh>
          ))}
        </>
      )}
      {a.top === 'astronaut' && (
        <>
          <mesh position={[0, 0.1, 0.5]}>
            <boxGeometry args={[0.45, 0.32, 0.08]} />
            <M color="#d8dbe2" rough={0.5} />
          </mesh>
          <mesh position={[0.1, 0.12, 0.55]}>
            <boxGeometry args={[0.08, 0.08, 0.02]} />
            <M color="#3fa66b" emissive="#3fa66b" emissiveIntensity={1} />
          </mesh>
          <mesh position={[0, 1.5, 0]}>
            <sphereGeometry args={[1.28, 48, 48]} />
            <meshPhysicalMaterial color="#cfe3ff" transmission={0.9} roughness={0.05} thickness={0.1} transparent opacity={0.35} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <torusGeometry args={[0.6, 0.12, 16, 40]} />
            <M color="#e8eaee" rough={0.5} />
          </mesh>
        </>
      )}
      {a.top === 'jacket' && (
        <mesh position={[0, 0.05, 0.5]}>
          <boxGeometry args={[0.04, 1.0, 0.02]} />
          <M color="#c9ced8" metal={0.6} rough={0.3} />
        </mesh>
      )}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.22, 0.26, 0.3, 24]} />
        <M color={a.skin} />
      </mesh>
    </group>
  );
}

export default function AvatarModel({ a }) {
  const root = useRef();
  const head = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!root.current) return;
    const gx = Math.max(-1, Math.min(1, gyro.roll / 25));
    const gy = Math.max(-1, Math.min(1, gyro.pitch / 25));
    root.current.position.y = Math.sin(t * 1.6) * 0.03;
    head.current.rotation.y += ((gx * 0.5 + Math.sin(t * 0.5) * 0.12) - head.current.rotation.y) * 0.08;
    head.current.rotation.x += ((-gy * 0.25) - head.current.rotation.x) * 0.08;
    head.current.rotation.z = Math.sin(t * 0.9) * 0.025;
  });
  return (
    <group ref={root}>
      <Body a={a} />
      <group ref={head}>
        <mesh scale={[a.headWidth, a.headShape, 1]}>
          <sphereGeometry args={[0.9, 64, 64]} />
          <M color={a.skin} rough={0.6} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.88 * a.headWidth, 0.02, 0]} scale={[0.5, 1, 0.8]}>
            <sphereGeometry args={[0.17, 20, 20]} />
            <M color={a.skin} />
          </mesh>
        ))}
        <group scale={[a.headWidth, 1, 1]}>
          <Eyes a={a} />
          <Brows a={a} />
          <Nose a={a} />
          <Mouth a={a} />
          <Glasses a={a} />
        </group>
        <group scale={[a.headWidth, a.headShape, 1]}>
          <Hair a={a} />
          <Accessory a={a} />
        </group>
      </group>
    </group>
  );
}
