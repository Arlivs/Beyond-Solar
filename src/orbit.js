'use strict';
// Two-body conics + patched-conic trajectory prediction.
// An "el" (elements) object fully describes a conic around a body with gravitational
// parameter mu, anchored at epoch t0. Works for ellipses and hyperbolas.

function solveKeplerE(M, e) {
  M = wrapPi(M);
  let lo = -Math.PI, hi = Math.PI;
  let E = e < 0.8 ? M : (M >= 0 ? Math.PI : -Math.PI);
  for (let i = 0; i < 80; i++) {
    const f = E - e * Math.sin(E) - M;
    if (Math.abs(f) < 1e-14) break;
    if (f > 0) hi = E; else lo = E;
    const d = f / (1 - e * Math.cos(E));
    let En = E - d;
    if (!(En > lo && En < hi)) En = 0.5 * (lo + hi);
    if (Math.abs(En - E) < 1e-15) { E = En; break; }
    E = En;
  }
  return E;
}

function solveKeplerH(M, e) {
  const X = Math.asinh(Math.abs(M) / (e - 1)) + 1e-9;
  let lo = -X, hi = X;
  let H = M === 0 ? 0 : Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8);
  if (!(H > lo && H < hi)) H = 0.5 * (lo + hi);
  for (let i = 0; i < 100; i++) {
    const f = e * Math.sinh(H) - H - M;
    if (Math.abs(f) < 1e-12 * Math.max(1, Math.abs(M))) break;
    if (f > 0) hi = H; else lo = H;
    let Hn = H - f / (e * Math.cosh(H) - 1);
    if (!(Hn > lo && Hn < hi)) Hn = 0.5 * (lo + hi);
    if (Math.abs(Hn - H) < 1e-15) { H = Hn; break; }
    H = Hn;
  }
  return H;
}

function _finishEl(mu, e, p, P, Q, W, nu, t) {
  const el = { mu, e, p, P, Q, W, t0: t };
  if (e < 1) {
    el.a = p / (1 - e * e);
    el.n = Math.sqrt(mu / (el.a * el.a * el.a));
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    el.M0 = E - e * Math.sin(E);
    el.T = TAU / el.n;
    el.ra = el.a * (1 + e);
  } else {
    el.a = p / (1 - e * e); // negative
    el.n = Math.sqrt(mu / (-el.a * -el.a * -el.a));
    const H = 2 * Math.atanh(clamp(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2), -0.999999999999, 0.999999999999));
    el.M0 = e * Math.sinh(H) - H;
    el.T = Infinity;
    el.ra = Infinity;
    el.nuInf = Math.acos(-1 / e);
  }
  el.rp = p / (1 + e);
  el.inc = Math.acos(clamp(W[2], -1, 1));
  const nodeV = [-W[1], W[0], 0];
  const nl = Math.hypot(nodeV[0], nodeV[1]);
  el.lan = nl > 1e-9 ? wrap2Pi(Math.atan2(nodeV[1], nodeV[0])) : 0;
  const nodeU = nl > 1e-9 ? [nodeV[0] / nl, nodeV[1] / nl, 0] : [1, 0, 0];
  el.argp = wrap2Pi(Math.atan2(V.dot(V.cross(nodeU, P), W), V.dot(nodeU, P)));
  return el;
}

// A massless frame (deep space, mu = 0): straight-line motion. Shaped like a hyperbola for callers that only look at
// e / ra / rp / T: never bound, periapsis = the closest approach to the frame's centre.
function linEl(r, v, t) {
  const v2 = V.len2(v), tc = v2 > 0 ? -V.dot(r, v) / v2 : 0, h = V.cross(r, v), hl = V.len(h);
  const W = hl > 1e-12 ? V.scale(h, 1 / hl) : [0, 0, 1];
  return { lin: true, mu: 0, r0: r.slice(), v0: v.slice(), t0: t, e: Infinity, a: -Infinity, T: Infinity, ra: Infinity,
    rp: tc > 0 ? V.len(V.addS(r, v, tc)) : V.len(r), inc: Math.acos(clamp(W[2], -1, 1)), W, P: V.norm(v2 > 0 ? v : r), Q: V.cross(W, V.norm(v2 > 0 ? v : r)) };
}

function elFromState(r, v, mu, t) {
  if (mu === 0) return linEl(r, v, t);
  let h = V.cross(r, v);
  let hm = V.len(h);
  const rm = V.len(r);
  if (hm < 1e-7 * rm * Math.max(1, V.len(v))) {
    // (near-)radial trajectory: nudge sideways by a negligible amount so the conic is defined
    v = V.addS(v, V.perp(r), 1e-3);
    h = V.cross(r, v); hm = V.len(h);
  }
  const W = V.scale(h, 1 / hm);
  const ev = V.sub(V.scale(V.cross(v, h), 1 / mu), V.scale(r, 1 / rm));
  let e = V.len(ev);
  const p = hm * hm / mu;
  let P;
  if (e > 1e-11) P = V.scale(ev, 1 / e);
  else {
    const nodeV = V.cross([0, 0, 1], W);
    P = V.len(nodeV) > 1e-9 ? V.norm(nodeV) : V.norm(V.reject([1, 0, 0], W));
    e = 0;
  }
  P = V.norm(V.reject(P, W));
  if (Math.abs(e - 1) < 1e-9) e = e >= 1 ? 1 + 1e-9 : 1 - 1e-9;
  const Qv = V.cross(W, P);
  const nu = Math.atan2(V.dot(r, Qv), V.dot(r, P));
  return _finishEl(mu, e, p, P, Qv, W, nu, t);
}

// Classical elements (angles in degrees) -> el. M0 = mean anomaly at t0.
function elFromKepler(a, e, iDeg, lanDeg, argpDeg, M0Deg, mu, t0) {
  const i = iDeg * DEG, O = lanDeg * DEG, w = argpDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Qv = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  const W = [sO * si, -cO * si, ci];
  const p = a * (1 - e * e);
  // convert M0 -> true anomaly for _finishEl
  const E = solveKeplerE(M0Deg * DEG, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return _finishEl(mu, e, p, P, Qv, W, nu, t0 || 0);
}

function elMeanAnomaly(el, t) { return el.M0 + el.n * (t - el.t0); }

// state {r, v} on the conic at time t
function elState(el, t) {
  if (el.lin) return { r: V.addS(el.r0, el.v0, t - el.t0), v: el.v0.slice() };
  const M = elMeanAnomaly(el, t), e = el.e;
  let x, y, vx, vy;
  if (e < 1) {
    const E = solveKeplerE(M, e), cE = Math.cos(E), sE = Math.sin(E), a = el.a, s = Math.sqrt(1 - e * e);
    const r = a * (1 - e * cE);
    x = a * (cE - e); y = a * s * sE;
    const f = Math.sqrt(el.mu * a) / r;
    vx = -f * sE; vy = f * s * cE;
  } else {
    const H = solveKeplerH(M, e), cH = Math.cosh(H), sH = Math.sinh(H), A = -el.a, s = Math.sqrt(e * e - 1);
    const r = A * (e * cH - 1);
    x = A * (e - cH); y = A * s * sH;
    const f = Math.sqrt(el.mu * A) / r;
    vx = -f * sH; vy = f * s * cH;
  }
  const P = el.P, Qv = el.Q;
  return {
    r: [x * P[0] + y * Qv[0], x * P[1] + y * Qv[1], x * P[2] + y * Qv[2]],
    v: [vx * P[0] + vy * Qv[0], vx * P[1] + vy * Qv[1], vx * P[2] + vy * Qv[2]],
  };
}

function elNuAt(el, t) {
  const M = elMeanAnomaly(el, t), e = el.e;
  if (e < 1) { const E = solveKeplerE(M, e); return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)); }
  const H = solveKeplerH(M, e);
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
}

function elPosAtNu(el, nu) {
  const r = el.p / (1 + el.e * Math.cos(nu)), c = Math.cos(nu) * r, s = Math.sin(nu) * r;
  return [c * el.P[0] + s * el.Q[0], c * el.P[1] + s * el.Q[1], c * el.P[2] + s * el.Q[2]];
}

// first time >= tAfter at which the orbiter passes true anomaly nu (null if never)
function elTimeAtNu(el, nu, tAfter) {
  if (el.lin) return null;
  const e = el.e;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = E - e * Math.sin(E);
    let dM = (M - elMeanAnomaly(el, tAfter)) % TAU;
    if (dM < 0) dM += TAU;
    return tAfter + dM / el.n;
  }
  if (Math.abs(nu) >= el.nuInf) return null;
  const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
  const M = e * Math.sinh(H) - H;
  const t = el.t0 + (M - el.M0) / el.n;
  return t >= tAfter - 1e-6 ? t : null;
}

// true anomaly (>= 0) where the conic reaches radius R; NaN if never
function elNuAtRadius(el, R) {
  if (el.e < 1e-12) return NaN;
  const c = (el.p / R - 1) / el.e;
  return c >= -1 && c <= 1 ? Math.acos(c) : NaN;
}

function elTimeToRadius(el, R, tAfter, outbound) {
  if (el.lin) {
    // |r0 + v0 tau| = R
    const a = V.len2(el.v0), b = V.dot(el.r0, el.v0), c = V.len2(el.r0) - R * R, D = b * b - a * c;
    if (!(a > 0) || D < 0) return null;
    const tau = (outbound ? -b + Math.sqrt(D) : -b - Math.sqrt(D)) / a, t = el.t0 + tau;
    return t >= tAfter - 1e-6 ? t : null;
  }
  if (el.e >= 1) {
    // straight from the hyperbolic anomaly: stays exact for near-radial escapes, where tan(nu/2) blows up
    const c = (1 - R / el.a) / el.e;
    if (!(c >= 1)) return null;
    const H = Math.acosh(c) * (outbound ? 1 : -1), t = el.t0 + (el.e * Math.sinh(H) - H - el.M0) / el.n;
    return t >= tAfter - 1e-6 ? t : null;
  }
  const nu = elNuAtRadius(el, R);
  if (isNaN(nu)) return null;
  return elTimeAtNu(el, outbound ? nu : -nu, tAfter);
}

// unit vectors of the local maneuver frame at a state
function maneuverFrame(r, v) {
  const pro = V.norm(v);
  const nrm = V.norm(V.cross(r, v));
  const rad = V.cross(pro, nrm); // radial out
  return { pro, nrm, rad };
}
function dvLocalToWorld(r, v, dv) {
  const f = maneuverFrame(r, v);
  return V.add(V.add(V.scale(f.pro, dv[0]), V.scale(f.nrm, dv[1])), V.scale(f.rad, dv[2]));
}
function dvWorldToLocal(r, v, w) {
  const f = maneuverFrame(r, v);
  return [V.dot(w, f.pro), V.dot(w, f.nrm), V.dot(w, f.rad)];
}

// ---- patched conics ----

// time of first entry into a child SOI on [tA, tB]; skip = child the orbiter is leaving
function findEncounter(el, body, tA, tB, skip) {
  const kids = body.children;
  if (!kids || !kids.length || !(tB > tA)) return null;
  const span = tB - tA;
  const maxDt = Math.min(isFinite(el.T) ? el.T / 120 : span / 60, span / 8);
  const minDt = Math.max(0.05, span / 2e5);
  let excluded = skip || null;
  let t = tA, tPrev = tA, iter = 0;
  while (iter++ < 6000) {
    const st = elState(el, t);
    const sp = V.len(st.v);
    let step = Infinity;
    for (const c of kids) {
      const cs = bodyRelState(c, t);
      const d = V.dist(st.r, cs.r);
      if (c === excluded) {
        if (d > c.soi * 1.02) excluded = null;
        else continue;
      }
      if (d < c.soi) {
        if (t === tA) continue; // already inside at start: not a new entry
        // bisect entry time
        let lo = tPrev, hi = t;
        for (let k = 0; k < 50; k++) {
          const mid = 0.5 * (lo + hi);
          const d2 = V.dist(elState(el, mid).r, bodyRelState(c, mid).r);
          if (d2 < c.soi) hi = mid; else lo = mid;
          if (hi - lo < 1e-3) break;
        }
        return { body: c, t: hi };
      }
      const s = (d - c.soi) / (sp + V.len(cs.v) + 1);
      if (s < step) step = s;
    }
    if (t >= tB) break;
    step = clamp(step * 0.85, minDt, maxDt);
    tPrev = t;
    t = Math.min(tB, t + step);
  }
  return null;
}

// how far a body's children reach: plan = its planets (and moons' orbits), far = everything incl. other stars
function bodyReach(b) {
  if (b._reach) return b._reach;
  let plan = 0, far = 0;
  for (const c of b.children) { const r = c.el.ra + c.soi; far = Math.max(far, r); if (!c.star) plan = Math.max(plan, r); }
  return (b._reach = { plan: plan * 1.5, far: far * 1.05 });
}
// encounter search split where the path crosses the edge of the planetary region: a light-year-long span
// would otherwise force steps far larger than a planet's sphere of influence
function findEncounterSplit(el, body, tA, tB, skip) {
  const R = bodyReach(body), cuts = [tA];
  if (R.plan > 0 && el.ra > R.plan) {
    for (const out of [false, true]) { const tc = elTimeToRadius(el, R.plan, tA, out); if (tc != null && tc > tA && tc < tB) cuts.push(tc); }
  }
  cuts.sort((a, b) => a - b); cuts.push(tB);
  for (let i = 0; i + 1 < cuts.length; i++) { const e = findEncounter(el, body, cuts[i], cuts[i + 1], skip); if (e) return e; }
  return null;
}

// Predict a chain of conic patches. nodes: [{t, dv:[pro,nrm,rad]}] sorted by t.
function predictTrajectory(body, r, v, t, opts) {
  opts = opts || {};
  const maxPatches = opts.maxPatches || 6;
  const nodes = (opts.nodes || []).slice().sort((a, b) => a.t - b.t);
  const out = [];
  let cb = body, cr = r, cv = v, ct = t, skip = opts.skip || null, nodeIdx = -1, ni = 0;
  while (ni < nodes.length && nodes[ni].t <= ct) ni++;
  for (let k = 0; k < maxPatches; k++) {
    const el = elFromState(cr, cv, cb.mu, ct);
    let tEnd = Infinity, end = 'none', next = null;
    if (cb.parent && (el.e >= 1 || el.ra > cb.soi)) {
      const te = elTimeToRadius(el, cb.soi, ct, true);
      if (te != null && te > ct) { tEnd = te; end = 'exit'; next = cb.parent; }
    }
    let surf = cb.R + (opts.terrain ? cb.hMax || 0 : 0);
    const useAtmo = opts.atmo && cb.atm && V.len(cr) > cb.R + cb.atm.top;
    if (useAtmo) surf = cb.R;
    if (useAtmo) surf += cb.atm.top;
    if (el.rp < surf && V.len(cr) >= surf - 1) {
      const ti = elTimeToRadius(el, surf, ct + 1e-6, false);
      if (ti != null && ti < tEnd) { tEnd = ti; end = useAtmo ? 'atmo' : 'impact'; next = null; }
    }
    const node = nodes[ni];
    // escaping a body with no parent (the Sun): search out to where its farthest child could be met
    let tOut = null;
    if (!isFinite(tEnd) && el.e >= 1) {
      const rOut = Math.max(bodyReach(cb).far, V.len(cr) * 2);
      tOut = elTimeToRadius(el, rOut, ct, true);
    }
    let searchEnd = isFinite(tEnd) ? tEnd : tOut != null ? tOut : ct + el.T;
    if (node && node.t < searchEnd) searchEnd = node.t;
    if (opts.horizon) searchEnd = Math.min(searchEnd, t + opts.horizon);
    const enc = findEncounterSplit(el, cb, ct, searchEnd, skip);
    if (enc) { tEnd = enc.t; end = 'enter'; next = enc.body; }
    else if (node && node.t < tEnd) { tEnd = node.t; end = 'node'; next = null; }
    if (!isFinite(tEnd)) { tEnd = tOut != null ? tOut : ct + el.T; end = 'none'; }
    out.push({ body: cb, el, t0: ct, t1: tEnd, end, next, nodeIdx });
    if (end === 'none' || end === 'impact' || end === 'atmo') break;
    const st = elState(el, tEnd);
    if (end === 'exit') {
      const ps = bodyRelState(cb, tEnd);
      cr = V.add(st.r, ps.r); cv = V.add(st.v, ps.v); skip = cb; cb = cb.parent;
    } else if (end === 'enter') {
      const cs = bodyRelState(next, tEnd);
      cr = V.sub(st.r, cs.r); cv = V.sub(st.v, cs.v); cb = next; skip = null;
    } else if (end === 'node') {
      cr = st.r; cv = V.add(st.v, dvLocalToWorld(st.r, st.v, node.dv)); nodeIdx = ni; ni++; skip = null;
    }
    ct = tEnd;
    if (opts.horizon && ct > t + opts.horizon) break;
  }
  return out;
}

// sample points (relative to the patch body) for drawing a patch
function samplePatch(pt, n) {
  const el = pt.el, pts = [];
  if (el.lin) { const t1 = isFinite(pt.t1) ? pt.t1 : pt.t0 + 1e9; for (let i = 0; i <= n; i++) pts.push(elState(el, pt.t0 + (t1 - pt.t0) * i / n).r); return pts; }
  let nu0 = elNuAt(el, pt.t0), nu1;
  const full = el.e < 1 && (pt.end === 'none' || pt.t1 - pt.t0 >= el.T * 0.999);
  if (full) { nu1 = nu0 + TAU; }
  else {
    nu1 = elNuAt(el, pt.t1);
    if (el.e < 1) { while (nu1 <= nu0) nu1 += TAU; }
  }
  for (let i = 0; i <= n; i++) pts.push(elPosAtNu(el, nu0 + (nu1 - nu0) * i / n));
  return pts;
}
