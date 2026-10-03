'use strict';
// The Solar System, uniformly rescaled 1:10 with surface gravity preserved:
//   lengths x0.1, GM x0.01  =>  velocities x1/sqrt(10), times x1/sqrt(10).
// Orbits: planets use JPL J2000 mean elements; moons use real a/e and approximate
// angles. Simplification: no axial tilt — every body spins about the ecliptic pole.
// Atmospheres are gameplay-tuned (a literal 1:10 scale height would be ~1 km).

const SCALE_L = 0.1, SCALE_GM = 0.01, SCALE_T = 1 / Math.sqrt(10);
// light is scaled like every other speed (x1/sqrt 10): a game light-year is then exactly a scaled real one,
// and a Schwarzschild radius 2GM/c^2 scales like every other radius (x0.1)
const C_LIGHT = 299792458 * Math.sqrt(SCALE_GM / SCALE_L);
const AU = 1.495978707e11;
const PC = 3.0856775814913673e16;   // parsec, m (real; star distances get SCALE_L like everything else)
const GM_SUN = 1.32712440018e20, GM_EARTH = 3.986004418e14, GM_JUP = 1.26686534e17, R_SUN = 695700, R_EARTH = 6371;
const OBLIQ = 23.4392911 * DEG;     // J2000 obliquity: equatorial -> ecliptic
// unit vector (ecliptic J2000) of a catalogue position: RA in hours, Dec in degrees
function eqToEcl(raH, decDeg) {
  const a = raH * 15 * DEG, d = decDeg * DEG, x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
  const c = Math.cos(OBLIQ), s = Math.sin(OBLIQ);
  return [x, c * y + s * z, -s * y + c * z];
}
// semi-major axis (km, real) of a planet with period `days` around a star of `gmStar` (real)
function aFromPeriod(gmStar, days) { const T = days * 86400; return Math.cbrt(gmStar * T * T / (4 * Math.PI * Math.PI)) / 1e3; }
const DAY = 86400 * SCALE_T;      // game day = scaled Earth solar day (~7.6 h)
const YEAR_DAYS = 365;
const LY = C_LIGHT * 365.25 * DAY;  // game light-year, 9.46e14 m

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
    atm: { p0: 101.325, rho0: 1.225, H: 5.6, top: 70, sky: [0.32, 0.55, 1.0], oxygen: true },
    sci: [0.3, 0.7, 0.9, 1, 1.5], diff: 0, vis: { type: 'earth', c: ['#1d4f8f', '#3f7a3a', '#c9b98a'] } },

  { id: 'moon', name: 'Луна', parent: 'earth', gm: 4.9048695e12, r: 1737.4, lock: true,
    kep: [384748, 0.0549, 5.145, 125.08, 318.15, 135.27],   // a tuned so the two-body period is the real sidereal month (27.3217 d; the Sun stretches it)
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

  // ---- other stars: real catalogue positions (HYG), masses, radii and bolometric luminosities.
  // Planets: real periods/masses; radii of RV-only planets are assumed from their mass, atmospheres and
  // surfaces are game assumptions. Orbit orientations around another star are not the real ones.
  // star: { ra (h), dec (deg), pc } places a star; aAU sets its (bound) orbit around the parent star instead of a circle.
  { id: 'acena', name: 'Альфа Центавра A', parent: 'sun', gm: 1.0788 * GM_SUN, r: 1.2175 * R_SUN, rot: 22,
    star: { ra: 14.660765, dec: -60.833976, pc: 1.3248, L: 1.5059, bv: 0.71 }, sci: [0, 0, 0, 22, 18], diff: 14,
    vis: { type: 'star', c: ['#fff4dc', '#ffc070', '#ff9a3c'] } },
  { id: 'acenb', name: 'Альфа Центавра B', parent: 'acena', gm: 0.9092 * GM_SUN, r: 0.8591 * R_SUN, rot: 36,
    kep: [23.4 * AU / 1e3, 0.5179, 79.2, 205, 232, 160], star: { L: 0.4981, bv: 0.90 }, sci: [0, 0, 0, 22, 18], diff: 14,
    vis: { type: 'star', c: ['#ffe2b8', '#ffa850', '#ff7d2a'] } },
  { id: 'proxima', name: 'Проксима Центавра', parent: 'acena', gm: 0.1221 * GM_SUN, r: 0.1542 * R_SUN, rot: 89,
    star: { ra: 14.495985, dec: -62.679485, pc: 1.2959, aAU: 8700, L: 0.00155, bv: 1.82 }, sci: [0, 0, 0, 24, 20], diff: 15,
    vis: { type: 'star', c: ['#ffb27a', '#ff6a2a', '#d23a12'] } },
  { id: 'proxb', name: 'Проксима b', parent: 'proxima', gm: 1.07 * GM_EARTH, r: 1.03 * R_EARTH, lock: true,
    kep: [0.04848 * AU / 1e3, 0.02, 0.5, 10, 40, 210], sci: [40, 32, 30, 28, 24], diff: 16,
    atm: { p0: 55, rho0: 0.75, H: 6.2, top: 62, sky: [0.75, 0.48, 0.3] },
    ter: { kind: 'rough', base: [1.9, 9, 1700], ridge: [7, 6, 1500], sea: -350, craters: [[24, 0.18, 0.08]] },
    vis: { type: 'rocky', c: ['#8a5a3c', '#4a3226', '#d8c8b8'], caps: 1 } },
  { id: 'proxd', name: 'Проксима d', parent: 'proxima', gm: 0.26 * GM_EARTH, r: 0.81 * R_EARTH, lock: true,
    kep: [0.02881 * AU / 1e3, 0.04, 0.5, 10, 120, 40], sci: [36, 0, 0, 26, 22], diff: 16,
    vis: { type: 'rocky', c: ['#7a6a60', '#3a3430', '#a89a90'], crat: 1 } },

  { id: 'barnard', name: 'Звезда Барнарда', parent: 'sun', gm: 0.162 * GM_SUN, r: 0.187 * R_SUN, rot: 145,
    star: { ra: 17.963472, dec: 4.693388, pc: 1.8238, L: 0.0034, bv: 1.57 }, sci: [0, 0, 0, 22, 18], diff: 15,
    vis: { type: 'star', c: ['#ffbc88', '#ff7434', '#d8461a'] } },
  { id: 'barnd', name: 'Барнард d', parent: 'barnard', gm: 0.26 * GM_EARTH, r: 0.70 * R_EARTH, lock: true,
    kep: [aFromPeriod(0.162 * GM_SUN, 2.34), 0.03, 0.6, 30, 10, 0], sci: [34, 0, 0, 26, 22], diff: 16,
    vis: { type: 'rocky', c: ['#5e5248', '#2e2824', '#8a7c70'], crat: 1 } },
  { id: 'barnb', name: 'Барнард b', parent: 'barnard', gm: 0.30 * GM_EARTH, r: 0.72 * R_EARTH, lock: true,
    kep: [aFromPeriod(0.162 * GM_SUN, 3.15), 0.03, 0.6, 30, 80, 90], sci: [34, 0, 0, 26, 22], diff: 16,
    vis: { type: 'rocky', c: ['#8a7060', '#4a3a30', '#b89a82'], crat: 0.8 } },
  { id: 'barnc', name: 'Барнард c', parent: 'barnard', gm: 0.335 * GM_EARTH, r: 0.74 * R_EARTH, lock: true,
    kep: [aFromPeriod(0.162 * GM_SUN, 4.12), 0.03, 0.6, 30, 150, 200], sci: [34, 0, 0, 26, 22], diff: 16,
    vis: { type: 'rocky', c: ['#706458', '#38302a', '#a0948a'], crat: 1.1 } },
  { id: 'barne', name: 'Барнард e', parent: 'barnard', gm: 0.19 * GM_EARTH, r: 0.65 * R_EARTH, lock: true,
    kep: [aFromPeriod(0.162 * GM_SUN, 6.74), 0.03, 0.6, 30, 260, 300], sci: [34, 0, 0, 26, 22], diff: 16,
    vis: { type: 'rocky', c: ['#8a8078', '#4a443e', '#b8aea4'], crat: 1, caps: 1 } },

  { id: 'epseri', name: 'Эпсилон Эридана', parent: 'sun', gm: 0.82 * GM_SUN, r: 0.735 * R_SUN, rot: 11.2,
    star: { ra: 3.548848, dec: -9.458262, pc: 3.2161, L: 0.32, bv: 0.88 }, sci: [0, 0, 0, 22, 18], diff: 15,
    vis: { type: 'star', c: ['#ffe0b0', '#ffa448', '#ff7a26'] } },
  { id: 'epserib', name: 'Эгир (ε Эридана b)', parent: 'epseri', gm: 0.66 * GM_JUP, r: 74000, rot: 0.45, gas: true,
    kep: [3.53 * AU / 1e3, 0.055, 1.5, 60, 140, 20], atm: { p0: 100, rho0: 0.2, H: 8, top: 120, sky: [0.75, 0.62, 0.5] },
    sci: [0, 30, 30, 26, 22], diff: 17, vis: { type: 'gas', c: ['#b9a58a', '#6e5a48', '#e4d6c2'], bands: 13 } },

  { id: 'trappist', name: 'TRAPPIST-1', parent: 'sun', gm: 0.0898 * GM_SUN, r: 0.1192 * R_SUN, rot: 3.3,
    star: { ra: 23.108134, dec: -5.041275, pc: 12.47, L: 0.000553, bv: 2.0 }, sci: [0, 0, 0, 26, 22], diff: 18,
    vis: { type: 'star', c: ['#ff9a68', '#ff5622', '#b8300e'] } },
  ...[
    // [letter, period d, radius R_E, mass M_E, look] (Agol et al. 2021)
    ['b', 1.51088, 1.116, 1.374, { type: 'rocky', c: ['#5a4038', '#2a1e1a', '#8a6a5a'], volc: 1 }],
    ['c', 2.42194, 1.097, 1.308, { type: 'rocky', c: ['#6a5a50', '#352c28', '#9a8a80'], crat: 0.5 }],
    ['d', 4.04978, 0.788, 0.388, { type: 'rocky', c: ['#7a6a5e', '#3e3430', '#a89a90'], crat: 0.8 }],
    ['e', 6.09956, 0.920, 0.692, { type: 'rocky', c: ['#4e5a48', '#26302a', '#c8c0b4'], caps: 1 }],
    ['f', 9.20655, 1.045, 1.039, { type: 'ice', c: ['#d8d2c8', '#8a6a54', '#f2eee8'] }],
    ['g', 12.35294, 1.129, 1.321, { type: 'ice', c: ['#c8ccd4', '#6a6a78', '#eef0f4'] }],
    ['h', 18.7729, 0.755, 0.326, { type: 'ice', c: ['#e2dcd4', '#9a8a7a', '#f8f4ee'] }],
  ].map(([l, per, rr, mm, vis], i) => Object.assign({ id: 'trap' + l, name: 'TRAPPIST-1 ' + l, parent: 'trappist', gm: mm * GM_EARTH, r: rr * R_EARTH, lock: true,
    kep: [aFromPeriod(0.0898 * GM_SUN, per), 0.006, 0.2, 0, 0, i * 137.5], sci: [42, 34, 32, 30, 26], diff: 18, vis },
    l === 'e' ? { atm: { p0: 40, rho0: 0.5, H: 6, top: 55, sky: [0.7, 0.45, 0.3] }, ter: { kind: 'rough', base: [2.0, 8, 1500], ridge: [8, 6, 1200], sea: -200 } } : {})),

  // ---- science-fiction mode (scifi: true). Black holes: the horizon is the radius, 2GM/c^2 (scaled like every radius).
  // bh.disk: accretion disk for the renderer (inner / outer radius in horizon radii, temperature at the inner edge).
  { id: 'charybdis', name: 'Харибда (вымышленная)', parent: 'sun', scifi: true, gm: 6.2 * GM_SUN, rot: 0.01, soiMax: 1.2e15,
    star: { ra: 11.2, dec: 49.5, pc: 0.95 }, bh: { disk: { rIn: 3, rOut: 18, T: 9000, glow: 1 } }, sci: [0, 0, 0, 40, 34], diff: 16,
    vis: { type: 'blackhole', c: ['#ffb070', '#ff6020', '#000000'] } },
  { id: 'gaiabh1', name: 'Gaia BH1', parent: 'sun', scifi: true, gm: 9.62 * GM_SUN, rot: 0.01, soiMax: 1.5e15,
    star: { ra: 17.47808, dec: -0.58109, pc: 480 }, bh: { disk: null }, sci: [0, 0, 0, 44, 38], diff: 20,
    vis: { type: 'blackhole', c: ['#ffffff', '#888888', '#000000'] } },
  { id: 'gaiabh1s', name: 'Gaia BH1 · звезда', parent: 'gaiabh1', scifi: true, gm: 0.93 * GM_SUN, r: 0.79 * R_SUN, rot: 30,
    kep: [1.40 * AU / 1e3, 0.451, 40, 120, 30, 0], star: { L: 0.6, bv: 0.62 }, sci: [0, 0, 0, 30, 26], diff: 20,
    vis: { type: 'star', c: ['#fff1c8', '#ffb347', '#ff8a1e'] } },
  { id: 'cygx1', name: 'Лебедь X-1', parent: 'sun', scifi: true, gm: 21.2 * GM_SUN, rot: 0.01, soiMax: 2e15,
    star: { ra: 19.972688, dec: 35.201606, pc: 2220 }, bh: { disk: { rIn: 3, rOut: 26, T: 16000, glow: 1.6 } }, sci: [0, 0, 0, 46, 40], diff: 21,
    vis: { type: 'blackhole', c: ['#bcd8ff', '#5a8cff', '#000000'] } },
  { id: 'hde226868', name: 'HDE 226868', parent: 'cygx1', scifi: true, gm: 40.6 * GM_SUN, r: 22.2 * R_SUN, rot: 5.6,
    kep: [aFromPeriod(61.8 * GM_SUN, 5.599829), 0.02, 27, 160, 0, 0], star: { L: 3e5, bv: -0.28 }, sci: [0, 0, 0, 34, 30], diff: 21,
    vis: { type: 'star', c: ['#dbe7ff', '#9cb8ff', '#6f8dff'] } },
  { id: 'sgra', name: 'Стрелец A*', parent: 'sun', scifi: true, gm: 4.297e6 * GM_SUN, rot: 0.01, soiMax: 1e16,
    star: { ra: 17.761122, dec: -29.00781, pc: 8277 }, bh: { disk: { rIn: 3, rOut: 9, T: 4200, glow: 0.45 } }, sci: [0, 0, 0, 60, 52], diff: 26,
    vis: { type: 'blackhole', c: ['#ffd090', '#ff7a30', '#000000'] } },
  { id: 'm31bh', name: 'M31* (ядро Андромеды)', parent: 'sun', scifi: true, gm: 1.4e8 * GM_SUN, rot: 0.01, soiMax: 1e17,
    star: { ra: 0.712306, dec: 41.2692, pc: 765000 }, bh: { disk: { rIn: 3, rOut: 10, T: 5200, glow: 0.6 } }, sci: [0, 0, 0, 80, 70], diff: 32,
    vis: { type: 'blackhole', c: ['#ffe0a0', '#ff9040', '#000000'] } },
  // wormholes (fictional): a throat of radius r km with a tiny mass; wh.to = the other mouth
  { id: 'wh_ariadne', name: 'Червоточина «Ариадна»', parent: 'sun', scifi: true, gm: 1e9, r: 20, rot: 0.01, wh: { to: 'wh_ariadne2', tint: [0.5, 0.8, 1.0] },
    kep: [AU / 1e3, 0.0, 0.0, 0, 0, 160.46], sci: [0, 0, 0, 30, 26], diff: 12, vis: { type: 'wormhole', c: ['#80c8ff', '#4060ff', '#000000'] } },
  { id: 'wh_ariadne2', name: 'Червоточина «Ариадна» · TRAPPIST-1', parent: 'trappist', scifi: true, gm: 1e9, r: 20, rot: 0.01, wh: { to: 'wh_ariadne', tint: [1.0, 0.6, 0.4] },
    kep: [0.08 * AU / 1e3, 0.0, 0.0, 0, 0, 40], sci: [0, 0, 0, 30, 26], diff: 18, vis: { type: 'wormhole', c: ['#ffa070', '#ff5030', '#000000'] } },
  { id: 'wh_thread', name: 'Червоточина «Нить»', parent: 'saturn', scifi: true, gm: 1e9, r: 20, rot: 0.01, wh: { to: 'wh_thread2', tint: [1.0, 0.85, 0.5] },
    kep: [1.5e7, 0.0, 12, 30, 0, 0], sci: [0, 0, 0, 30, 26], diff: 12, vis: { type: 'wormhole', c: ['#ffd890', '#ff9a40', '#000000'] } },
  { id: 'wh_thread2', name: 'Червоточина «Нить» · Стрелец A*', parent: 'sgra', scifi: true, gm: 1e9, r: 20, rot: 0.01, wh: { to: 'wh_thread', tint: [0.6, 0.75, 1.0] },
    kep: [3000 * AU / 1e3, 0.0, 20, 0, 0, 90], sci: [0, 0, 0, 40, 34], diff: 26, vis: { type: 'wormhole', c: ['#a0c0ff', '#6080ff', '#000000'] } },
  { id: 'wh_andromeda', name: 'Врата Андромеды', parent: 'sgra', scifi: true, gm: 1e9, r: 30, rot: 0.01, wh: { to: 'wh_andromeda2', tint: [1.0, 0.75, 1.0] },
    kep: [6000 * AU / 1e3, 0.0, 35, 70, 0, 200], sci: [0, 0, 0, 50, 44], diff: 28, vis: { type: 'wormhole', c: ['#ffb0ff', '#c050ff', '#000000'] } },
  { id: 'wh_andromeda2', name: 'Врата Млечного Пути', parent: 'm31bh', scifi: true, gm: 1e9, r: 30, rot: 0.01, wh: { to: 'wh_andromeda', tint: [0.7, 0.9, 1.0] },
    kep: [6000 * AU / 1e3, 0.0, 10, 0, 0, 30], sci: [0, 0, 0, 80, 70], diff: 32, vis: { type: 'wormhole', c: ['#b0e0ff', '#5090ff', '#000000'] } },
  // megastructures (fictional): an O'Neill "Island Three" at the Earth-Moon L5 point (the Moon's orbit, 60 degrees
  // behind it), and a star dimmed by a Dyson swarm with a ringworld round it. mega.size: drawn size, km
  { id: 'island3', name: 'Остров-3 (цилиндр О\'Нила)', parent: 'earth', scifi: true, gm: 1e6, r: 0.001, rot: 0.0014, mega: { kind: 'oneill', size: 32 },
    kep: [384748, 0.0549, 5.145, 125.08, 318.15, 135.27 - 60], sci: [0, 0, 0, 20, 16], diff: 2, vis: { type: 'mega', c: ['#d8dde6', '#8090a0', '#ffffff'] } },
  { id: 'prometheus', name: 'Прометей (вымышленная)', parent: 'sun', scifi: true, gm: 1.02 * GM_SUN, r: 1.01 * R_SUN, rot: 24, soiMax: 2e15,
    star: { ra: 20.1, dec: 44.5, pc: 4.6, L: 0.45, bv: 0.64 }, mega: { kind: 'dyson', ring: 1.0, swarm: [0.55, 0.85] }, sci: [0, 0, 0, 40, 34], diff: 16,
    vis: { type: 'star', c: ['#fff1c8', '#ffb347', '#ff8a1e'] } },
  { id: 'sgra_s2', name: 'S2', parent: 'sgra', scifi: true, gm: 13.6 * GM_SUN, r: 6.6 * R_SUN, rot: 3,
    kep: [1031 * AU / 1e3, 0.8846, 134.6, 228, 66, 0], star: { L: 2e4, bv: -0.2 }, sci: [0, 0, 0, 40, 34], diff: 26,
    vis: { type: 'star', c: ['#e2ebff', '#a8c0ff', '#7894ff'] } },
];

const BODIES = [];
const BODY = {};

(function buildBodies() {
  for (const d of BODY_DATA) {
    const b = {
      id: d.id, name: d.name, mu: d.gm * SCALE_GM, R: d.r * 1e3 * SCALE_L,
      gas: !!d.gas, rings: d.rings || null, sci: d.sci, diff: d.diff, vis: d.vis,
      parent: d.parent ? BODY[d.parent] : null, children: [], lock: !!d.lock, ter: d.ter || null, scifi: !!d.scifi,
    };
    if (d.vis.type === 'star') {
      const st = d.star || { L: 1, bv: 0.656 };
      b.star = true; b.L = st.L; b.bv = st.bv;
    }
    if (d.vis.type === 'blackhole') { b.bh = d.bh; b.R = 2 * b.mu / (C_LIGHT * C_LIGHT); }   // the event horizon
    if (d.wh) b.wh = d.wh;
    if (d.mega) b.mega = d.mega;
    // catalogue position relative to the Sun, game scale
    if (b.star || b.bh) b.pos = d.star && d.star.pc ? V.scale(eqToEcl(d.star.ra, d.star.dec), d.star.pc * PC * SCALE_L) : d.parent ? null : [0, 0, 0];
    b.g0 = b.mu / (b.R * b.R);
    if (d.atm) {
      b.atm = { p0: d.atm.p0, rho0: d.atm.rho0, H: d.atm.H * 1e3, top: d.atm.top * 1e3, sky: d.atm.sky, oxygen: !!d.atm.oxygen };
    }
    if (b.parent) {
      // two-body period uses G(M+m): matters for the Moon (1.2% of Earth), keeps real dates' phases right
      const pmu = b.parent.mu + b.mu;
      if (d.jpl) {
        const [aAU, e, i, L, lp, node] = d.jpl;
        b.el = elFromKepler(aAU * AU * SCALE_L, e, i, node, lp - node, L - lp, pmu, 0);
      } else if (b.pos) {
        // a star: sits at its catalogue place relative to the parent star; a circle (effectively at rest) or a wide bound orbit
        const r = V.sub(b.pos, b.parent.pos), rl = V.len(r), a = d.star.aAU ? d.star.aAU * AU * SCALE_L : rl;
        const vt = V.norm(V.cross([0, 0, 1], r));
        b.el = elFromState(r, V.scale(vt, Math.sqrt(pmu * (2 / rl - 1 / a))), pmu, 0);
      } else {
        const [aKm, e, i, node, argp, M0] = d.kep;
        b.el = elFromKepler(aKm * 1e3 * SCALE_L, e, i, node, argp, M0, pmu, 0);
      }
      // Laplace sphere, kept inside periapsis for comparable masses (binary stars); a star near the Sun gets the
      // point where the two pulls are equal (the Laplace formula breaks down for stellar masses)
      b.soi = Math.min(Math.max(Math.min(b.el.a * Math.pow(b.mu / pmu, 0.4), b.el.rp * 0.45), b.R * 3), b.el.rp * 0.45);
      if ((b.star || b.bh) && b.parent.id === 'sun') b.soi = b.el.a * Math.sqrt(b.mu) / (Math.sqrt(b.mu) + Math.sqrt(b.parent.mu)) * 0.9;
      if (d.soiMax) b.soi = Math.min(b.soi, d.soiMax);
      if (b.wh) b.soi = Math.min(2e7, b.el.rp * 0.2);   // a wormhole's frame: big enough to aim at its throat
      if (b.mega && !b.star) b.soi = 2e5;               // a station: a small frame to rendezvous in
      if (b.star && !b.pos) b.pos = V.add(b.parent.pos, elState(b.el, 0).r);
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
  // host: the star that lights a body; sys: its star system (a star orbiting the Sun, or the Sun itself)
  for (const b of BODIES) {
    let h = b; while (!h.star) h = h.parent;
    let s = b; while (s.parent && !((s.star || s.bh) && s.parent.id === 'sun')) s = s.parent;
    b.host = h; b.sys = s;
  }
})();
// Every body ever defined; BODIES / BODY / STARS / children hold only the ones active in this game:
// science-fiction objects (b.scifi) exist only in the science-fiction mode (setSciFi).
const ALL_BODIES = BODIES.slice();
const STARS = BODIES.filter(b => b.star);
const SCIFI = { on: false };
function setSciFi(on) {
  SCIFI.on = !!on;
  BODIES.length = 0; STARS.length = 0;
  for (const b of ALL_BODIES) {
    b.active = !b.scifi || SCIFI.on;
    delete b._reach;
    if (b.active) { BODIES.push(b); BODY[b.id] = b; if (b.star) STARS.push(b); } else delete BODY[b.id];
  }
  for (const b of ALL_BODIES) b.children = ALL_BODIES.filter(c => c.parent === b && c.active);
}
setSciFi(false);

// ---- body kinematics ----
function bodyRelState(b, t) {
  if (!b.parent) return { r: [0, 0, 0], v: [0, 0, 0] };
  return elState(b.el, t);
}
// Floating origin: "absolute" positions are relative to the star system the player is in (the Sun by default),
// so a lander next to TRAPPIST-1 (4e16 m from the Sun) keeps millimetre precision.
const ORIGIN = { b: null };
function setOrigin(sys) { ORIGIN.b = sys && sys.parent ? sys : null; }
function chainState(b, t, stop) {
  let r = [0, 0, 0], v = [0, 0, 0];
  for (let c = b; c.parent && c !== stop; c = c.parent) { const s = elState(c.el, t); r = V.add(r, s.r); v = V.add(v, s.v); }
  return { r, v };
}
function bodyAbsState(b, t) {
  const o = ORIGIN.b;
  if (!o) return chainState(b, t, null);
  if (b.sys === o) return chainState(b, t, o);
  const a = chainState(b, t, null), c = chainState(o, t, null);
  return { r: V.sub(a.r, c.r), v: V.sub(a.v, c.v) };
}
function bodyAbsPos(b, t) { return bodyAbsState(b, t).r; }

// ---- deep-space frames ----
// Far from every body a vessel's position relative to its star has to be stored with metres of rounding (8 m at
// 4 light-years, 260 km at Andromeda), which freezes slow physics and makes the camera jitter. While the active
// vessel flies with physics out there it is moved into a massless frame centred on itself ("open space", mu = 0,
// straight-line motion); on time warp it goes back to the star's frame, where rails are analytic anyway.
const VOID_FROM = 1e13, VOID_SOI = 1e12;
const VOIDS = { seq: 1 };
function makeVoid(parent, pos) {
  const b = { id: 'void' + VOIDS.seq++, name: 'Открытый космос', mu: 0, R: 0, gas: false, rings: null, sci: [0, 0, 0, 0, 0], diff: parent.diff,
    vis: { type: 'void', c: ['#000000', '#000000', '#000000'] }, parent, children: [], lock: false, ter: null, void: true, active: true,
    el: linEl(pos, [0, 0, 0], 0), soi: VOID_SOI, rotPeriod: Infinity, rot0: 0, flyHigh: 0, spaceHigh: 0, terrain: null, hMax: 0, g0: 0, host: parent.host };
  b.sys = b;
  BODY[b.id] = b;
  return b;
}
function dropVoid(b) { if (b && b.void) delete BODY[b.id]; }
// move a vessel from a far-away star frame into a fresh void (and back); returns the void or null. The void's centre
// sits 1e6 km behind the vessel on the line from the star, so "up" and the radial directions still point away from it.
const VOID_OFF = 1e9;
function voidEnter(v) {
  const b = v.body; if (b.void || !b.star || V.len(v.r) < VOID_FROM) return null;
  const off = V.scale(V.norm(v.r), VOID_OFF), vb = makeVoid(b, V.sub(v.r, off));
  v.r = off; v.body = vb;
  return vb;
}
// distance from the star a void belongs to
function voidStarDist(v) { return V.len(V.add(v.r, v.body.el.r0)); }
function voidLeave(v) {
  const b = v.body; if (!b.void) return false;
  v.r = V.add(v.r, b.el.r0); v.body = b.parent;
  return true;
}

// starlight at an absolute position: total flux and the brightest star's, relative to sunlight at Earth
function starLight(pAbs, t) {
  const dE2 = BODY.earth.el.a * BODY.earth.el.a;
  let f = 0, fMain = -1, star = null, pos = null;
  for (const s of STARS) {
    const sp = bodyAbsPos(s, t), fi = s.L * dE2 / Math.max(V.len2(V.sub(sp, pAbs)), 1);
    f += fi;
    if (fi > fMain) { fMain = fi; star = s; pos = sp; }
  }
  return { f, fMain, star, pos };
}
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

// Starlight factor relative to sunlight at Earth, plus the shadow of the vessel's own body
function sunExposure(bodyOfVessel, rRel, t) {
  const bAbs = bodyAbsPos(bodyOfVessel, t), L = starLight(V.add(bAbs, rRel), t);
  if (bodyOfVessel.star) return L.f;
  const sunDir = V.norm(V.sub(L.pos, bAbs)), along = V.dot(rRel, sunDir);
  if (along < 0 && V.len(V.reject(rRel, sunDir)) < bodyOfVessel.R) { const o = L.f - L.fMain; return o > 1e-6 ? o : 0; }
  return L.f;
}

const KSC = { body: 'earth', lat: 0, lon: 0 };
