'use strict';
// Galaxies and a quasar for the science-fiction mode: real places (RA/Dec, distance), real sizes, inclinations and
// position angles, drawn as oriented images with procedural textures. A galaxy is drawn at a stand-in distance inside
// the camera's range with the true angular size, so it stays right from Earth and from intergalactic space alike.
// Inside a galaxy the sky is re-baked with that galaxy's own band; between galaxies there is no band and no stars.

// [id, name, kind, RA h, Dec deg, distance ly, diameter ly, inclination deg, position angle deg, brightness]
const GALAXIES = [
  ['mw', 'Млечный Путь', 'barred', 17.76033, -28.93617, 26000, 100000, 0, 0, 1.0],
  ['m31', 'Галактика Андромеды', 'spiral', 0.712306, 41.2692, 2.537e6, 152000, 77, 38, 1.0],
  ['m33', 'Галактика Треугольника', 'spiral', 1.564139, 30.660194, 2.73e6, 61000, 55, 23, 0.7],
  ['lmc', 'Большое Магелланово Облако', 'irregular', 5.392944, -69.756111, 163000, 32000, 35, 170, 0.9],
  ['smc', 'Малое Магелланово Облако', 'irregular', 0.877639, -72.828611, 203000, 19000, 60, 45, 0.7],
  ['m104', 'Сомбреро', 'sombrero', 12.666506, -11.623056, 31.1e6, 50000, 84, 90, 0.8],
  ['m87', 'M87 (Дева A)', 'elliptical', 12.513729, 12.391123, 53.5e6, 132000, 0, 0, 0.9],
  ['3c273', 'Квазар 3C 273', 'quasar', 12.485194, 2.052389, 2.44e9, 200000, 0, 222, 1.4],
].map(([id, name, kind, ra, dec, dly, diam, incl, pa, br]) => {
  const s0 = eqToEcl(ra, dec);
  // the disc normal: the line of sight tipped by the inclination about the major axis (position angle from north
  // through east on the sky); the Milky Way's normal is the galactic north pole
  const npEcl = eqToEcl(0, 90), north = V.norm(V.reject(npEcl, s0)), east = V.cross(s0, north);
  const major = V.norm(V.add(V.scale(north, Math.cos(pa * DEG)), V.scale(east, Math.sin(pa * DEG))));
  const N = id === 'mw' ? eqToEcl(12.85730, 27.12825) : V.norm(V.add(V.scale(s0, Math.cos(incl * DEG)), V.scale(V.cross(major, s0), Math.sin(incl * DEG))));
  return { id, name, kind, pos: V.scale(s0, dly * LY), R: diam / 2 * LY, N, major: V.norm(V.reject(major, N)), br };
});

const DEEP = { meshes: {}, home: 'mw' };

// ---- procedural galaxy images (canvas, 512 x 512, additive) ----
function galaxyTexture(kind, seed) {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data, r = rng(seed);
  const knots = [];
  for (let i = 0; i < 90; i++) knots.push([r() * TAU, 0.15 + r() * 0.8, 0.008 + r() * 0.02, r()]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1, rr = Math.hypot(u, v), th = Math.atan2(v, u);
    let R = 0, G = 0, B = 0;
    if (kind === 'spiral' || kind === 'barred' || kind === 'sombrero') {
      const bulgeR = kind === 'sombrero' ? 0.32 : 0.16, bulge = Math.exp(-((rr / bulgeR) ** 2) * 2.2);
      const arms = kind === 'barred' ? 2 : 2, pitch = kind === 'sombrero' ? 0.12 : 0.24;
      // logarithmic spiral arms (a bar for the Milky Way), dust lanes on their inner edge
      let arm = 0;
      for (let k = 0; k < arms; k++) {
        const phase = Math.log(Math.max(rr, 0.03)) / Math.tan(pitch) + k * TAU / arms;
        const dth = Math.atan2(Math.sin(th - phase), Math.cos(th - phase));
        arm += Math.exp(-((dth / 0.55) ** 2)) * (1 - Math.exp(-((rr / 0.18) ** 2)));
      }
      if (kind === 'barred') { const bx = u * Math.cos(0.5) + v * Math.sin(0.5), by = -u * Math.sin(0.5) + v * Math.cos(0.5); arm += Math.exp(-((bx / 0.32) ** 2) - ((by / 0.07) ** 2)) * 1.2; }
      const disk = Math.exp(-rr / 0.28) * (rr < 1 ? 1 : 0);
      const dust = kind === 'sombrero' ? Math.exp(-(((rr - 0.62) / 0.05) ** 2)) : 0;
      const I = (disk * (0.25 + arm * 0.9) + bulge * 1.6) * (1 - dust * 0.85);
      R = I * (0.75 + bulge * 0.35); G = I * (0.78 + bulge * 0.15); B = I * (1.0 - bulge * 0.35);
    } else if (kind === 'elliptical') {
      const e = Math.hypot(u, v * 1.15), I = Math.exp(-7.67 * (Math.pow(Math.max(e, 1e-3) / 0.35, 0.25) - 1)) * 0.06;
      R = I; G = I * 0.88; B = I * 0.7;
      // the relativistic jet of M87, out of the core towards one side
      const jx = u * 0.8 + v * 0.6, jy = -u * 0.6 + v * 0.8;
      if (jx > 0 && jx < 0.6) { const j = Math.exp(-((jy / (0.008 + jx * 0.02)) ** 2)) * (0.6 + 0.4 * Math.sin(jx * 40)) * 0.9; R += j * 0.7; G += j * 0.85; B += j * 1.2; }
    } else if (kind === 'irregular') {
      let I = Math.exp(-((rr / 0.5) ** 2)) * 0.25;
      const bx = u * Math.cos(0.3) + v * Math.sin(0.3), by = -u * Math.sin(0.3) + v * Math.cos(0.3);
      I += Math.exp(-((bx / 0.45) ** 2) - ((by / 0.12) ** 2)) * 0.5;
      R = I * 0.8; G = I * 0.85; B = I;
    } else {   // quasar: a point-like core and a straight jet
      const core = Math.exp(-((rr / 0.025) ** 2)) * 6 + Math.exp(-rr / 0.08) * 0.4;
      const jx = u * 0.7 - v * 0.7, jy = u * 0.7 + v * 0.7;
      const jet = jx > 0 && jx < 0.9 ? Math.exp(-((jy / 0.015) ** 2)) * (1 - jx) * 0.9 : 0;
      R = core + jet * 0.7; G = core + jet * 0.85; B = core * 1.1 + jet * 1.3;
    }
    // knots of star formation along the disc
    if (kind !== 'elliptical' && kind !== 'quasar') for (const [kt, kr, ks, kc] of knots) {
      const kx = Math.cos(kt) * kr - u, ky = Math.sin(kt) * kr - v, k = Math.exp(-(kx * kx + ky * ky) / (ks * ks)) * 0.5 * Math.exp(-rr / 0.6);
      if (kc < 0.5) { R += k; G += k * 0.5; B += k * 0.7; } else { R += k * 0.6; G += k * 0.75; B += k * 1.1; }
    }
    const fade = rr > 0.95 ? Math.max(0, 1 - (rr - 0.95) / 0.05) : 1, i = (y * n + x) * 4;
    d[i] = Math.min(255, R * fade * 255); d[i + 1] = Math.min(255, G * fade * 255); d[i + 2] = Math.min(255, B * fade * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

function buildDeepSky() {
  GALAXIES.forEach((G, i) => {
    const mat = new THREE.MeshBasicMaterial({ map: galaxyTexture(G.kind, 101 + i * 17), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      transparent: true, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.renderOrder = -8; mesh.frustumCulled = false; mesh.visible = false;
    RV.scene.add(mesh);
    // orientation: image x along the major axis, z along the disc normal (three axes)
    const Z = toT(G.N).normalize(), X = toT(G.major).normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    DEEP.meshes[G.id] = mesh;
  });
}

// the galaxy the camera is inside, if any ('mw' near home, null between galaxies)
function homeGalaxy(camSun) {
  for (const G of GALAXIES) if (V.dist(camSun, G.pos) < G.R * 1.15) return G.id;
  return null;
}

// per frame: place the images; re-bake the sky band when the camera moves into another galaxy
function updateDeepSky(t, camAbs, far, sky) {
  const on = SCIFI.on, sunAbs = bodyAbsPos(BODY.sun, t), camSun = V.sub(camAbs, sunAbs);
  const home = on ? homeGalaxy(camSun) : 'mw';
  if (home !== DEEP.home) { DEEP.home = home; rebakeHomeSky(home, camSun); }
  for (const G of GALAXIES) {
    const mesh = DEEP.meshes[G.id];
    if (!on || G.id === home) { mesh.visible = false; continue; }
    const rel = V.sub(G.pos, camSun), dist = V.len(rel), Dv = Math.min(dist, far * 0.3);
    mesh.position.copy(toT(V.scale(rel, Dv / dist)));
    mesh.scale.setScalar(G.R * Dv / dist);
    mesh.material.opacity = G.br * clamp((dist / G.R - 1.15) / 1.5, 0, 1) * (1 - clamp(sky * 1.6, 0, 0.985));
    mesh.visible = mesh.material.opacity > 0.003;
  }
  // our catalogue at home; inside another galaxy the same field, turned, stands in for its stars; none in between
  RV.stars.visible = !!home; RV.gstars.visible = home === 'mw';
}

// the sky band of the galaxy the camera is in: its disc plane and the direction of its centre
function rebakeHomeSky(home, camSun) {
  const u = RV.skyProc.material.uniforms;
  if (!u.uBand) u.uBand = { value: 1 };
  const G = GALAXIES.find(x => x.id === home);
  if (!G) u.uBand.value = 0;
  else {
    u.uBand.value = 1;
    const C = toT(G.id === 'mw' ? eqToEcl(17.76033, -28.93617) : V.norm(V.sub(G.pos, camSun))).normalize();
    const N0 = toT(G.N).normalize(), N = N0.addScaledVector(C, -N0.dot(C)).normalize(), Wg = new THREE.Vector3().crossVectors(C, N);
    u.uGal.value.set(C.x, C.y, C.z, N.x, N.y, N.z, Wg.x, Wg.y, Wg.z);
  }
  RV.skyProc.material.needsUpdate = true;
  bakeSky();
  const rot = RV.stars.material.uniforms.uStarRot.value;
  if (!home || home === 'mw') rot.identity();
  else rot.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.1, 2.3 + home.length, 0.7)));
}
