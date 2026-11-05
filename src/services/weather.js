// Weather via Open-Meteo (free, no API key): geocoding + forecast.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FC = 'https://api.open-meteo.com/v1/forecast';

export async function geocode(name) {
  const r = await fetch(`${GEO}?name=${encodeURIComponent(name)}&count=5&language=de&format=json`);
  if (!r.ok) throw new Error('Ort nicht gefunden');
  const d = await r.json();
  return (d.results || []).map((x) => ({ name: x.name, region: [x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude, tz: x.timezone }));
}

export async function forecast({ lat, lon }) {
  const key = `lumos.weather.${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < 15 * 60e3) return c.v;
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    forecast_days: '6',
    timezone: 'auto',
  });
  const r = await fetch(`${FC}?${params}`);
  if (!r.ok) throw new Error(`Wetterdienst: ${r.status}`);
  const d = await r.json();
  const nowIdx = Math.max(0, d.hourly.time.findIndex((t) => new Date(t) >= new Date()));
  const v = {
    current: {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      wind: d.current.wind_speed_10m,
      code: d.current.weather_code,
      isDay: !!d.current.is_day,
    },
    hourly: d.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({ t, temp: d.hourly.temperature_2m[nowIdx + i], code: d.hourly.weather_code[nowIdx + i], pop: d.hourly.precipitation_probability?.[nowIdx + i] })),
    daily: d.daily.time.map((t, i) => ({ t, code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i] })),
    sunrise: d.daily.sunrise[0],
    sunset: d.daily.sunset[0],
  };
  localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  return v;
}

// WMO weather interpretation codes → label + icon key
export function describe(code) {
  if (code === 0) return { label: 'Klar', icon: 'sun' };
  if (code <= 2) return { label: 'Leicht bewölkt', icon: 'cloud-sun' };
  if (code === 3) return { label: 'Bedeckt', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Nebel', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Nieselregen', icon: 'drizzle' };
  if (code >= 61 && code <= 67) return { label: 'Regen', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Schnee', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Schauer', icon: 'rain' };
  if (code >= 85 && code <= 86) return { label: 'Schneeschauer', icon: 'snow' };
  if (code >= 95) return { label: 'Gewitter', icon: 'storm' };
  return { label: '—', icon: 'cloud' };
}
