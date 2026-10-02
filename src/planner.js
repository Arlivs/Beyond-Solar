'use strict';
// Planning tools: Lambert solver and porkchop plots, automatic transfer manoeuvres with a numerical
// refinement pass, and a landing-point prediction that integrates drag through the atmosphere.

// ---- Lambert (universal variables, single revolution, Bate-Mueller-White / Curtis) ----
function stumpC(z) { if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z; if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z; return 0.5 - z / 24 + z * z / 720; }
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + z * z / 5040;
}
// velocities at r1 (t0) and r2 (t0 + tof) on the prograde (counter-clockwise about +Z) transfer arc
function lambert(r1, r2, tof, mu) {
  const R1 = V.len(r1), R2 = V.len(r2);
  let dnu = Math.acos(clamp(V.dot(r1, r2) / (R1 * R2), -1, 1));
  if (V.cross(r1, r2)[2] < 0) dnu = TAU - dnu;
  const A = Math.sin(dnu) * Math.sqrt(R1 * R2 / (1 - Math.cos(dnu)));
  if (!(Math.abs(A) > 1e-9) || !(tof > 0)) return null;
  const y = (z) => R1 + R2 + A * (z * stumpS(z) - 1) / Math.sqrt(stumpC(z));
  const F = (z) => { const yz = y(z); return Math.pow(yz / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yz) - Math.sqrt(mu) * tof; };
  // time of flight grows with z; bracket on the part where y(z) >= 0, below the first full revolution (4 pi^2)
  let lo = -40, hi = 4 * Math.PI * Math.PI - 1e-7;
  if (A > 0) { let a = -40, b = hi; for (let i = 0; i < 80; i++) { const m = 0.5 * (a + b); if (y(m) < 0) a = m; else b = m; } lo = b; }
  if (F(lo) > 0 || F(hi) < 0) return null;
  for (let i = 0; i < 70; i++) { const m = 0.5 * (lo + hi); if (F(m) > 0) hi = m; else lo = m; }
  const z = 0.5 * (lo + hi), yz = y(z);
  const f = 1 - yz / R1, g = A * Math.sqrt(yz / mu), gd = 1 - yz / R2;
  return { v1: V.scale(V.sub(r2, V.scale(r1, f)), 1 / g), v2: V.scale(V.sub(V.scale(r2, gd), r1), 1 / g) };
}

// low parking orbit radius of a body (just above the atmosphere or 5% of the radius)
function parkRadius(b) { return b.R + (b.atm ? b.atm.top + 20000 : Math.max(8000, b.R * 0.05)); }
// burn from a circular orbit of radius r to leave / arrive with hyperbolic excess speed vinf
function hyperbolicDv(b, vinf, r) { return Math.sqrt(vinf * vinf + 2 * b.mu / r) - Math.sqrt(b.mu / r); }
function hohmannTime(mu, r1, r2) { return Math.PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu); }
function synodic(a, b) { return 1 / Math.abs(1 / a.el.T - 1 / b.el.T); }

// porkchop grid between two siblings (same parent). Calls back when done; computed in slices to keep the UI alive.
function porkchop(from, to, tStart, opts, onDone, onProgress) {
  const mu = from.parent.mu;
  const th = hohmannTime(mu, from.el.a, to.el.a);
  const span = opts.span || Math.min(synodic(from, to) * 1.25, from.el.T * 3);
  const nx = opts.nx || 110, ny = opts.ny || 80;
  const tof0 = th * 0.45, tof1 = th * 1.65;
  const rp = parkRadius(from), ra = parkRadius(to);
  const G = { from, to, t0: tStart, span, tof0, tof1, nx, ny, dv: new Float64Array(nx * ny), dep: new Float64Array(nx * ny), arr: new Float64Array(nx * ny), best: null, capture: opts.capture !== false };
  let j = 0;
  const slice = () => {
    const tEnd = performance.now() + 12;
    for (; j < ny && performance.now() < tEnd; j++) {
      const tof = tof0 + (tof1 - tof0) * j / (ny - 1);
      for (let i = 0; i < nx; i++) {
        const td = tStart + span * i / (nx - 1);
        const s1 = bodyRelState(from, td), s2 = bodyRelState(to, td + tof);
        const L = lambert(s1.r, s2.r, tof, mu);
        const k = j * nx + i;
        if (!L) { G.dv[k] = NaN; continue; }
        const d1 = hyperbolicDv(from, V.dist(L.v1, s1.v), rp), d2 = hyperbolicDv(to, V.dist(L.v2, s2.v), ra);
        G.dep[k] = d1; G.arr[k] = d2; G.dv[k] = d1 + (G.capture ? d2 : 0);
        if (!G.best || G.dv[k] < G.best.dv) G.best = { i, j, td, tof, dv: G.dv[k], dep: d1, arr: d2 };
      }
    }
    if (onProgress) onProgress(j / ny);
    if (j < ny) setTimeout(slice, 0); else onDone(G);
  };
  slice();
  return G;
}
// details of a porkchop cell: dates, speeds and the departure geometry
function transferAt(G, td, tof) {
  const mu = G.from.parent.mu, s1 = bodyRelState(G.from, td), s2 = bodyRelState(G.to, td + tof);
  const L = lambert(s1.r, s2.r, tof, mu); if (!L) return null;
  const vinf = V.sub(L.v1, s1.v);
  const ang = (a) => Math.atan2(a[1], a[0]);
  return {
    td, tof, vinf, vinfArr: V.dist(L.v2, s2.v),
    dep: hyperbolicDv(G.from, V.len(vinf), parkRadius(G.from)), arr: hyperbolicDv(G.to, V.dist(L.v2, s2.v), parkRadius(G.to)),
    phase: wrapPi(ang(bodyRelState(G.to, td).r) - ang(s1.r)) / DEG,
    eject: wrapPi(ang(vinf) - ang(s1.v)) / DEG,
  };
}

// ---- automatic manoeuvres ----
// nearest future time the vessel passes a given direction (projected into its orbit plane)
function timeAtDirection(el, dir, tAfter) {
  const nu = Math.atan2(V.dot(dir, el.Q), V.dot(dir, el.P));
  return elTimeAtNu(el, nu, tAfter);
}
// escape burn from the current (near circular) orbit leaving with hyperbolic excess vinf (world vector) around time tDep
function ejectionNode(v, vinf, tDep, t) {
  const b = v.body, el = elFromState(v.r, v.v, b.mu, t);
  if (el.e >= 1) return null;
  const h = el.W, u = V.norm(V.reject(vinf, h)), vi = V.len(vinf);
  const r = el.a, e = 1 + r * vi * vi / b.mu, nuInf = Math.acos(-1 / e);
  // periapsis of the escape hyperbola sits nuInf behind the outgoing asymptote
  const pDir = V.add(V.scale(u, Math.cos(-nuInf)), V.scale(V.cross(h, u), Math.sin(-nuInf)));
  const t0 = Math.max(t + 60, tDep - el.T / 2);
  const tb = timeAtDirection(el, pDir, t0);
  const st = elState(el, tb);
  const need = Math.sqrt(vi * vi + 2 * b.mu / V.len(st.r));
  const vh = V.dot(vinf, h) / vi;                                 // out-of-plane share of the escape
  return { t: tb, dv: [need * Math.sqrt(Math.max(0, 1 - vh * vh)) - V.len(st.v), need * vh, 0] };
}
// Hohmann-style transfer to something orbiting the same body as the vessel (a moon, or another vessel)
function hohmannNode(v, tgt, t) {
  const b = v.body, el = elFromState(v.r, v.v, b.mu, t);
  if (el.e >= 1) return null;
  const elT = tgt.vessel ? elFromState(tgt.vessel.r, tgt.vessel.v, b.mu, t) : tgt.body.el;
  const tr = (tt) => elState(elT, tt);
  const r1 = el.a, r2 = V.len(tr(t).r);
  const th = hohmannTime(b.mu, r1, r2);
  const ang = (x) => Math.atan2(V.dot(x, el.Q), V.dot(x, el.P));
  // scan one synodic window for the burn time where the target arrives at the transfer apoapsis
  let best = null;
  const tEnd = t + Math.min(Math.abs(1 / (1 / el.T - 1 / elT.T)) * 1.05, el.T * 400);
  const step = el.T / 90;
  for (let tb = t + 60; tb < tEnd; tb += step) {
    const pv = elState(el, tb).r;
    const err = Math.abs(wrapPi(ang(tr(tb + th).r) - (ang(pv) + Math.PI)));
    if (!best || err < best.err) best = { tb, err };
  }
  if (!best) return null;
  const rb = V.len(elState(el, best.tb).r);
  return { t: best.tb, dv: [Math.sqrt(b.mu / rb) * (Math.sqrt(2 * r2 / (rb + r2)) - 1), 0, 0] };
}

// target description: { body } or { vessel }; returns a closeness score for the trajectory (lower is better)
function transferScore(v, nodes, tgt, wantPe, t) {
  const traj = predictTrajectory(v.body, v.r, v.v, t, { nodes, maxPatches: 6 });
  if (tgt.body) {
    const enc = traj.find(p => p.body === tgt.body);
    if (enc) return { score: Math.abs(enc.el.rp - (tgt.body.R + wantPe)) / 1000, enc: true, pe: enc.el.rp - tgt.body.R, traj };
    const c = closestApproach(traj, tgt.body.id);
    return { score: c ? 1e5 + c.d / 1000 : 1e9, enc: false, d: c && c.d, traj };
  }
  const c = closestApproachVessel(traj, tgt.vessel, t);
  return { score: c ? c.d : 1e9, d: c && c.d, c, traj };
}
// pattern search over (prograde, normal, radial, time) of the last node, in slices; at most `budget` predictions
function refineNode(v, tgt, wantPe, t, onDone, budget) {
  const nd = v.nodes[v.nodes.length - 1];
  let dvStep = Math.max(2, V.len(nd.dv) * 0.02), tStep = 30, evals = 0;
  budget = budget || 300;
  let best = transferScore(v, v.nodes, tgt, wantPe, t);
  const tryMove = (apply, undo) => {
    apply(); nd.vTarget = null; evals++;
    const s = transferScore(v, v.nodes, tgt, wantPe, t);
    if (s.score < best.score - 1e-9) { best = s; return true; }
    undo(); return false;
  };
  const loop = () => {
    const tEnd = performance.now() + 25;
    while (performance.now() < tEnd) {
      let moved = false;
      for (const k of [0, 1, 2]) for (const sgn of [1, -1]) if (!moved) moved = tryMove(() => { nd.dv[k] += sgn * dvStep; }, () => { nd.dv[k] -= sgn * dvStep; });
      for (const sgn of [1, -1]) if (!moved && nd.t + sgn * tStep > t + 30) moved = tryMove(() => { nd.t += sgn * tStep; }, () => { nd.t -= sgn * tStep; });
      if (!moved) { dvStep *= 0.5; tStep *= 0.5; }
      if (evals >= budget || (dvStep < 0.005 && tStep < 0.05)) { nd.vTarget = null; nd.dvTotal = null; onDone(best, evals); return; }
    }
    setTimeout(loop, 0);
  };
  loop();
}
// node at the closest approach that cancels the relative velocity
function matchVelocityNode(v, tv, t) {
  const traj = predictTrajectory(v.body, v.r, v.v, t, { nodes: v.nodes || [], maxPatches: 4 });
  const c = closestApproachVessel(traj, tv, t);
  if (!c || c.t < t + 10) return null;
  const s = elState(c.patch.el, c.t), st = elState(elFromState(tv.r, tv.v, tv.body.mu, t), c.t);
  return { t: c.t, dv: dvWorldToLocal(s.r, s.v, V.sub(st.v, s.v)) };
}

// ---- landing prediction (Trajectories-mod style) ----
// integrates gravity + drag (current attitude, armed parachutes) in the rotating atmosphere until the ground
function predictImpact(v, t) {
  const b = v.body; if (b.gas || v.landed || v.lock) return null;
  const mp = massProps(v), m = mp.m, geo = v.geo || vesselGeometry(v);
  const om = bodyOmega(b);
  const fwdW = Q.rot(v.q, [0, 1, 0]);
  const air0 = V.sub(v.v, V.cross(om, v.r));
  const noseFirst = V.dot(fwdW, air0) >= 0;
  const cdaBody = (noseFirst ? geo.frontSum : geo.backSum) + 0.15 * (noseFirst ? geo.backSum : geo.frontSum);
  const chutes = v.parts.filter(p => !p.dead && p.st.chute && p.st.chute !== 'stowed' && p.st.chute !== 'cut').map(p => ({ c: PART[p.id].chute, st: p.st.chute }));
  let r = v.r.slice(), vel = v.v.slice(), tt = t;
  const pts = [];
  const acc = (rr, vv, chuteCda) => {
    const R = V.len(rr), a = V.scale(rr, -b.mu / (R * R * R));
    const at = atmAt(b, R - b.R);
    if (at.rho > 0) { const u = V.sub(vv, V.cross(om, rr)), sp = V.len(u); return V.addS(a, u, -0.5 * at.rho * sp * (cdaBody + chuteCda) / m); }
    return a;
  };
  for (let i = 0; i < 8000; i++) {
    const R = V.len(r), alt = R - b.R, at = atmAt(b, alt);
    // parachutes open on the same rules as in flight
    let cc = 0;
    const sp = V.len(V.sub(vel, V.cross(om, r)));
    const agl = alt < b.hMax + 2000 ? alt - groundHeight(b, V.norm(inertialToBodyFixed(b, tt, r)), 30) : alt;   // main canopy opens by radar altitude
    for (const ch of chutes) {
      if (ch.st === 'armed' && at.p > ch.c.minP && sp < ch.c.safe) ch.st = 'semi';
      if (ch.st === 'semi' && agl < ch.c.deployAlt) ch.st = 'full';
      cc += ch.st === 'full' ? ch.c.full : ch.st === 'semi' ? ch.c.semi : 0;
    }
    let dt = at.rho > 0 ? (alt < 3000 ? 0.25 : 1) : clamp((alt - b.hMax) / Math.max(1, V.len(vel)) * 0.03, 0.5, 20);
    if (at.rho > 0) dt = Math.max(0.02, Math.min(dt, 0.25 * m / (0.5 * at.rho * (cdaBody + cc) * Math.max(sp, 1))));   // stiff under a canopy
    const a1 = acc(r, vel, cc), vm = V.addS(vel, a1, dt / 2), rm = V.addS(r, vel, dt / 2);
    const a2 = acc(rm, vm, cc);
    r = V.addS(r, vm, dt); vel = V.addS(vel, a2, dt); tt += dt;
    if (i % 4 === 0) pts.push(inertialToBodyFixed(b, tt, r));
    if (V.len(r) - b.R < b.hMax + 50) {
      const dF = V.norm(inertialToBodyFixed(b, tt, r)), gh = groundHeight(b, dF, 30);
      if (V.len(r) - b.R <= gh) {
        const pF = V.scale(dF, b.R + gh);
        pts.push(pF);
        const ll = { lat: Math.asin(dF[2]), lon: Math.atan2(dF[1], dF[0]) };
        return { t: tt, pF, pts, lat: ll.lat, lon: ll.lon, speed: V.len(V.sub(vel, V.cross(om, r))), body: b };
      }
    }
    if (tt - t > 6 * 3600 || V.len(r) > b.soi) return null;
  }
  return null;
}
