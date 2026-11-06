// WebGL2 renderer for the living backgrounds. Runs at display refresh (up to 165 Hz) with
// dynamic resolution scaling so the shell never drops frames because of the wallpaper.
import { VERT, FRAG, PARTICLE_VERT, PARTICLE_FRAG, PARTICLES as PARTICLE_THEMES } from './shaders.js';

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile failed: ${log}`);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

const PARTICLES = 2400;

export class BackgroundRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', desynchronized: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 nicht verfügbar');
    this.gl = gl;
    this.programs = {};
    this.theme = 'tide';
    this.scale = 1;
    this.maxScale = 1;
    this.frameTimes = [];
    this.tex = null;
    this.texSize = [1, 1];
    this.video = null;

    // fullscreen triangle
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // particle seeds
    const seeds = new Float32Array(PARTICLES * 4);
    for (let i = 0; i < PARTICLES; i++) {
      seeds[i * 4] = Math.random() * 2 - 1;
      seeds[i * 4 + 1] = Math.random() * 2 - 1;
      seeds[i * 4 + 2] = Math.pow(Math.random(), 1.8);
      seeds[i * 4 + 3] = Math.random();
    }
    this.seedBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    this.particles = program(gl, PARTICLE_VERT, PARTICLE_FRAG);
  }

  #prog(theme) {
    if (!this.programs[theme]) this.programs[theme] = program(this.gl, VERT, FRAG[theme] || FRAG.tide);
    return this.programs[theme];
  }

  setTheme(theme) {
    this.theme = FRAG[theme] ? theme : 'tide';
    this.#prog(this.theme);
  }

  /** @param {HTMLImageElement|HTMLVideoElement|ImageBitmap|null} source */
  setTexture(source) {
    const gl = this.gl;
    this.video = source instanceof HTMLVideoElement ? source : null;
    if (!source) {
      if (this.tex) gl.deleteTexture(this.tex);
      this.tex = null;
      return;
    }
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    this.#upload(source);
  }

  #upload(src) {
    const gl = this.gl;
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return;
    this.texSize = [w, h];
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr * this.scale));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr * this.scale;
  }

  /** adapts the internal resolution to keep the frame budget (refresh-rate aware) */
  adapt(dt, budgetMs) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.frameTimes.length = 0;
    if (p90 > budgetMs * 1.25 && this.scale > 0.5) this.scale = Math.max(0.5, this.scale - 0.125);
    else if (p90 < budgetMs * 0.9 && this.scale < this.maxScale) this.scale = Math.min(this.maxScale, this.scale + 0.0625);
  }

  render(s) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const theme = this.theme === 'custom' && !this.tex ? 'tide' : this.theme;
    const { p, u } = this.#prog(theme);
    gl.useProgram(p);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.#uniforms(u, s);
    if (theme === 'custom' && this.tex) {
      if (this.video && this.video.readyState >= 2) this.#upload(this.video);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uTexSize, this.texSize[0], this.texSize[1]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);

    const pconf = PARTICLE_THEMES[theme];
    if (pconf) {
      const pp = this.particles;
      gl.useProgram(pp.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      const sl = gl.getAttribLocation(pp.p, 'aSeed');
      gl.enableVertexAttribArray(sl);
      gl.vertexAttribPointer(sl, 4, gl.FLOAT, false, 0, 0);
      this.#uniforms(pp.u, s);
      gl.uniform1f(pp.u.uDpr, this.dpr);
      gl.uniform1i(pp.u.uMode, pconf.mode);
      gl.uniform3f(pp.u.uPColor, ...pconf.color);
      const base = pconf.mode === 3 ? 900 : pconf.mode === 2 ? 160 : pconf.mode === 1 ? 1600 : 1400;
      gl.drawArrays(gl.POINTS, 0, Math.max(16, Math.min(PARTICLES, Math.round(base * (s.particles ?? 1)))));
      gl.disableVertexAttribArray(sl);
    }
  }

  #uniforms(u, s) {
    const gl = this.gl;
    gl.uniform1f(u.uTime, s.time);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uTilt, s.tilt[0], s.tilt[1]);
    if (u.uFlow) gl.uniform2f(u.uFlow, s.flow[0], s.flow[1]);
    if (u.uRipple) gl.uniform3f(u.uRipple, s.ripple[0], s.ripple[1], s.ripple[2]);
    if (u.uAmp) gl.uniform1f(u.uAmp, s.amp);
    if (u.uIntensity) gl.uniform1f(u.uIntensity, s.intensity);
    if (u.uAccent) gl.uniform3f(u.uAccent, s.accent[0], s.accent[1], s.accent[2]);
  }

  dispose() {
    const gl = this.gl;
    Object.values(this.programs).forEach(({ p }) => gl.deleteProgram(p));
    gl.deleteProgram(this.particles.p);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.seedBuf);
    if (this.tex) gl.deleteTexture(this.tex);
  }
}
