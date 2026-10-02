'use strict';
// Double-precision vector / quaternion helpers. Physics frame: inertial ecliptic,
// +Z = ecliptic north. Vectors are plain arrays [x, y, z]; quaternions [x, y, z, w].

const G0 = 9.80665;          // standard gravity, m/s^2 (Isp conversion)
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  addS: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  len2: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  norm: (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
  neg: (a) => [-a[0], -a[1], -a[2]],
  dist: (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2),
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  copy: (a) => [a[0], a[1], a[2]],
  // component of a perpendicular to unit vector n
  reject: (a, n) => { const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]; return [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d]; },
  // any unit vector perpendicular to a
  perp: (a) => { const n = V.norm(a); const t = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; return V.norm(V.cross(n, t)); },
  rotZ: (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c, a[2]]; },
};

const Q = {
  ident: () => [0, 0, 0, 1],
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  norm: (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
  rot: (q, v) => {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
      v[0] + q[3] * tx + q[1] * tz - q[2] * ty,
      v[1] + q[3] * ty + q[2] * tx - q[0] * tz,
      v[2] + q[3] * tz + q[0] * ty - q[1] * tx,
    ];
  },
  invRot: (q, v) => Q.rot([-q[0], -q[1], -q[2], q[3]], v),
  axisAngle: (axis, ang) => { const n = V.norm(axis), s = Math.sin(ang / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; },
  // rotation taking unit u onto unit v (shortest arc)
  fromTo: (u, v) => {
    const d = V.dot(u, v);
    if (d < -0.999999) { const ax = V.perp(u); return [ax[0], ax[1], ax[2], 0]; }
    const c = V.cross(u, v);
    return Q.norm([c[0], c[1], c[2], 1 + d]);
  },
  // quaternion whose rotated basis is (x, y, z) columns (must be orthonormal)
  fromBasis: (x, y, z) => {
    const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
    else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    return Q.norm(q);
  },
  // integrate body-frame angular velocity w over dt
  integrate: (q, w, dt) => {
    const dq = Q.mul(q, [w[0], w[1], w[2], 0]);
    return Q.norm([q[0] + 0.5 * dq[0] * dt, q[1] + 0.5 * dq[1] * dt, q[2] + 0.5 * dq[2] * dt, q[3] + 0.5 * dq[3] * dt]);
  },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const wrap2Pi = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

// Deterministic PRNG (mulberry32) for contracts / procedural bits
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- formatting ----
function fmtDist(m) {
  const a = Math.abs(m);
  if (!isFinite(m)) return '—';
  if (a < 1e4) return m.toFixed(0) + ' м';
  if (a < 1e7) return (m / 1e3).toFixed(a < 1e5 ? 2 : 1) + ' км';
  if (a < 1e10) return (m / 1e6).toFixed(2) + ' Мм';
  return (m / 1e9).toFixed(2) + ' Гм';
}
function fmtSpeed(v) { return Math.abs(v) < 1e4 ? v.toFixed(1) + ' м/с' : (v / 1e3).toFixed(2) + ' км/с'; }
// Game calendar: 1 day = scaled Earth solar day (see bodies.js DAY)
function fmtDur(s, short) {
  if (!isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const d = Math.floor(s / DAY), rem = s - d * DAY;
  const h = Math.floor(rem / 3600), m = Math.floor((rem % 3600) / 60), sec = Math.floor(rem % 60);
  const y = Math.floor(d / YEAR_DAYS), dd = d % YEAR_DAYS;
  let out;
  if (y > 0) out = `${y}г ${dd}д ${h}ч`;
  else if (d > 0) out = short ? `${d}д ${h}ч ${m}м` : `${d}д ${h}ч ${m}м ${sec}с`;
  else if (h > 0) out = `${h}ч ${m}м ${sec}с`;
  else if (m > 0) out = `${m}м ${sec}с`;
  else out = `${sec}с`;
  return (neg ? '-' : '') + out;
}
// ---- calendar ----
// Game time 0 is J2000 (1 Jan 2000, 12:00). The planets move on real J2000 elements and the 1:10 system runs
// sqrt(10) times faster, so one game day is exactly one calendar day: dates match the real sky.
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function utToDate(ut) { return new Date(J2000_MS + ut * Math.sqrt(10) * 1000); }
function dateToUt(ms) { return (ms - J2000_MS) / 1000 / Math.sqrt(10); }
function fmtDay(ut) { const d = utToDate(ut); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtDate(ut) {
  const d = utToDate(ut), p = (x) => String(x).padStart(2, '0');
  return `${fmtDay(ut)}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function fmtMoney(x) { return (x < 0 ? '-' : '') + '√' + Math.round(Math.abs(x)).toLocaleString('ru-RU'); }
function fmtMass(t) { return t < 10 ? t.toFixed(3) + ' т' : t.toFixed(1) + ' т'; }
