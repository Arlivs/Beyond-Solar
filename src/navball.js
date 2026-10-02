'use strict';
// Navball: attitude sphere in the local horizon frame + direction markers.
// Display convention: centre = nose (+Y), screen right = vessel right (+X), screen up = vessel top (+Z).
// The mapping local->screen (x, z, y) is a reflection, so the texture is drawn with mirrored glyphs.

const NB = { scene: null, cam: null, ball: null, markers: {}, size: 190 };

function navballTexture() {
  const W = 2048, H = 1024;
  return canvasTex(W, H, (x) => {
    const sky = x.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, '#1f4f9a'); sky.addColorStop(1, '#5d9be0');
    x.fillStyle = sky; x.fillRect(0, 0, W, H / 2);
    const gnd = x.createLinearGradient(0, H / 2, 0, H);
    gnd.addColorStop(0, '#a8692e'); gnd.addColorStop(1, '#5a3412');
    x.fillStyle = gnd; x.fillRect(0, H / 2, W, H / 2);
    const xOf = (hdg) => ((0.5 - hdg / 360) % 1 + 1) % 1 * W;
    const yOf = (pitch) => (90 - pitch) / 180 * H;
    x.strokeStyle = 'rgba(255,255,255,0.85)';
    // pitch rings
    for (let p = -80; p <= 80; p += 10) {
      x.lineWidth = p === 0 ? 6 : (p % 30 === 0 ? 3 : 1.5);
      x.beginPath(); x.moveTo(0, yOf(p)); x.lineTo(W, yOf(p)); x.stroke();
    }
    // meridians
    for (let h = 0; h < 360; h += 15) {
      x.lineWidth = h % 90 === 0 ? 3 : 1.2;
      x.beginPath(); x.moveTo(xOf(h), yOf(85)); x.lineTo(xOf(h), yOf(-85)); x.stroke();
    }
    const label = (txt, px, py, size, col) => {
      x.save(); x.translate(px, py); x.scale(-1, 1);
      x.font = `bold ${size}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = col || '#fff'; x.fillText(txt, 0, 0); x.restore();
    };
    const names = { 0: 'С', 90: 'В', 180: 'Ю', 270: 'З' };
    for (let h = 0; h < 360; h += 30) {
      for (const p of [5, -5, 45, -45]) label(names[h] || String(h), xOf(h) + (p > 0 ? 0 : 0), yOf(p), names[h] ? 46 : 32, names[h] ? '#ffe28a' : '#fff');
    }
    for (let p = -60; p <= 60; p += 30) if (p) for (let h = 15; h < 360; h += 90) label(String(Math.abs(p)), xOf(h), yOf(p), 26);
    // poles
    x.fillStyle = '#fff'; x.beginPath(); x.arc(W / 2, 4, 8, 0, TAU); x.fill();
  });
}

function markerTex(kind) {
  return canvasTex(128, 128, (x) => {
    x.translate(64, 64); x.lineWidth = 7; x.lineCap = 'round';
    const col = { pro: '#ffe23a', retro: '#ffe23a', normal: '#e04bff', anti: '#e04bff', radout: '#3ad8ff', radin: '#3ad8ff', node: '#3a8cff', target: '#ff5bd2' }[kind];
    x.strokeStyle = col; x.fillStyle = col;
    const circle = (r) => { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke(); };
    switch (kind) {
      case 'pro': circle(22); x.beginPath(); x.arc(0, 0, 4, 0, TAU); x.fill(); for (const a of [-90, 0, 180]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 22, Math.sin(r) * 22); x.lineTo(Math.cos(r) * 44, Math.sin(r) * 44); x.stroke(); } break;
      case 'retro': circle(22); for (const a of [45, 135, 225, 315]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 8, Math.sin(r) * 8); x.lineTo(Math.cos(r) * 22, Math.sin(r) * 22); x.stroke(); } for (const a of [90, 210, 330]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 22, Math.sin(r) * 22); x.lineTo(Math.cos(r) * 40, Math.sin(r) * 40); x.stroke(); } break;
      case 'normal': x.beginPath(); x.moveTo(0, -30); x.lineTo(26, 18); x.lineTo(-26, 18); x.closePath(); x.stroke(); x.beginPath(); x.arc(0, 2, 4, 0, TAU); x.fill(); break;
      case 'anti': x.beginPath(); x.moveTo(0, 30); x.lineTo(26, -18); x.lineTo(-26, -18); x.closePath(); x.stroke(); for (const a of [90, 210, 330]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 12, Math.sin(r) * 12); x.lineTo(Math.cos(r) * 30, Math.sin(r) * 30); x.stroke(); } break;
      case 'radout': circle(20); for (const a of [0, 90, 180, 270]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 20, Math.sin(r) * 20); x.lineTo(Math.cos(r) * 40, Math.sin(r) * 40); x.stroke(); } x.beginPath(); x.arc(0, 0, 4, 0, TAU); x.fill(); break;
      case 'radin': circle(26); for (const a of [45, 135, 225, 315]) { const r = a * DEG; x.beginPath(); x.moveTo(Math.cos(r) * 8, Math.sin(r) * 8); x.lineTo(Math.cos(r) * 26, Math.sin(r) * 26); x.stroke(); } break;
      case 'node': x.lineWidth = 8; x.beginPath(); x.arc(0, 0, 26, 0.3, 1.27); x.stroke(); x.beginPath(); x.arc(0, 0, 26, 1.87, 2.84); x.stroke(); x.beginPath(); x.arc(0, 0, 26, 3.44, 4.41); x.stroke(); x.beginPath(); x.arc(0, 0, 26, 5.01, 5.98); x.stroke(); x.beginPath(); x.arc(0, 0, 5, 0, TAU); x.fill(); break;
      case 'target': circle(24); x.beginPath(); x.arc(0, 0, 9, 0, TAU); x.stroke(); break;
    }
  });
}

function initNavball() {
  NB.scene = new THREE.Scene();
  NB.cam = new THREE.PerspectiveCamera(30, 1, 0.5, 20);
  NB.cam.position.set(0, 0, 4); NB.cam.lookAt(0, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ map: navballTexture(), toneMapped: false });
  NB.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  NB.ball.matrixAutoUpdate = false;
  NB.scene.add(NB.ball);
  for (const k of ['pro', 'retro', 'normal', 'anti', 'radout', 'radin', 'node', 'target']) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex(k), depthTest: false, toneMapped: false, transparent: true }));
    s.scale.set(0.34, 0.34, 1); s.renderOrder = 10; s.visible = false;
    NB.scene.add(s); NB.markers[k] = s;
  }
}

// world dir -> navball camera coordinates (reflection local (x,y,z) -> (x, z, y))
function nbCam(q, w) { const l = Q.invRot(q, w); return [l[0], l[2], l[1]]; }

// dirs: {pro, retro, ...} world unit vectors (null hides)
function updateNavball(v, up, north, dirs) {
  const east = V.cross(north, up);
  // sphere frame columns: X_s = north, Y_s = up, Z_s = east -> camera coords
  const cx = nbCam(v.q, north), cy = nbCam(v.q, up), cz = nbCam(v.q, east);
  const m = new THREE.Matrix4().set(
    cx[0], cy[0], cz[0], 0,
    cx[1], cy[1], cz[1], 0,
    cx[2], cy[2], cz[2], 0,
    0, 0, 0, 1);
  NB.ball.matrix.copy(m);
  NB.ball.matrixWorldNeedsUpdate = true;
  for (const k in NB.markers) {
    const s = NB.markers[k], d = dirs[k];
    if (!d) { s.visible = false; continue; }
    const c = nbCam(v.q, d);
    s.visible = c[2] > 0.05;
    s.position.set(c[0] * 1.02, c[1] * 1.02, c[2] * 1.02);
  }
}

function drawNavball(px, py, size) {
  const r = RV.renderer;
  const H = RV.h;
  r.setViewport(px, H - py - size, size, size);
  r.setScissor(px, H - py - size, size, size);
  r.setScissorTest(true);
  r.clearDepth();
  r.render(NB.scene, NB.cam);
  r.setScissorTest(false);
}
