'use strict';
// Procedural part meshes and materials (PBR with generated normal/roughness maps),
// vessel views, engine plumes, re-entry plasma and particle effects.

const MAT = {};
const TEX = {};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(w, h, draw) {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
// grayscale height canvas -> tangent-space normal map
function heightToNormal(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h), ctx = out.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out); t.anisotropy = 8; return t;
}
// paint(albedoCtx, heightCtx, roughCtx, w, h) -> {map, normalMap, roughnessMap}
function texSet(w, h, rough, bump, paint) {
  const ca = makeCanvas(w, h), ch = makeCanvas(w, h), cr = makeCanvas(w, h);
  const A = ca.getContext('2d'), Hc = ch.getContext('2d'), Rc = cr.getContext('2d');
  Hc.fillStyle = '#808080'; Hc.fillRect(0, 0, w, h);
  const rv = Math.round(rough * 255); Rc.fillStyle = `rgb(${rv},${rv},${rv})`; Rc.fillRect(0, 0, w, h);
  paint(A, Hc, Rc, w, h);
  const map = new THREE.CanvasTexture(ca); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const rmap = new THREE.CanvasTexture(cr); rmap.anisotropy = 8;
  const set = { map, normalMap: heightToNormal(ch, bump), roughnessMap: rmap };
  for (const k in set) { set[k].wrapS = set[k].wrapT = THREE.RepeatWrapping; }
  return set;
}
const rand = rng(9091);
function speckle(ctx, w, h, n, col, smin, smax) { for (let i = 0; i < n; i++) { ctx.fillStyle = typeof col === 'function' ? col() : col; const s = smin + rand() * (smax - smin); ctx.fillRect(rand() * w, rand() * h, s, s); } }

// material cache keyed by texture set + repeat
const _matCache = {};
function texMat(setName, repU, repV, extra) {
  const key = setName + ':' + repU.toFixed(2) + ':' + repV.toFixed(2) + ':' + JSON.stringify(extra || {});
  if (_matCache[key]) return _matCache[key];
  const s = TEX[setName];
  const cl = (t) => { const c = t.clone(); c.repeat.set(repU, repV); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial(Object.assign({ map: cl(s.map), normalMap: cl(s.normalMap), roughnessMap: cl(s.roughnessMap), roughness: 1, metalness: 0 }, extra || {}));
  return (_matCache[key] = m);
}

function initMaterials() {
  // ---- texture sets
  TEX.tank = texSet(1024, 512, 0.42, 3.0, (A, H, R, w, h) => {
    A.fillStyle = '#e8e7e2'; A.fillRect(0, 0, w, h);
    speckle(A, w, h, 6000, () => `rgba(${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},0.025)`, 1, 3);
    for (let i = 0; i < 12; i++) {                                 // vertical panel seams + rivets
      const x = i * w / 12;
      A.fillStyle = 'rgba(0,0,0,0.13)'; A.fillRect(x, 0, 2, h);
      H.fillStyle = '#4a4a4a'; H.fillRect(x - 1, 0, 3, h);
      for (let y = 6; y < h; y += 14) { H.fillStyle = '#c8c8c8'; H.beginPath(); H.arc(x + 7, y, 2, 0, TAU); H.fill(); A.fillStyle = 'rgba(0,0,0,0.08)'; A.fillRect(x + 6, y - 1, 2, 2); }
    }
    for (const y of [0.33, 0.66]) { A.fillStyle = 'rgba(0,0,0,0.1)'; A.fillRect(0, y * h, w, 2); H.fillStyle = '#505050'; H.fillRect(0, y * h - 1, w, 4); }
    for (let i = 0; i < 4; i++) { const x = (i * 0.25 + 0.07) * w; A.fillStyle = '#23262b'; A.font = 'bold 22px Arial'; A.fillText(i % 2 ? 'ОРБИТА' : 'ГК-' + (12 + i * 7), x, h * 0.5); }
    A.fillStyle = '#d8692b'; A.fillRect(0, h * 0.08, w, 10);
    for (let i = 0; i < 400; i++) { const v = 90 + rand() * 50; R.fillStyle = `rgba(${v},${v},${v},0.25)`; R.fillRect(rand() * w, rand() * h, 20, 20); }
  });
  TEX.foam = texSet(512, 512, 0.88, 6.0, (A, H, R, w, h) => {
    A.fillStyle = '#b5612a'; A.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const s = 1 + rand() * 7; A.fillStyle = `rgba(${150 + rand() * 60},${70 + rand() * 40},${20 + rand() * 30},0.35)`; A.beginPath(); A.arc(rand() * w, rand() * h, s, 0, TAU); A.fill(); H.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.2})`; H.beginPath(); H.arc(rand() * w, rand() * h, s, 0, TAU); H.fill(); }
    for (let i = 0; i < 5; i++) { A.fillStyle = 'rgba(60,30,10,0.25)'; A.fillRect(0, i * h / 5, w, 3); H.fillStyle = '#404040'; H.fillRect(0, i * h / 5, w, 4); }
  });
  TEX.roll = texSet(512, 512, 0.45, 2.0, (A, H, R, w, h) => {
    A.fillStyle = '#ebebe8'; A.fillRect(0, 0, w, h);
    A.fillStyle = '#16181b'; for (let i = 0; i < 4; i++) { A.fillRect(i * w / 4, 0, w / 8, h * 0.18); A.fillRect(i * w / 4 + w / 8, h * 0.82, w / 8, h * 0.18); }
    for (let i = 0; i < 16; i++) { H.fillStyle = '#505050'; H.fillRect(i * w / 16, 0, 2, h); }
    speckle(A, w, h, 3000, 'rgba(0,0,0,0.03)', 1, 3);
  });
  TEX.srb = texSet(512, 1024, 0.5, 3.0, (A, H, R, w, h) => {
    A.fillStyle = '#efeeea'; A.fillRect(0, 0, w, h);
    for (let s = 1; s < 5; s++) { const y = s * h / 5; A.fillStyle = '#5c6066'; A.fillRect(0, y - 6, w, 12); H.fillStyle = '#d0d0d0'; H.fillRect(0, y - 6, w, 12); for (let x = 0; x < w; x += 16) { H.fillStyle = '#ffffff'; H.beginPath(); H.arc(x + 8, y, 3, 0, TAU); H.fill(); } }
    for (let i = 0; i < 4; i++) { A.fillStyle = '#16181b'; A.fillRect(i * w / 4, 0, w / 8, h * 0.06); A.fillRect(i * w / 4 + w / 8, h * 0.94, w / 8, h * 0.06); }
    speckle(A, w, h, 4000, 'rgba(0,0,0,0.035)', 1, 3);
  });
  TEX.tiles = texSet(512, 512, 0.78, 4.0, (A, H, R, w, h) => {
    A.fillStyle = '#2a2c30'; A.fillRect(0, 0, w, h);
    const cols = 16, rows = 12;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = i * w / cols + (j % 2) * w / cols / 2, y = j * h / rows;
      const v = 52 + rand() * 22;
      A.fillStyle = `rgb(${v},${v + 2},${v + 6})`; A.fillRect(x + 1.5, y + 1.5, w / cols - 3, h / rows - 3);
      H.fillStyle = '#9a9a9a'; H.fillRect(x + 2, y + 2, w / cols - 4, h / rows - 4);
      if (rand() < 0.15) { A.fillStyle = 'rgba(200,200,200,0.08)'; A.fillRect(x + 3, y + 3, w / cols - 6, h / rows - 6); }
    }
    A.fillStyle = '#c8452b'; A.fillRect(0, h * 0.9, w, 6);
  });
  TEX.metal = texSet(256, 256, 0.42, 1.5, (A, H, R, w, h) => {
    A.fillStyle = '#3a3e45'; A.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { const y = rand() * h, v = 50 + rand() * 30; A.fillStyle = `rgba(${v},${v + 4},${v + 10},0.35)`; A.fillRect(0, y, w, 1); H.fillStyle = `rgba(${150 + rand() * 60},0,0,0.2)`; H.fillRect(0, y, w, 1); }
    for (let i = 0; i < 300; i++) { const v = 60 + rand() * 90; R.fillStyle = `rgba(${v},${v},${v},0.3)`; R.fillRect(rand() * w, rand() * h, 8, 3); }
  });
  TEX.foil = texSet(512, 512, 0.32, 7.0, (A, H, R, w, h) => {
    A.fillStyle = '#c9993a'; A.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rand() * w, y = rand() * h, s = 8 + rand() * 30;
      const v = rand();
      A.fillStyle = `rgba(${230 + v * 25},${180 + v * 40},${60 + v * 40},0.35)`;
      H.fillStyle = `rgba(${v * 255},${v * 255},${v * 255},0.5)`;
      A.beginPath(); H.beginPath();
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + rand(); const px = x + Math.cos(a) * s, py = y + Math.sin(a) * s; if (k) { A.lineTo(px, py); H.lineTo(px, py); } else { A.moveTo(px, py); H.moveTo(px, py); } }
      A.fill(); H.fill();
    }
  });
  TEX.stripe = texSet(512, 64, 0.5, 2.5, (A, H, R, w, h) => {
    A.fillStyle = '#e8b51c'; A.fillRect(0, 0, w, h); A.fillStyle = '#16161a';
    for (let i = -2; i < 36; i++) { A.beginPath(); A.moveTo(i * 16, 0); A.lineTo(i * 16 + 8, 0); A.lineTo(i * 16 + 8 + h, h); A.lineTo(i * 16 + h, h); A.fill(); }
    A.fillStyle = '#2b2d31'; A.fillRect(0, 0, w, 7); A.fillRect(0, h - 7, w, 7);
    for (let x = 6; x < w; x += 24) { H.fillStyle = '#ffffff'; H.beginPath(); H.arc(x, 4, 3, 0, TAU); H.fill(); H.beginPath(); H.arc(x, h - 4, 3, 0, TAU); H.fill(); }
  });
  TEX.shield = texSet(512, 512, 0.95, 5.0, (A, H, R, w, h) => {
    A.fillStyle = '#3d2a1c'; A.fillRect(0, 0, w, h);
    const s = 14;
    for (let j = 0; j < h / (s * 1.5) + 1; j++) for (let i = 0; i < w / (s * 1.732) + 1; i++) {
      const cx = i * s * 1.732 + (j % 2) * s * 0.866, cy = j * s * 1.5;
      const v = 40 + rand() * 30;
      A.fillStyle = `rgb(${v + 18},${v},${v - 8})`; H.fillStyle = `rgb(${170 + rand() * 40},0,0)`;
      A.beginPath(); H.beginPath();
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; const px = cx + Math.cos(a) * (s - 1.5), py = cy + Math.sin(a) * (s - 1.5); if (k) { A.lineTo(px, py); H.lineTo(px, py); } else { A.moveTo(px, py); H.moveTo(px, py); } }
      A.fill(); H.fill();
    }
  });
  TEX.solar = texSet(256, 512, 0.18, 1.5, (A, H, R, w, h) => {
    A.fillStyle = '#c0c4ca'; A.fillRect(0, 0, w, h);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) {
      const v = 30 + rand() * 18; A.fillStyle = `rgb(${v * 0.4},${v * 0.6},${v * 1.9 + 30})`; A.fillRect(i * w / 8 + 2, j * h / 16 + 2, w / 8 - 4, h / 16 - 4);
      H.fillStyle = '#707070'; H.fillRect(i * w / 8 + 2, j * h / 16 + 2, w / 8 - 4, h / 16 - 4);
    }
  });
  TEX.white = texSet(256, 256, 0.45, 1.0, (A, H, R, w, h) => { A.fillStyle = '#e6e6e2'; A.fillRect(0, 0, w, h); speckle(A, w, h, 1500, 'rgba(0,0,0,0.03)', 1, 3); });
  // ---- plain materials
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.5, metalness: 0.1 }, o));
  MAT.white = std({ color: 0xe9e9e6, roughness: 0.42 });
  MAT.gray = std({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.38 });
  MAT.dark = texMat('metal', 2, 2, { metalness: 0.75 });
  MAT.black = std({ color: 0x141619, roughness: 0.55 });
  MAT.orange = std({ color: 0xd8692b, roughness: 0.6 });
  MAT.glass = std({ color: 0x0c1520, metalness: 0.2, roughness: 0.04, envMapIntensity: 2.0 });
  MAT.steel = std({ color: 0xb4bbc2, metalness: 0.9, roughness: 0.28 });
  MAT.blue = std({ color: 0x3d6fb0, roughness: 0.35 });
  MAT.red = std({ color: 0xb8352a, roughness: 0.45 });
  MAT.green = std({ color: 0x6fb83a, emissive: 0x1c3a0c, roughness: 0.3 });
  MAT.gold = texMat('foil', 2, 1, { metalness: 1.0 });
  MAT.foam = texMat('foam', 2, 2, {});
  MAT.shield = texMat('shield', 3, 3, {});
  MAT.solar = texMat('solar', 1, 1, { metalness: 0.4, emissive: 0x020612 });
  MAT.stripe = texMat('stripe', 4, 1, {});
  MAT.canopy = new THREE.MeshStandardMaterial({ map: canvasTex(512, 64, (x, w, h) => { for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? '#f2f1ec' : '#e0602a'; x.fillRect(i * w / 12, 0, w / 12, h); } x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, h - 4, w, 4); }), side: THREE.DoubleSide, roughness: 0.85 });
  // bell: steel near the throat, heat-tinted bronze/blue toward the exit (vertex colours)
  MAT.bell = std({ color: 0xffffff, vertexColors: true, metalness: 0.92, roughness: 0.32, side: THREE.DoubleSide });
}

const GEO_CACHE = {};
const _gc = (k, f) => GEO_CACHE[k] || (GEO_CACHE[k] = f());
function cyl(rt, rb, h, seg, open) { return _gc(`c${rt}_${rb}_${h}_${seg || 48}_${!!open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg || 48, 1, !!open)); }
function bellGeo(r0, r1, len) {
  return _gc(`b${r0}_${r1}_${len}`, () => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 0.65), -t * len)); }
    const g = new THREE.LatheGeometry(pts, 48);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const t = -g.attributes.position.getY(i) / len;
      const c = t < 0.35 ? [0.45, 0.46, 0.5] : t < 0.75 ? [0.62, 0.45, 0.3] : [0.42, 0.38, 0.55];
      const c2 = t < 0.35 ? [0.62, 0.45, 0.3] : [0.42, 0.38, 0.55];
      const k = t < 0.35 ? t / 0.35 : t < 0.75 ? (t - 0.35) / 0.4 : 0;
      col.set([lerp(c[0], c2[0], k * 0.4), lerp(c[1], c2[1], k * 0.4), lerp(c[2], c2[2], k * 0.4)], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
}
function ogive(r, h) {
  return _gc(`o${r}_${h}`, () => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector2(Math.max(0.0005, r * Math.sqrt(Math.max(0, 1 - t * t * 0.985))), -h / 2 + t * h)); }
    return new THREE.LatheGeometry(pts, 48);
  });
}
function finGeo(h, depth, w) {
  return _gc(`f${h}_${depth}_${w}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, h / 2); s.lineTo(depth * 0.3, h / 2 - h * 0.06); s.lineTo(depth, -h * 0.18); s.lineTo(depth, -h / 2); s.lineTo(0, -h / 2); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: w * 0.4, bevelSize: w * 0.35, bevelSegments: 2 });
    g.translate(-depth / 2, 0, -w / 2);
    return g;
  });
}

// returns Object3D in part-local coords: +Y up; radial parts face +X (outward)
function buildPartMesh(def) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); g.add(m); return m; };
  const rt = def.dTop / 2, rb = def.dBot / 2, h = def.h;
  const circ = (r) => Math.max(1, Math.round(TAU * r / 1.2));   // texture repeats around
  const tankMat = (r, hh) => r >= 1.8 ? texMat('roll', circ(r) / 2, hh / 3.75) : r >= 1.2 ? texMat('foam', circ(r) / 2, hh / 2) : texMat('tank', Math.max(1, circ(r) / 3), hh / 1.9);
  switch (def.shape) {
    case 'pod': {
      const body = add(cyl(rt, rb, h * 0.86, 64), texMat('tiles', 2, 1), 0, -h * 0.03);
      void body;
      add(cyl(rt * 0.96, rt * 0.98, h * 0.1, 48), MAT.dark, 0, h * 0.45);
      add(cyl(rb * 1.01, rb * 1.015, h * 0.05, 64), MAT.dark, 0, -h * 0.475);
      // windows and hatch on the conical wall
      const slope = Math.atan2(rb - rt, h);
      for (const [a, y, s] of [[0.3, 0.12, 0.09], [-0.3, 0.12, 0.09], [Math.PI, 0.05, 0.11]]) {
        const rr = lerp(rb, rt, (y + 0.5)) + 0.005;
        const w = new THREE.Mesh(cyl(s * def.dBot, s * def.dBot, 0.04, 24), MAT.glass);
        const fr = new THREE.Mesh(new THREE.TorusGeometry(s * def.dBot, 0.018, 8, 24), MAT.dark);
        const holder = new THREE.Group();
        holder.add(w); holder.add(fr); fr.rotation.x = Math.PI / 2;
        holder.position.set(Math.cos(a) * rr, y * h - h * 0.03, Math.sin(a) * rr);
        holder.rotation.order = 'YXZ';
        holder.rotation.y = -a; holder.rotation.z = -(Math.PI / 2 - slope);
        g.add(holder);
      }
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.32, def.dBot * 0.26), MAT.dark);
      const hr = lerp(rb, rt, 0.42) + 0.01;
      hatch.position.set(hr, -h * 0.08, 0); hatch.rotation.z = slope; g.add(hatch);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, r2 = lerp(rb, rt, 0.85); add(new THREE.BoxGeometry(0.08, 0.08, 0.08), MAT.white, Math.cos(a) * r2, h * 0.3, Math.sin(a) * r2); }
      break;
    }
    case 'probe': {
      add(cyl(rt, rb, h * 0.8, 8), MAT.gold);
      add(cyl(rt * 1.02, rt * 1.02, h * 0.1, 8), MAT.dark, 0, h * 0.45);
      add(cyl(rb * 1.02, rb * 1.02, h * 0.1, 8), MAT.dark, 0, -h * 0.45);
      add(cyl(0.012, 0.012, h * 1.4, 6), MAT.steel, rt * 0.5, h * 0.9, 0);
      const dish = add(new THREE.SphereGeometry(rt * 0.35, 20, 8, 0, TAU, 0, 1.1), MAT.white, -rt * 0.5, h * 0.55, 0); dish.rotation.z = 0.5;
      dish.material = MAT.white.clone(); dish.material.side = THREE.DoubleSide;
      break;
    }
    case 'tank': {
      add(cyl(rt, rb, h * 0.94, 64), tankMat(rt, h));
      add(cyl(rt * 1.004, rt * 1.004, h * 0.03, 64), MAT.dark, 0, h * 0.485);
      add(cyl(rb * 1.004, rb * 1.004, h * 0.03, 64), MAT.dark, 0, -h * 0.485);
      break;
    }
    case 'adapterTank': add(cyl(rt, rb, h, 64), texMat('foam', 4, 1)); add(cyl(rb * 1.004, rb * 1.004, h * 0.04, 64), MAT.dark, 0, -h * 0.48); break;
    case 'monoTank': add(cyl(rt, rb, h, 48), MAT.gray); add(cyl(rt * 1.01, rt * 1.01, h * 0.2, 48), texMat('white', 2, 1)); add(new THREE.TorusGeometry(rt * 0.98, 0.03, 8, 48), MAT.dark, 0, h * 0.4).rotation.x = Math.PI / 2; break;
    case 'xenonTank': add(cyl(rt, rb, h * 0.9, 24), MAT.dark); add(new THREE.SphereGeometry(rt * 0.96, 24, 16), MAT.gold, 0, 0, 0).scale.set(1, h / (rt * 2), 1); break;
    case 'engine': case 'nuclear': case 'ion': {
      const mountH = h * (def.shape === 'ion' ? 0.6 : 0.42);
      const bellL = h - mountH;
      if (def.shape === 'nuclear') {
        add(cyl(rt, rt, mountH, 48), MAT.gray, 0, h / 2 - mountH / 2);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const f = add(new THREE.BoxGeometry(0.02, mountH * 0.9, rt * 0.7), MAT.dark, Math.cos(a) * rt * 1.2, h / 2 - mountH / 2, Math.sin(a) * rt * 1.2); f.rotation.y = -a; }
      } else if (def.shape === 'ion') {
        add(cyl(rt, rt, mountH, 24), MAT.gold, 0, h / 2 - mountH / 2);
        const grid = add(cyl(rt * 0.92, rt * 0.92, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0x1a2a5a, emissive: 0x2050ff, emissiveIntensity: 0, roughness: 0.3, metalness: 0.6 }), 0, -h / 2 + bellL * 0.6);
        grid.name = 'iongrid';
      } else {
        add(cyl(rt * 0.98, rt * 0.62, mountH, 48), MAT.dark, 0, h / 2 - mountH / 2);
        add(cyl(rt * 0.2, rt * 0.2, mountH * 0.7, 16), MAT.steel, rt * 0.52, h / 2 - mountH * 0.55, 0);
        add(cyl(rt * 0.14, rt * 0.14, mountH * 0.55, 16), MAT.steel, -rt * 0.5, h / 2 - mountH * 0.6, rt * 0.15);
        const pipe = add(new THREE.TorusGeometry(rt * 0.45, rt * 0.04, 8, 32, Math.PI * 1.3), MAT.gray, 0, h / 2 - mountH * 0.8, 0); pipe.rotation.x = Math.PI / 2;
        add(cyl(rt * 0.36, rt * 0.3, mountH * 0.15, 32), MAT.gray, 0, h / 2 - mountH - mountH * 0.02, 0);
      }
      if (def.shape !== 'ion') {
        const bm = MAT.bell.clone(); bm.emissive = new THREE.Color(0xff5a1a); bm.emissiveIntensity = 0;
        const bell = add(bellGeo(rt * 0.3, rt * (def.bell || 0.85), bellL), bm, 0, h / 2 - mountH);
        bell.name = 'bell';
      }
      break;
    }
    case 'srb': {
      add(cyl(rt, rb, h * 0.9, 48), texMat('srb', 2, 1), 0, h * 0.04);
      add(cyl(rt * 0.96, rt * 0.62, h * 0.05, 48), MAT.dark, 0, -h * 0.43);
      const bm = MAT.bell.clone(); bm.emissive = new THREE.Color(0xff5a1a); bm.emissiveIntensity = 0;
      const bell = add(bellGeo(rt * 0.34, rt * 0.68, h * 0.08), bm, 0, -h * 0.455); bell.name = 'bell';
      add(new THREE.SphereGeometry(rt, 32, 12, 0, TAU, 0, Math.PI / 2), texMat('white', 2, 1), 0, h * 0.49, 0).scale.y = 0.15;
      break;
    }
    case 'decoupler': {
      add(cyl(rt, rb, h, 64), MAT.stripe);
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; add(cyl(0.025, 0.025, h * 1.05, 6), MAT.steel, Math.cos(a) * rt * 1.0, 0, Math.sin(a) * rt * 1.0); }
      break;
    }
    case 'adapter': {
      add(cyl(rt, rb, h, 64), texMat('white', 4, 1));
      add(cyl(rb * 1.004, rb * 1.004, h * 0.1, 64), MAT.dark, 0, -h * 0.45);
      add(cyl(rt * 1.006, rt * 1.006, h * 0.06, 64), MAT.dark, 0, h * 0.47);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = (rt + rb) / 2; const rib = add(new THREE.BoxGeometry(0.05, h * 0.9, 0.05), MAT.gray, Math.cos(a) * rr, 0, Math.sin(a) * rr); rib.rotation.order = 'YXZ'; rib.rotation.y = -a; rib.rotation.z = Math.atan2(rb - rt, h); }
      break;
    }
    case 'cone': add(ogive(rb, h), texMat('white', 3, 1)); add(new THREE.SphereGeometry(rb * 0.06, 12, 8), MAT.dark, 0, h / 2, 0); add(cyl(rb * 1.004, rb * 1.004, h * 0.04, 64), MAT.dark, 0, -h * 0.48); break;
    case 'chute': {
      add(cyl(rt, rb, h * 0.75, 32), MAT.orange, 0, -h * 0.12);
      add(new THREE.SphereGeometry(rt, 24, 10, 0, TAU, 0, Math.PI / 2), MAT.orange, 0, h * 0.25).scale.y = 0.6;
      add(cyl(rb, rb, h * 0.16, 32), MAT.dark, 0, -h * 0.42);
      break;
    }
    case 'shield': add(cyl(rt, rb, h * 0.7, 64), MAT.shield, 0, -h * 0.15); add(cyl(rt * 1.003, rt * 1.003, h * 0.3, 64), MAT.dark, 0, h * 0.35); break;
    case 'wheel': add(cyl(rt, rb, h, 48), MAT.gray); add(new THREE.TorusGeometry(rt * 0.8, 0.035, 8, 48), MAT.dark, 0, 0, 0).rotation.x = Math.PI / 2; add(cyl(rt * 1.01, rt * 1.01, h * 0.25, 48), MAT.dark); break;
    case 'batteryStack': add(cyl(rt, rb, h, 32), MAT.dark); add(cyl(rt * 1.01, rt * 1.01, h * 0.3, 32), MAT.gold); break;
    case 'matbay': {
      add(cyl(rt, rb, h, 48), MAT.gray);
      for (const s of [1, -1]) { const door = add(new THREE.BoxGeometry(rt * 0.7, h * 0.72, 0.04), texMat('white', 1, 1), 0, 0, s * rt * 0.98); void door; }
      break;
    }
    // radial parts (outward = +X)
    case 'radialDecoupler': add(new THREE.BoxGeometry(def.depth, def.h, def.w), MAT.stripe); add(new THREE.BoxGeometry(def.depth * 0.4, def.h * 0.5, def.w * 1.2), MAT.dark); break;
    case 'fin': add(finGeo(def.h, def.depth, def.w), MAT.white); break;
    case 'battery': add(new THREE.BoxGeometry(def.depth, def.h, def.w), MAT.dark); add(new THREE.BoxGeometry(def.depth * 1.02, def.h * 0.25, def.w * 1.02), MAT.gold); break;
    case 'monoRadial': add(new THREE.CapsuleGeometry(def.depth / 2, def.h - def.depth, 8, 16), texMat('white', 1, 1)); add(new THREE.TorusGeometry(def.depth / 2, 0.015, 6, 24), MAT.dark).rotation.x = Math.PI / 2; break;
    case 'xenonRadial': add(new THREE.CapsuleGeometry(def.depth / 2, def.h - def.depth, 8, 16), MAT.gold); break;
    case 'solar': case 'solarBig': {
      add(new THREE.BoxGeometry(def.depth, def.h * 0.3, 0.06), MAT.dark);
      const pn = new THREE.Group(); pn.name = 'panel';
      const L = def.shape === 'solarBig' ? 3.2 : 0.55;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.02, L, def.shape === 'solarBig' ? 0.75 : 0.5), MAT.solar);
      p.position.set(0.05, def.shape === 'solarBig' ? L / 2 : 0, 0); pn.add(p);
      pn.position.x = def.depth / 2; g.add(pn);
      break;
    }
    case 'legs': {
      add(new THREE.BoxGeometry(def.depth * 0.6, def.h, def.w), MAT.dark);
      const lg = new THREE.Group(); lg.name = 'leg';
      const L = def.legs.len;
      const strut = new THREE.Mesh(cyl(0.05, 0.05, L, 10), MAT.steel); strut.position.y = -L / 2; lg.add(strut);
      const shock = new THREE.Mesh(cyl(0.08, 0.08, L * 0.35, 10), MAT.dark); shock.position.y = -L * 0.25; lg.add(shock);
      const foot = new THREE.Mesh(cyl(0.2, 0.24, 0.06, 16), MAT.dark); foot.position.y = -L; lg.add(foot);
      lg.position.set(def.depth * 0.3, def.h * 0.35, 0); g.add(lg);
      break;
    }
    case 'rcs': {
      add(new THREE.BoxGeometry(def.depth, def.h, def.w), texMat('white', 1, 1));
      for (const [x, y, z, rx, rz] of [[0.05, 0.14, 0, 0, 0], [0.05, -0.14, 0, 0, Math.PI], [0.05, 0, 0.12, Math.PI / 2, 0], [0.05, 0, -0.12, -Math.PI / 2, 0]]) add(cyl(0.022, 0.034, 0.05, 10), MAT.dark, x, y, z).rotation.set(rx, 0, rz);
      break;
    }
    case 'antenna': add(cyl(0.012, 0.018, def.h, 8), MAT.steel, def.depth * 0.3, def.h / 2 - 0.1); add(new THREE.BoxGeometry(0.06, 0.12, 0.06), MAT.dark); add(new THREE.SphereGeometry(0.02, 8, 6), MAT.red, def.depth * 0.3, def.h - 0.1); break;
    case 'chuteRadial': add(new THREE.CapsuleGeometry(def.depth / 2, def.h - def.depth, 8, 16), MAT.orange); break;
    case 'goo': {
      add(cyl(def.depth / 2, def.depth / 2, def.h, 24), MAT.gray);
      add(new THREE.SphereGeometry(def.depth * 0.45, 16, 12), MAT.green, def.depth * 0.12, 0, 0);
      add(new THREE.TorusGeometry(def.depth / 2, 0.02, 6, 24), MAT.dark, 0, def.h * 0.45).rotation.x = Math.PI / 2;
      break;
    }
    case 'sci': default: {
      const col = { temperature: MAT.red, pressure: MAT.blue, seismic: MAT.orange, gravity: MAT.gold, atmosphere: MAT.green }[def.sci] || MAT.gray;
      add(new THREE.BoxGeometry(def.depth, def.h, def.w), texMat('white', 1, 1));
      add(new THREE.BoxGeometry(def.depth * 0.5, def.h * 0.5, def.w * 1.05), col, def.depth * 0.3, 0, 0);
    }
  }
  g.traverse(o => { if (o.isMesh) { o.renderOrder = 5; o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// canopy for parachutes
function buildCanopy(def) {
  const g = new THREE.Group();
  const R = def.chute.full > 1000 ? 9 : def.chute.full > 200 ? 6 : 2.8;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 36, 14, 0, TAU, 0, Math.PI / 2.3), MAT.canopy);
  dome.position.y = R * 1.6; dome.castShadow = true;
  g.add(dome);
  const pts = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * R * 0.92, R * 1.6 + R * 0.25, Math.sin(a) * R * 0.92)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8a8a84 })));
  g.traverse(o => { o.renderOrder = 5; });
  return g;
}

// ---------------------------------------------------------------- engine plume
const PLUME_VS = `
uniform float uExp, uLen, uR0, uP;
varying float vX; varying vec3 vN; varying vec3 vV;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vec3 p = position;
  float x = clamp(-p.y, 0.0, 1.0);                  // 0 at the nozzle exit, 1 at the tail
  float s = mix(1.0, uExp, pow(x, 0.55)) * (1.0 - 0.18 * uP * sin(min(x, 0.5) * 6.2832));
  p.xz *= s * uR0; p.y *= uLen;
  vX = x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * vec3(normal.x, 0.0, normal.z));
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PLUME_FS = `
uniform vec3 uColor, uCore; uniform float uT, uThr, uP, uI, uKind;
varying float vX; varying vec3 vN; varying vec3 vV;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  float rim = abs(dot(vN, vV));
  float body = pow(rim, 1.6);
  float x = vX;
  float fall = exp(-x * mix(1.4, 3.2, uP)) * smoothstep(1.0, 0.75, x);
  float diamonds = uP * smoothstep(0.15, 0.6, uP) * pow(0.5 + 0.5 * cos(x * 38.0), 6.0) * exp(-x * 4.0);
  float flick = 0.86 + 0.14 * sin(uT * 61.0 + x * 23.0) * sin(uT * 37.0 + x * 7.0);
  float coreMask = pow(rim, 5.0) * exp(-x * 7.0);
  float I = (fall * body + diamonds * body * 2.0) * flick * uThr * uI;
  vec3 c = mix(uColor, uCore, clamp(coreMask * 1.4 + diamonds, 0.0, 1.0));
  gl_FragColor = vec4(c * I, 1.0);
}`;
function plumeMaterial(kind) {
  const cols = {
    liquid: [[1.0, 0.48, 0.16], [1.0, 0.92, 0.75]],
    solid: [[1.0, 0.55, 0.2], [1.0, 0.95, 0.8]],
    ion: [[0.25, 0.45, 1.0], [0.75, 0.85, 1.0]],
    nuclear: [[1.0, 0.55, 0.6], [1.0, 0.9, 0.95]],
    plasma: [[1.0, 0.38, 0.15], [1.0, 0.8, 0.6]],
  }[kind];
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...cols[0]).multiplyScalar(3) }, uCore: { value: new THREE.Vector3(...cols[1]).multiplyScalar(6) },
      uT: { value: 0 }, uThr: { value: 1 }, uP: { value: 0 }, uI: { value: 1 }, uKind: { value: 0 }, uExp: { value: 1 }, uLen: { value: 1 }, uR0: { value: 1 } },
    vertexShader: PLUME_VS, fragmentShader: PLUME_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
  });
}
let _plumeGeo = null;
function plumeGeo() {
  if (_plumeGeo) return _plumeGeo;
  const g = new THREE.CylinderGeometry(1, 1, 1, 32, 24, true);
  g.translate(0, -0.5, 0);
  return (_plumeGeo = g);
}
const _glowTex = { t: null };
function nozzleGlowTex() {
  if (_glowTex.t) return _glowTex.t;
  _glowTex.t = canvasTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,240,210,1)'); g.addColorStop(0.3, 'rgba(255,170,90,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); });
  return _glowTex.t;
}

// ---------------------------------------------------------------- vessel view
class VesselView {
  constructor(v) {
    this.v = v;
    this.group = new THREE.Group();
    this.parts = new Map();
    this.plumes = [];
    for (const p of v.parts) {
      if (p.dead) continue;
      const d = PART[p.id];
      const m = buildPartMesh(d);
      m.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.dir) m.rotation.y = -p.ang;
      this.group.add(m);
      this.parts.set(p.rid, m);
      if (d.engine) {
        const kind = d.engine.prop === 'SOLID' ? 'solid' : d.engine.prop === 'XENON' ? 'ion' : d.shape === 'nuclear' ? 'nuclear' : 'liquid';
        const rr = (d.dBot / 2) * (d.engine.prop === 'SOLID' ? 0.62 : (d.bell || 0.85)) * 0.95;
        const outer = new THREE.Mesh(plumeGeo(), plumeMaterial(kind));
        const core = new THREE.Mesh(plumeGeo(), plumeMaterial(kind));
        core.material.uniforms.uColor.value.multiplyScalar(0.6);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nozzleGlowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        for (const o of [outer, core, sprite]) { o.position.set(p.pos[0], p.pos[1] - d.h / 2, p.pos[2]); o.visible = false; o.renderOrder = 8; o.frustumCulled = false; this.group.add(o); }
        this.plumes.push({ p, outer, core, sprite, rr, kind, heat: 0, bell: m.getObjectByName('bell'), grid: m.getObjectByName('iongrid') });
      }
      if (d.chute) {
        const c = buildCanopy(d);
        c.visible = false;
        c.position.set(p.pos[0], p.pos[1], p.pos[2]);
        this.group.add(c);
        this.parts.get(p.rid).userData.canopy = c;
      }
    }
    // re-entry plasma: open cone, wide end at the leading face, trailing along the flow
    this.glow = new THREE.Mesh(plumeGeo(), plumeMaterial('plasma'));
    this.glow.renderOrder = 9; this.glow.frustumCulled = false; this.glow.visible = false;
    this.group.add(this.glow);
    this.bounds = vesselBounds(v);
  }
  dispose() {
    const cached = new Set(Object.values(GEO_CACHE)); cached.add(_plumeGeo);
    this.group.traverse(o => { if (o.geometry && !cached.has(o.geometry)) o.geometry.dispose(); });
  }
  // lowest running engine position (local) and total thrust share, for the exhaust light
  engineCenter() {
    let n = 0, x = 0, y = 0, z = 0, thr = 0;
    for (const pl of this.plumes) {
      const e = pl.p.st.eng;
      if (pl.p.dead || !e || !e.on || e.out || !(e.thr > 0.01)) continue;
      const d = PART[pl.p.id];
      x += pl.p.pos[0]; y += pl.p.pos[1] - d.h / 2 - 1.5; z += pl.p.pos[2]; n++; thr += e.thr * d.engine.thrust;
    }
    return n ? { pos: [x / n, y / n, z / n], thrust: thr } : null;
  }
  update(t, airLocal, atmP, dt) {
    const v = this.v;
    const mp = massProps(v);
    const hull = V.sub(V.sub(V.add(bodyAbsPos(v.body, t), v.r), RV.camAbs), Q.rot(v.q, mp.com));
    toT(hull, this.group.position);
    quatT(v.q, this.group.quaternion);
    for (const p of v.parts) {
      const m = this.parts.get(p.rid);
      if (!m) continue;
      m.visible = !p.dead;
      if (p.dead) { if (m.userData.canopy) m.userData.canopy.visible = false; continue; }
      if (p.st.legs != null) {
        const leg = m.getObjectByName('leg');
        if (leg) { p._legA = lerp(p._legA || 0, p.st.legs ? 1 : 0, 0.08); leg.rotation.z = -lerp(0.05, 0.55, p._legA); }
      }
      const c = m.userData.canopy;
      if (c) {
        const s = p.st.chute;
        c.visible = s === 'semi' || s === 'full';
        if (c.visible) {
          const k = s === 'full' ? 0.35 + 0.65 * (p.st.chuteT || 0) : 0.18;
          c.scale.set(k, s === 'full' ? 1 : 1.6, k);
          if (airLocal && V.len(airLocal) > 0.5) {
            const up = V.norm(V.neg(airLocal));
            c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up[0], up[1], up[2]));
          }
        }
      }
    }
    const pAtm = clamp(atmP || 0, 0, 1);
    for (const pl of this.plumes) {
      const p = pl.p, e = p.st.eng;
      const on = !p.dead && e && e.on && !e.out && (e.thr || 0) > 0.01;
      const thr = on ? e.thr || 1 : 0;
      pl.heat = clamp(pl.heat + ((on ? 0.4 + 0.6 * thr : 0) - pl.heat) * Math.min(1, (dt || 0.016) * (on ? 0.6 : 0.15)), 0, 1);
      if (pl.bell) pl.bell.material.emissiveIntensity = pl.heat * pl.heat * 1.6;
      if (pl.grid) pl.grid.material.emissiveIntensity = on ? 2.5 * thr : 0;
      pl.outer.visible = pl.core.visible = pl.sprite.visible = on && !p.dead;
      if (!on) continue;
      const vac = 1 - pAtm;
      const base = pl.kind === 'ion' ? 4 : pl.kind === 'solid' ? 11 : 7;
      // short and dense at sea level, long and faint in vacuum
      const len = base * (0.45 + 0.55 * thr) * (1 + vac * 1.6) * (pl.rr * 1.4 + 0.35);
      for (const [mesh, k, lenK, iK] of [[pl.outer, 1, 1, 0.45], [pl.core, 0.5, 0.42, 0.7]]) {
        const u = mesh.material.uniforms;
        u.uT.value = t; u.uThr.value = thr; u.uP.value = pAtm * (pl.kind === 'ion' ? 0 : 1);
        u.uExp.value = (pl.kind === 'ion' ? 1.3 : lerp(0.7, 3.4, vac)) * (k === 1 ? 1 : 0.8);
        u.uLen.value = len * lenK; u.uR0.value = pl.rr * k;
        u.uI.value = (pl.kind === 'ion' ? 0.6 : 1) * iK * lerp(0.55, 1.0, pAtm);
      }
      const s = pl.rr * (3.5 + thr * 2);
      pl.sprite.scale.set(s, s, 1);
      pl.sprite.material.color.setRGB(3 * thr, 2.4 * thr, 1.8 * thr);
    }
  }
}

// ---------------------------------------------------------------- particles (smoke, fire, sparks, dust)
const FX = { list: [], max: 3000, points: null, geo: null, light: [1, 1, 1] };
function puffTexture() {
  return canvasTex(128, 128, (x) => {
    for (let i = 0; i < 26; i++) {
      const cx = 64 + (rand() - 0.5) * 50, cy = 64 + (rand() - 0.5) * 50, r = 14 + rand() * 26;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a = 0.18 + rand() * 0.18;
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
  });
}
function initFX() {
  const n = FX.max;
  FX.geo = new THREE.BufferGeometry();
  FX.pos = new Float32Array(n * 3); FX.col = new Float32Array(n * 4); FX.size = new Float32Array(n); FX.rot = new Float32Array(n); FX.kind = new Float32Array(n);
  FX.geo.setAttribute('position', new THREE.BufferAttribute(FX.pos, 3));
  FX.geo.setAttribute('color', new THREE.BufferAttribute(FX.col, 4));
  FX.geo.setAttribute('size', new THREE.BufferAttribute(FX.size, 1));
  FX.geo.setAttribute('rot', new THREE.BufferAttribute(FX.rot, 1));
  FX.geo.setAttribute('kind', new THREE.BufferAttribute(FX.kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puffTexture() }, uPx: { value: 1 }, uLight: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: `attribute float size; attribute float rot; attribute float kind; attribute vec4 color;
      uniform float uPx; uniform vec3 uLight;
      varying vec4 vC; varying float vR; varying float vK;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vK = kind; vR = rot; vC = color; if (kind < 0.5) vC.rgb *= uLight;
        vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(size * 900.0 * uPx / max(-mv.z, 0.1), 512.0); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; varying vec4 vC; varying float vR; varying float vK;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); q = vec2(c*q.x - s*q.y, s*q.x + c*q.y) + 0.5;
        float a;
        if (vK < 0.5 || vK > 2.5) a = texture2D(map, q).a * 1.6; else { float r = length(gl_PointCoord - 0.5) * 2.0; a = max(1.0 - r*r, 0.0); }
        a *= vC.a; if (a < 0.003) discard;
        gl_FragColor = vec4(vC.rgb * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  FX.points = new THREE.Points(FX.geo, mat);
  FX.points.frustumCulled = false; FX.points.renderOrder = 7;
  RV.scene.add(FX.points);
}
// kind: 'smoke' | 'steam' | 'dust' (lit puffs) | 'fire' | 'spark' (emissive). base: air velocity (not damped)
function fxSpawn(p, vel, kind, size, life, base) {
  if (FX.list.length >= FX.max) FX.list.shift();
  const b = base || [0, 0, 0];
  // fresh: spawned at the current time, so it must not be advanced in this frame's update
  FX.list.push({ p: p.slice(), b: b.slice(), v: V.sub(vel, b), kind, s0: size, age: 0, life, rot: rand() * TAU, spin: (rand() - 0.5) * 0.6, fresh: true });
}
function fxUpdate(dt, light) {
  const L = FX.list;
  if (light) FX.points.material.uniforms.uLight.value.set(light[0], light[1], light[2]);
  FX.points.material.uniforms.uPx.value = RV.renderer.getPixelRatio();
  for (let i = L.length - 1; i >= 0; i--) {
    const f = L[i];
    if (f.fresh) { f.fresh = false; continue; }
    f.age += dt;
    if (f.age > f.life) { L.splice(i, 1); continue; }
    f.p[0] += (f.b[0] + f.v[0]) * dt; f.p[1] += (f.b[1] + f.v[1]) * dt; f.p[2] += (f.b[2] + f.v[2]) * dt;
    const damp = f.kind === 'smoke' || f.kind === 'steam' ? Math.exp(-dt * 0.5) : f.kind === 'dust' ? Math.exp(-dt * 0.3) : Math.exp(-dt * 0.25);
    f.v = V.scale(f.v, damp);
    f.rot += f.spin * dt;
  }
  const n = L.length;
  for (let i = 0; i < n; i++) {
    const f = L[i], k = f.age / f.life;
    const r = [f.p[0] - RV.camAbs[0], f.p[1] - RV.camAbs[1], f.p[2] - RV.camAbs[2]];
    FX.pos[i * 3] = r[0]; FX.pos[i * 3 + 1] = r[2]; FX.pos[i * 3 + 2] = -r[1];
    FX.rot[i] = f.rot;
    let c, kind = 0;
    const fadeIn = Math.min(1, f.age * 6);
    if (f.kind === 'smoke') { const g = 0.55 - k * 0.12; c = [g, g * 0.98, g * 0.95, (1 - k) * (1 - k * 0.5) * 0.5 * fadeIn]; FX.size[i] = f.s0 * (1 + k * 6); }
    else if (f.kind === 'steam') { c = [0.82, 0.83, 0.85, (1 - k) * (1 - k) * 0.3 * fadeIn]; FX.size[i] = f.s0 * (1 + k * 5); }
    else if (f.kind === 'dust') { c = [0.55, 0.53, 0.5, (1 - k) * 0.5 * fadeIn]; FX.size[i] = f.s0 * (1 + k * 3); }
    else if (f.kind === 'fire') { c = [3.2, 1.3 + (1 - k) * 1.2, 0.35, (1 - k) * 0.9]; FX.size[i] = f.s0 * (1 + k * 2.5); kind = 3; }
    else { c = [4, 2.6, 1.2, 1 - k]; FX.size[i] = f.s0; kind = 2; }
    FX.kind[i] = kind;
    FX.col.set(c, i * 4);
  }
  for (let i = n; i < FX.max; i++) FX.size[i] = 0;
  FX.geo.setDrawRange(0, Math.max(1, n));
  for (const a of ['position', 'color', 'size', 'rot', 'kind']) FX.geo.attributes[a].needsUpdate = true;
}
function fxExplosion(abs, vel, scale) {
  for (let i = 0; i < 50 * scale; i++) {
    const d = V.norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
    fxSpawn(abs, V.add(vel, V.scale(d, 8 + rand() * 28 * scale)), i % 3 ? 'fire' : 'smoke', 1.4 * scale + rand() * 2, 1.0 + rand() * 1.8, vel);
  }
  for (let i = 0; i < 30 * scale; i++) {
    const d = V.norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
    fxSpawn(abs, V.add(vel, V.scale(d, 30 + rand() * 50)), 'spark', 0.25, 0.6 + rand(), vel);
  }
}
