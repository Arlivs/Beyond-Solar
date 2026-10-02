'use strict';
// Vehicle Assembly Building: interactive editor for designs.
//
// Interaction model (KSP-like):
//   click a part on the rocket  -> pick it up with everything hanging below it (Alt: just that part)
//   click a node / a surface    -> attach what you hold there (Shift: keep placing copies of a new part)
//   click the parts catalogue   -> delete what you hold;  right click / Esc -> put it back
//   drag the root part (cockpit) up and down to move the whole rocket in the hall

const VAB = {
  scene: null, camera: null, root: null, ghost: null, design: null, sym: 1, held: null, pickSnap: null,
  hover: null, history: [], future: [], yaw: 0.6, pitch: 0.2, dist: 18, camY: 8, active: false, statBody: 'earth',
  layout: [], meshes: [], placement: null, cat: 'pod', rocketY: 10, drag: null, snap: false,
};

function initVAB() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x10141a);
  s.fog = new THREE.Fog(0x10141a, 90, 300);
  VAB.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3630, 1.5); s.add(VAB.hemi);
  const key = new THREE.DirectionalLight(0xfff3e2, 2.6);
  key.position.set(55, 75, -35); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 80; sc.bottom = -10; sc.near = 1; sc.far = 220;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  s.add(key); s.add(key.target);
  VAB.key = key;
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.7); fill.position.set(-40, 25, -30); s.add(fill);
  // spot lights from the gantry
  for (const [x, z] of [[18, 14], [-18, 14], [0, -20]]) { const sp = new THREE.SpotLight(0xfff0dd, 900, 140, 0.55, 0.6, 1.6); sp.position.set(x, 95, z); sp.target.position.set(0, 10, 0); s.add(sp); s.add(sp.target); }
  // floor
  const floorTex = canvasTex(1024, 1024, (x, w, h) => {
    x.fillStyle = '#2b3038'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = Math.random() * 0.06; x.fillStyle = `rgba(255,255,255,${v})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3;
    for (let i = 0; i <= 16; i++) { x.beginPath(); x.moveTo(i * w / 16, 0); x.lineTo(i * w / 16, h); x.stroke(); x.beginPath(); x.moveTo(0, i * h / 16); x.lineTo(w, i * h / 16); x.stroke(); }
    x.strokeStyle = 'rgba(232,181,28,0.85)'; x.lineWidth = 10; x.beginPath(); x.arc(w / 2, h / 2, w * 0.1, 0, TAU); x.stroke();
    x.setLineDash([30, 20]); x.lineWidth = 6; x.beginPath(); x.arc(w / 2, h / 2, w * 0.16, 0, TAU); x.stroke();
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(5, 5);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
  // walls with panel texture and light strips
  const wallTex = canvasTex(1024, 512, (x, w, h) => {
    x.fillStyle = '#323a45'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) { x.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)'; x.fillRect(i * w / 32, 0, w / 32, h); }
    for (let j = 0; j < 8; j++) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, j * h / 8, w, 2); }
    x.fillStyle = 'rgba(255,240,200,0.9)'; for (let i = 0; i < 8; i++) x.fillRect(i * w / 8 + 20, h * 0.18, w / 8 - 40, 6);
  });
  wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(4, 1);
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 150, 48, 1, true), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, side: THREE.BackSide, emissive: 0x111111, emissiveMap: wallTex }));
  walls.position.y = 75; s.add(walls);
  const beamM = new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.6, metalness: 0.5 });
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 150, 3), beamM); beam.position.set(Math.cos(a) * 146, 75, Math.sin(a) * 146); beam.castShadow = true; s.add(beam); }
  // overhead crane gantry
  const crane = new THREE.Group();
  for (const z of [-6, 6]) { const g = new THREE.Mesh(new THREE.BoxGeometry(290, 2.5, 1.6), new THREE.MeshStandardMaterial({ color: 0xc88a1e, roughness: 0.6, metalness: 0.4 })); g.position.set(0, 110, z); crane.add(g); }
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 14), beamM); trolley.position.set(0, 108, 0); crane.add(trolley);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), new THREE.MeshStandardMaterial({ color: 0x222222 })); cable.name = 'cable'; crane.add(cable);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.15, 8, 16), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.3 })); hook.name = 'hook'; crane.add(hook);
  s.add(crane); VAB.crane = crane;
  // platform rings (work stands)
  const ringM = new THREE.MeshStandardMaterial({ color: 0x59616b, roughness: 0.5, metalness: 0.6 });
  for (const [r, y] of [[24, 0.05]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 8, 96), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = y; s.add(ring); }
  VAB.scene = s;
  VAB.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  VAB.root = new THREE.Group(); s.add(VAB.root);
  VAB.ghost = new THREE.Group(); s.add(VAB.ghost);
  VAB.nodeGroup = new THREE.Group(); s.add(VAB.nodeGroup);
  VAB.ghostOk = new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.45, depthWrite: false });
  VAB.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.35, depthWrite: false });
  VAB.ghostDel = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.25, depthWrite: false });
  VAB.nodeMat = new THREE.MeshBasicMaterial({ color: 0x3affb0, transparent: true, opacity: 0.85, depthTest: false });
  VAB.nodeGeo = new THREE.SphereGeometry(0.16, 14, 10);
  VAB.ray = new THREE.Raycaster();
}

function vabOpen(design) {
  VAB.design = design || { name: 'Новая ракета', stack: [], stages: [] };
  VAB.history = []; VAB.future = []; VAB.held = null; VAB.pickSnap = null; VAB.drag = null;
  VAB.active = true;
  VAB.rocketY = VAB.design.vabY || 12;
  vabRebuild(true);
}

function vabPush(snap) { VAB.history.push(snap || JSON.stringify(VAB.design)); if (VAB.history.length > 100) VAB.history.shift(); VAB.future = []; }
function vabUndo() { vabCancelHeld(); if (!VAB.history.length) return; VAB.future.push(JSON.stringify(VAB.design)); VAB.design = JSON.parse(VAB.history.pop()); vabRebuild(); }
function vabRedo() { vabCancelHeld(); if (!VAB.future.length) return; VAB.history.push(JSON.stringify(VAB.design)); VAB.design = JSON.parse(VAB.future.pop()); vabRebuild(); }

function vabBounds(L) {
  let minY = 0, maxY = 0;
  for (const it of L) { minY = Math.min(minY, it.pos[1] - it.def.h / 2); maxY = Math.max(maxY, it.pos[1] + it.def.h / 2); }
  return { minY, maxY };
}

function vabRebuild(resetCam) {
  const d = VAB.design;
  syncStages(d);
  while (VAB.root.children.length) VAB.root.remove(VAB.root.children[0]);
  VAB.layout = layoutDesign(d);
  VAB.meshes = [];
  const { minY, maxY } = vabBounds(VAB.layout);
  // the rocket hangs where the player put it; only lift it if parts would go through the floor
  if (VAB.rocketY + minY < 0.3) VAB.rocketY = 0.3 - minY;
  d.vabY = VAB.rocketY;
  VAB.root.position.y = VAB.rocketY;
  VAB.layout.forEach((it, i) => {
    const m = buildPartMesh(it.def);
    m.position.set(it.pos[0], it.pos[1], it.pos[2]);
    if (it.dir) m.rotation.y = -it.ang;
    m.traverse(o => { if (o.isMesh) o.userData = { li: i, uid: it.uid }; });
    m.userData = { li: i, uid: it.uid };
    VAB.root.add(m);
    VAB.meshes.push(m);
  });
  const h = maxY - minY;
  if (resetCam || VAB.fitH == null || h > VAB.fitH + 0.3) {
    VAB.dist = resetCam ? Math.max(9, h * 1.5 + 5) : Math.max(VAB.dist, h * 1.5 + 5);
    VAB.camY = VAB.rocketY + (maxY + minY) / 2;
    VAB.fitH = h;
  }
  VAB.height = h;
  VAB.minY = minY; VAB.maxY = maxY;
  vabClearGhost();
  ui.vabRefresh();
}

function vabCamera() {
  const c = VAB.camera;
  c.aspect = RV.w / RV.h; c.updateProjectionMatrix();
  const cy = Math.max(1, VAB.camY);
  c.position.set(Math.cos(VAB.yaw) * Math.cos(VAB.pitch) * VAB.dist, Math.max(0.8, cy + Math.sin(VAB.pitch) * VAB.dist), Math.sin(VAB.yaw) * Math.cos(VAB.pitch) * VAB.dist);
  c.lookAt(0, cy, 0);
}

function vabRender() {
  vabCamera();
  // crane hook follows the top of the rocket
  if (VAB.crane) {
    const top = VAB.rocketY + (VAB.layout.length ? VAB.maxY : 0) + 0.8;
    const cable = VAB.crane.getObjectByName('cable'), hook = VAB.crane.getObjectByName('hook');
    const len = Math.max(1, 108 - top);
    cable.scale.y = len; cable.position.y = 108 - len / 2; hook.position.y = top;
  }
  renderScene(VAB.scene, VAB.camera);
}

// ---- helpers over the design tree ----
function findGroup(design, uid) {
  for (const e of designTemplates(design)) if (e.group && e.group.uid === uid) return e.group;
  return null;
}
function collectUids(o, out) {
  out = out || new Set();
  if (Array.isArray(o)) { for (const x of o) collectUids(x, out); return out; }
  if (o && typeof o === 'object') { if (o.uid) out.add(o.uid); for (const k in o) if (k !== 'uid' && typeof o[k] === 'object') collectUids(o[k], out); }
  return out;
}
// the root is the command part (cockpit / probe) in the main stack, else the top part
function rootIndex() { const st = VAB.design.stack; if (!st.length) return -1; const i = st.findIndex(t => PART[t.id].command); return i >= 0 ? i : 0; }
function rootUid() { const i = rootIndex(); return i >= 0 ? VAB.design.stack[i].uid : null; }
function heldDef() {
  const h = VAB.held; if (!h) return null;
  if (h.kind === 'new') return PART[h.id];
  if (h.kind === 'seg') return PART[h.parts[0].id];
  return PART[(h.group.mount || h.group.column[0]).id];
}
// what can the held thing attach to: 'stack' (nodes + surface) or 'surface' only
function heldMode() {
  const h = VAB.held; if (!h) return null;
  if (h.kind === 'group') return 'surface';
  const d = heldDef();
  return d.attach === 'stack' ? 'stack' : 'surface';
}

// ---- attach nodes for stack-capable parts ----
function vabStackNodes() {
  const d = VAB.design, L = VAB.layout, out = [];
  if (!d.stack.length) { out.push({ pos: [0, 0, 0], act: { type: 'stack', index: 0 } }); return out; }
  const stackItems = L.filter(it => it.role === 'stack');
  out.push({ pos: [0, stackItems[0].pos[1] + stackItems[0].def.h / 2, 0], act: { type: 'stack', index: 0 } });
  stackItems.forEach((it, i) => out.push({ pos: [0, it.pos[1] - it.def.h / 2, 0], act: { type: 'stack', index: i + 1 } }));
  for (const it of L) {
    if (it.role === 'mount' && !it.group.column.length) out.push({ pos: V.add(it.pos, V.scale(it.dir, it.def.depth / 2 + 0.25)), act: { type: 'col', group: it.group.uid, index: 0 } });
    if (it.role === 'column') {
      if (it.cj === 0) out.push({ pos: [it.pos[0], it.pos[1] + it.def.h / 2, it.pos[2]], act: { type: 'col', group: it.group.uid, index: 0 } });
      out.push({ pos: [it.pos[0], it.pos[1] - it.def.h / 2, it.pos[2]], act: { type: 'col', group: it.group.uid, index: it.cj + 1 } });
    }
  }
  return out;
}

// templates the held thing contributes (fresh copies for new parts)
function heldPayload() {
  const h = VAB.held;
  if (h.kind === 'new') {
    const pd = PART[h.id];
    if (pd.mount) return { group: { uid: newUid(), sym: 1, y: 0, ang: 0, mount: { uid: newUid(), id: h.id }, column: [], anchor: 0 } };
    const tpl = { uid: newUid(), id: h.id, radial: [] };
    return pd.attach === 'radial' ? { group: { uid: newUid(), sym: 1, y: 0, ang: 0, mount: null, column: [tpl], anchor: 0 } } : { seg: [tpl], anchor: 0 };
  }
  if (h.kind === 'seg') return { seg: JSON.parse(JSON.stringify(h.parts)), anchor: h.anchor || 0 };
  return { group: JSON.parse(JSON.stringify(h.group)) };
}

// apply an attach action to design d with payload pl
function applyPlacement(d, act, pl) {
  if (act.type === 'stack') { d.stack.splice(act.index, 0, ...pl.seg); return true; }
  if (act.type === 'col') {
    const g = findGroup(d, act.group); if (!g) return false;
    const was = g.column.length;
    g.column.splice(act.index, 0, ...pl.seg);
    if (!was) g.anchor = pl.anchor || 0;
    else if (act.index <= g.anchor) g.anchor += pl.seg.length;
    return true;
  }
  if (act.type === 'surf') {
    const owner = designTemplates(d).find(e => e.t.uid === act.owner);
    if (!owner) return false;
    const grp = pl.group || { uid: newUid(), mount: null, column: pl.seg, anchor: pl.anchor || 0 };
    grp.sym = act.sym; grp.y = act.y; grp.ang = act.ang;
    (owner.t.radial || (owner.t.radial = [])).push(grp);
    return true;
  }
  return false;
}

function vabClearGhost() {
  while (VAB.ghost.children.length) VAB.ghost.remove(VAB.ghost.children[0]);
  while (VAB.nodeGroup.children.length) VAB.nodeGroup.remove(VAB.nodeGroup.children[0]);
  VAB.placement = null;
}
function ghostMesh(def, pos, ang, dir, mat) {
  const m = buildPartMesh(def);
  m.traverse(o => { if (o.isMesh) { o.material = mat; o.renderOrder = 20; o.castShadow = false; } });
  m.position.set(pos[0], pos[1] + VAB.rocketY, pos[2]);
  if (dir) m.rotation.y = -ang;
  VAB.ghost.add(m);
}
function vabScreen(p) {
  const v = new THREE.Vector3(p[0], p[1] + VAB.rocketY, p[2]).project(VAB.camera);
  return [(v.x + 1) / 2 * RV.w, (1 - v.y) / 2 * RV.h, v.z];
}
function vabRayHit(mx, my) {
  const mouse = new THREE.Vector2(mx / RV.w * 2 - 1, -(my / RV.h) * 2 + 1);
  VAB.ray.setFromCamera(mouse, VAB.camera);
  return VAB.ray.intersectObjects(VAB.meshes, true);
}

// held thing follows the mouse: snap to a node or to a part surface
function vabMouseMove(mx, my, overPalette) {
  vabClearGhost();
  VAB.mouse = [mx, my];
  if (!VAB.held) {
    const hit = vabRayHit(mx, my)[0];
    VAB.hover = hit ? hit.object.userData.uid : null;
    ui.vabHover(VAB.hover ? VAB.layout.find(it => it.uid === VAB.hover).def : null);
    return;
  }
  const mode = heldMode();
  const pl = heldPayload();
  const ghostUids = collectUids(pl);
  const showGhost = (act, mat) => {
    const tmp = JSON.parse(JSON.stringify(VAB.design));
    if (!applyPlacement(tmp, act, JSON.parse(JSON.stringify(pl)))) return false;
    // the temp layout re-anchors the stack top; keep the existing rocket fixed on screen
    const L = layoutDesign(tmp);
    const shift = act.type === 'stack' && act.index === 0 && VAB.design.stack.length ? pl.seg.reduce((s, t) => s + PART[t.id].h, 0) : 0;
    for (const it of L) if (ghostUids.has(it.uid)) ghostMesh(it.def, [it.pos[0], it.pos[1] + shift, it.pos[2]], it.ang, it.dir, mat);
    return true;
  };
  if (overPalette) return;   // hovering the catalogue with a part in hand: the panel shows it will be deleted
  // 1) stack nodes
  if (mode === 'stack') {
    let best = null, bd = 34 * 34;
    for (const n of vabStackNodes()) {
      const s = vabScreen(n.pos);
      const nm = new THREE.Mesh(VAB.nodeGeo, VAB.nodeMat); nm.position.set(n.pos[0], n.pos[1] + VAB.rocketY, n.pos[2]); nm.renderOrder = 30; VAB.nodeGroup.add(nm);
      const dd = (s[0] - mx) ** 2 + (s[1] - my) ** 2;
      if (dd < bd) { bd = dd; best = n; }
    }
    if (best && showGhost(best.act, VAB.ghostOk)) { VAB.placement = best.act; return; }
  }
  // 2) surface attach onto any cylindrical part (stack or column)
  const hits = vabRayHit(mx, my);
  let hit = null;
  for (const h of hits) { const it = VAB.layout[h.object.userData.li]; if (it && (it.role === 'stack' || it.role === 'column')) { hit = { h, it }; break; } }
  if (hit && VAB.design.stack.length) {
    const it = hit.it;
    const lp = [hit.h.point.x, hit.h.point.y - VAB.rocketY, hit.h.point.z];
    const hd = heldDef();
    let yRel = lp[1] - it.pos[1];
    if (VAB.snap) yRel = Math.round(yRel / (it.def.h / 4)) * (it.def.h / 4);
    yRel = clamp(yRel, -it.def.h / 2 + Math.min(hd.h, it.def.h) * 0.25, it.def.h / 2 - Math.min(hd.h, it.def.h) * 0.25);
    let ang = Math.atan2(lp[2] - it.pos[2], lp[0] - it.pos[0]);
    if (VAB.snap) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    const relAng = it.role === 'column' ? ang - it.ang : ang;
    const act = { type: 'surf', owner: it.uid, y: yRel, ang: relAng, sym: VAB.sym };
    if (showGhost(act, VAB.ghostOk)) { VAB.placement = act; return; }
  }
  // 3) nothing to attach to: free-floating red ghost (or the first part of a new rocket)
  const p = VAB.ray.ray.at(VAB.dist * 0.75, new THREE.Vector3());
  ghostMesh(heldDef(), [p.x, p.y - VAB.rocketY, p.z], 0, null, VAB.ghostBad);
}

// pick a part (with its subtree) off the rocket
function vabPick(uid, single) {
  const d = VAB.design;
  const e = designTemplates(d).find(x => x.t.uid === uid);
  if (!e) return false;
  const snap = JSON.stringify(d);
  let held = null;
  if (e.kind === 'stack') {
    const ri = rootIndex();
    if (e.i === ri) {
      if (!single) return false;                     // root: dragging moves the rocket instead
      if (d.stack.length > 1) { ui.toast('Кабину нельзя снять, пока к ней что-то прикреплено', '', 2500); return false; }
    }
    if (e.i < ri) {
      // parts above the cockpit hang off its top: take this one and everything above it
      const parts = single ? d.stack.splice(e.i, 1) : d.stack.splice(0, e.i + 1);
      held = { kind: 'seg', parts, anchor: single ? 0 : parts.length - 1 };
    } else {
      const n = single ? 1 : d.stack.length - e.i;
      held = { kind: 'seg', parts: d.stack.splice(e.i, n), anchor: 0 };
    }
  } else if (e.kind === 'column') {
    const g = e.group, j = e.j, A = g.anchor;
    let parts, anchor = 0;
    if (single) { parts = g.column.splice(j, 1); if (j < A) g.anchor--; }
    else if (j === A) { parts = g.column.splice(0); anchor = A; }
    else if (j < A) { parts = g.column.splice(0, j + 1); g.anchor = A - (j + 1); anchor = j; }
    else parts = g.column.splice(j);
    g.anchor = clamp(g.anchor, 0, Math.max(0, g.column.length - 1));
    if (!g.column.length && !g.mount) e.owner.radial = e.owner.radial.filter(x => x !== g);
    held = { kind: 'seg', parts, anchor };
  } else {
    e.owner.radial = e.owner.radial.filter(x => x !== e.group);
    held = { kind: 'group', group: e.group };
  }
  vabPush(snap);
  VAB.held = held; VAB.pickSnap = snap;
  vabRebuild();
  return true;
}

function vabCancelHeld() {
  if (!VAB.held) return;
  if (VAB.held.kind !== 'new' && VAB.pickSnap) { VAB.design = JSON.parse(VAB.pickSnap); VAB.history.pop(); }
  VAB.held = null; VAB.pickSnap = null;
  vabRebuild(); ui.vabPalette();
}
function vabDiscardHeld() {
  if (!VAB.held) return;
  const n = VAB.held.kind === 'new' ? 0 : collectUids(VAB.held.kind === 'seg' ? VAB.held.parts : VAB.held.group).size;
  VAB.held = null; VAB.pickSnap = null;
  vabRebuild(); ui.vabPalette();
  if (n) ui.toast('Удалено деталей: ' + n, '', 1500);
}

function vabClick(mx, my, shift, alt) {
  if (VAB.held) {
    if (VAB.placement) {
      if (VAB.held.kind === 'new') vabPush();
      applyPlacement(VAB.design, VAB.placement, heldPayload());
      if (!(shift && VAB.held.kind === 'new')) { VAB.held = null; VAB.pickSnap = null; }
      vabRebuild(); ui.vabPalette();
    } else if (!VAB.design.stack.length && heldMode() === 'stack') {
      vabPush(); applyPlacement(VAB.design, { type: 'stack', index: 0 }, heldPayload()); VAB.held = null; vabRebuild(); ui.vabPalette();
    }
    vabMouseMove(mx, my);
    return;
  }
  const hit = vabRayHit(mx, my)[0];
  if (!hit) return;
  const uid = hit.object.userData.uid;
  if (uid === rootUid() && !alt) { ui.toast('Корень ракеты: тяните мышью, чтобы поднять или опустить ракету', '', 2200); return; }
  if (vabPick(uid, alt)) { ui.vabPalette(); vabMouseMove(mx, my); }
}

// root-part drag: move the rocket vertically on a camera-facing plane
function vabDragStart(mx, my) {
  if (VAB.held) return false;
  const hit = vabRayHit(mx, my)[0];
  if (!hit || hit.object.userData.uid !== rootUid()) return false;
  VAB.drag = { y0: VAB.rocketY, hitY: hit.point.y };
  return true;
}
function vabDragMove(mx, my) {
  const D = VAB.drag; if (!D) return;
  const mouse = new THREE.Vector2(mx / RV.w * 2 - 1, -(my / RV.h) * 2 + 1);
  VAB.ray.setFromCamera(mouse, VAB.camera);
  const n = new THREE.Vector3().subVectors(VAB.camera.position, new THREE.Vector3(0, VAB.camera.position.y, 0)).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.lengthSq() > 0 ? n : new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, D.hitY, 0));
  const p = VAB.ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!p) return;
  const minY = 0.3 - (VAB.minY || 0), maxY = 120 - (VAB.maxY || 0);
  VAB.rocketY = clamp(D.y0 + (p.y - D.hitY), minY, Math.max(minY, maxY));
  VAB.root.position.y = VAB.rocketY;
  VAB.design.vabY = VAB.rocketY;
  VAB.camY = VAB.rocketY + ((VAB.maxY || 0) + (VAB.minY || 0)) / 2;
}
function vabDragEnd() { VAB.drag = null; }

function vabCycleSym() { const s = [1, 2, 3, 4, 6, 8]; VAB.sym = s[(s.indexOf(VAB.sym) + 1) % s.length]; ui.vabRefresh(); }

// move a stage item (template uid) to stage index `to` in firing order; `newStage` inserts a new stage at `to`
function vabMoveStageItem(uid, to, newStage) {
  const d = VAB.design;
  const si = d.stages.findIndex(s => s.includes(uid));
  if (si < 0) return;
  vabPush();
  d.stages = moveStageItem(d.stages, si, [uid], to, newStage);
  d.customStages = true;
  vabRebuild();
}
// shared by the VAB and flight staging: returns new stages array (firing order)
function moveStageItem(stages, from, items, to, newStage) {
  const st = stages.map(s => s.slice());
  st[from] = st[from].filter(x => !items.includes(x));
  if (newStage) st.splice(to, 0, items.slice());
  else st[clamp(to, 0, st.length - 1)].push(...items);
  return st.filter(s => s.length);
}
function vabAutoStage() { vabPush(); VAB.design.customStages = false; vabRebuild(); }

function vabStats() {
  const d = VAB.design;
  if (!d.stack.length) return null;
  const v = buildVessel(d);
  const b = BODY[VAB.statBody];
  const pAtm = b.atm ? b.atm.p0 / 101.325 : 0;
  const vac = simulateStages(v, 0, b.g0), sl = simulateStages(v, pAtm, b.g0);
  const L = VAB.layout;
  const { minY, maxY } = vabBounds(L);
  return {
    mass: designMass(d), dry: L.reduce((s, it) => s + it.def.mass, 0), cost: designCost(d), parts: L.length, height: maxY - minY,
    stages: vac.map((s, i) => ({ idx: i, n: v.stages.length - 1 - i, dvVac: s.dv, dvSL: sl[i].dv, twr: sl[i].twr, time: s.time })),
    command: designHasCommand(d), vessel: v,
  };
}
