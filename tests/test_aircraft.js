// Aircraft and rovers: runway placement, take-off run, climb-out, jet altitude limit, rover drive/steer/brake.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js']);
const { V, Q, BODY, PART, stockDesigns, buildVessel, massProps, physicsStep, placeOnRunway, activateStage, PHYS_DT, inertialToBodyFixed, jetFactor, bodyOmega } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const E = BODY.earth, hooks = { event: (t, d) => { if (t === 'explode') console.log('  explode', PART[d.part.id].name, d.why); } };
const step = (v, ut, ctl) => { for (let i = 0; i < 4; i++) physicsStep(v, PHYS_DT / 4, ut + i * PHYS_DT / 4, ctl, hooks); };
const up = (v) => V.norm(v.r);
const pitchOf = (v) => Math.asin(V.dot(Q.rot(v.q, [0, 1, 0]), up(v))) / G.DEG;
const gs = (v) => V.len(V.sub(v.v, V.cross(bodyOmega(E), v.r)));

// ---- plane
{
  const d = stockDesigns().find(x => x.name === 'Стриж');
  const v = buildVessel(d, 'Стриж'); v.legs = true;
  placeOnRunway(v, 0);
  const mp = massProps(v);
  console.log(`  Стриж: ${(mp.m / 1000).toFixed(2)} t, CoM y ${mp.com[1].toFixed(2)} m`);
  const p0 = inertialToBodyFixed(E, 0, v.r);
  let ut = 0;
  for (; ut < 3; ut += PHYS_DT) step(v, ut, {});
  ok(!v.destroyed && v.parts.every(p => !p.dead), `parked on the runway without damage (locked ${!!v.lock})`);
  activateStage(v, ut, hooks); v.throttle = 1;
  let lift = null, maxAoA = 0, maxW = 0, tClimb = null;
  for (; ut < 200 && !v.destroyed; ut += PHYS_DT) {
    const pt = pitchOf(v), alt = v.radarAlt;
    const ctl = {};
    if (gs(v) > 52 && !lift) ctl.pitch = pt < 12 ? -1 : clamp(-(12 - pt) * 0.3, -1, 1);   // full back stick to 12 deg, as a pilot would
    if (lift) ctl.pitch = clamp(-(12 - pt) * 0.08 + v.w[0] * 0.8, -1, 1);              // climb at 12 deg
    step(v, ut, ctl);
    if (!lift && alt > 4) lift = { ut, dist: Math.acos(Math.min(1, V.dot(V.norm(p0), V.norm(inertialToBodyFixed(E, ut, v.r))))) * E.R, spd: gs(v) };
    if (lift) { const ua = Q.invRot(v.q, V.sub(v.v, V.cross(bodyOmega(E), v.r))); maxAoA = Math.max(maxAoA, Math.abs(Math.atan2(-ua[2], ua[1]) / G.DEG)); maxW = Math.max(maxW, V.len(v.w)); }
    if (lift && alt > 1000 && !tClimb) { tClimb = ut; break; }
  }
  ok(lift && lift.dist < 1200 && lift.spd < 130, `wheels off after ${lift && lift.dist.toFixed(0)} m at ${lift && lift.spd.toFixed(0)} m/s (runway 1510 m)`);
  ok(tClimb && maxAoA < 16 && maxW < 0.6, `climbed to 1 km in ${tClimb ? (tClimb - lift.ut).toFixed(0) : '—'} s; max AoA ${maxAoA.toFixed(1)}°, max rate ${maxW.toFixed(2)} rad/s`);
  // retract gear in flight: no effect on stability, then jet limits
  ok(jetFactor(PART.jet_basic.engine.air, 1, 0) === 1 && jetFactor(PART.jet_basic.engine.air, 0.1, 0.9) < 0.4 && jetFactor(PART.jet_basic.engine.air, 1, 3.0) === 0, 'jet thrust: full at sea level, weak in thin air, zero past Mach 3');
}

// ---- rover
{
  const d = stockDesigns().find(x => x.name === 'Луноход');
  const v = buildVessel(d, 'Луноход');
  placeOnRunway(v, 0);
  let ut = 0;
  for (; ut < 2; ut += PHYS_DT) step(v, ut, {});
  const p0 = inertialToBodyFixed(E, ut, v.r);
  for (; ut < 10; ut += PHYS_DT) step(v, ut, { pitch: 1 });
  const p1 = inertialToBodyFixed(E, ut, v.r), d1 = V.dist(p0, p1);
  ok(!v.destroyed && d1 > 30 && gs(v) > 6, `drove ${d1.toFixed(0)} m in 8 s, now ${gs(v).toFixed(1)} m/s, upright ${V.dot(Q.rot(v.q, [0, 0, 1]), up(v)).toFixed(2)}`);
  // accumulate the heading change (a full circle must not read as zero)
  let turned = 0, hPrev = V.norm(V.reject(Q.rot(v.q, [0, 1, 0]), up(v)));
  for (; ut < 16; ut += PHYS_DT) {
    step(v, ut, { pitch: 0.6, yaw: 1 });
    const h = V.norm(V.reject(Q.rot(v.q, [0, 1, 0]), up(v)));
    turned += Math.acos(clamp(V.dot(h, hPrev), -1, 1)) / G.DEG; hPrev = h;
  }
  ok(turned > 30 && V.dot(Q.rot(v.q, [0, 0, 1]), up(v)) > 0.9, `turned ${turned.toFixed(0)}° and stayed on its wheels`);
  for (; ut < 22; ut += PHYS_DT) step(v, ut, { brake: 1 });
  ok(gs(v) < 0.3, `braked to ${gs(v).toFixed(2)} m/s`);
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
console.log(fails ? fails + ' FAILURES' : 'ALL OK');
process.exitCode = fails ? 1 : 0;
