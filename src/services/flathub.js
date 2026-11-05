// Flathub REST API v2 client (https://flathub.org/api/v2). In Electron requests go through the
// main process (no CORS, on-disk cache, offline fallback); in a browser they go direct with a
// localStorage cache. All responses are normalised into stable shapes for the store UI.
const BASE = 'https://flathub.org/api/v2';
const memo = new Map();

export const STORE_CATEGORIES = [
  { key: 'discover', label: 'Entdecken' },
  { key: 'games', label: 'Spiele', category: 'Game' },
  { key: 'emulators', label: 'Emulatoren', category: 'Game', sub: 'Emulator', search: 'emulator' },
  { key: 'media', label: 'Medien', category: 'AudioVideo' },
  { key: 'tools', label: 'Werkzeuge', category: 'Utility' },
  { key: 'browsers', label: 'Browser', category: 'Network', sub: 'WebBrowser', search: 'web browser' },
];

/** Hand-picked titles that work great on a controller-first handheld. */
export const HANDHELD_PICKS = [
  'com.valvesoftware.Steam',
  'org.libretro.RetroArch',
  'com.heroicgameslauncher.hgl',
  'org.DolphinEmu.dolphin-emu',
  'org.ppsspp.PPSSPP',
  'net.pcsx2.PCSX2',
  'com.moonlight_stream.Moonlight',
  'net.lutris.Lutris',
  'tv.kodi.Kodi',
  'org.prismlauncher.PrismLauncher',
  'net.davidotek.pupgui2',
  'com.github.tchx84.Flatseal',
];

async function raw(path, { method = 'GET', body, ttl = 15 * 60e3 } = {}) {
  const key = `${method} ${path} ${body ? JSON.stringify(body) : ''}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;

  let v;
  if (window.lumos?.flathub) {
    v = await window.lumos.flathub({ path, method, body, ttl });
  } else {
    const lsKey = `fh:${key}`;
    try {
      const cached = JSON.parse(localStorage.getItem(lsKey) || 'null');
      if (cached && Date.now() - cached.t < ttl) {
        memo.set(key, cached);
        return cached.v;
      }
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Flathub antwortet mit ${res.status}`);
      v = await res.json();
      try {
        localStorage.setItem(lsKey, JSON.stringify({ t: Date.now(), v }));
      } catch {
        /* quota */
      }
    } catch (err) {
      const stale = JSON.parse(localStorage.getItem(lsKey) || 'null');
      if (stale) return stale.v;
      throw err;
    }
  }
  memo.set(key, { t: Date.now(), v });
  return v;
}

const asBool = (x) => x === true || x === 'true';

export function normalizeHit(h) {
  const id = h.app_id || h.flatpakAppId || (h.id ? String(h.id).replace(/_/g, '.') : '');
  return {
    id,
    name: h.name || id,
    summary: h.summary || '',
    icon: h.icon || h.iconDesktopUrl || iconUrl(id),
    developer: h.developer_name || h.developerName || '',
    installs: h.installs_last_month ?? null,
    verified: asBool(h.verification_verified),
    categories: h.main_categories ? [].concat(h.main_categories) : h.categories || [],
    subcategories: h.sub_categories ? [].concat(h.sub_categories) : [],
    updatedAt: h.updated_at ? h.updated_at * 1000 : null,
  };
}

function hitsOf(data) {
  if (Array.isArray(data)) return data;
  return data?.hits || data?.results || [];
}

export const iconUrl = (id) => `https://dl.flathub.org/repo/appstream/x86_64/icons/128x128/${id}.png`;

export async function collection(kind = 'popular', { page = 1, perPage = 24 } = {}) {
  const d = await raw(`/collection/${kind}?page=${page}&per_page=${perPage}`);
  return { items: hitsOf(d).map(normalizeHit), total: d?.totalHits ?? null, pages: d?.totalPages ?? null };
}

export async function search(query, { page = 1, perPage = 30 } = {}) {
  if (!query?.trim()) return { items: [], total: 0 };
  const d = await raw('/search', { method: 'POST', body: { query: query.trim(), hits_per_page: perPage, page }, ttl: 5 * 60e3 });
  return { items: hitsOf(d).map(normalizeHit), total: d?.totalHits ?? null };
}

export async function category(cat, { page = 1, perPage = 30 } = {}) {
  const c = typeof cat === 'string' ? STORE_CATEGORIES.find((x) => x.key === cat) : cat;
  if (!c?.category) return collection('popular', { page, perPage });
  if (c.sub) {
    try {
      const d = await raw(`/collection/category/${c.category}/subcategories/${c.sub}?page=${page}&per_page=${perPage}`);
      const items = hitsOf(d).map(normalizeHit);
      if (items.length) return { items, total: d?.totalHits ?? null };
    } catch {
      /* fall through to search */
    }
    const r = await search(c.search || c.sub, { page, perPage });
    const filtered = r.items.filter((x) => !x.categories.length || x.categories.includes(c.category));
    return { items: filtered.length ? filtered : r.items, total: r.total };
  }
  const d = await raw(`/collection/category/${c.category}?page=${page}&per_page=${perPage}`);
  return { items: hitsOf(d).map(normalizeHit), total: d?.totalHits ?? null };
}

function pickScreenshot(s, maxW = 1600) {
  if (!s) return null;
  if (typeof s === 'string') return { src: s, w: 0, h: 0 };
  let entries = [];
  const sizes = s.sizes ?? s;
  if (Array.isArray(sizes)) entries = sizes.map((x) => ({ src: x.src || x.url, w: +x.width || 0, h: +x.height || 0 }));
  else if (sizes && typeof sizes === 'object') {
    entries = Object.entries(sizes)
      .filter(([k, v]) => /^\d+x\d+$/.test(k) && typeof v === 'string')
      .map(([k, v]) => {
        const [w, h] = k.split('x').map(Number);
        return { src: v, w, h };
      });
  }
  if (!entries.length && s.src) return { src: s.src, w: 0, h: 0, caption: s.caption };
  entries.sort((a, b) => a.w - b.w);
  const best = entries.filter((e) => e.w <= maxW).at(-1) || entries[0];
  return best ? { ...best, caption: s.caption || '' } : null;
}

/** Converts AppStream HTML description into safe text blocks (no innerHTML from the network). */
export function descriptionBlocks(html = '') {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const blocks = [];
  doc.body.firstChild.childNodes.forEach((n) => {
    if (n.nodeType === 3 && n.textContent.trim()) blocks.push({ type: 'p', text: n.textContent.trim() });
    else if (n.nodeName === 'P') blocks.push({ type: 'p', text: n.textContent.trim() });
    else if (n.nodeName === 'UL' || n.nodeName === 'OL') n.querySelectorAll('li').forEach((li) => blocks.push({ type: 'li', text: li.textContent.trim() }));
  });
  return blocks.filter((b) => b.text);
}

export async function appDetails(id) {
  const [a, summary, stats] = await Promise.all([
    raw(`/appstream/${encodeURIComponent(id)}`, { ttl: 60 * 60e3 }),
    raw(`/summary/${encodeURIComponent(id)}`, { ttl: 60 * 60e3 }).catch(() => null),
    raw(`/stats/${encodeURIComponent(id)}`, { ttl: 60 * 60e3 }).catch(() => null),
  ]);
  if (!a) throw new Error('App nicht gefunden');
  const shots = (a.screenshots || []).map((s) => pickScreenshot(s)).filter(Boolean);
  const release = Array.isArray(a.releases) ? a.releases[0] : null;
  return {
    id: a.id || id,
    name: a.name || id,
    summary: a.summary || '',
    developer: a.developer_name || a.developer?.name || '',
    icon: a.icon || a.icons?.at?.(-1)?.url || iconUrl(id),
    description: descriptionBlocks(a.description),
    screenshots: shots,
    license: a.project_license || '',
    categories: a.categories || [],
    homepage: a.urls?.homepage || '',
    version: release?.version || '',
    releaseDate: release?.timestamp ? Number(release.timestamp) * 1000 : null,
    releaseNotes: descriptionBlocks(release?.description || ''),
    downloadSize: summary?.download_size ?? null,
    installedSize: summary?.installed_size ?? null,
    installs: stats?.installs_total ?? stats?.installs_last_month ?? null,
    verified: asBool(a.metadata?.['flathub::verification::verified']),
    contentRating: a.content_rating?.type ? a.content_rating : null,
  };
}

export async function picks() {
  const out = await Promise.allSettled(HANDHELD_PICKS.map((id) => raw(`/appstream/${id}`, { ttl: 6 * 60 * 60e3 })));
  return out
    .map((r, i) => (r.status === 'fulfilled' && r.value ? normalizeHit({ ...r.value, app_id: HANDHELD_PICKS[i], developer_name: r.value.developer_name }) : null))
    .filter(Boolean);
}

export function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
