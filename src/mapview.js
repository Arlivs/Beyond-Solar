'use strict';
// Map view: orbit lines for bodies, vessel patched-conic trajectory, HTML markers.

const MAP = {
  on: false, bodyLines: {}, patchLines: [], labels: new Map(), layer: null,
  focus: { kind: 'vessel', id: null }, yaw: 0.6, pitch: 0.7, dist: 3e6,
  samples: [], hoverPt: null,
};
const PATCH_COLORS = [0x5ae2ff, 0xffb13a, 0xe07bff, 0x8dff7b, 0xff7b98, 0xfff27b, 0x7bffe2, 0xffffff];

function initMap(layer) {
  MAP.layer = layer;
  for (const b of BODIES) {
    if (!b.parent) continue;
    const pts = [];
    for (let i = 0; i <= 360; i++) pts.push(toT(elPosAtNu(b.el, i / 360 * TAU)));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const col = new THREE.Color(b.vis.c[0]).lerp(new THREE.Color(0xffffff), 0.25);
    const m = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false; line.visible = false; line.renderOrder = 6;
    RV.scene.add(line);
    MAP.bodyLines[b.id] = line;
  }
  // orbit of a target vessel
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 361), 3));
    MAP.tgtLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff5bd2, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
    MAP.tgtLine.frustumCulled = false; MAP.tgtLine.visible = false; MAP.tgtLine.renderOrder = 6;
    RV.scene.add(MAP.tgtLine);
  }
  // predicted descent path through the atmosphere
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2100), 3));
    MAP.impLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff7a45, depthWrite: false, toneMapped: false }));
    MAP.impLine.frustumCulled = false; MAP.impLine.visible = false; MAP.impLine.renderOrder = 6;
    RV.scene.add(MAP.impLine);
  }
  for (let i = 0; i < 10; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 401), 3));
    const m = new THREE.LineBasicMaterial({ color: PATCH_COLORS[i % PATCH_COLORS.length], depthWrite: false, toneMapped: false });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false; line.visible = false; line.renderOrder = 6;
    RV.scene.add(line);
    MAP.patchLines.push(line);
  }
}

function mapSetVisible(on) {
  MAP.on = on;
  for (const id in MAP.bodyLines) MAP.bodyLines[id].visible = on;
  if (!on) { for (const l of MAP.patchLines) l.visible = false; MAP.tgtLine.visible = false; MAP.impLine.visible = false; MAP.layer.innerHTML = ''; MAP.labels.clear(); }
}

// focus world position
function mapFocusAbs(t, vessel) {
  if (MAP.focus.kind === 'body') return bodyAbsPos(BODY[MAP.focus.id], t);
  if (vessel) return V.add(bodyAbsPos(vessel.body, t), vessel.r);
  return [0, 0, 0];
}
function mapFocusBody(vessel) { return MAP.focus.kind === 'body' ? BODY[MAP.focus.id] : vessel ? vessel.body : BODY.earth; }

function mapCameraAbs(t, vessel) {
  const f = mapFocusAbs(t, vessel);
  const cp = Math.cos(MAP.pitch), sp = Math.sin(MAP.pitch);
  const off = [Math.cos(MAP.yaw) * cp * MAP.dist, Math.sin(MAP.yaw) * cp * MAP.dist, sp * MAP.dist];
  return { abs: V.add(f, off), look: V.neg(off) };
}
function mapCameraQuat(look) {
  const m = new THREE.Matrix4();
  const dir = toT(look).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(dir.dot(up)) > 0.999) up.set(0, 0, -1);
  m.lookAt(new THREE.Vector3(0, 0, 0), dir, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// screen projection of a camera-relative three vector
function projectT(vT) {
  const p = vT.clone().project(RV.camera);
  if (p.z > 1 || p.z < -1) return null;
  return [(p.x + 1) / 2 * RV.w, (1 - p.y) / 2 * RV.h];
}
function projectAbs(abs) { return projectT(relT(abs)); }

function mapLabel(key, html, xy, cls, onClick) {
  let el = MAP.labels.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'mlabel ' + (cls || '');
    MAP.layer.appendChild(el);
    MAP.labels.set(key, el);
    if (onClick) { el.style.pointerEvents = 'auto'; el.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); }); }
  }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  if (!xy) { el.style.display = 'none'; return el; }
  el.style.display = '';
  el.style.transform = `translate(${xy[0].toFixed(1)}px, ${xy[1].toFixed(1)}px)`;
  el._seen = MAP._frame;
  return el;
}

// traj: array of patches (predictTrajectory); nodes: vessel.nodes
function mapUpdate(t, vessel, traj, hooks) {
  MAP._frame = (MAP._frame || 0) + 1;
  // body orbit lines
  const focusB = mapFocusBody(vessel);
  for (const b of BODIES) {
    if (!b.parent) continue;
    const line = MAP.bodyLines[b.id];
    relT(bodyAbsPos(b.parent, t), line.position);
    // show moon orbits only near their parent
    const camD = V.dist(RV.camAbs, bodyAbsPos(b.parent, t));
    line.visible = b.parent.id === 'sun' || camD < b.parent.soi * 6 || b.parent === focusB || b === focusB;
  }
  // body markers
  for (const b of BODIES) {
    const abs = bodyAbsPos(b, t);
    const xy = projectAbs(abs);
    const camD = V.dist(RV.camAbs, abs);
    const show = b.parent == null || b.parent.id === 'sun' || camD < b.parent.soi * 4 || b.parent === focusB;
    mapLabel('b_' + b.id, `<i style="background:${b.vis.c[0]}"></i><span>${b.name}</span>`, show ? xy : null, 'body' + (hooks.target === b.id ? ' target' : ''),
      () => hooks.focusBody(b.id));
  }
  // vessel trajectory
  MAP.samples = [];
  let li = 0;
  if (traj) {
    for (let k = 0; k < traj.length && li < MAP.patchLines.length; k++) {
      const pt = traj[k];
      const line = MAP.patchLines[li++];
      const n = 400;
      const pts = samplePatchTimed(pt, n);
      const arr = line.geometry.attributes.position.array;
      for (let i = 0; i <= n; i++) { const p = pts[i].r; arr[i * 3] = p[0]; arr[i * 3 + 1] = p[2]; arr[i * 3 + 2] = -p[1]; }
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.setDrawRange(0, n + 1);
      const bodyAbs = bodyAbsPos(pt.body, t);
      relT(bodyAbs, line.position);
      line.material.color.setHex(pt.nodeIdx >= 0 ? 0xffa23a : PATCH_COLORS[(k === 0 ? 0 : 1 + (k % 6))]);
      line.visible = true;
      MAP.samples.push({ pt, pts, bodyAbs });
      // Ap / Pe markers
      const el = pt.el;
      const tPe = elTimeAtNu(el, 0, pt.t0);
      if (tPe != null && tPe <= pt.t1 + 1) {
        const p = elPosAtNu(el, 0);
        mapLabel('pe' + k, `Пе ${fmtDist(el.rp - pt.body.R)}<small>${fmtDur(tPe - t, true)}</small>`, projectAbs(V.add(bodyAbs, p)), 'apsis pe');
      } else mapLabel('pe' + k, '', null);
      if (el.e < 1) {
        const tAp = elTimeAtNu(el, Math.PI, pt.t0);
        if (tAp <= pt.t1 + 1) {
          const p = elPosAtNu(el, Math.PI);
          mapLabel('ap' + k, `Ап ${fmtDist(el.ra - pt.body.R)}<small>${fmtDur(tAp - t, true)}</small>`, projectAbs(V.add(bodyAbs, p)), 'apsis ap');
        } else mapLabel('ap' + k, '', null);
      } else mapLabel('ap' + k, '', null);
      // transitions
      if (pt.end === 'enter' || pt.end === 'exit') {
        const st = elState(el, pt.t1);
        const txt = pt.end === 'enter' ? `Вход: ${pt.next.name}` : `Выход из СВ: ${pt.body.name}`;
        mapLabel('tr' + k, `${txt}<small>${fmtDur(pt.t1 - t, true)}</small>`, projectAbs(V.add(bodyAbs, st.r)), 'soi');
      } else if ((pt.end === 'impact' || pt.end === 'atmo') && !hooks.impact) {   // the drag-aware prediction replaces it
        const st = elState(el, pt.t1);
        mapLabel('tr' + k, `${pt.end === 'impact' ? 'Падение' : 'Атмосфера'}<small>${fmtDur(pt.t1 - t, true)}</small>`, projectAbs(V.add(bodyAbs, st.r)), 'impact');
      } else mapLabel('tr' + k, '', null);
    }
  }
  for (; li < MAP.patchLines.length; li++) MAP.patchLines[li].visible = false;
  // nodes
  if (vessel && vessel.nodes) vessel.nodes.forEach((nd, i) => {
    const s = trajStateAt(traj, nd.t);
    const xy = s ? projectAbs(V.add(bodyAbsPos(s.body, t), s.r)) : null;
    const el = mapLabel('node' + i, `<b class="nodeicon"></b><span>Δv ${nd.dvTotal != null ? nd.dvTotal.toFixed(1) : V.len(nd.dv).toFixed(1)} м/с</span>`, xy, 'node' + (hooks.selNode === i ? ' sel' : ''), () => hooks.selectNode(i));
    void el;
  });
  // other vessels: click to make one the target; the target's orbit is drawn in magenta
  MAP.tgtLine.visible = false;
  for (const o of hooks.vessels || []) {
    if (o === vessel || o.destroyed || o.debris) continue;
    const isT = hooks.target === 'v:' + o.id;
    mapLabel('ov_' + o.id, `<b class="vicon"></b><span>${esc(o.name)}</span>`, projectAbs(V.add(bodyAbsPos(o.body, t), o.r)), 'vessel other' + (isT ? ' target' : ''),
      () => hooks.setTarget && hooks.setTarget('v:' + o.id));
    if (isT && !o.landed && !o.lock) {
      const el = elFromState(o.r, o.v, o.body.mu, t), arr = MAP.tgtLine.geometry.attributes.position.array;
      const lim = el.e < 1 ? Math.PI : Math.min(el.nuInf * 0.98, elNuAtRadius(el, o.body.soi) || el.nuInf * 0.98);
      for (let i = 0; i <= 360; i++) { const p = elPosAtNu(el, -lim + 2 * lim * i / 360); arr[i * 3] = p[0]; arr[i * 3 + 1] = p[2]; arr[i * 3 + 2] = -p[1]; }
      MAP.tgtLine.geometry.attributes.position.needsUpdate = true;
      relT(bodyAbsPos(o.body, t), MAP.tgtLine.position);
      MAP.tgtLine.visible = true;
    }
  }
  // landing prediction
  const imp = hooks.impact;
  MAP.impLine.visible = !!imp;
  if (imp) {
    const b = imp.body, arr = MAP.impLine.geometry.attributes.position.array, n = Math.min(imp.pts.length, 2100);
    for (let i = 0; i < n; i++) { const q = bodyFixedToInertial(b, t, imp.pts[Math.floor(i * imp.pts.length / n)]); arr[i * 3] = q[0]; arr[i * 3 + 1] = q[2]; arr[i * 3 + 2] = -q[1]; }
    MAP.impLine.geometry.attributes.position.needsUpdate = true; MAP.impLine.geometry.setDrawRange(0, n);
    relT(bodyAbsPos(b, t), MAP.impLine.position);
    mapLabel('impact', `✕ Посадка<small>через ${fmtDur(imp.t - t, true)} · ${imp.speed.toFixed(0)} м/с</small>`, projectAbs(V.add(bodyAbsPos(b, t), bodyFixedToInertial(b, t, imp.pF))), 'impact');
  } else mapLabel('impact', '', null);
  // vessel marker
  if (vessel) mapLabel('vessel', `<b class="vicon"></b><span>${vessel.name}</span>`, projectAbs(V.add(bodyAbsPos(vessel.body, t), vessel.r)), 'vessel', () => hooks.focusVessel());
  // target closest approach
  // closest approach (hidden when it is happening right now next to the target marker)
  if (hooks.closest && hooks.closest.t - t > 1 && !(vessel && hooks.closest.d < 2000 && V.dist(hooks.closest.rv, vessel.r) < 2000)) {
    const c = hooks.closest;
    mapLabel('ca1', `Сближение<small>${fmtDist(c.d)}</small>`, projectAbs(V.add(bodyAbsPos(c.patch.body, t), c.rv)), 'closest');
    mapLabel('ca2', `${esc(c.name)}<small>через ${fmtDur(c.t - t, true)}${c.relV != null ? ' · ' + fmtSpeed(c.relV) : ''}</small>`, projectAbs(V.add(bodyAbsPos(c.patch.body, t), c.rt)), 'closest');
  } else { mapLabel('ca1', '', null); mapLabel('ca2', '', null); }
  // drop stale labels
  for (const [k, el] of MAP.labels) if (el._seen !== MAP._frame) el.style.display = 'none';
}

// sample patch at n+1 points with times (true-anomaly spacing)
function samplePatchTimed(pt, n) {
  const el = pt.el, out = [];
  let nu0 = elNuAt(el, pt.t0), nu1;
  const full = el.e < 1 && (pt.t1 - pt.t0 >= el.T * 0.999);
  if (full) nu1 = nu0 + TAU;
  else { nu1 = elNuAt(el, pt.t1); if (el.e < 1) while (nu1 <= nu0) nu1 += TAU; }
  let tPrev = pt.t0;
  for (let i = 0; i <= n; i++) {
    const nu = nu0 + (nu1 - nu0) * i / n;
    let tt = i === 0 ? pt.t0 : elTimeAtNu(el, nu, tPrev - 1e-6);
    if (tt == null) tt = tPrev;
    if (el.e < 1 && tt - tPrev > el.T * 0.9) tt -= el.T;
    tPrev = Math.max(tPrev, tt);
    out.push({ r: elPosAtNu(el, nu), t: tt });
  }
  return out;
}

function trajStateAt(traj, t) {
  if (!traj) return null;
  for (const pt of traj) if (t >= pt.t0 - 1e-6 && t <= pt.t1 + 1e-6) { const s = elState(pt.el, t); return { body: pt.body, r: s.r, v: s.v, patch: pt }; }
  return null;
}

// nearest trajectory sample to a screen point (px)
function mapPick(x, y, maxPx) {
  let best = null, bd = maxPx * maxPx;
  for (const s of MAP.samples) {
    for (let i = 0; i < s.pts.length; i++) {
      const xy = projectAbs(V.add(s.bodyAbs, s.pts[i].r));
      if (!xy) continue;
      const d = (xy[0] - x) ** 2 + (xy[1] - y) ** 2;
      if (d < bd) { bd = d; best = { t: s.pts[i].t, patch: s.pt }; }
    }
  }
  return best;
}

// closest approach between trajectory patches and a target body
function closestApproach(traj, targetId) {
  const T = BODY[targetId];
  if (!traj || !T) return null;
  let best = null;
  for (const pt of traj) {
    if (pt.body === T) return null; // already an encounter
    if (T.parent !== pt.body) continue;
    const n = 600;
    const span = Math.min(pt.t1 - pt.t0, isFinite(pt.el.T) ? pt.el.T * 1.0 : pt.t1 - pt.t0);
    for (let i = 0; i <= n; i++) {
      const tt = pt.t0 + span * i / n;
      const rv = elState(pt.el, tt).r, rt = bodyRelState(T, tt).r;
      const d = V.dist(rv, rt);
      if (!best || d < best.d) best = { d, t: tt, rv, rt, patch: pt, target: targetId, name: T.name };
    }
  }
  return best;
}

// closest approach to a vessel on its current (coasting) orbit: coarse scan + golden-section refine
function closestApproachVessel(traj, T, t) {
  if (!traj || !T || T.landed || T.lock) return null;
  const elT = elFromState(T.r, T.v, T.body.mu, t);
  let best = null;
  for (const pt of traj) {
    if (pt.body !== T.body) continue;
    const per = Math.max(isFinite(pt.el.T) ? pt.el.T : 0, isFinite(elT.T) ? elT.T : 0) || pt.t1 - pt.t0;
    const span = Math.min(pt.t1 - pt.t0, per * 1.5), n = 720;
    const f = (tt) => V.dist(elState(pt.el, tt).r, elState(elT, tt).r);
    let bi = 0, bd = Infinity;
    for (let i = 0; i <= n; i++) { const d = f(pt.t0 + span * i / n); if (d < bd) { bd = d; bi = i; } }
    let lo = pt.t0 + span * Math.max(0, bi - 1) / n, hi = pt.t0 + span * Math.min(n, bi + 1) / n;
    for (let k = 0; k < 40; k++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (f(m1) < f(m2)) hi = m2; else lo = m1; }
    const tb = (lo + hi) / 2, sa = elState(pt.el, tb), sb = elState(elT, tb), d = V.dist(sa.r, sb.r);
    if (!best || d < best.d) best = { d, t: tb, rv: sa.r, rt: sb.r, patch: pt, name: T.name, relV: V.dist(sa.v, sb.v) };
  }
  return best;
}
