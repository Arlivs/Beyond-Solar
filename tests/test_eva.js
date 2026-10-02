// EVA: walking, jumping, jetpack budget and lift-off limits, boarding range, crew bookkeeping.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'docking.js', 'eva.js', 'career.js']);
const { V, Q, BODY, PART, makeDesign, buildVessel, massProps, physicsStep, placeOnPad, unlock, evaStep, nearestHatch, hatchWorld, EVA, PHYS_DT,
  newGame, assignCrew, crewOf, crewById, crewLog, crewHome, crewLevel, recoverVessel, sasAllowed, hireKerbal, inertialToBodyFixed, bodyFixedToInertial } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const hooks = { event: () => {} };

function kerbalOn(bodyId, lat, lon) {
  const k = buildVessel(makeDesign('К', ['kerbal']), 'К');
  k.parts[0].crew = ['k1'];
  placeOnPad(k, 0, { body: bodyId, lat, lon });
  k.prelaunch = false; k.prelaunchHold = false; k.loaded = true;
  return k;
}
function frame(k) {   // camera looking east (horizontal), up = local up
  const up = V.norm(k.r), east = V.norm(V.cross([0, 0, 1], up));
  return { fwd: east, right: V.cross(east, up), up };
}
function run(k, T, inp, ut0) {
  let ut = ut0 || 0, maxH = -1e9, minUp = 1;
  for (; ut < (ut0 || 0) + T && !k.destroyed; ut += PHYS_DT) {
    const f = frame(k);
    evaStep(k, Object.assign({ mx: 0, mz: 0, my: 0, jump: false, jet: false }, f, inp(ut)), PHYS_DT);
    for (let i = 0; i < 4; i++) physicsStep(k, PHYS_DT / 4, ut + i * PHYS_DT / 4, {}, hooks);
    maxH = Math.max(maxH, k.radarAlt);
    minUp = Math.min(minUp, V.dot(Q.rot(k.q, [0, 1, 0]), V.norm(k.r)));
  }
  return { ut, maxH, minUp };
}
const surfDist = (b, a, c, t0, t1) => V.dist(inertialToBodyFixed(b, t0, a), inertialToBodyFixed(b, t1, c));

for (const [bid, lat, lon] of [['earth', 0.002, 0.003], ['moon', 0.3, -0.6]]) {
  const b = BODY[bid];
  const k = kerbalOn(bid, lat, lon);
  run(k, 2, () => ({}));                                         // settle
  const p0 = k.r.slice(), t0 = 2;
  const r = run(k, 5, () => ({ mz: 1 }), 2);
  const d = surfDist(b, p0, k.r, t0, r.ut);
  const want = EVA.walk * Math.min(1, Math.max(0.55, Math.pow(b.g0 / 9.8, 0.25))) * 5;
  ok(!k.destroyed && Math.abs(d - want) < want * 0.25, `${b.name}: walked ${d.toFixed(2)} m in 5 s (expected ≈${want.toFixed(2)})`);
  ok(r.minUp > 0.98 && r.maxH < 0.9, `${b.name}: stays upright (cos ${r.minUp.toFixed(3)}) and on the ground (max ${r.maxH.toFixed(2)} m)`);
  const h0 = k.radarAlt;
  let jumped = false;
  const j = run(k, 4, () => { if (!jumped) { jumped = true; return { jump: true }; } return {}; }, r.ut);
  const hJump = j.maxH - h0;
  const vj = EVA.jump * Math.min(1, Math.max(0.7, Math.pow(b.g0 / 9.8, 0.15)));
  ok(Math.abs(hJump - vj * vj / (2 * b.g0)) < 0.3 + 0.15 * vj * vj / (2 * b.g0), `${b.name}: jump ${hJump.toFixed(2)} m (ballistic ${(vj * vj / (2 * b.g0)).toFixed(2)})`);
  const before = k.parts[0].st.evaFuel;
  const up = run(k, 4, () => ({ my: 1, jet: true }), j.ut);
  const lifted = up.maxH - h0;
  if (bid === 'earth') ok(lifted < 0.6, `Земля: ранец не поднимает (${lifted.toFixed(2)} м), топлива ушло ${(before - k.parts[0].st.evaFuel).toFixed(2)}`);
  else ok(lifted > 3, `Луна: ранец поднимает на ${lifted.toFixed(1)} м за 4 с`);
}

// space: jetpack Δv budget
{
  const E = BODY.earth, R0 = E.R + 150000, vc = Math.sqrt(E.mu / R0);
  const k = buildVessel(makeDesign('К', ['kerbal']), 'К');
  k.parts[0].crew = ['k1']; k.body = E; k.r = [R0, 0, 0]; k.v = [0, vc, 0]; k.q = [0, 0, 0, 1]; k.w = [0, 0, 0]; k.loaded = true;
  const v0 = k.v.slice();
  let ut = 0;
  for (; ut < 200 && k.parts[0].st.evaFuel !== 0; ut += PHYS_DT) {
    evaStep(k, { fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], mx: 0, mz: 1, my: 0, jump: false, jet: true }, PHYS_DT);
    physicsStep(k, PHYS_DT, ut, {}, hooks);
  }
  const dvz = k.v[2] - v0[2];
  ok(Math.abs(dvz - EVA.fuel * EVA.dvPerUnit) < 3, `space: jetpack budget ${dvz.toFixed(1)} m/s out-of-plane (fuel ${EVA.fuel} × ${EVA.dvPerUnit})`);
  ok(V.dot(Q.rot(k.q, [0, 0, 1]), [0, 0, 1]) > 0.95, 'space: turns to face the camera direction');
}

// boarding range + crew bookkeeping
{
  const g = newGame('career');
  const pod = buildVessel(makeDesign('Капсула', ['pod_k3']), 'Капсула');
  assignCrew(g, pod, { crew: {} });
  ok(crewOf(pod).length === 3 && crewById(g, crewOf(pod)[0]).role === 'pilot', `three seats filled, pilot first (${crewOf(pod).map(id => crewById(g, id).role).join(', ')})`);
  ok(g.crew.filter(c => c.status === 'flight').length === 3, 'seated crew marked in flight');
  placeOnPad(pod, 0); pod.loaded = true;
  const kid = pod.parts[0].crew.pop();
  const k = buildVessel(makeDesign('К', ['kerbal']), 'К'); k.parts[0].crew = [kid]; k.body = pod.body;
  const hw = hatchWorld(pod, pod.parts[0]);
  k.r = V.add(hw, [0, 0, 1.5]);
  ok(!!nearestHatch([pod, k], k), 'hatch found from 1.5 m');
  k.r = V.add(hw, [0, 0, 4]);
  ok(!nearestHatch([pod, k], k), 'no hatch from 4 m');
  // XP: Moon landing logged, credited on recovery
  crewLog(g, kid, 'moon', 'landed'); crewLog(g, kid, 'moon', 'soi');
  const c = crewById(g, kid), lv0 = crewLevel(c);
  pod.parts[0].crew.push(kid);
  const rec = recoverVessel(g, pod);
  ok(Math.abs(c.xp - 2.3 * 1.5 - 1 * 1.5) < 1e-9 && c.status === 'ready', `recovery credits ${c.xp.toFixed(2)} XP (level ${lv0} → ${crewLevel(c)}) and frees the crew`);
  ok(rec.crew.length === 3, 'recovery report lists the crew');
  // SAS gating in career: pod with only a scientist holds attitude only
  const v2 = buildVessel(makeDesign('Учёный', ['pod_k1']), 'У');
  v2.parts[0].crew = [g.crew.find(x => x.role === 'scientist').id];
  ok(sasAllowed(g, v2, 'stab') && !sasAllowed(g, v2, 'pro'), 'scientist alone: stability only');
  v2.parts[0].crew = [g.crew.find(x => x.role === 'pilot').id];
  ok(sasAllowed(g, v2, 'pro') && !sasAllowed(g, v2, 'node'), 'level-1 pilot: prograde yes, manoeuvre no');
  const v3 = buildVessel(makeDesign('Зонд', ['probe_p0', 'tank_t0s']), 'З');
  ok(sasAllowed(g, v3, 'node'), 'probe core: every mode');
  const before = g.funds, hk = hireKerbal(g, 'engineer');
  ok(hk && g.funds < before && hk.status === 'ready', `hire costs ${before - g.funds}`);
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exitCode = fails ? 1 : 0;
