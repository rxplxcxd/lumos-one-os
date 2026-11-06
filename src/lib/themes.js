// UI colour schemes: accent ramp (focus halo, highlights, progress) + glass tint.
export const UI_THEMES = [
  { key: 'lumen', label: 'Lumen', accent: ['216 228 255', '169 194 255', '127 163 255', '91 132 240'], glass: [18, 21, 27] },
  { key: 'graphit', label: 'Graphit', accent: ['230 232 236', '196 200 208', '160 166 176', '120 126 138'], glass: [20, 20, 22] },
  { key: 'polar', label: 'Polar', accent: ['208 246 255', '150 226 245', '96 205 232', '52 170 205'], glass: [14, 22, 27] },
  { key: 'rose', label: 'Rosé', accent: ['255 222 230', '246 178 196', '232 136 162', '206 96 130'], glass: [26, 18, 22] },
  { key: 'salbei', label: 'Salbei', accent: ['222 244 228', '176 222 190', '130 198 152', '88 166 116'], glass: [16, 24, 19] },
  { key: 'bernstein', label: 'Bernstein', accent: ['255 236 204', '248 206 146', '236 172 92', '210 136 52'], glass: [26, 21, 15] },
  { key: 'lavendel', label: 'Lavendel', accent: ['234 226 255', '200 186 250', '166 146 240', '130 108 220'], glass: [21, 18, 28] },
  { key: 'koralle', label: 'Koralle', accent: ['255 226 216', '252 184 164', '240 140 112', '214 102 76'], glass: [26, 18, 16] },
  { key: 'oled', label: 'OLED-Schwarz', accent: ['240 240 240', '200 200 200', '160 160 160', '120 120 120'], glass: [0, 0, 0], strongAlpha: 0.9 },
];

export function applyUiTheme({ theme = 'lumen', glassOpacity = 0.52, glassBlur = 28, reduceTransparency, highContrast, boldText, focusStyle, nightShift = 0, lowPower = false }) {
  if (lowPower) glassBlur = Math.min(glassBlur, 6); // backdrop blur is the most expensive effect on the iGPU
  const t = UI_THEMES.find((x) => x.key === theme) || UI_THEMES[0];
  const r = document.documentElement;
  const [a, a4, a5, a6] = t.accent;
  r.style.setProperty('--lumen', a);
  r.style.setProperty('--lumen-400', a4);
  r.style.setProperty('--lumen-500', a5);
  r.style.setProperty('--lumen-600', a6);
  const [gr, gg, gb] = t.glass;
  r.style.setProperty('--glass-bg', `rgba(${gr}, ${gg}, ${gb}, ${glassOpacity})`);
  r.style.setProperty('--glass-bg-strong', `rgba(${Math.max(0, gr - 4)}, ${Math.max(0, gg - 4)}, ${Math.max(0, gb - 4)}, ${t.strongAlpha ?? Math.min(0.95, glassOpacity + 0.26)})`);
  r.style.setProperty('--glass-blur', `${glassBlur}px`);
  r.style.setProperty('--night-tint', String(nightShift));
  r.classList.toggle('reduce-transparency', !!reduceTransparency);
  r.classList.toggle('high-contrast', !!highContrast);
  r.classList.toggle('bold-text', !!boldText);
  r.classList.toggle('focus-halo', focusStyle === 'halo');
  r.classList.toggle('low-power', !!lowPower);
}
