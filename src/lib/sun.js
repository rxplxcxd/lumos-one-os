// Sunrise / sunset (NOAA simplified algorithm, ±2 min) for the automatic night mode.
const rad = Math.PI / 180;

function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
}

/** Returns { sunrise, sunset } as Date objects for the local day of `date`, or null at polar day/night. */
export function sunTimes(date, lat, lon) {
  const n = dayOfYear(date);
  const g = ((2 * Math.PI) / 365) * (n - 1 + 0.5);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  const ha = Math.acos(cosH) / rad;
  const midnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const at = (minutes) => new Date(midnightUtc + minutes * 60000);
  return { sunrise: at(720 - 4 * (lon + ha) - eqTime), sunset: at(720 - 4 * (lon - ha) - eqTime) };
}

export function isNight(date, lat, lon) {
  const t = sunTimes(date, lat, lon);
  if (!t) {
    const m = date.getMonth();
    const northSummer = m >= 3 && m <= 8;
    return lat >= 0 ? !northSummer : northSummer; // polar night in local winter
  }
  return date < t.sunrise || date > t.sunset;
}

const mins = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** true when `date` lies in the [from, to) clock window; windows may wrap midnight. */
export function inWindow(date, from, to) {
  const now = date.getHours() * 60 + date.getMinutes();
  const a = mins(from);
  const b = mins(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

/** Resolves whether the night-shift tint is active for the given settings. */
export function nightShiftActive(v, date = new Date()) {
  switch (v.nightShiftMode) {
    case 'manual':
      return true;
    case 'auto':
      return isNight(date, v.weatherLocation?.lat ?? 52.52, v.weatherLocation?.lon ?? 13.4);
    case 'schedule':
      return inWindow(date, v.nightShiftFrom, v.nightShiftTo);
    default:
      return false;
  }
}
