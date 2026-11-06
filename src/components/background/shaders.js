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
uniform vec3 uAccent;
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
    col += mix(vec3(0.55, 0.65, 0.85), uAccent, 0.6) * exp(-abs(d) * 160.0) * (0.04 + 0.05 * k);
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
  float band = smoothstep(0.33, 0.72, n) * smoothstep(0.8, -0.4, p.y + 0.1 * sin(p.x * 2.0 + t * 4.0));
  vec3 base = mix(vec3(0.01, 0.012, 0.02), vec3(0.025, 0.035, 0.05), uv.y);
  vec3 c1 = vec3(0.12, 0.34, 0.36);
  vec3 c2 = vec3(0.26, 0.2, 0.44);
  vec3 col = base + mix(c1, c2, smoothstep(0.2, 0.8, q.x)) * band * 0.85;
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

  nebula: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.05, 0.04);
  float r = ripple(p);
  float t = uTime * 0.02 + uFlow.x * 0.1;
  vec2 q = p * 1.3 + vec2(t, -t * 0.6);
  float n1 = fbm(q + fbm(q * 1.7 + t) * 1.2);
  float n2 = fbm(q * 2.1 - vec2(t * 1.3, 0.0) + 3.1);
  vec3 col = vec3(0.006, 0.008, 0.016);
  col += mix(vec3(0.16, 0.09, 0.26), uAccent * 0.25, 0.35) * smoothstep(0.35, 0.85, n1) * 0.8;
  col += vec3(0.06, 0.14, 0.24) * smoothstep(0.4, 0.9, n2) * 0.7;
  col += vec3(0.9, 0.85, 1.0) * pow(smoothstep(0.6, 0.95, n1 * n2 * 1.6), 3.0) * 0.08;
  col += vec3(0.5, 0.6, 1.0) * abs(r) * 0.04;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  ocean: `${COMMON}
float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.04, 0.03);
  float r = ripple(p);
  vec2 pp = mod((p + vec2(uFlow.x * 0.05, r * 0.02)) * 6.28318 * 0.8, 6.28318) - 250.0;
  float c = clamp(caustic(pp, uTime * 0.22 + 23.0), 0.0, 1.0);
  vec3 col = mix(vec3(0.0, 0.025, 0.045), vec3(0.01, 0.085, 0.115), smoothstep(-0.6, 0.6, p.y));
  col += vec3(0.25, 0.55, 0.6) * c * 0.2 * smoothstep(-0.7, 0.5, p.y);
  col += vec3(0.1, 0.25, 0.3) * 0.1 * pow(max(0.0, sin(p.x * 3.0 + p.y * 1.5 + uTime * 0.1)), 10.0) * smoothstep(-0.4, 0.6, p.y);
  outColor = vec4(finish(col, uv), 1.0);
}`,

  mesh: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene();
  float r = ripple(p);
  float t = uTime * 0.6 + uFlow.x;
  p += 0.06 * vec2(fbm(p * 2.0 + t * 0.03), fbm(p * 2.0 - t * 0.03 + 4.0)) + normalize(p - uRipple.xy + 1e-4) * r * 0.01;
  vec2 a = vec2(sin(t * 0.13) * 0.6, cos(t * 0.11) * 0.3) - uTilt * 0.08;
  vec2 b = vec2(cos(t * 0.09 + 1.0) * 0.7, sin(t * 0.12 + 2.0) * 0.35) - uTilt * 0.05;
  vec2 c = vec2(sin(t * 0.07 + 4.0) * 0.5, sin(t * 0.1 + 1.0) * 0.4) - uTilt * 0.11;
  vec2 d = vec2(cos(t * 0.15 + 3.0) * 0.8, cos(t * 0.08) * 0.3) - uTilt * 0.03;
  float wa = 1.0 / (0.04 + dot(p - a, p - a) * 4.0);
  float wb = 1.0 / (0.04 + dot(p - b, p - b) * 4.0);
  float wc = 1.0 / (0.04 + dot(p - c, p - c) * 4.0);
  float wd = 1.0 / (0.04 + dot(p - d, p - d) * 4.0);
  vec3 col = (vec3(0.05, 0.06, 0.11) * wa + vec3(0.16, 0.11, 0.25) * wb + uAccent * 0.12 * wc + vec3(0.2, 0.11, 0.09) * wd) / (wa + wb + wc + wd);
  col *= 0.8;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  rain: `${COMMON}
vec2 rainLayer(vec2 uv, float t, float scale) {
  vec2 aspect = vec2(2.0, 1.0);
  vec2 st = uv * scale * aspect;
  st.y += t * 0.25;
  vec2 id = floor(st);
  vec2 gv = fract(st) - 0.5;
  float n = hash(id);
  float tt = t + n * 6.2831;
  float w = uv.y * 10.0;
  float x = (n - 0.5) * 0.8 + (0.4 - abs(n - 0.5)) * sin(3.0 * w) * pow(sin(w), 6.0) * 0.45;
  float y = -sin(tt + sin(tt + sin(tt) * 0.5)) * 0.45;
  y -= (gv.x - x) * (gv.x - x);
  vec2 dropPos = (gv - vec2(x, y)) / aspect;
  float drop = smoothstep(0.05, 0.03, length(dropPos));
  vec2 trailPos = (gv - vec2(x, t * 0.25)) / aspect;
  trailPos.y = (fract(trailPos.y * 8.0) - 0.5) / 8.0;
  float trail = smoothstep(0.03, 0.01, length(trailPos)) * smoothstep(-0.05, 0.05, dropPos.y) * smoothstep(0.5, y, gv.y);
  return vec2(drop, trail);
}
vec3 bokeh(vec2 p) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec2 pos = vec2(hash1(fi) * 2.0 - 1.0, hash1(fi + 3.0) - 0.6) * vec2(0.9, 0.5);
    float rad = 0.05 + 0.12 * hash1(fi + 7.0);
    vec3 lc = mix(vec3(0.7, 0.45, 0.25), vec3(0.3, 0.45, 0.8), hash1(fi + 11.0));
    c += lc * smoothstep(rad, rad * 0.3, length(p - pos)) * 0.06;
  }
  return c;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.03, 0.02);
  float t = uTime * 0.7;
  vec2 d1 = rainLayer(uv + uTilt * 0.01, t, 4.0);
  vec2 d2 = rainLayer(uv * 1.4 + 7.0, t * 0.9, 4.0);
  float m = d1.x + d1.y * 0.5 + d2.x * 0.7 + d2.y * 0.3;
  vec3 col = mix(vec3(0.01, 0.012, 0.02), vec3(0.03, 0.035, 0.05), uv.y);
  col += bokeh(p + vec2(m) * 0.05);
  col += vec3(0.6, 0.7, 0.9) * m * 0.05 + vec3(0.4, 0.5, 0.7) * abs(ripple(p)) * 0.03;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  dunes: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.05, 0.03);
  float r = ripple(p);
  float t = uTime * 0.03 + uFlow.x * 0.2;
  vec3 col = mix(vec3(0.05, 0.035, 0.03), vec3(0.015, 0.016, 0.03), smoothstep(-0.2, 0.5, p.y));
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float k = fi / 5.0;
    float x = p.x * (1.0 + fi * 0.35) + t * (0.3 + k) + fi * 3.1 + uTilt.x * 0.05 * k;
    float ridge = 1.0 - abs(sin(x * 1.3 + 0.5 * sin(x * 0.7)));
    float y = 0.15 - fi * 0.11 + 0.06 * ridge + 0.02 * fbm(vec2(x, fi)) + r * 0.01 * k;
    float d = p.y - y;
    vec3 sand = mix(vec3(0.22, 0.15, 0.1), vec3(0.09, 0.07, 0.07), k);
    float lit = 0.6 + 0.4 * cos(x * 1.3);
    col = mix(col, sand * lit, smoothstep(0.004, -0.004, d));
    col += vec3(0.6, 0.45, 0.3) * exp(-abs(d) * 120.0) * 0.03 * (1.0 - k);
  }
  outColor = vec4(finish(col, uv), 1.0);
}`,

  snow: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * 0.02;
  vec3 col = mix(vec3(0.03, 0.04, 0.06), vec3(0.012, 0.015, 0.025), smoothstep(-0.5, 0.5, p.y));
  col += vec3(0.08, 0.1, 0.14) * 0.6 * fbm(vec2(p.x * 2.0 + uTime * 0.02, p.y * 4.0)) * smoothstep(0.0, -0.5, p.y);
  outColor = vec4(finish(col, uv), 1.0);
}`,

  fireflies: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * 0.03;
  vec3 col = mix(vec3(0.008, 0.02, 0.012), vec3(0.01, 0.012, 0.02), smoothstep(-0.5, 0.6, p.y));
  col += vec3(0.04, 0.08, 0.05) * fbm(p * 2.5 + vec2(uTime * 0.015, 0.0)) * smoothstep(0.3, -0.5, p.y);
  outColor = vec4(finish(col, uv), 1.0);
}`,

  grid: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene();
  float r = ripple(p);
  float horizon = -0.04 + uTilt.y * 0.03;
  vec3 col = mix(vec3(0.008, 0.01, 0.016), vec3(0.04, 0.045, 0.07), smoothstep(-0.5, 0.5, p.y));
  if (p.y < horizon) {
    float z = 0.25 / (horizon - p.y);
    vec2 g = vec2((p.x + uTilt.x * 0.08) * z, z + uTime * 0.35 + uFlow.x);
    vec2 f = abs(fract(g) - 0.5);
    float line = min(f.x, f.y);
    float gl = 1.0 - smoothstep(0.0, fwidth(line) * 1.4, line);
    col += mix(vec3(0.45, 0.52, 0.68), uAccent, 0.5) * gl * 0.28 * exp(-z * 0.12) * (1.0 + r * 2.0);
  }
  col += mix(vec3(0.3, 0.36, 0.55), uAccent * 0.6, 0.4) * 0.22 * exp(-abs(p.y - horizon) * 16.0);
  outColor = vec4(finish(col, uv), 1.0);
}`,

  ink: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.05, 0.04);
  float r = ripple(p);
  float t = uTime * 0.03 + uFlow.x * 0.15;
  vec2 q = p * 1.4 + normalize(p - uRipple.xy + 1e-4) * r * 0.03;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(fbm(q * 1.3 + t + fi), fbm(q * 1.3 - t + fi * 1.7)) * 0.55;
  }
  float n = fbm(q);
  vec3 col = mix(vec3(0.01, 0.012, 0.016), vec3(0.17, 0.19, 0.23), smoothstep(0.3, 0.85, n));
  col += uAccent * pow(smoothstep(0.6, 0.9, n), 3.0) * 0.08;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  prism: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * vec2(0.06, 0.04);
  float r = ripple(p);
  float t = uTime * 0.05 + uFlow.x * 0.2;
  float a = p.x * 1.1 + p.y * 0.6 + fbm(p * 1.4 + t) * 1.3 + t + r * 0.3;
  vec3 spec = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + a * 0.5));
  float band = pow(0.5 + 0.5 * sin(a * 3.0), 6.0);
  vec3 col = mix(vec3(0.012, 0.013, 0.02), vec3(0.03, 0.03, 0.045), uv.y) + spec * band * 0.08;
  outColor = vec4(finish(col, uv), 1.0);
}`,

  oled: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = scene() + uTilt * 0.04;
  float sweep = exp(-pow((p.x - sin(uTime * 0.03) * 0.9) * 1.6, 2.0)) * smoothstep(0.7, -0.5, p.y);
  vec3 col = mix(vec3(0.02, 0.024, 0.032), uAccent * 0.03, 0.3) * sweep;
  outColor = vec4(col + (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 512.0, 1.0);
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
uniform int uMode; // 0 drift · 1 snow · 2 fireflies · 3 stars
out float vAlpha;
void main() {
  float depth = aSeed.z;
  float aspect = uRes.x / uRes.y;
  vec2 pos = aSeed.xy * vec2(aspect, 1.0) * 0.62;
  float size = 1.2 + depth * 3.4;
  if (uMode == 0) {
    pos += vec2(sin(uTime * (0.05 + depth * 0.08) + aSeed.w * 6.28), cos(uTime * (0.04 + depth * 0.06) + aSeed.w * 4.1)) * (0.05 + 0.08 * depth);
    pos.y += mod(uTime * 0.008 * (0.4 + depth) + aSeed.w, 1.3) - 0.65;
    vAlpha = 0.12 + 0.5 * depth * (0.6 + 0.4 * sin(uTime * 0.8 + aSeed.w * 30.0));
  } else if (uMode == 1) {
    pos.y = 0.65 - mod(uTime * (0.03 + 0.07 * depth) + aSeed.w * 1.3, 1.3);
    pos.x += sin(uTime * (0.4 + depth) + aSeed.w * 20.0) * 0.02 * (1.0 + depth) - uFlow.x * 0.05 * depth;
    size = 1.5 + depth * 5.0;
    vAlpha = 0.18 + 0.55 * depth;
  } else if (uMode == 2) {
    pos += vec2(sin(uTime * 0.21 * (0.5 + depth) + aSeed.w * 17.0), cos(uTime * 0.17 * (0.5 + depth) + aSeed.w * 11.0)) * 0.12;
    pos.y = pos.y * 0.6 - 0.15;
    size = 2.0 + depth * 5.0;
    vAlpha = pow(max(0.0, sin(uTime * (0.6 + depth) + aSeed.w * 40.0)), 4.0) * (0.4 + 0.6 * depth);
  } else {
    size = 0.8 + depth * 1.8;
    vAlpha = (0.15 + 0.6 * depth) * (0.65 + 0.35 * sin(uTime * (1.0 + depth * 2.0) + aSeed.w * 50.0));
  }
  pos -= uTilt * (0.02 + 0.1 * depth) + uFlow * 0.06 * depth;
  vec2 away = pos - uRipple.xy;
  float d = length(away);
  pos += normalize(away + 1e-4) * uAmp * exp(-uRipple.z * 1.6) * exp(-d * 3.0) * 0.08 * depth;
  // scene space (y ∈ [-0.5, 0.5]) → clip space
  gl_Position = vec4(pos.x * 2.0 / aspect, pos.y * 2.0, 0.0, 1.0);
  gl_PointSize = size * uDpr;
}`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uPColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  outColor = vec4(uPColor * a * vAlpha, a * vAlpha);
}`;

export const PARTICLES = { drift: { mode: 0, color: [0.82, 0.88, 1.0] }, snow: { mode: 1, color: [0.92, 0.95, 1.0] }, fireflies: { mode: 2, color: [1.0, 0.86, 0.45] }, nebula: { mode: 3, color: [0.9, 0.92, 1.0] } };

export const THEMES = [
  { key: 'tide', label: 'Gezeiten', desc: 'Sanfte, geschichtete Wellen' },
  { key: 'drift', label: 'Drift', desc: 'Schwebende Lichtpartikel' },
  { key: 'aurora', label: 'Aurora', desc: 'Fließende Polarlicht-Bänder' },
  { key: 'silk', label: 'Seide', desc: 'Weiche, glänzende Falten' },
  { key: 'ember', label: 'Glut', desc: 'Warmes Bokeh in der Tiefe' },
  { key: 'nebula', label: 'Nebel', desc: 'Sternennebel mit Funkeln' },
  { key: 'ocean', label: 'Tiefsee', desc: 'Lichtkaustik unter Wasser' },
  { key: 'mesh', label: 'Verlauf', desc: 'Wandernde Farbflächen' },
  { key: 'rain', label: 'Regen', desc: 'Tropfen auf Glas, Stadtlichter' },
  { key: 'dunes', label: 'Dünen', desc: 'Wandernde Sandkämme' },
  { key: 'snow', label: 'Schnee', desc: 'Leiser Schneefall' },
  { key: 'fireflies', label: 'Glühwürmchen', desc: 'Warme Lichter im Wald' },
  { key: 'grid', label: 'Horizont', desc: 'Endloses Raster in die Tiefe' },
  { key: 'ink', label: 'Tinte', desc: 'Tinte in Wasser' },
  { key: 'prism', label: 'Prisma', desc: 'Gebrochenes Licht' },
  { key: 'oled', label: 'OLED', desc: 'Fast schwarz – spart Akku' },
  { key: 'custom', label: 'Eigenes', desc: 'Bild oder Video von dir' },
];
