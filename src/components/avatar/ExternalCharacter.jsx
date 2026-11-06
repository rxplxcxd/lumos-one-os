// External 3D characters for the avatar studio: free glTF/GLB models loaded at runtime from a
// public CDN (cached on the device via the Cache API, so they work offline afterwards) or
// imported by the user (stored in IndexedDB). Supports recolouring, the model's own animation
// clips as emotes, and Lumos accessories attached to the head bone.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, createPortal } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { Box3, Color, LoopOnce, Quaternion, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { gyro } from '@/store/system.js';
import { Accessory } from './AvatarModel.jsx';

export const CATALOG = [
  {
    id: 'robot',
    name: 'Expressive Robot',
    urls: [
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
      'https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    ],
    credit: 'Tomás Laulhé (Quaternius) · CC0',
    idle: 'Idle',
    hide: ['Death', 'Sitting', 'Standing', 'Walking', 'Running', 'Idle'],
  },
  {
    id: 'fox',
    name: 'Fuchs',
    urls: [
      'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Fox/glTF-Binary/Fox.glb',
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb',
    ],
    credit: 'PixelMannen (CC0) · Rig: tomkranis (CC BY 4.0)',
    idle: 'Survey',
    rotY: 0.6,
    accScale: 1.6,
    accDrop: 1.1,
  },
];

// ---- local storage of downloaded / imported models --------------------------------------
const CACHE = 'lumos-avatar-models-v1';
const DB = 'lumos-avatars';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('models', mode);
    const out = fn(t.objectStore('models'));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
};

export async function importModel(file) {
  if (!/\.(glb|gltf)$/i.test(file.name) && file.type !== 'model/gltf-binary') throw new Error('Bitte eine .glb-Datei wählen');
  if (file.size > 40e6) throw new Error('Modell ist größer als 40 MB');
  const id = `custom-${Date.now().toString(36)}`;
  await tx('readwrite', (s) => s.put({ name: file.name.replace(/\.(glb|gltf)$/i, ''), blob: file, added: Date.now() }, id));
  return id;
}
export async function listImported() {
  const keys = await tx('readonly', (s) => s.getAllKeys()).catch(() => []);
  const vals = await tx('readonly', (s) => s.getAll()).catch(() => []);
  return keys.map((k, i) => ({ id: k, name: vals[i]?.name || k }));
}
export const deleteImported = (id) => tx('readwrite', (s) => s.delete(id));

/** Resolves a model id to an object URL (download → Cache API, or IndexedDB for imports). */
export async function resolveModel(id, onProgress) {
  if (id.startsWith('custom-')) {
    const rec = await tx('readonly', (s) => s.get(id));
    if (!rec) throw new Error('Importiertes Modell nicht gefunden');
    return URL.createObjectURL(rec.blob);
  }
  const entry = CATALOG.find((c) => c.id === id);
  if (!entry) throw new Error('Unbekanntes Modell');
  let res = null;
  const key = `https://lumos.local/avatar-models/${entry.id}.glb`; // stable cache key across mirrors
  const cache = 'caches' in window ? await caches.open(CACHE).catch(() => null) : null;
  if (cache) res = await cache.match(key);
  if (!res) {
    let r = null;
    let lastErr = null;
    for (const u of entry.urls) {
      try {
        r = await fetch(u);
        if (r.ok) break;
        lastErr = new Error(`HTTP ${r.status}`);
      } catch (e) {
        lastErr = e;
      }
      r = null;
    }
    if (!r) throw new Error(`Download fehlgeschlagen (${lastErr?.message || 'offline'})`);
    const total = Number(r.headers.get('content-length')) || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(total ? got / total : null);
    }
    const blob = new Blob(chunks, { type: 'model/gltf-binary' });
    res = new Response(blob, { headers: { 'content-type': 'model/gltf-binary' } });
    await cache?.put(key, res.clone()).catch(() => {});
  }
  return URL.createObjectURL(await res.blob());
}
export async function isCached(id) {
  const entry = CATALOG.find((c) => c.id === id);
  if (!entry || !('caches' in window)) return false;
  const cache = await caches.open(CACHE).catch(() => null);
  return !!(cache && (await cache.match(`https://lumos.local/avatar-models/${entry.id}.glb`)));
}

// ---- renderer ----------------------------------------------------------------------------
const TARGET_H = 2.75; // world units – the whole figure fits the portrait camera
const FLOOR = -1.55;

export default function ExternalCharacter({ url, entry, a, emote, onClips }) {
  const gltf = useGLTF(url, false, false); // no Draco/Meshopt: avoids remote decoders and WASM under the CSP
  // clone + measure while still detached (world = model space): height, head bone scale, meshes
  const { scene, fit, head, meshes } = useMemo(() => {
    const sc0 = cloneSkinned(gltf.scene);
    sc0.updateMatrixWorld(true);
    const size = new Box3().setFromObject(sc0).getSize(new Vector3());
    const box = new Box3().setFromObject(sc0);
    const s = TARGET_H / Math.max(0.001, size.y, size.x * 0.8, size.z * 0.8); // long animals fit too
    const ms = [];
    const heads = [];
    sc0.traverse((o) => {
      if (o.isMesh) ms.push(o);
      if (/head/i.test(o.name) && !/end|top|tip/i.test(o.name)) heads.push(o);
    });
    const h = heads.find((o) => o.isBone) || heads[0] || null; // prefer the skeleton's head bone
    // accessories are modelled for a 0.9-radius head centred at the origin: place them just
    // below the model's top above the head bone, upright in world space, following the bone
    let acc = null;
    if (h) {
      const hp = h.getWorldPosition(new Vector3());
      const ws = h.getWorldScale(new Vector3()).x || 1;
      const r = Math.min(size.y * 0.22, Math.max(size.y * 0.06, (box.max.y - hp.y) * 0.5)) * (entry?.accScale || 1);
      const centre = new Vector3(hp.x, box.max.y - r * (entry?.accDrop ?? 1), hp.z);
      acc = { pos: h.worldToLocal(centre.clone()).toArray(), quat: h.getWorldQuaternion(new Quaternion()).invert().toArray(), scale: r / 0.9 / ws };
    }
    return { scene: sc0, head: h, meshes: ms, fit: { s, y: FLOOR - box.min.y * s, acc } };
  }, [gltf.scene, entry]);
  const root = useRef();
  const { actions, names } = useAnimations(gltf.animations, scene);
  const originals = useRef(new Map());

  useEffect(() => onClips?.(names), [names, onClips]);

  // tint: multiply every material's base colour (original kept for "Original")
  useEffect(() => {
    meshes.forEach((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m?.color) return;
        if (!originals.current.has(m)) originals.current.set(m, m.color.clone());
        m.color.copy(originals.current.get(m));
        if (a.extTint && a.extTint !== 'original') m.color.multiply(new Color(a.extTint)).multiplyScalar(1.5);
      });
    });
  }, [meshes, a.extTint]);

  // animation: emote plays once, then back to the idle loop
  useEffect(() => {
    const idle = actions[entry?.idle] || actions[names.find((n) => /idle|survey|breath/i.test(n))] || actions[names[0]];
    const play = emote && actions[emote.split('#')[0]];
    Object.values(actions).forEach((x) => x?.fadeOut(0.25));
    if (play && play !== idle) {
      play.reset().setLoop(LoopOnce, 1).fadeIn(0.25).play();
      play.clampWhenFinished = true;
      const t = setTimeout(() => (play.fadeOut(0.3), idle?.reset().fadeIn(0.35).play()), Math.min(6000, (play.getClip().duration || 2) * 1000));
      return () => clearTimeout(t);
    }
    idle?.reset().fadeIn(0.3).play();
    return undefined;
  }, [actions, names, emote, entry]);

  useFrame(() => {
    if (!root.current) return;
    const gx = Math.max(-1, Math.min(1, gyro.roll / 25));
    root.current.rotation.y += ((entry?.rotY || 0) + gx * 0.5 - root.current.rotation.y) * 0.06;
  });

  return (
    <group ref={root}>
      <group position={[0, fit.y, 0]} scale={fit.s}>
        <primitive object={scene} />
      </group>
      {head && fit.acc && a.accessory && a.accessory !== 'none' &&
        createPortal(
          <group position={fit.acc.pos} quaternion={fit.acc.quat} scale={fit.acc.scale}>
            <Accessory a={a} />
          </group>,
          head,
        )}
    </group>
  );
}
