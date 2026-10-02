'use strict';
// Procedural terrain shared by physics (ground contact) and rendering (mesh displacement).
// Heights are metres above the body's reference radius R, as a function of the planet-fixed
// unit direction d. minWave (m) drops octaves/craters finer than the sampling resolution.

// ---- 3D simplex noise (Gustavson), seeded permutation ----
const _G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];
function makeSimplex(seed) {
  const r = rng(seed), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm[i] = (perm[i] % 12) * 3; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function (x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) { g = pm[ii + perm[jj + perm[kk]]]; tt *= tt; n += tt * tt * (_G3[g] * x0 + _G3[g + 1] * y0 + _G3[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]; tt *= tt; n += tt * tt * (_G3[g] * x1 + _G3[g + 1] * y1 + _G3[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]; tt *= tt; n += tt * tt * (_G3[g] * x2 + _G3[g + 1] * y2 + _G3[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]; tt *= tt; n += tt * tt * (_G3[g] * x3 + _G3[g + 1] * y3 + _G3[g + 2] * z3); }
    return 32 * n;
  };
}

// integer hash -> [0,1)
function _h3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---- terrain description per body ----
// base: [frequency, octaves, amplitude m]; ridge: [freq, oct, amp]; craters: [[freq, density, depthRatio], ...]
function terrainSpec(b) {
  const R = b.R, v = b.vis;
  if (b.gas || v.type === 'star') return null;
  const s = { seed: [...b.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0 };
  switch (b.id) {
    case 'earth': return Object.assign(s, { kind: 'earth', base: [1.6, 9, 1], ridge: [8, 7, 3400], hills: [40, 5, 160], sea: 0, ksc: true });
    case 'moon': return Object.assign(s, { kind: 'cratered', base: [2.2, 8, 1400], maria: [1.1, 2600], craters: [[5, 0.55, 0.22], [13, 0.5, 0.2], [34, 0.45, 0.17], [90, 0.4, 0.14], [240, 0.35, 0.12], [640, 0.3, 0.1]] });
    case 'mars': return Object.assign(s, { kind: 'cratered', base: [1.8, 9, 3200], ridge: [6, 6, 2200], bulge: [[0.3, 0.9, 0.3], 0.55, 9000], craters: [[9, 0.35, 0.15], [26, 0.35, 0.12], [80, 0.3, 0.1], [220, 0.25, 0.08]] });
    case 'mercury': return Object.assign(s, { kind: 'cratered', base: [2.2, 8, 1200], craters: [[6, 0.6, 0.22], [16, 0.55, 0.2], [42, 0.5, 0.17], [110, 0.45, 0.14], [300, 0.4, 0.12]] });
    case 'venus': return Object.assign(s, { kind: 'rough', base: [1.7, 9, 2600], ridge: [7, 6, 1800], craters: [[20, 0.15, 0.08]] });
    case 'titan': return Object.assign(s, { kind: 'rough', base: [2.0, 8, 700], ridge: [10, 5, 500], sea: -260 });
    case 'io': return Object.assign(s, { kind: 'rough', base: [2.2, 8, 1300], ridge: [9, 5, 1600], calderas: true });
    case 'europa': return Object.assign(s, { kind: 'ice', base: [2.0, 7, 250], cracks: [7, 260], craters: [[60, 0.08, 0.06]] });
    case 'enceladus': return Object.assign(s, { kind: 'ice', base: [2.2, 7, 300], cracks: [5, 400], craters: [[20, 0.35, 0.12], [60, 0.3, 0.1]] });
    case 'triton': case 'pluto': return Object.assign(s, { kind: 'ice', base: [2.0, 8, 900], cracks: [6, 300], craters: [[14, 0.25, 0.12], [40, 0.25, 0.1]] });
    case 'phobos': case 'deimos': return Object.assign(s, { kind: 'lumpy', base: [1.3, 7, R * 0.16], craters: [[3, 0.6, 0.3], [9, 0.55, 0.25], [27, 0.5, 0.2]] });
  }
  if (v.type === 'ice') return Object.assign(s, { kind: 'ice', base: [2.0, 8, Math.min(1200, R * 0.012)], cracks: [6, Math.min(400, R * 0.004)], craters: [[10, 0.4, 0.14], [30, 0.4, 0.12], [90, 0.35, 0.1]] });
  // generic rocky moon
  return Object.assign(s, { kind: 'cratered', base: [2.2, 8, Math.min(1800, R * 0.012)], craters: [[6, 0.55, 0.2], [16, 0.5, 0.18], [44, 0.45, 0.15], [120, 0.4, 0.12], [330, 0.35, 0.1]] });
}

const _noiseCache = {};
function _noiseFor(seed) { return _noiseCache[seed] || (_noiseCache[seed] = makeSimplex(seed)); }

function _fbm(N, x, y, z, f, oct, R, minWave) {
  let a = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const wave = TAU * R / f;
    if (wave < minWave * 2 && i > 0) break;
    s += a * N(x * f + i * 17.1, y * f - i * 9.3, z * f + i * 3.7);
    norm += a; a *= 0.5; f *= 2.03;
  }
  return s / 1.6;
}
function _ridged(N, x, y, z, f, oct, R, minWave) {
  let a = 1, s = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    const wave = TAU * R / f;
    if (wave < minWave * 2 && i > 0) break;
    let n = 1 - Math.abs(N(x * f + 31.7 + i * 5.1, y * f + 11.3, z * f - 7.9 - i * 2.3));
    n *= n * w;
    w = clamp(n * 1.6, 0, 1);
    s += a * n; a *= 0.5; f *= 2.1;
  }
  return s * 0.55;
}
function _craters(x, y, z, freq, density, depth, seed, R, minWave) {
  const qx = x * freq, qy = y * freq, qz = z * freq;
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  const fx = qx - ix, fy = qy - iy, fz = qz - iz;
  // a crater (centre within [0.15,0.85] of its cell, reach <= 0.81 cells) can only touch nearby cells
  const x0 = fx < 0.66 ? -1 : 0, x1 = fx > 0.34 ? 1 : 0, y0 = fy < 0.66 ? -1 : 0, y1 = fy > 0.34 ? 1 : 0, z0 = fz < 0.66 ? -1 : 0, z1 = fz > 0.34 ? 1 : 0;
  let h = 0;
  for (let dz = z0; dz <= z1; dz++) for (let dy = y0; dy <= y1; dy++) for (let dx = x0; dx <= x1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    if (_h3(cx, cy, cz, seed + 4) > density) continue;
    const r1 = _h3(cx, cy, cz, seed + 1), r2 = _h3(cx, cy, cz, seed + 2), r3 = _h3(cx, cy, cz, seed + 3);
    const rad = 0.12 + 0.3 * r1 * r1;
    if (rad / freq * R < minWave * 1.5) continue;
    const ex = fx - (dx + 0.15 + 0.7 * r1), ey = fy - (dy + 0.15 + 0.7 * r2), ez = fz - (dz + 0.15 + 0.7 * r3);
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez) / rad;
    if (d > 1.9) continue;
    const bowl = d < 1 ? (d * d - 1) * (1 - 0.35 * Math.exp(-d * d * 9) * (rad > 0.3 ? 1 : 0)) : 0;
    const rq = (d - 1) * 3.2, rim = Math.exp(-rq * rq);
    h += (bowl * 0.85 + rim * 0.32) * rad / freq * depth;
  }
  return h;
}

// height (m) at planet-fixed unit direction d
function terrainHeight(b, d, minWave) {
  const T = b.terrain;
  if (!T) return 0;
  minWave = minWave || 4;
  const N = _noiseFor(T.seed), R = b.R;
  const x = d[0], y = d[1], z = d[2];
  let h = 0;
  if (T.kind === 'earth') {
    const cont = _fbm(N, x, y, z, T.base[0], T.base[1], R, minWave) - 0.06 + 0.05 * N(x * 6.1, y * 6.1 + 4, z * 6.1);
    if (cont < 0) h = cont * 4200;
    else {
      const mount = _ridged(N, x, y, z, T.ridge[0], T.ridge[1], R, minWave) * smooth(0.04, 0.32, cont);
      const hills = _fbm(N, x + 3, y, z, T.hills[0], T.hills[1], R, minWave);
      h = cont * 700 + mount * T.ridge[2] + hills * T.hills[2] * smooth(0.0, 0.05, cont) + 2;
    }
    if (T.ksc) {
      // flat launch site: blend to a 1 m plateau within ~3 km of the pad
      const kd = Math.hypot(x - _KSC_DIR[0], y - _KSC_DIR[1], z - _KSC_DIR[2]) * R;
      const f = smooth(2500, 7000, kd);
      h = h * f + 1 * (1 - f);
      if (kd < 9000 && h < 1) h = lerp(1, h, smooth(7000, 9000, kd));
    }
    return h;
  }
  const base = _fbm(N, x, y, z, T.base[0], T.base[1], R, minWave);
  h = base * T.base[2];
  if (T.ridge) h += _ridged(N, x, y, z, T.ridge[0], T.ridge[1], R, minWave) * T.ridge[2];
  if (T.maria) { const m = smooth(0.0, 0.35, _fbm(N, x + 9, y - 4, z + 2, T.maria[0], 3, R, minWave)); h -= m * T.maria[1]; }
  if (T.bulge) { const [c, w, a] = T.bulge; const cn = V.norm(c); const dd = 1 - (x * cn[0] + y * cn[1] + z * cn[2]); h += a * Math.exp(-dd * dd / (w * w * 0.02)); }
  if (T.cracks) { const c = 1 - Math.abs(N(x * T.cracks[0] + 50, y * T.cracks[0], z * T.cracks[0])); h += Math.pow(c, 12) * T.cracks[1]; }
  if (T.craters) for (let i = 0; i < T.craters.length; i++) {
    const c = T.craters[i];
    if (0.42 / c[0] * R < minWave * 1.5) break; // levels are ordered coarse -> fine
    h += _craters(x, y, z, c[0], c[1], c[2], T.seed + i * 101, R, minWave) * R;
  }
  if (T.calderas) h += _craters(x, y, z, 7, 0.3, -0.1, T.seed + 777, R, minWave) * R;
  return h;
}

// launch pad deck: the launch site props sit KSC_DECK above the 1 m plateau
const KSC_DECK = 1.25, KSC_DECK_R = 21;
// physical ground height: liquid surfaces are flat at sea level, the pad deck is solid
function groundHeight(b, d, minWave) {
  if (b.id === 'earth') {
    const kd = Math.hypot(d[0] - _KSC_DIR[0], d[1] - _KSC_DIR[1], d[2] - _KSC_DIR[2]) * b.R;
    if (kd < KSC_DECK_R) return KSC_DECK;
  }
  const h = terrainHeight(b, d, minWave);
  return b.terrain && b.terrain.sea != null ? Math.max(h, b.terrain.sea) : h;
}

let _KSC_DIR = [1, 0, 0];
(function initTerrain() {
  for (const b of BODIES) {
    b.terrain = terrainSpec(b);
    if (!b.terrain) { b.hMax = 0; continue; }
    const T = b.terrain;
    // conservative upper bound used by time warp to stop before mountains
    let m = (T.base ? Math.abs(T.base[2]) : 0) + (T.ridge ? T.ridge[2] : 0) + (T.bulge ? T.bulge[2] : 0) + (T.cracks ? T.cracks[1] : 0);
    if (T.kind === 'earth') m = 700 + T.ridge[2] + T.hills[2];
    if (T.craters) m += b.R * 0.05 * 0.3;
    b.hMax = m;
  }
  _KSC_DIR = V.norm(surfacePoint(BODY.earth, KSC.lat, KSC.lon, 0));
})();

// ground under a world-frame point near the body: {h, n (inertial unit normal), water}
function groundAt(b, t, rel) {
  const df = V.norm(inertialToBodyFixed(b, t, rel));
  const h = groundHeight(b, df, 3);
  // normal from two tangent samples
  const e1 = V.perp(df), e2 = V.cross(df, e1), eps = 6 / b.R;
  const d1 = V.norm(V.addS(df, e1, eps)), d2 = V.norm(V.addS(df, e2, eps));
  const p0 = V.scale(df, b.R + h), p1 = V.scale(d1, b.R + groundHeight(b, d1, 3)), p2 = V.scale(d2, b.R + groundHeight(b, d2, 3));
  let n = V.norm(V.cross(V.sub(p1, p0), V.sub(p2, p0)));
  if (V.dot(n, df) < 0) n = V.neg(n);
  const water = !!(b.terrain && b.terrain.sea != null && terrainHeight(b, df, 30) < b.terrain.sea);
  return { h, nF: n, n: bodyFixedToInertial(b, t, n), water, dF: df };
}
