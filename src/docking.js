'use strict';
// Docking ports: magnetic capture between two vessels, merging them into one rigid body, undocking.
// A port is a stack part on the vessel's ±Y axis; its free end (p.portDir) is the docking face.

const DOCK = { capture: 0.3, magnet: 1.6, align: Math.cos(12 * DEG), alignMag: Math.cos(35 * DEG), vmax: 1.2 };

// face centre and outward normal of a port in vessel axes
function portLocal(p) {
  const d = PART[p.id];
  const ax = V.scale(partAxis(p), p.portDir || 1);
  return { face: V.add(p.pos, V.scale(ax, d.h / 2)), ax };
}
// world (SOI-relative) pose and velocity of a port face
function portWorld(v, p) {
  const mp = massProps(v), L = portLocal(p);
  const arm = Q.rot(v.q, V.sub(L.face, mp.com));
  return { pos: V.add(v.r, arm), ax: Q.rot(v.q, L.ax), vel: V.add(v.v, V.cross(Q.rot(v.q, v.w), arm)), local: L };
}
function isFreePort(p) { return !p.dead && PART[p.id].dock && p.portDir && !p.st.dock; }
function freePorts(v) { return v.parts.filter(isFreePort); }
function dockedPorts(v) { return v.parts.filter(p => !p.dead && PART[p.id].dock && p.st.dock); }
function portsMatch(a, b) { return PART[a.id].dock.size === PART[b.id].dock.size; }

// apply an impulse J (world, N*s) at world arm r from the CoM
function applyImpulse(v, J, armW) {
  const mp = massProps(v);
  v.v = V.addS(v.v, J, 1 / mp.m);
  const L = Q.invRot(v.q, V.cross(armW, J));
  v.w = [v.w[0] + L[0] / mp.I[0], v.w[1] + L[1] / mp.I[1], v.w[2] + L[2] / mp.I[2]];
}

// one physics step for all loaded vessels: port magnets and capture. Returns [{keep, gone}] merges.
function dockingStep(vessels, dt, prefer) {
  const out = [];
  const list = vessels.filter(v => v.loaded && !v.destroyed && !v.lock && !v.landed && freePorts(v).length);
  // a port that just undocked stays disarmed until no other vessel's port is within reach (as in KSP)
  for (const v of list) for (const p of freePorts(v)) {
    if (!p.st.dockOff) continue;
    const P = portWorld(v, p).pos;
    if (!list.some(o => o !== v && o.body === v.body && freePorts(o).some(q => V.dist(portWorld(o, q).pos, P) < DOCK.magnet + 0.5))) delete p.st.dockOff;
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.destroyed || b.destroyed || a.body !== b.body) continue;
    const reach = (a._bnd ? a._bnd.size : 20) + (b._bnd ? b._bnd.size : 20) + DOCK.magnet;
    if (V.dist(a.r, b.r) > reach) continue;
    let done = false;
    for (const pa of freePorts(a)) {
      if (done) break;
      if (pa.st.dockOff) continue;
      for (const pb of freePorts(b)) {
        if (!portsMatch(pa, pb) || pb.st.dockOff) continue;
        const A = portWorld(a, pa), B = portWorld(b, pb);
        const sep = V.sub(B.pos, A.pos), d = V.len(sep);
        if (d > DOCK.magnet) continue;
        const c = -V.dot(A.ax, B.ax);
        if (c < DOCK.alignMag) continue;
        const relV = V.sub(B.vel, A.vel);
        if (d < DOCK.capture && c > DOCK.align && V.len(relV) < DOCK.vmax) {
          const keepA = prefer ? prefer === a || prefer !== b : massProps(a).m >= massProps(b).m;
          out.push(keepA ? dockMerge(a, b, pa, pb) : dockMerge(b, a, pb, pa));
          done = true; break;
        }
        // magnet: pull the faces together, damp the closing speed and turn the axes towards each other
        const size = PART[pa.id].dock.size, k = (size ? 420 : 160) * (1 - d / DOCK.magnet);
        const n = d > 1e-6 ? V.scale(sep, 1 / d) : A.ax;
        const J = V.scale(V.add(V.scale(n, k), V.scale(relV, k * 0.6)), dt);
        applyImpulse(a, J, V.sub(A.pos, a.r));
        applyImpulse(b, V.neg(J), V.sub(B.pos, b.r));
        const e = V.cross(A.ax, V.neg(B.ax));                 // rotate a's axis onto -b's axis
        const tq = V.scale(e, (size ? 260 : 90) * dt);
        const ta = Q.invRot(a.q, tq), tb = Q.invRot(b.q, V.neg(tq)), Ia = massProps(a).I, Ib = massProps(b).I;
        a.w = [a.w[0] + ta[0] / Ia[0], a.w[1] + ta[1] / Ia[1], a.w[2] + ta[2] / Ia[2]];
        b.w = [b.w[0] + tb[0] / Ib[0], b.w[1] + tb[1] / Ib[1], b.w[2] + tb[2] / Ib[2]];
      }
    }
  }
  return out;
}

// merge vessel B into A through ports pa (on A) and pb (on B). A keeps its frame, name and staging order.
function dockMerge(A, B, pa, pb) {
  const mpA = massProps(A), mpB = massProps(B);
  const mA = mpA.m, mB = mpB.m;
  // B-local -> A-local rotation, snapped so the faces are exactly opposed
  let qRel = Q.mul(Q.conj(A.q), B.q);
  const LA = portLocal(pa), LB = portLocal(pb);
  qRel = Q.norm(Q.mul(Q.fromTo(Q.rot(qRel, LB.ax), V.neg(LA.ax)), qRel));
  const off = V.sub(LA.face, Q.rot(qRel, LB.face));
  const base = A.parts.length, ebase = A.edges.length, tag = ':' + B.id.slice(-4);
  const added = B.parts.map((p, i) => Object.assign({}, p, {
    rid: base + i, uid: p.uid + tag, pos: V.add(off, Q.rot(qRel, p.pos)), q: Q.norm(Q.mul(qRel, partQ(p))),
    origName: p.origName || B.name, st: JSON.parse(JSON.stringify(p.st)), res: Object.assign({}, p.res), data: p.data.slice(),
    pEdge: p.pEdge != null ? p.pEdge + ebase : null,
  }));
  // world origin of A's part frame stays put; the merged CoM moves
  const O = V.sub(A.r, Q.rot(A.q, mpA.com));
  const vNew = V.scale(V.add(V.scale(A.v, mA), V.scale(B.v, mB)), 1 / (mA + mB));
  A.parts = A.parts.concat(added);
  A.edges = A.edges.concat(B.edges.map(e => ({ a: e.a + base, b: e.b + base, cut: e.cut })), [{ a: pa.rid, b: pb.rid + base, cut: false, dock: true }]);
  A.stages = A.stages.concat(B.stages.slice(B.stageIdx).map(s => s.map(r => r + base)));
  pa.st.dock = { partner: pb.rid + base };
  A.parts[pb.rid + base].st.dock = { partner: pa.rid };
  for (const id in (B.flags && B.flags.bodies) || {}) { A.flags.bodies[id] = Object.assign(A.flags.bodies[id] || {}, B.flags.bodies[id]); }
  A.maxAlt = Math.max(A.maxAlt || 0, B.maxAlt || 0);
  A._all = null; A._bnd = null; A.geo = null; A._mp = null;
  vesselTopology(A);
  const mp = massProps(A);
  A.r = V.add(O, Q.rot(A.q, mp.com));
  A.v = vNew;
  A._comPrev = mp.com.slice();
  A.dockedAt = A._ut;
  B.destroyed = true; B.merged = A.id;
  for (const p of B.parts) p.dead = true;
  return { keep: A, gone: B };
}

// undock the joint at port rid. Returns the vessels split off (normally one).
function undock(v, rid, hooks) {
  const p = v.parts[rid];
  if (!p || !p.st.dock) return [];
  const prid = p.st.dock.partner, q = v.parts[prid];
  const ei = v.edges.findIndex(e => e.dock && !e.cut && ((e.a === rid && e.b === prid) || (e.a === prid && e.b === rid)));
  if (ei < 0) return [];
  v.edges[ei].cut = true;
  delete p.st.dock; if (q) delete q.st.dock;
  p.st.dockOff = true; if (q) q.st.dockOff = true;
  const out = [];
  const L = { event: (t, d) => { if (t === 'split') out.push(d.child); hooks && hooks.event && hooks.event(t, d); } };
  const axW = Q.rot(v.q, portLocal(p).ax);
  topologyChanged(v, L);
  // gentle push apart along the port axis (springs in the collar)
  for (const nv of out) {
    const mN = massProps(nv).m, mM = massProps(v).m, push = 0.3;
    const side = V.dot(V.sub(nv.r, v.r), axW) >= 0 ? 1 : -1;
    nv.v = V.addS(nv.v, axW, side * push * mM / (mN + mM));
    v.v = V.addS(v.v, axW, -side * push * mN / (mN + mM));
  }
  return out;
}
