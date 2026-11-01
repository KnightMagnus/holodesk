// WebGL particle sphere. All per-particle work (displacement, rotation, projection,
// depth shading) runs in the vertex shader: one draw call per frame for the points,
// one for the wireframe and one for the glow quad.
import { CX, CY, FOCAL, RADIUS, fibonacciSphere } from './geometry.js';

const POINT_VS = `
attribute vec4 a_p;            // xyz on unit sphere, w = random seed
uniform mat3 u_rot;
uniform vec2 u_center, u_res;
uniform float u_t, u_R, u_amp, u_listen, u_level, u_scale, u_wire, u_focal;
varying float v_depth;
varying float v_wire;
void main() {
  v_wire = u_wire;
  vec3 p = a_p.xyz;
  float d = sin(p.x * 4.0 + u_t * 2.1) * sin(p.y * 4.0 + u_t * 1.7 + a_p.w) * sin(p.z * 4.0 + u_t * 1.3);
  float r = u_wire > 0.5
    ? u_R * 1.04
    : u_R * (1.0 + u_amp * d + u_listen * sin(u_t * 6.0 + p.y * 8.0) * 0.03);
  vec3 q = u_rot * p * r;
  float k = u_focal / (u_focal - q.z);
  vec2 px = u_center + q.xy * k;
  v_depth = clamp((q.z / u_R + 1.0) * 0.5, 0.0, 1.0);
  gl_Position = vec4(px / u_res * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  gl_PointSize = (1.0 + v_depth * 2.1 + u_level * 1.2) * u_scale;
}`;

const POINT_FS = `
precision mediump float;
uniform vec3 u_back, u_front;
uniform float u_wireAlpha;
varying float v_depth;
varying float v_wire;
void main() {
  if (v_wire > 0.5) { gl_FragColor = vec4(u_front * u_wireAlpha, u_wireAlpha); return; }
  vec2 c = gl_PointCoord - 0.5;
  float fall = 1.0 - smoothstep(0.25, 0.5, length(c));
  float a = (0.12 + v_depth * 0.75) * fall;
  gl_FragColor = vec4(mix(u_back, u_front, v_depth) * a, a);
}`;

const GLOW_VS = `
attribute vec2 a_q;
uniform vec2 u_center, u_res;
uniform float u_size;
varying vec2 v_uv;
void main() {
  v_uv = a_q;
  vec2 px = u_center + a_q * u_size;
  gl_Position = vec4(px / u_res * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

// Two radial falloffs: a wide halo and a hot nucleus.
const GLOW_FS = `
precision mediump float;
uniform vec3 u_col, u_hot;
uniform float u_level, u_ratio;
varying vec2 v_uv;
void main() {
  float r = length(v_uv);
  float halo = (1.0 - smoothstep(0.0, 1.0, r)) * (0.20 + u_level * 0.45);
  float nr = r / (u_ratio * (1.0 + u_level * 0.5));
  float nucleus = (1.0 - smoothstep(0.0, 1.0, nr)) * (0.55 + u_level * 0.45);
  vec3 c = u_col * halo + u_hot * nucleus;
  float a = clamp(halo + nucleus, 0.0, 1.0);
  gl_FragColor = vec4(c, a);
}`;

function compile(gl, vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = new Proxy({}, { get: (cache, name) => (cache[name] ??= gl.getUniformLocation(prog, name)) });
  return { prog, u };
}

function wireframe() {
  const verts = [];
  const SEG = 64;
  for (let m = 0; m < 6; m++) {
    const ph = (m / 6) * Math.PI;
    for (let i = 0; i < SEG; i++) {
      for (const j of [i, i + 1]) {
        const a = (j / SEG) * Math.PI * 2;
        verts.push(Math.cos(a) * Math.cos(ph), Math.sin(a), Math.cos(a) * Math.sin(ph), 0);
      }
    }
  }
  return new Float32Array(verts);
}

/** Returns null when WebGL is unavailable so the caller can fall back to 2D. */
export function createGlSphere(canvas, particleCount) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;

  let points;
  let glow;
  try {
    points = compile(gl, POINT_VS, POINT_FS);
    glow = compile(gl, GLOW_VS, GLOW_FS);
  } catch (err) {
    console.warn('WebGL shader setup failed, using 2D fallback', err);
    return null;
  }

  const pointBuf = gl.createBuffer();
  let count = 0;
  function setParticles(n) {
    count = n;
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, fibonacciSphere(n), gl.STATIC_DRAW);
  }
  setParticles(particleCount);

  const wireBuf = gl.createBuffer();
  const wire = wireframe();
  gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wire, gl.STATIC_DRAW);

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const aP = gl.getAttribLocation(points.prog, 'a_p');
  const aQ = gl.getAttribLocation(glow.prog, 'a_q');

  return {
    kind: 'webgl',
    setParticles,
    /** f: { t, rot, level, amp, listening, scale, back, front, hot, w, h } */
    draw(f) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Both shaders emit premultiplied colour, so plain additive blending is correct.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const R = RADIUS * f.scale * (1 + f.level * 0.1 + Math.sin(f.t * 1.4) * 0.012);
      const cx = CX * f.scale;
      const cy = CY * f.scale;

      gl.useProgram(glow.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(aQ);
      gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(glow.u.u_center, cx, cy);
      gl.uniform2f(glow.u.u_res, canvas.width, canvas.height);
      gl.uniform1f(glow.u.u_size, R * 1.6);
      gl.uniform1f(glow.u.u_ratio, 0.45 / 1.6);
      gl.uniform1f(glow.u.u_level, f.level);
      gl.uniform3fv(glow.u.u_col, f.front);
      gl.uniform3fv(glow.u.u_hot, f.hot);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(aQ);

      gl.useProgram(points.prog);
      const u = points.u;
      gl.uniformMatrix3fv(u.u_rot, false, f.rot);
      gl.uniform2f(u.u_center, cx, cy);
      gl.uniform2f(u.u_res, canvas.width, canvas.height);
      gl.uniform1f(u.u_t, f.t);
      gl.uniform1f(u.u_R, R);
      gl.uniform1f(u.u_amp, f.amp);
      gl.uniform1f(u.u_listen, f.listening ? 1 : 0);
      gl.uniform1f(u.u_level, f.level);
      gl.uniform1f(u.u_scale, f.scale);
      gl.uniform1f(u.u_focal, FOCAL * f.scale);
      gl.uniform3fv(u.u_back, f.back);
      gl.uniform3fv(u.u_front, f.front);
      gl.enableVertexAttribArray(aP);

      gl.uniform1f(u.u_wire, 1);
      gl.uniform1f(u.u_wireAlpha, 0.07 + f.level * 0.12);
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
      gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, wire.length / 4);

      gl.uniform1f(u.u_wire, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disableVertexAttribArray(aP);
    }
  };
}
