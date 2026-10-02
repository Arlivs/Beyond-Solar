// Planner: Lambert vs Hohmann, porkchop minimum, auto transfer to the Moon (+ refinement), landing prediction vs physics.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'mapview.js', 'planner.js']);
const { V, Q, BODY, lambert, hohmannTime, porkchop, transferAt, hohmannNode, refineNode, transferScore, predictImpact, predictTrajectory,
  makeDesign, buildVessel, physicsStep, activateStage, elFromState, PHYS_DT, inertialToBodyFixed, parkRadius, hyperbolicDv } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const S = BODY.sun, E = BODY.earth, M = BODY.moon, Ma = BODY.mars;

// 1. Lambert reproduces a Hohmann half-ellipse (slightly short of 180 deg to stay well-defined)
{
  const r1 = 1e9, r2 = 1.6e9, mu = S.mu, th = hohmannTime(mu, r1, r2), ang = Math.PI * 0.999;
  const L = lambert([r1, 0, 0], [r2 * Math.cos(ang), r2 * Math.sin(ang), 0], th * 0.9995, mu);
  const vp = Math.sqrt(mu / r1) * Math.sqrt(2 * r2 / (r1 + r2));
  ok(L && Math.abs(V.len(L.v1) - vp) / vp < 0.01, `Lambert ≈ Hohmann perihelion speed: ${L && V.len(L.v1).toFixed(1)} vs ${vp.toFixed(1)} m/s`);
  // round trip: propagate v1 for tof, land on r2
  const el = elFromState([r1, 0, 0], L.v1, mu, 0), st = G.elState(el, th * 0.9995);
  ok(V.dist(st.r, [r2 * Math.cos(ang), r2 * Math.sin(ang), 0]) < 10, `propagating the Lambert solution hits r2 (miss ${V.dist(st.r, [r2 * Math.cos(ang), r2 * Math.sin(ang), 0]).toFixed(2)} m)`);
}
// 2. Earth -> Mars porkchop minimum close to the ideal Hohmann budget
(async () => {
  const G2 = await new Promise(res => porkchop(E, Ma, 0, { nx: 90, ny: 60 }, res));
  const th = hohmannTime(S.mu, E.el.a, Ma.el.a);
  const v1 = Math.sqrt(S.mu / E.el.a) * (Math.sqrt(2 * Ma.el.a / (E.el.a + Ma.el.a)) - 1);
  const ideal = hyperbolicDv(E, Math.abs(v1), parkRadius(E));
  const b = G2.best;
  ok(b && b.dep < ideal * 1.35 && b.dep > ideal * 0.6, `Earth→Mars best ejection ${b.dep.toFixed(0)} m/s (circular-coplanar Hohmann ${ideal.toFixed(0)}), tof ${(b.tof / th).toFixed(2)}×Hohmann`);
  const tr = transferAt(G2, b.td, b.tof);
  ok(tr && Math.abs(tr.dep - b.dep) < 1e-6, `cell details consistent (phase ${tr.phase.toFixed(1)}°, ejection angle ${tr.eject.toFixed(1)}°)`);

  // 3. auto transfer from LEO to the Moon, then refine to a 30 km periapsis
  const v = buildVessel(makeDesign('П', ['probe_p0', 'tank_t1l', 'eng_terrier']), 'П');
  v.body = E; const R0 = E.R + 120000; v.r = [R0, 0, 0]; v.v = [0, Math.sqrt(E.mu / R0), 0]; v.q = [0, 0, 0, 1]; v.w = [0, 0, 0];
  const t = 1000;
  const nd = hohmannNode(v, { body: M }, t);
  // 1:10 system: LEO ~2.33 km/s, ideal Hohmann to the Moon's distance ~935 m/s
  ok(nd && nd.dv[0] > 850 && nd.dv[0] < 1000, `Hohmann to the Moon: burn ${nd.dv[0].toFixed(0)} m/s in ${((nd.t - t) / 60).toFixed(1)} min`);
  v.nodes = [{ t: nd.t, dv: nd.dv.slice() }];
  const s0 = transferScore(v, v.nodes, { body: M }, 30000, t);
  const res = await new Promise(r => refineNode(v, { body: M }, 30000, t, (best, n) => r({ best, n }), 300));
  ok(res.best.enc && Math.abs(res.best.pe - 30000) < 3000, `refined: encounter with periapsis ${(res.best.pe / 1000).toFixed(1)} km after ${res.n} predictions (before: ${s0.enc ? 'Pe ' + (s0.pe / 1000).toFixed(0) + ' km' : 'miss ' + (s0.d / 1000).toFixed(0) + ' km'})`);

  // 4. landing prediction vs the full physics: capsule from 45 km, 2.3 km/s, shield first, chutes armed
  const cap = buildVessel(makeDesign('Капсула', ['chute_s', 'pod_k1', 'shield_s1']), 'К');
  cap.body = E; cap.r = [E.R + 45000, 0, 0]; cap.v = [-250, 2200, 0];
  const back = V.norm(V.neg(cap.v)), side = V.norm(V.cross(back, [0, 0, 1]));
  cap.q = Q.fromBasis(side, back, V.cross(side, back)); cap.w = [0, 0, 0];
  cap.sas = true; cap.sasMode = 'retro';
  activateStage(cap, 0, { event: () => {} });                 // arms the parachute
  const pred = predictImpact(cap, 0);
  let ut = 0;
  for (; ut < 3000 && !cap.landed && !cap.destroyed; ut += PHYS_DT) physicsStep(cap, PHYS_DT, ut, {}, { event: () => {} });
  const real = V.norm(inertialToBodyFixed(E, ut, cap.r));
  const miss = Math.acos(Math.min(1, V.dot(real, V.norm(pred.pF)))) * E.R;
  ok(pred && miss < 15000 && Math.abs(pred.t - ut) < 15 && pred.speed < 12, `landing predicted within ${(miss / 1000).toFixed(1)} km and ${Math.abs(pred.t - ut).toFixed(0)} s of the simulated one (lands at ${ut.toFixed(0)} s, touchdown ${pred.speed.toFixed(1)} m/s under the canopy)`);
  console.log(fails ? fails + ' FAILURES' : 'ALL OK');
  process.exitCode = fails ? 1 : 0;
})();
