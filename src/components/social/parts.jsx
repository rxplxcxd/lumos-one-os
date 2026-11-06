// Shared social UI pieces: platform badges, avatars with presence dot, cover tiles.
import { motion } from 'framer-motion';
import { PLATFORMS } from '@/services/social/hub.js';

export const STATUS_COLOR = { online: '#3fd17f', away: '#f2b441', busy: '#ef5b5b', offline: '#6b7280' };

const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function PlatformBadge({ platform, size = '1.15rem', className = '' }) {
  const p = PLATFORMS[platform] || PLATFORMS.lumos;
  return (
    <span title={p.label} className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white ring-1 ring-white/20 ${className}`} style={{ background: p.color, width: size, height: size, fontSize: `calc(${size} * 0.58)` }}>
      {p.short}
    </span>
  );
}

export function FriendAvatar({ f, size = '2.6rem', dot = true, className = '' }) {
  const h = hue(f.name);
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {f.avatar ? (
        <img src={f.avatar} alt="" className="h-full w-full rounded-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white" style={{ background: `linear-gradient(135deg, hsl(${h} 55% 45%), hsl(${(h + 50) % 360} 60% 32%))`, fontSize: `calc(${size} * 0.4)` }}>
          {f.name?.[0]?.toUpperCase()}
        </span>
      )}
      <PlatformBadge platform={f.platform} size={`calc(${size} * 0.42)`} className="absolute -left-1 -top-1" />
      {dot && (
        <motion.span
          key={f.status}
          initial={{ scale: 0.3 }}
          animate={{ scale: 1 }}
          className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[#0b0d12]"
          style={{ width: `calc(${size} * 0.32)`, height: `calc(${size} * 0.32)`, background: STATUS_COLOR[f.status] || STATUS_COLOR.offline }}
        />
      )}
    </span>
  );
}

/** High-res cover art (or a generated gradient tile when the platform provides none). */
export function Cover({ game, className = '' }) {
  if (!game) return null;
  const h = hue(game.name);
  return game.cover ? (
    <img src={game.cover} alt="" className={`object-cover ${className}`} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
  ) : (
    <div className={`flex items-center justify-center text-center font-semibold text-white/90 ${className}`} style={{ background: `linear-gradient(145deg, hsl(${h} 50% 38%), hsl(${(h + 70) % 360} 55% 20%))` }}>
      <span className="line-clamp-2 px-2 text-[0.7em] leading-tight">{game.name}</span>
    </div>
  );
}
