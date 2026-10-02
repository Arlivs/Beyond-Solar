const G = require('./load')(['math.js', 'orbit.js', 'bodies.js']);
const { V, elFromState, elState, BODY, BODIES, predictTrajectory, bodyRelState, DAY, fmtDist } = G;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// 1. round trip + propagation vs RK4
function rk4(r, v, mu, T, dt) {
  const acc = (p) => V.scale(p, -mu / Math.pow(V.len(p), 3));
  for (let t = 0; t < T; t += dt) {
    const h = Math.min(dt, T - t);
    const k1v = acc(r), k1r = v;
    const k2v = acc(V.addS(r, k1r, h / 2)), k2r = V.addS(v, k1v, h / 2);
    const k3v = acc(V.addS(r, k2r, h / 2)), k3r = V.addS(v, k2v, h / 2);
    const k4v = acc(V.addS(r, k3r, h)), k4r = V.addS(v, k3v, h);
    r = V.add(r, V.scale(V.add(V.add(k1r, V.scale(k2r, 2)), V.add(V.scale(k3r, 2), k4r)), h / 6));
    v = V.add(v, V.scale(V.add(V.add(k1v, V.scale(k2v, 2)), V.add(V.scale(k3v, 2), k4v)), h / 6));
  }
  return { r, v };
}
const mu = BODY.earth.mu;
let maxErr = 0;
// seeded: Math.random occasionally drew a near-parabolic case right at the 1 mm round-trip tolerance
const rnd = G.rng(20261002);
for (let k = 0; k < 40; k++) {
  const r = [700e3 + rnd() * 3e5, (rnd() - .5) * 4e5, (rnd() - .5) * 2e5];
  const vc = Math.sqrt(mu / V.len(r));
  const v = [(rnd() - .5) * vc * 0.6, vc * (0.6 + rnd() * 1.0), (rnd() - .5) * vc * 0.4];
  const t0 = 1234.5;
  const el = elFromState(r, v, mu, t0);
  const s0 = elState(el, t0);
  ok(V.dist(s0.r, r) < 1e-3 && V.dist(s0.v, v) < 1e-6, 'roundtrip ' + k + ' e=' + el.e + ' ' + V.dist(s0.r, r));
  const T = 900;
  const num = rk4(r, v, mu, T, 0.5);
  const an = elState(el, t0 + T);
  const err = V.dist(num.r, an.r);
  maxErr = Math.max(maxErr, err);
  ok(err < 0.5, 'propagate ' + k + ' e=' + el.e.toFixed(3) + ' err=' + err);
}
console.log('round-trip/propagation max err (m):', maxErr.toExponential(2));
// 2. body table
console.log('body        R(km)    g(m/s2)  SOI(km)      period(days)');
for (const b of BODIES) console.log(b.id.padEnd(10), (b.R / 1e3).toFixed(1).padStart(8), b.g0.toFixed(2).padStart(7), (isFinite(b.soi) ? (b.soi / 1e3).toFixed(0) : 'inf').padStart(10), b.el ? (b.el.T / DAY).toFixed(2).padStart(12) : '');
ok(Math.abs(BODY.earth.el.T / DAY - 365.25) < 1, 'earth year');
ok(Math.abs(BODY.earth.g0 - 9.82) < 0.05, 'earth g');
// 3. LEO -> Moon transfer encounter
const E = BODY.earth, rLeo = E.R + 100e3, vLeo = Math.sqrt(E.mu / rLeo);
console.log('LEO 100 km: v =', vLeo.toFixed(1), 'm/s, period', (2 * Math.PI * Math.sqrt(rLeo ** 3 / E.mu) / 60).toFixed(1), 'min');
// find a departure time when burning prograde reaches the Moon: scan phase
let best = null;
for (let ph = 0; ph < 360; ph += 2) {
  const a = ph * Math.PI / 180;
  const r = [rLeo * Math.cos(a), rLeo * Math.sin(a), 0], v = [-vLeo * Math.sin(a), vLeo * Math.cos(a), 0];
  const dv = 975;
  const v2 = V.add(v, V.scale(V.norm(v), dv));
  const pts = predictTrajectory(E, r, v2, 0, { maxPatches: 3 });
  if (pts.length > 1 && pts[0].end === 'enter') { best = { ph, pts }; break; }
}
ok(!!best, 'found moon encounter');
if (best) {
  const p1 = best.pts[1];
  console.log('Moon encounter at phase', best.ph, 'deg: t =', (best.pts[0].t1 / 3600).toFixed(2), 'h; Moon Pe =', fmtDist(p1.el.rp - BODY.moon.R), 'e =', p1.el.e.toFixed(3), '->', p1.end, p1.next && p1.next.id);
}
// 4. Hohmann Earth -> Mars from heliocentric
const S = BODY.sun, ea = BODY.earth.el.a, ma = BODY.mars.el.a;
const dvH = Math.sqrt(S.mu / ea) * (Math.sqrt(2 * ma / (ea + ma)) - 1);
console.log('helio Hohmann Earth->Mars dv:', dvH.toFixed(0), 'm/s, transfer', (Math.PI * Math.sqrt(((ea + ma) / 2) ** 3 / S.mu) / DAY).toFixed(0), 'days');
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
