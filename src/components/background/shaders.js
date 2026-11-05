// GLSL ES 3.00 shaders for the living backgrounds. All themes share one uniform block:
//  uTime (s), uRes (px), uTilt (−1..1, smoothed gyro/pointer), uFlow (swipe velocity),
//  uRipple (xy in scene space, z = seconds since impulse), uAmp (impulse strength), uIntensity.
export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uTilt;
uniform vec2 uFlow;
uniform vec3 uRipple;
uniform float uAmp;
uniform float uIntensity;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
vec2 scene() { return (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; }
// soft ring wave emitted on every press / swipe
float ripple(vec2 p) {
  float d = length(p - uRipple.xy);
  float t = uRipple.z;
  return sin(d * 26.0 - t * 8.5) * exp(-abs(d - t * 0.42) * 7.0) * exp(-t * 1.6) * uAmp;
}
vec3 finish(vec3 col, vec2 uv) {
  float vig = smoothstep(1.25, 0.25, length((uv - 0.5) * vec2(1.25, 1.0)));
  col *= mix(0.55, 1.0, vig);
  col *= uIntensity;
  // blue-noise-ish dither: kills banding on the 10-bit OLED
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.13)) - 0.5) / 255.0;
  return col;
}
`;

export const FRAG = {
  tide: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene();
  p += uTilt * vec2(0.05, 0.035);
  float r = ripple(p);
  p.y += r * 0.012;
  vec3 col = mix(vec3(0.012, 0.015, 0.022), vec3(0.04, 0.05, 0.075), smoothstep(-0.6, 0.6, p.y));
  float t = uTime + uFlow.x * 0.6;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float k = fi / 6.0;
    float par = 0.4 + k * 0.9; // depth-dependent parallax
    float x = p.x + uTilt.x * 0.04 * par;
    float y = -0.42 + fi * 0.085
      + 0.055 * sin(x * (1.3 + fi * 0.27) + t * (0.16 + fi * 0.035) + fi * 1.9)
      + 0.022 * sin(x * (3.4 - fi * 0.2) - t * (0.27 + fi * 0.02) + fi)
      + uTilt.y * 0.025 * par + r * 0.02 * par;
    float d = p.y - y;
    vec3 wc = mix(vec3(0.05, 0.07, 0.11), vec3(0.15, 0.19, 0.27), k);
    float fill = smoothstep(0.006, -0.006, d);
    col = mix(col, wc * (0.55 + 0.45 * smoothstep(-0.35, 0.0, d)), fill * (0.55 - k * 0.04));
    col += vec3(0.55, 0.65, 0.85) * exp(-abs(d) * 160.0) * (0.04 + 0.05 * k);
  }
  col += vec3(0.6, 0.7, 1.0) * 0.05 * abs(r);
  outColor = vec4(finish(col, uv), 1.0);
}`,

  aurora: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.07, 0.05);
  float r = ripple(p);
  p += normalize(p - uRipple.xy + 1e-4) * r * 0.01;
  float t = uTime * 0.045 + uFlow.x * 0.2;
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, 1.3) - t));
  vec2 w = vec2(fbm(p * 1.4 + q * 1.7 + vec2(1.7, 9.2) + t * 1.5), fbm(p * 1.4 + q * 1.7 + vec2(8.3, 2.8) - t));
  float n = fbm(p * 1.2 + w * 1.6);
  float band = smoothstep(0.38, 0.78, n) * smoothstep(0.75, -0.35, p.y + 0.1 * sin(p.x * 2.0 + t * 4.0));
  vec3 base = mix(vec3(0.01, 0.012, 0.02), vec3(0.025, 0.035, 0.05), uv.y);
  vec3 c1 = vec3(0.12, 0.34, 0.36);
  vec3 c2 = vec3(0.26, 0.2, 0.44);
  vec3 col = base + mix(c1, c2, smoothstep(0.2, 0.8, q.x)) * band * 0.6;
  col += vec3(0.7, 0.85, 1.0) * pow(band, 3.0) * 0.08;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  silk: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.06, 0.04);
  float r = ripple(p);
  float t = uTime * 0.06 + uFlow.x * 0.25;
  float f = fbm(p * 0.8 + vec2(t, -t * 0.5) + fbm(p * 1.2 - t) * 1.4);
  float folds = sin(p.x * 2.2 + p.y * 1.1 + f * 5.0 + t * 1.5 + r * 2.0) * 0.5 + 0.5;
  float sheen = pow(folds, 8.0);
  float shade = smoothstep(0.0, 1.0, folds);
  vec3 col = vec3(0.022, 0.025, 0.032) + vec3(0.09, 0.1, 0.125) * shade + vec3(0.42, 0.46, 0.55) * sheen * 0.14;
  col += vec3(0.2, 0.25, 0.35) * 0.06 * r;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  ember: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene();
  float r = ripple(p);
  vec3 col = mix(vec3(0.03, 0.018, 0.016), vec3(0.012, 0.012, 0.018), uv.y);
  float aspect = uRes.x / uRes.y;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float depth = 0.2 + 0.8 * hash1(fi + 11.0);
    vec2 c = vec2((hash1(fi) * 2.0 - 1.0) * aspect * 0.55, hash1(fi + 7.0) * 1.1 - 0.55);
    c += vec2(sin(uTime * 0.05 * (1.0 + hash1(fi + 3.0)) + fi), cos(uTime * 0.04 * (1.0 + hash1(fi + 5.0)) + fi)) * 0.14;
    c -= uTilt * 0.08 * depth + uFlow * 0.05 * depth;
    c += normalize(c - uRipple.xy + 1e-4) * r * 0.02 * depth;
    float rad = 0.07 + 0.2 * hash1(fi + 13.0);
    float d = length(p - c);
    vec3 oc = mix(vec3(0.55, 0.3, 0.2), vec3(0.45, 0.32, 0.38), hash1(fi + 17.0));
    col += oc * smoothstep(rad, rad * 0.15, d) * 0.05 * (1.2 - depth * 0.6);
  }
  outColor = vec4(finish(col, uv), 1.0);
}`,

  drift: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * 0.02;
  vec3 col = mix(vec3(0.008, 0.01, 0.016), vec3(0.03, 0.036, 0.055), smoothstep(-0.7, 0.8, p.y + 0.15 * fbm(p * 1.5 + uTime * 0.02)));
  col += vec3(0.08, 0.1, 0.16) * 0.35 * smoothstep(0.9, 0.0, length(p - vec2(0.35, 0.25)));
  outColor = vec4(finish(col, uv), 1.0);
}`,

  custom: `${COMMON}
uniform sampler2D uTex;
uniform vec2 uTexSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene();
  float r = ripple(p);
  float ra = uRes.x / uRes.y;
  float ta = uTexSize.x / max(uTexSize.y, 1.0);
  vec2 s = ra > ta ? vec2(1.0, ta / ra) : vec2(ra / ta, 1.0);
  float zoom = 1.09 + 0.015 * sin(uTime * 0.05);
  vec2 kb = vec2(sin(uTime * 0.021), cos(uTime * 0.017)) * 0.012;
  vec2 tuv = (vec2(uv.x, 1.0 - uv.y) - 0.5) * s / zoom + 0.5 + vec2(uTilt.x, -uTilt.y) * 0.018 + kb + vec2(uFlow.x, 0.0) * 0.01;
  tuv += normalize(p - uRipple.xy + 1e-4) * r * 0.006;
  vec3 col = texture(uTex, tuv).rgb;
  col = pow(col, vec3(1.08)) * 0.62;
  outColor = vec4(finish(col, uv), 1.0);
}`,
};

// Particle field drawn on top of the "drift" base.
export const PARTICLE_VERT = `#version 300 es
precision highp float;
in vec4 aSeed; // x,y ∈ [-1,1], z = depth, w = phase
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uTilt;
uniform vec2 uFlow;
uniform vec3 uRipple;
uniform float uAmp;
uniform float uDpr;
out float vAlpha;
void main() {
  float depth = aSeed.z;
  float aspect = uRes.x / uRes.y;
  vec2 pos = aSeed.xy * vec2(aspect, 1.0) * 0.62;
  pos += vec2(sin(uTime * (0.05 + depth * 0.08) + aSeed.w * 6.28), cos(uTime * (0.04 + depth * 0.06) + aSeed.w * 4.1)) * (0.05 + 0.08 * depth);
  pos.y += mod(uTime * 0.008 * (0.4 + depth) + aSeed.w, 1.3) - 0.65;
  pos -= uTilt * (0.02 + 0.1 * depth) + uFlow * 0.06 * depth;
  vec2 away = pos - uRipple.xy;
  float d = length(away);
  pos += normalize(away + 1e-4) * uAmp * exp(-uRipple.z * 1.6) * exp(-d * 3.0) * 0.08 * depth;
  // scene space (y ∈ [-0.5, 0.5]) → clip space
  gl_Position = vec4(pos.x * 2.0 / aspect, pos.y * 2.0, 0.0, 1.0);
  gl_PointSize = (1.2 + depth * 3.4) * uDpr;
  vAlpha = 0.12 + 0.5 * depth * (0.6 + 0.4 * sin(uTime * 0.8 + aSeed.w * 30.0));
}`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  outColor = vec4(vec3(0.82, 0.88, 1.0) * a * vAlpha, a * vAlpha);
}`;

export const THEMES = [
  { key: 'tide', label: 'Gezeiten', desc: 'Sanfte, geschichtete Wellen' },
  { key: 'drift', label: 'Drift', desc: 'Schwebende Lichtpartikel' },
  { key: 'aurora', label: 'Aurora', desc: 'Fließende Polarlicht-Bänder' },
  { key: 'silk', label: 'Seide', desc: 'Weiche, glänzende Falten' },
  { key: 'ember', label: 'Glut', desc: 'Warmes Bokeh in der Tiefe' },
  { key: 'custom', label: 'Eigenes', desc: 'Bild oder Video von dir' },
];
