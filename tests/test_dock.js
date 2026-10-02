// Docking: capture, merge conservation, flipped parts, thrust direction, undock, save round-trip, magnet.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'docking.js', 'career.js']);
const { V, Q, BODY, PART, makeDesign, buildVessel, massProps, physicsStep, dockingStep, undock, portWorld, freePorts, partAxis, vesselGeometry, serializeVessel, deserializeVessel, PHYS_DT } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const E = BODY.earth, R0 = E.R + 120000, vc = Math.sqrt(E.mu / R0);
const mk = (name) => { const v = buildVessel(makeDesign(name, ['dock_s', 'probe_p0', 'tank_t0s', 'eng_spark']), name); v.body = E; v.w = [0, 0, 0]; v.loaded = true; return v; };
// a: port faces +y (along the orbit); b: port faces -y, `gap` metres ahead, closing at `vClose`, with optional offset / tilt
function setup(gap, vClose, lateral, tiltDeg) {
  const a = mk('Станция'), b = mk('Цель');
  a.q = [0, 0, 0, 1];
  b.q = Q.mul(Q.axisAngle([0, 0, 1], (tiltDeg || 0) * Math.PI / 180), Q.axisAngle([1, 0, 0], Math.PI));
  a.r = [R0, 0, 0]; a.v = [0, vc, 0];
  b.r = [R0, 0, 0]; b.v = [0, vc - vClose, 0];
  const fa = portWorld(a, freePorts(a)[0]).pos, fb = portWorld(b, freePorts(b)[0]).pos;
  b.r = V.add(b.r, V.add(V.sub(fa, fb), [lateral || 0, gap, 0]));
  return { a, b };
}
function run(a, b, T) {
  let ut = 0, merged = null;
  const hooks = { event: () => {} };
  for (; ut < T && !merged; ut += PHYS_DT) {
    for (const v of [a, b]) if (!v.destroyed) physicsStep(v, PHYS_DT, ut, {}, hooks);
    const m = dockingStep([a, b], PHYS_DT, a);
    if (m.length) merged = m[0];
  }
  return { merged, ut };
}

// ---- 1. straight approach, nose to nose
{
  const { a, b } = setup(3, 0.25);
  const mA = massProps(a).m, mB = massProps(b).m;
  let pTot = null;
  // momentum just before capture is compared against the merged vessel
  const hooks = { event: () => {} };
  let ut = 0, merged = null;
  for (; ut < 60 && !merged; ut += PHYS_DT) {
    physicsStep(a, PHYS_DT, ut, {}, hooks); physicsStep(b, PHYS_DT, ut, {}, hooks);
    pTot = V.add(V.scale(a.v, massProps(a).m), V.scale(b.v, massProps(b).m));
    const m = dockingStep([a, b], PHYS_DT, a);
    if (m.length) merged = m[0];
  }
  ok(!!merged && merged.keep === a && b.destroyed, `captured after ${ut.toFixed(1)} s, kept the preferred vessel`);
  const mp = massProps(a);
  ok(Math.abs(mp.m - (mA + mB)) < 1e-6 * mp.m, `mass conserved: ${(mp.m / 1000).toFixed(3)} t`);
  ok(V.len(V.sub(V.scale(a.v, mp.m), pTot)) < 1e-6 * V.len(pTot), 'momentum conserved');
  const flipped = a.parts.slice(4).filter(p => partAxis(p)[1] < -0.99).length;
  ok(flipped === 4, `all 4 parts of the second probe are upside down in the station frame (${flipped})`);
  ok(a.edges.some(e => e.dock && !e.cut) && a.parts.filter(p => p.st.dock).length === 2, 'dock edge and both ports marked');
  ok(!a.parts.some(p => !isFinite(p.pos[0]) || !isFinite(p.pos[1])) && isFinite(a.r[0]), 'no NaN');
  const g = vesselGeometry(a);
  ok(g.frontSum > 0 && g.backSum > 0 && g.contacts.length > 0 && isFinite(g.frontSum + g.backSum), `aero geometry ok (front ${g.frontSum.toFixed(3)} back ${g.backSum.toFixed(3)})`);
  // the fused faces must not count as exposed area: front+back of the merged stack equals two noses' worth
  // second probe's engine pushes toward its own nose: -y in the world
  const engB = a.parts.find((p, i) => i >= 4 && PART[p.id].engine);
  const v0 = a.v.slice();
  engB.st.eng.on = true; a.throttle = 1;
  for (let i = 0; i < 50; i++) physicsStep(a, PHYS_DT, ut + i * PHYS_DT, {}, hooks);
  const dvy = a.v[1] - v0[1];
  ok(dvy < -0.5, `docked engine of the second probe thrusts along -y (Δv_y ${dvy.toFixed(2)} m/s)`);
  engB.st.eng.on = false; a.throttle = 0;
  // save round-trip keeps orientation and the joint
  const s = JSON.parse(JSON.stringify(serializeVessel(a)));
  const a2 = deserializeVessel(s);
  ok(a2.parts.slice(4).every(p => p.q && partAxis(p)[1] < -0.99) && a2.edges.some(e => e.dock), 'save/load keeps part orientation and the dock joint');
  ok(Math.abs(massProps(a2).m - massProps(a).m) < 1e-6, 'save/load keeps mass');
  // undock
  const port = a.parts.find(p => p.st.dock);
  const ut2 = ut + 1;
  const outV = undock(a, port.rid, { event: () => {} });
  ok(outV.length === 1 && outV[0].name === 'Цель', `undock splits off "${outV[0] && outV[0].name}"`);
  const nv = outV[0];
  nv.loaded = true;
  const relY = nv.v[1] - a.v[1];
  ok(relY > 0.05, `separation push ${relY.toFixed(3)} m/s apart`);
  ok(a.parts.filter(p => !p.dead).length === 4 && nv.parts.length === 4, 'four parts each after undocking');
  let again = null;
  for (let t = ut2; t < ut2 + 10; t += PHYS_DT) { physicsStep(a, PHYS_DT, t, {}, hooks); physicsStep(nv, PHYS_DT, t, {}, hooks); const m = dockingStep([a, nv], PHYS_DT, a); if (m.length) { again = m; break; } }
  ok(!again, 'no immediate re-capture after undocking');
}

// ---- 2. magnet: 0.35 m lateral offset, 8° tilt, slow approach
{
  const { a, b } = setup(1.4, 0.12, 0.35, 8);
  const r = run(a, b, 60);
  ok(!!r.merged, `magnet aligns and captures with offset and tilt (${r.ut.toFixed(1)} s)`);
}

// ---- 3. too fast: no capture, no merge
{
  const { a, b } = setup(1.0, 3.0);
  const r = run(a, b, 3);
  ok(!r.merged, 'a 3 m/s pass does not dock');
}

// ---- 4. mismatched sizes never dock
{
  const a = mk('A');
  const b = buildVessel(makeDesign('B', ['dock_m', 'probe_p1', 'tank_t1s']), 'B'); b.body = E; b.w = [0, 0, 0]; b.loaded = true;
  a.q = [0, 0, 0, 1]; b.q = Q.axisAngle([1, 0, 0], Math.PI);
  a.r = [R0, 0, 0]; a.v = [0, vc, 0]; b.v = [0, vc - 0.1, 0];
  b.r = [R0, 0, 0];
  const fa = portWorld(a, freePorts(a)[0]).pos, fb = portWorld(b, freePorts(b)[0]).pos;
  b.r = V.add(b.r, V.add(V.sub(fa, fb), [0, 0.5, 0]));
  ok(!run(a, b, 10).merged, '0.625 m and 1.25 m ports do not dock');
}
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exitCode = fails ? 1 : 0;
