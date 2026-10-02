'use strict';
// The Solar System, uniformly rescaled 1:10 with surface gravity preserved:
//   lengths x0.1, GM x0.01  =>  velocities x1/sqrt(10), times x1/sqrt(10).
// Orbits: planets use JPL J2000 mean elements; moons use real a/e and approximate
// angles. Simplification: no axial tilt — every body spins about the ecliptic pole.
// Atmospheres are gameplay-tuned (a literal 1:10 scale height would be ~1 km).

const SCALE_L = 0.1, SCALE_GM = 0.01, SCALE_T = 1 / Math.sqrt(10);
const AU = 1.495978707e11;
const DAY = 86400 * SCALE_T;      // game day = scaled Earth solar day (~7.6 h)
const YEAR_DAYS = 365;

// sci: science multipliers [landed, flyingLow, flyingHigh, spaceLow, spaceHigh]
// vis: renderer hints. diff: contract difficulty tier.
const BODY_DATA = [
  { id: 'sun', name: 'Солнце', gm: 1.32712440018e20, r: 695700, rot: 25.38, sci: [0, 0, 0, 11, 2], diff: 9,
    vis: { type: 'star', c: ['#fff1c8', '#ffb347', '#ff8a1e'] } },

  { id: 'mercury', name: 'Меркурий', parent: 'sun', gm: 2.2032e13, r: 2439.7, rot: 58.6462,
    jpl: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    sci: [12, 0, 0, 8, 7], diff: 4, vis: { type: 'rocky', c: ['#8f8984', '#5e5a55', '#b3aca4'], crat: 1 } },

  { id: 'venus', name: 'Венера', parent: 'sun', gm: 3.24859e14, r: 6051.8, rot: -243.025,
    jpl: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    atm: { p0: 9200, rho0: 65, H: 5.5, top: 100, sky: [0.95, 0.75, 0.45] },
    sci: [8, 6, 6, 7, 5], diff: 3, vis: { type: 'cloud', c: ['#ecd9a9', '#c9a86a', '#f6ead0'] } },

  { id: 'earth', name: 'Земля', parent: 'sun', gm: 3.986004418e14, r: 6371, rot: 0.99726968,
    jpl: [1.00000261, 0.01671123, 0, 100.46457166, 102.93768193, 0.0],
    atm: { p0: 101.325, rho0: 1.225, H: 5.6, top: 70, sky: [0.32, 0.55, 1.0] },
    sci: [0.3, 0.7, 0.9, 1, 1.5], diff: 0, vis: { type: 'earth', c: ['#1d4f8f', '#3f7a3a', '#c9b98a'] } },

  { id: 'moon', name: 'Луна', parent: 'earth', gm: 4.9048695e12, r: 1737.4, lock: true,
    kep: [384399, 0.0549, 5.145, 125.08, 318.15, 135.27],
    sci: [4, 0, 0, 3, 2], diff: 1, vis: { type: 'rocky', c: ['#a3a19c', '#5c5a57', '#c4c2bd'], crat: 1, maria: 1 } },

  { id: 'mars', name: 'Марс', parent: 'sun', gm: 4.282837e13, r: 3389.5, rot: 1.025957,
    jpl: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    atm: { p0: 0.636, rho0: 0.020, H: 3.5, top: 30, sky: [0.85, 0.6, 0.45] },
    sci: [8, 5, 5, 7, 5], diff: 2, vis: { type: 'rocky', c: ['#c2562a', '#7a3418', '#d98a5a'], crat: 0.5, caps: 1 } },
  { id: 'phobos', name: 'Фобос', parent: 'mars', gm: 7.087e5, r: 11.27, lock: true,
    kep: [9376, 0.0151, 1.08, 16.9, 150.1, 92], sci: [9, 0, 0, 7, 5], diff: 3,
    vis: { type: 'rocky', c: ['#7a6e64', '#4e463f', '#8f8379'], crat: 1 } },
  { id: 'deimos', name: 'Деймос', parent: 'mars', gm: 9.8e4, r: 6.2, lock: true,
    kep: [23463.2, 0.00033, 1.79, 47, 260.7, 296], sci: [9, 0, 0, 7, 5], diff: 3,
    vis: { type: 'rocky', c: ['#857a6f', '#5a5047', '#9a8f84'], crat: 1 } },

  { id: 'ceres', name: 'Церера', parent: 'sun', gm: 6.26325e10, r: 469.7, rot: 0.3781,
    kep: [2.7675 * AU / 1e3, 0.0758, 10.59, 80.3, 73.6, 77.4], sci: [10, 0, 0, 8, 7], diff: 4,
    vis: { type: 'rocky', c: ['#8a8580', '#56524e', '#a9a49e'], crat: 1 } },

  { id: 'jupiter', name: 'Юпитер', parent: 'sun', gm: 1.26686534e17, r: 69911, rot: 0.41354, gas: true,
    jpl: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    atm: { p0: 100, rho0: 0.16, H: 8, top: 120, sky: [0.8, 0.7, 0.55] },
    sci: [0, 12, 12, 7, 6], diff: 5, vis: { type: 'gas', c: ['#d9c9a6', '#a8774a', '#efe4cc'], bands: 15, spot: 1 } },
  { id: 'io', name: 'Ио', parent: 'jupiter', gm: 5.959916e12, r: 1821.6, lock: true,
    kep: [421700, 0.0041, 2.2, 337, 84, 171], sci: [12, 0, 0, 9, 8], diff: 6,
    vis: { type: 'rocky', c: ['#e3cf63', '#a8742c', '#f2e7a6'], crat: 0.2, volc: 1 } },
  { id: 'europa', name: 'Европа', parent: 'jupiter', gm: 3.202739e12, r: 1560.8, lock: true,
    kep: [671034, 0.009, 2.2, 337, 88, 324], sci: [12, 0, 0, 9, 8], diff: 6,
    vis: { type: 'ice', c: ['#ddd3c4', '#9a6a44', '#f4efe6'] } },
  { id: 'ganymede', name: 'Ганимед', parent: 'jupiter', gm: 9.887834e12, r: 2634.1, lock: true,
    kep: [1070412, 0.0013, 2.2, 337, 192, 317], sci: [11, 0, 0, 8, 7], diff: 6,
    vis: { type: 'rocky', c: ['#a09382', '#6a5e52', '#c9beb0'], crat: 0.8 } },
  { id: 'callisto', name: 'Каллисто', parent: 'jupiter', gm: 7.179289e12, r: 2410.3, lock: true,
    kep: [1882709, 0.0074, 2.2, 337, 52, 181], sci: [11, 0, 0, 8, 7], diff: 6,
    vis: { type: 'rocky', c: ['#6e6155', '#3e3630', '#9a8c7e'], crat: 1.2 } },

  { id: 'saturn', name: 'Сатурн', parent: 'sun', gm: 3.7931187e16, r: 58232, rot: 0.44401, gas: true, rings: [1.24, 2.27],
    jpl: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    atm: { p0: 100, rho0: 0.19, H: 9, top: 130, sky: [0.85, 0.78, 0.6] },
    sci: [0, 13, 13, 8, 7], diff: 7, vis: { type: 'gas', c: ['#e3d3a6', '#c19f63', '#f2e8cc'], bands: 11 } },
  { id: 'mimas', name: 'Мимас', parent: 'saturn', gm: 2.503e9, r: 198.2, lock: true,
    kep: [185539, 0.0196, 28, 169.5, 332, 14], sci: [12, 0, 0, 9, 8], diff: 8, vis: { type: 'rocky', c: ['#c9c6c0', '#8a8781', '#e2dfd9'], crat: 1.4 } },
  { id: 'enceladus', name: 'Энцелад', parent: 'saturn', gm: 7.211e9, r: 252.1, lock: true,
    kep: [237948, 0.0047, 28, 169.5, 211, 57], sci: [13, 0, 0, 9, 8], diff: 8, vis: { type: 'ice', c: ['#f2f5f7', '#b9c8d4', '#ffffff'] } },
  { id: 'tethys', name: 'Тефия', parent: 'saturn', gm: 4.121e10, r: 531.1, lock: true,
    kep: [294619, 0.0001, 28, 169.5, 262, 189], sci: [12, 0, 0, 9, 8], diff: 8, vis: { type: 'rocky', c: ['#dcdad5', '#9a9893', '#efedea'], crat: 1 } },
  { id: 'dione', name: 'Диона', parent: 'saturn', gm: 7.311e10, r: 561.4, lock: true,
    kep: [377396, 0.0022, 28, 169.5, 168, 284], sci: [12, 0, 0, 9, 8], diff: 8, vis: { type: 'rocky', c: ['#d6d2cb', '#8f8b84', '#ebe8e2'], crat: 1 } },
  { id: 'rhea', name: 'Рея', parent: 'saturn', gm: 1.539e11, r: 763.8, lock: true,
    kep: [527108, 0.0013, 28, 169.5, 256, 31], sci: [12, 0, 0, 9, 8], diff: 8, vis: { type: 'rocky', c: ['#cbc7c0', '#85817a', '#e4e1db'], crat: 1.2 } },
  { id: 'titan', name: 'Титан', parent: 'saturn', gm: 8.978e12, r: 2574.7, lock: true,
    kep: [1221870, 0.0288, 28, 169.5, 186, 163],
    atm: { p0: 146.7, rho0: 5.4, H: 5, top: 60, sky: [0.95, 0.6, 0.25] },
    sci: [15, 12, 12, 10, 9], diff: 7, vis: { type: 'cloud', c: ['#d9993c', '#a5662a', '#e8b866'] } },
  { id: 'iapetus', name: 'Япет', parent: 'saturn', gm: 1.205e11, r: 734.5, lock: true,
    kep: [3560820, 0.0286, 17, 140, 271, 356], sci: [13, 0, 0, 9, 8], diff: 8, vis: { type: 'rocky', c: ['#e6e0d6', '#2e2620', '#f5f1ea'], crat: 0.8, twotone: 1 } },

  { id: 'uranus', name: 'Уран', parent: 'sun', gm: 5.793939e15, r: 25362, rot: -0.71833, gas: true,
    jpl: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    atm: { p0: 100, rho0: 0.42, H: 7, top: 100, sky: [0.6, 0.85, 0.9] },
    sci: [0, 14, 14, 9, 8], diff: 9, vis: { type: 'gas', c: ['#a9dde2', '#86c3cc', '#c8eef0'], bands: 6 } },
  { id: 'miranda', name: 'Миранда', parent: 'uranus', gm: 4.4e9, r: 235.8, lock: true,
    kep: [129390, 0.0013, 97.8, 167.6, 68, 311], sci: [14, 0, 0, 10, 9], diff: 10, vis: { type: 'rocky', c: ['#b9b6b2', '#77746f', '#d6d3cf'], crat: 0.8 } },
  { id: 'ariel', name: 'Ариэль', parent: 'uranus', gm: 8.35e10, r: 578.9, lock: true,
    kep: [190900, 0.0012, 97.8, 167.6, 115, 39], sci: [14, 0, 0, 10, 9], diff: 10, vis: { type: 'rocky', c: ['#bdb9b4', '#7a7671', '#d9d6d2'], crat: 0.8 } },
  { id: 'umbriel', name: 'Умбриэль', parent: 'uranus', gm: 8.51e10, r: 584.7, lock: true,
    kep: [266000, 0.0039, 97.8, 167.6, 84, 12], sci: [14, 0, 0, 10, 9], diff: 10, vis: { type: 'rocky', c: ['#6f6c69', '#45423f', '#8a8783'], crat: 1 } },
  { id: 'titania', name: 'Титания', parent: 'uranus', gm: 2.269e11, r: 788.4, lock: true,
    kep: [435910, 0.0011, 97.8, 167.6, 284, 24], sci: [14, 0, 0, 10, 9], diff: 10, vis: { type: 'rocky', c: ['#a8a29b', '#6e6862', '#c9c4bd'], crat: 1 } },
  { id: 'oberon', name: 'Оберон', parent: 'uranus', gm: 2.053e11, r: 761.4, lock: true,
    kep: [583520, 0.0014, 97.8, 167.6, 104, 283], sci: [14, 0, 0, 10, 9], diff: 10, vis: { type: 'rocky', c: ['#9a928a', '#5f5852', '#bbb3aa'], crat: 1.1 } },

  { id: 'neptune', name: 'Нептун', parent: 'sun', gm: 6.836529e15, r: 24622, rot: 0.6713, gas: true,
    jpl: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    atm: { p0: 100, rho0: 0.45, H: 6, top: 90, sky: [0.35, 0.5, 0.95] },
    sci: [0, 15, 15, 10, 9], diff: 10, vis: { type: 'gas', c: ['#4a70d8', '#2f4ea8', '#7d9ef0'], bands: 8, spot: 1 } },
  { id: 'triton', name: 'Тритон', parent: 'neptune', gm: 1.428e12, r: 1353.4, lock: true,
    kep: [354759, 0.000016, 130, 177, 0, 264], sci: [16, 0, 0, 11, 10], diff: 11, vis: { type: 'ice', c: ['#dccbc2', '#a98a80', '#f0e6e0'] } },

  { id: 'pluto', name: 'Плутон', parent: 'sun', gm: 8.71e11, r: 1188.3, rot: -6.387,
    jpl: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    sci: [18, 0, 0, 13, 12], diff: 12, vis: { type: 'ice', c: ['#d9c2a2', '#8a5a3a', '#f2e6d6'], heart: 1 } },
  { id: 'charon', name: 'Харон', parent: 'pluto', gm: 1.058e11, r: 606, lock: true,
    kep: [19591, 0.0002, 112.9, 223, 147, 81], sci: [18, 0, 0, 13, 12], diff: 12, vis: { type: 'rocky', c: ['#a19b95', '#5f5953', '#c2bcb5'], crat: 0.9 } },
];

const BODIES = [];
const BODY = {};

(function buildBodies() {
  for (const d of BODY_DATA) {
    const b = {
      id: d.id, name: d.name, mu: d.gm * SCALE_GM, R: d.r * 1e3 * SCALE_L,
      gas: !!d.gas, rings: d.rings || null, sci: d.sci, diff: d.diff, vis: d.vis,
      parent: d.parent ? BODY[d.parent] : null, children: [], lock: !!d.lock,
    };
    b.g0 = b.mu / (b.R * b.R);
    if (d.atm) {
      b.atm = { p0: d.atm.p0, rho0: d.atm.rho0, H: d.atm.H * 1e3, top: d.atm.top * 1e3, sky: d.atm.sky };
    }
    if (b.parent) {
      const pmu = b.parent.mu;
      if (d.jpl) {
        const [aAU, e, i, L, lp, node] = d.jpl;
        b.el = elFromKepler(aAU * AU * SCALE_L, e, i, node, lp - node, L - lp, pmu, 0);
      } else {
        const [aKm, e, i, node, argp, M0] = d.kep;
        b.el = elFromKepler(aKm * 1e3 * SCALE_L, e, i, node, argp, M0, pmu, 0);
      }
      b.soi = Math.max(b.el.a * Math.pow(b.mu / pmu, 0.4), b.R * 3);
      b.parent.children.push(b);
    } else {
      b.soi = Infinity;
    }
    if (b.lock) b.rotPeriod = b.el.T;
    else b.rotPeriod = d.rot * 86400 * SCALE_T;
    b.rot0 = 0;
    // situation thresholds
    b.flyHigh = b.atm ? b.atm.top * 0.26 : 0;
    b.spaceHigh = Math.max(b.R * 0.4, b.atm ? b.atm.top * 2 : 0);
    BODIES.push(b);
    BODY[b.id] = b;
  }
  // tidally locked moons: prime meridian faces the parent at t = 0
  for (const b of BODIES) {
    if (b.lock) { const s = elState(b.el, 0); b.rot0 = Math.atan2(-s.r[1], -s.r[0]); }
  }
  // Earth: launch site (lon 0, lat 0) starts in the local morning (~9:00)
  const e = BODY.earth, es = elState(e.el, 0);
  e.rot0 = Math.atan2(-es.r[1], -es.r[0]) - 45 * DEG;
})();

// ---- body kinematics ----
function bodyRelState(b, t) {
  if (!b.parent) return { r: [0, 0, 0], v: [0, 0, 0] };
  return elState(b.el, t);
}
// position / velocity relative to the Sun
function bodyAbsState(b, t) {
  let r = [0, 0, 0], v = [0, 0, 0];
  for (let c = b; c.parent; c = c.parent) { const s = elState(c.el, t); r = V.add(r, s.r); v = V.add(v, s.v); }
  return { r, v };
}
function bodyAbsPos(b, t) { return bodyAbsState(b, t).r; }
function bodyRotAngle(b, t) { return b.rot0 + TAU * t / b.rotPeriod; }
function bodyOmega(b) { return [0, 0, TAU / b.rotPeriod]; }
// body-fixed <-> inertial (rotation about +Z)
function bodyFixedToInertial(b, t, p) { return V.rotZ(p, bodyRotAngle(b, t)); }
function inertialToBodyFixed(b, t, p) { return V.rotZ(p, -bodyRotAngle(b, t)); }
function bodyRotQuat(b, t) { const a = bodyRotAngle(b, t); return [0, 0, Math.sin(a / 2), Math.cos(a / 2)]; }

// lat/lon (radians) of an inertial position relative to the body
function latLon(b, t, r) {
  const f = inertialToBodyFixed(b, t, r);
  return { lat: Math.atan2(f[2], Math.hypot(f[0], f[1])), lon: Math.atan2(f[1], f[0]) };
}
function surfacePoint(b, lat, lon, alt) {
  const R = b.R + (alt || 0);
  return [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
}

// atmosphere at altitude h (m): pressure in atm, density kg/m^3
function atmAt(b, h) {
  const a = b.atm;
  if (!a || h > a.top) return { p: 0, rho: 0 };
  const f = Math.exp(-Math.max(h, -a.H * 3) / a.H);
  const fade = h > a.top * 0.9 ? 1 - (h - a.top * 0.9) / (a.top * 0.1) : 1;
  return { p: a.p0 / 101.325 * f * fade, rho: a.rho0 * f * fade };
}

// Solar flux factor relative to Earth's distance, plus shadow test
function sunExposure(bodyOfVessel, rRel, t) {
  const pAbs = V.add(bodyAbsPos(bodyOfVessel, t), rRel);
  const d = V.len(pAbs);
  const dEarth = BODY.earth.el.a;
  let f = (dEarth * dEarth) / (d * d);
  // cylindrical shadow of the current body
  if (bodyOfVessel.parent) {
    const sunDir = V.norm(V.neg(bodyAbsPos(bodyOfVessel, t)));
    const along = V.dot(rRel, sunDir);
    if (along < 0 && V.len(V.reject(rRel, sunDir)) < bodyOfVessel.R) f = 0;
  }
  return f;
}

const KSC = { body: 'earth', lat: 0, lon: 0 };
