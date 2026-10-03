// Interstellar: star systems, floating origin, starlight, encounter prediction across light years,
// burns under time warp (rocket equation, manoeuvre cut-off), solar sail force.
const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js', 'eva.js', 'career.js']);
const { V, Q, BODY, BODIES, STARS, ORIGIN, PART, AU, SCALE_L, DAY, G0, makeDesign, buildVessel, massProps, vesselRes, predictTrajectory, enterRails,
  railsPoweredAdvance, sailForce, sunExposure, setOrigin, bodyAbsPos, chainState, elFromState, newGame, assignCrew, crewById, crewAge, crewAgeTick, hasControl } = G;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// ---- 1. systems: real periods and starlight, host / system links, solar SOIs untouched
ok(near(BODY.proxb.el.T / DAY, 11.18465, 0.01), `Proxima b period ${(BODY.proxb.el.T / DAY).toFixed(3)} d (real 11.185)`);
ok(near(BODY.trape.el.T / DAY, 6.09956, 0.01), `TRAPPIST-1 e period ${(BODY.trape.el.T / DAY).toFixed(3)} d (real 6.100)`);
ok(near(BODY.acenb.el.T / (365.25 * DAY), 79.9, 0.02), `α Cen B period ${(BODY.acenb.el.T / (365.25 * DAY)).toFixed(1)} yr (real 79.9)`);
const fP = sunExposure(BODY.proxb, [BODY.proxb.R * 3, 0, 0], 0), fT = sunExposure(BODY.trape, [BODY.trape.R * 3, 0, 0], 0);
ok(near(fP, 0.65, 0.05) && near(fT, 0.66, 0.05), `starlight: Proxima b ${fP.toFixed(3)}, TRAPPIST-1 e ${fT.toFixed(3)} of Earth's (real ≈0.65, 0.66)`);
ok(BODY.proxb.host === BODY.proxima && BODY.proxb.sys === BODY.acena && BODY.earth.sys === BODY.sun && STARS.length === 7, 'host star and system links');
const moonLaplace = BODY.moon.el.a * Math.pow(BODY.moon.mu / (BODY.earth.mu + BODY.moon.mu), 0.4);
ok(near(BODY.moon.soi, moonLaplace, 1e-12), 'solar-system spheres of influence unchanged (Laplace)');
const dly = V.len(BODY.acena.pos) / (9.4607e15 * SCALE_L);
ok(near(dly, 4.32, 0.01), `α Centauri at ${dly.toFixed(2)} ly (scaled 1:10 like everything else)`);

// ---- 2. floating origin keeps a far system precise
setOrigin(BODY.trappist);
const p = bodyAbsPos(BODY.trape, 1e6), q = chainState(BODY.trape, 1e6, BODY.trappist).r;
ok(V.dist(p, q) === 0 && V.len(p) < 1e10, `origin at TRAPPIST-1: e at ${V.len(p).toExponential(2)} m from the origin, exact`);
ok(near(V.len(bodyAbsPos(BODY.earth, 0)), V.len(BODY.trappist.pos), 1e-3), 'Earth seen from the TRAPPIST-1 origin is 40 ly away');
setOrigin(null);

// ---- 3. a light-year trajectory finds the star; an escape still finds nothing spurious
const r0 = V.scale(V.norm(BODY.acena.pos), 60 * AU * SCALE_L);
const tr = predictTrajectory(BODY.sun, r0, V.scale(V.norm(BODY.acena.pos), 3e5), 0, { maxPatches: 3 });
ok(tr[0].end === 'enter' && tr[0].next === BODY.acena, `towards α Centauri at 300 km/s: ${tr.map(x => x.body.id + ':' + x.end).join(' ')} after ${(tr[0].t1 / (365.25 * DAY)).toFixed(0)} yr`);
ok(isFinite(tr[tr.length - 1].t1), 'escape patches end at a finite time (drawable)');

// ---- 4. burn under warp: Δv follows the rocket equation
const mkShip = () => {
  const v = buildVessel(makeDesign('Т', [{ id: 'pod_k3', r: [] }, 'reactor', 'tank_he3_l', 'eng_fusion']), 'Т');
  v.body = BODY.sun; v.r = r0.slice(); v.v = V.scale(V.norm(r0), 30000); v.q = Q.fromTo([0, 1, 0], V.norm(r0)); v.w = [0, 0, 0];
  for (const p of v.parts) if (p.st.eng) p.st.eng.on = true;
  v.sas = true; v.sasMode = 'pro'; v.throttle = 1; v.loaded = true;
  enterRails(v, 0);
  return v;
};
{
  const v = mkShip(), m0 = massProps(v).m, v0 = V.len(v.v);
  let t = 0, ev = null, it = 0;
  while (!ev && it++ < 1000) { const r = railsPoweredAdvance(v, t, t + 1e9, 600); t = r.t; ev = r.event; }
  const m1 = massProps(v).m, dv = V.len(v.v) - v0, ideal = 100000 * G0 * Math.log(m0 / m1);
  ok(ev === 'burnout' && vesselRes(v, 'FUSION') < 1e-6, `burn ran to burnout in ${it} calls, ${(t / 3600).toFixed(1)} h`);
  ok(near(dv, ideal, 0.005), `Δv ${(dv / 1000).toFixed(1)} km/s vs rocket equation ${(ideal / 1000).toFixed(1)} km/s`);
  const tb = 48000 / (400000 / (100000 * G0));
  ok(t >= tb * 0.999 && t < tb * 1.03, `burn time ${(t / 3600).toFixed(1)} h = propellant / mass flow ${(tb / 3600).toFixed(1)} h (+ the last step)`);
}
// ---- 5. a manoeuvre node under warp stops at the planned Δv
{
  const E = BODY.earth, R0 = E.R + 300000, vc = Math.sqrt(E.mu / R0);
  const v = buildVessel(makeDesign('Н', ['probe_p1', 'tank_t1l', 'eng_terrier']), 'Н');
  v.body = E; v.r = [R0, 0, 0]; v.v = [0, vc, 0]; v.q = Q.fromTo([0, 1, 0], [0, 1, 0]); v.w = [0, 0, 0];
  for (const p of v.parts) if (p.st.eng) p.st.eng.on = true;
  v.sas = true; v.sasMode = 'node'; v.throttle = 1; v.nodeBurn = [0, 250, 0];
  enterRails(v, 0);
  // frame by frame (2 s of warp each), the trajectory never refreshing nodeBurn in between
  let r = { t: 0, event: null };
  const m0 = massProps(v).m;
  while (!r.event && r.t < 2000) r = railsPoweredAdvance(v, r.t, r.t + 2, 5000);
  const el = elFromState(v.r, v.v, E.mu, r.t), dv = PART.eng_terrier.engine.ispVac * G0 * Math.log(m0 / massProps(v).m);
  ok(r.event === 'node' && v.throttle === 0, `node burn cut off by itself after ${r.t.toFixed(1)} s`);
  ok(Math.abs(dv - 250) < 1 && el.ra > R0 + 1e5, `Δv spent ${dv.toFixed(2)} m/s of 250 over 2-second warp frames, Ap ${((el.ra - E.R) / 1000).toFixed(0)} km`);
}
// ---- 6. solar sail: 2·P·A at Earth's distance, facing the Sun
{
  const E = BODY.earth, v = buildVessel(makeDesign('П', ['probe_p1', 'sail']), 'П');
  v.body = BODY.sun; const eAbs = bodyAbsPos(E, 0); v.r = V.add(eAbs, [0, 0, 1e8]); v.v = [0, 0, 0];
  v.q = Q.fromTo([0, 1, 0], V.norm(v.r));
  for (const p of v.parts) if (PART[p.id].sail) p.st.sail = true;
  const F = sailForce(v, 0), f = sunExposure(v.body, v.r, 0), want = 2 * 4.56e-6 * 1e4 * f;
  ok(near(V.len(F), want, 0.01) && V.dot(F, v.r) > 0, `sail force ${(V.len(F) * 1000).toFixed(1)} mN, pushes away from the Sun`);
  v.q = Q.fromTo([0, 1, 0], V.perp(v.r));
  ok(V.len(sailForce(Object.assign(v, { _slT: null }), 0)) < 1e-6, 'edge-on sail: no force');
  // behind the Earth: no light, no push
  const sd = V.norm(V.sub(bodyAbsPos(BODY.sun, 0), eAbs));
  Object.assign(v, { body: E, r: V.scale(sd, -(E.R + 3e5)), _slT: null }); v.q = Q.fromTo([0, 1, 0], sd);
  ok(V.len(sailForce(v, 0)) === 0, "in the Earth's shadow the sail gives nothing");
}
// ---- 7. a century in flight: the awake crew dies of old age, the sleepers in a powered cryo pod barely age
{
  const g = newGame('career', 'Т');
  const v = buildVessel(makeDesign('Ковчег', [{ id: 'pod_k1', r: [{ sym: 2, y: 0, part: 'rtg' }] }, 'cryo', 'battery_l']), 'Ковчег');
  v.body = BODY.sun; v.r = r0.slice(); v.v = [0, 0, 0]; v.rails = { landed: false };
  assignCrew(g, v, v.design);
  const pod = v.parts.find(p => p.id === 'pod_k1'), cryo = v.parts.find(p => p.id === 'cryo');
  ok(pod.crew.length === 1 && cryo.crew.length === 3, `seated: ${pod.crew.length} in the capsule, ${cryo.crew.length} in the cryo pod`);
  const awake = crewById(g, pod.crew[0]), sleeper = crewById(g, cryo.crew[0]);
  crewAgeTick(g, [v], 0);
  const yr = 365.25 * DAY, dead = [];
  for (let y = 1; y <= 120; y++) dead.push(...crewAgeTick(g, [v], y * yr));
  ok(dead.includes(awake) && awake.status === 'kia' && pod.crew.length === 0, `awake: died of old age at ${Math.floor(crewAge(awake))}`);
  ok(sleeper.status === 'flight' && crewAge(sleeper) < 32, `asleep for 120 years (RTG power): aged to ${crewAge(sleeper).toFixed(1)}`);
  ok(!hasControl(v), 'sleepers cannot fly the ship');
}
// ---- 8. open space: 4 light-years out, slow physics only works in a frame of its own
{
  const { physicsStep, PHYS_DT, voidEnter, voidLeave, voidStarDist, predictTrajectory: pt } = G;
  const mkFar = () => { const v = buildVessel(makeDesign('Д', ['probe_p1', 'tank_t1l', 'eng_terrier']), 'Д'); v.body = BODY.sun; v.r = V.scale(V.norm(BODY.acena.pos), 4e16); v.v = [1, 0, 0]; v.q = [0, 0, 0, 1]; v.w = [0, 0, 0]; v.loaded = true; return v; };
  const run = (v) => { const p0 = V.add(v.r, v.body.void ? v.body.el.r0 : [0, 0, 0]); for (let i = 0; i < 500; i++) physicsStep(v, PHYS_DT, i * PHYS_DT, {}, { event: () => {} }); return V.dist(V.add(v.r, v.body.void ? v.body.el.r0 : [0, 0, 0]), p0); };
  const a = mkFar(), moved0 = run(a);
  const b = mkFar(), vb = voidEnter(b), moved1 = run(b);
  ok(vb && b.body.void && Math.abs(moved1 - 10) < 0.01, `at 4.2 ly, 1 m/s for 10 s: ${moved0.toFixed(2)} m in the star's frame, ${moved1.toFixed(3)} m in an open-space frame`);
  ok(Math.abs(voidStarDist(b) - 4e16) < 1e3, 'open-space frame keeps the true distance to the star');
  const tr = pt(b.body, b.r, [3e5, 0, 0], 0, { maxPatches: 2 });
  ok(tr[0].el.lin && tr[0].end === 'exit' && tr[1].body === BODY.sun, `straight line, then back to the Sun's frame: ${tr.map(x => x.body.id.replace(/\d+/, '') + ':' + x.end).join(' ')}`);
  voidLeave(b);
  ok(b.body === BODY.sun && Math.abs(V.len(b.r) - 4e16) < 1e3, 'leaving the frame restores the star-frame position');
}
// ---- 9. science fiction: a photon rocket cannot outrun light, and its clock runs slow
{
  const { setSciFi, SCIFI, lorentz, relAdd, C_LIGHT, LY, LY: ly } = G;
  setSciFi(true);
  ok(SCIFI.on && !!PART.eng_photon && PART.eng_photon.scifi, 'science-fiction mode on; photon drive defined');
  // relativistic addition: 0.9c + 0.9c (in the ship frame) = 0.9945c
  const u = relAdd([0.9 * C_LIGHT, 0, 0], [0.9 * C_LIGHT, 0, 0]);
  ok(Math.abs(u[0] / C_LIGHT - 1.8 / 1.81) < 1e-9, `0.9c ⊕ 0.9c = ${(u[0] / C_LIGHT).toFixed(4)}c`);
  ok(Math.abs(LY - 9.4607e14) / LY < 1e-3, `game light-year ${LY.toExponential(4)} m = scaled real one`);
  const v = buildVessel(makeDesign('Ф', [{ id: 'pod_k3', r: [] }, 'reactor', 'tank_am', 'tank_am', 'eng_photon']), 'Ф');
  v.body = BODY.sun; v.r = V.scale(V.norm(BODY.acena.pos), 60 * AU * SCALE_L); v.v = [0, 0, 0]; v.q = Q.fromTo([0, 1, 0], V.norm(v.r)); v.w = [0, 0, 0];
  for (const p of v.parts) if (p.st.eng) p.st.eng.on = true;
  v.sas = true; v.sasMode = 'stab'; v.throttle = 1; v.loaded = true; enterRails(v, 0);
  const m0 = massProps(v).m;
  let t = 0, ev = null, it = 0;
  while (!ev && it++ < 3000) { const r = railsPoweredAdvance(v, t, t + 1e7, 2000); t = r.t; ev = r.event; }
  const beta = V.len(v.v) / C_LIGHT, ideal = Math.tanh(Math.log(m0 / massProps(v).m));   // photon rocket: rapidity = ln(m0/m1)
  ok(ev === 'burnout' && beta < 1 && Math.abs(beta - ideal) < 0.01, `photon rocket: ${beta.toFixed(4)}c (relativistic rocket equation ${ideal.toFixed(4)}c), γ ${lorentz(v.v).toFixed(2)}`);
  // warp: 300c from 60 AU towards α Centauri drops out at its sphere of influence, exotic at k f^2 per second
  const { warpAdvance, warpWhyNot } = G;
  const w = buildVessel(makeDesign('В', [{ id: 'pod_k3', r: [] }, 'reactor', 'reactor', 'tank_exotic', 'warp_core']), 'В');
  w.body = BODY.sun; w.r = V.scale(V.norm(BODY.acena.pos), 60 * AU * SCALE_L); w.v = [0, 0, 0]; w.q = Q.fromTo([0, 1, 0], V.norm(V.sub(BODY.acena.pos, w.r))); w.w = [0, 0, 0];
  w.sas = true; w.sasMode = 'stab'; w.warpF = 300; w.loaded = true;
  ok(warpWhyNot(w) === null, 'warp allowed out at 60 AU');
  const ex0 = vesselRes(w, 'EXOTIC');
  let wt = 0, we = null, wi = 0;
  while (!we && wi++ < 100) { const r = warpAdvance(w, wt, wt + 1e6); wt = r.t; we = r.event; }
  if (we !== 'arrive') console.log('   warp ended with', we, 'body', w.body.id);
  const flown = V.dist(BODY.acena.pos, V.scale(V.norm(BODY.acena.pos), 60 * AU * SCALE_L)) - BODY.acena.soi;
  ok(we === 'arrive' && w.body === BODY.acena && Math.abs(wt - flown / (300 * C_LIGHT)) / wt < 0.01, `dropped out at α Centauri's sphere after ${(wt / (365.25 * DAY) * 365).toFixed(1)} days (light: ${(flown / LY).toFixed(2)} ly)`);
  ok(Math.abs((ex0 - vesselRes(w, 'EXOTIC')) - PART.warp_core.warp.k * 9e4 * wt) < 1e-6, `exotic used ${(ex0 - vesselRes(w, 'EXOTIC')).toFixed(2)} t`);
  const pl = buildVessel(makeDesign('П2', ['probe_p1', 'tank_exotic', 'warp_core']), 'П2'); pl.body = BODY.earth; pl.r = [BODY.earth.R + 2e5, 0, 0]; pl.v = [0, 2e3, 0];
  ok(/сферы влияния/.test(warpWhyNot(pl) || ''), 'no warp inside a planet\'s sphere of influence');
  // black hole horizon scales like every radius; a wormhole sends a ship to the other mouth, physics or rails
  ok(Math.abs(BODY.sgra.R - 2 * BODY.sgra.mu / (C_LIGHT * C_LIGHT)) < 1 && Math.abs(BODY.sgra.R / 1.269e9 - 1) < 0.01, `Sagittarius A* horizon ${(BODY.sgra.R / 1e9).toFixed(3)} Gm (real 12.7 Gm, scaled 1:10)`);
  ok(Math.abs(BODY.sgra_s2.el.T / (365.25 * DAY) - 16.05) < 0.2, `S2 goes round Sgr A* in ${(BODY.sgra_s2.el.T / (365.25 * DAY)).toFixed(2)} yr (real 16.05)`);
  const { physicsStep, PHYS_DT, railsAdvance } = G;
  const wv = buildVessel(makeDesign('Ч', ['probe_p1', 'tank_t1l', 'eng_terrier']), 'Ч'), A1 = BODY.wh_ariadne;
  wv.body = A1; wv.r = [A1.R * 3, 0, 0]; wv.v = [-2000, 0, 0]; wv.q = [0, 0, 0, 1]; wv.w = [0, 0, 0]; wv.loaded = true;
  for (let i = 0; i < 400 && wv.body === A1; i++) { physicsStep(wv, PHYS_DT, i * PHYS_DT, {}, { event: () => {} }); G.checkSOI(wv, i * PHYS_DT); }
  ok(wv.body === BODY.wh_ariadne2 && wv.body.sys === BODY.trappist && V.dot(wv.r, wv.v) > 0, `through «Ариадна»: now at ${wv.body.name}, heading out`);
  const wr = buildVessel(makeDesign('Ч2', ['probe_p1']), 'Ч2');
  wr.body = A1; wr.r = [A1.R * 400, 30, 0]; wr.v = [-3000, 0, 0]; enterRails(wr, 0);
  const rr = railsAdvance(wr, 0, 1e4);
  ok(rr.event === 'soi' && wr.body === BODY.wh_ariadne2, `on rails too: ${wr.body.name} after ${rr.t.toFixed(0)} s`);
  // a base makes exotic matter from reactor power, and only from generators
  const { produceExotic } = G;
  const base = buildVessel(makeDesign('Б', ['probe_p1', 'reactor', 'reactor', 'reactor', 'reactor', 'exotic_synth', 'tank_exotic']), 'Б');
  for (const p of base.parts) if (p.res.EXOTIC != null) p.res.EXOTIC = 0;
  base.body = BODY.earth; base.r = [BODY.earth.R + 3e5, 0, 0]; base.v = [0, 2e3, 0];
  produceExotic(base, 3600);
  ok(Math.abs(vesselRes(base, 'EXOTIC') / (2e-5 * 3600) - 1) < 0.005, `synthesizer: ${vesselRes(base, 'EXOTIC').toFixed(3)} t of exotic matter in an hour on 120 el/s`);
  const weak = buildVessel(makeDesign('Б2', ['probe_p1', 'reactor', 'exotic_synth', 'tank_exotic']), 'Б2');
  for (const p of weak.parts) if (p.res.EXOTIC != null) p.res.EXOTIC = 0;
  produceExotic(weak, 3600);
  ok(Math.abs(vesselRes(weak, 'EXOTIC') / (2e-5 * 3600 * 30 / 120) - 1) < 0.005, 'one reactor: a quarter of the rate (the probe core takes its share)');
  setSciFi(false);
  ok(!BODY.photon && !SCIFI.on, 'back to the realistic mode');
}
console.log(fails ? `${fails} FAILED` : 'ALL OK');
