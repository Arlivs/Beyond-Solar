const G = require('./load')(['math.js', 'orbit.js', 'bodies.js', 'terrain.js', 'parts.js', 'vessel.js', 'physics.js']);
const { V, Q, BODY, PART, stockDesigns, buildVessel, placeOnPad, physicsStep, activateStage, massProps, elFromState, checkSOI, PHYS_DT, fmtDist, simulateStages } = G;
const name = process.argv[2] || 'Орбитер-1';
const d = stockDesigns().find(x => x.name === name);
const v = buildVessel(d);
let ut = 0;
placeOnPad(v, ut);
const events = [];
const hooks = { event: (t, x) => { if (t !== 'stage') events.push(`[${ut.toFixed(1)}s] ${t} ${x && x.part ? PART[x.part.id].name : ''} ${x && x.why ? x.why : ''}`); } };
const E = BODY.earth;
const up = () => V.norm(v.r);
const east = () => V.norm(V.cross([0, 0, 1], up()));
const alt = () => V.len(v.r) - v.body.R;
const orb = () => elFromState(v.r, v.v, v.body.mu, ut);
let phase = 'ascent', maxQ = 0, maxT = 0, maxFlux = 0, log = [];
v.throttle = 1; v.sas = true; v.sasMode = 'target';
activateStage(v, ut, hooks);
const anyRunning = () => v.parts.some(p => !p.dead && p.st.eng && p.st.eng.on && !p.st.eng.out);
const T_END = +process.argv[3] || 4000;
let lastPrint = -1e9, circStart = null;
for (let step = 0; ut < T_END && !v.destroyed; step++) {
  const a = alt(), el = orb();
  const tAp = (() => { if (el.e >= 1) return 0; const M = el.M0 + el.n * (ut - el.t0); let dM = Math.PI - ((M % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI); if (dM < 0) dM += 2*Math.PI; return dM / el.n; })();
  if (phase === 'ascent') {
    const k = Math.min(1, Math.max(0, (a - 800) / 45000));
    const elev = (90 - 88 * Math.pow(k, 0.55)) * Math.PI / 180;
    v.targetDir = V.add(V.scale(up(), Math.sin(elev)), V.scale(east(), Math.cos(elev)));
    if (el.ra - E.R > 82000) { v.throttle = 0; phase = 'coast'; }
  } else if (phase === 'coast') {
    v.sasMode = 'pro';
    if (a > E.atm.top && tAp < 35) { v.throttle = 1; phase = 'circ'; }
  } else if (phase === 'circ') {
    v.sasMode = 'pro';
    if (el.rp - E.R > 74000 || el.e < 0.002) { v.throttle = 0; phase = 'orbit'; log.push(`ORBIT at ${ut.toFixed(0)} s: Ap ${fmtDist(el.ra - E.R)} Pe ${fmtDist(el.rp - E.R)}`); circStart = ut; }
  } else if (phase === 'orbit') {
    // coast a while then deorbit
    if (ut - circStart > 300) { phase = 'deorbit'; v.sasMode = 'retro'; }
  } else if (phase === 'deorbit') {
    v.sasMode = 'retro';
    const fwd = Q.rot(v.q, [0, 1, 0]);
    if (V.dot(fwd, V.norm(V.neg(v.v))) > 0.98) v.throttle = 1;
    if (el.rp - E.R < 25000) { v.throttle = 0; phase = 'reentry'; log.push(`deorbit done t=${ut.toFixed(0)} Pe ${fmtDist(el.rp - E.R)}`); }
  } else if (phase === 'reentry') {
    // drop everything but the capsule (+shield) then point retrograde, arm chutes
    if (v.stageIdx < v.stages.length - 1) activateStage(v, ut, hooks);
    v.sasMode = 'retro';
    if (a < 30000 && v.stageIdx < v.stages.length) activateStage(v, ut, hooks);
  }
  if (v.throttle > 0 && !anyRunning() && v.stageIdx < v.stages.length && (phase === 'ascent' || phase === 'circ' || phase === 'deorbit')) activateStage(v, ut, hooks);
  // ascent: drop empty booster stages promptly
  if (phase === 'ascent' && !anyRunning() && v.stageIdx < v.stages.length) activateStage(v, ut, hooks);
  const ctl = {};
  physicsStep(v, PHYS_DT, ut, ctl, hooks);
  checkSOI(v, ut);
  ut += PHYS_DT;
  maxQ = Math.max(maxQ, v.dynP || 0); maxFlux = Math.max(maxFlux, v.heatFlux || 0);
  for (const p of v.parts) if (!p.dead) maxT = Math.max(maxT, p.T);
  if (ut - lastPrint >= 20) { lastPrint = ut; const sp = V.len(V.sub(v.v, V.cross([0,0,2*Math.PI/E.rotPeriod], v.r))); log.push(`t=${ut.toFixed(0).padStart(5)} ${phase.padEnd(7)} alt ${fmtDist(a).padStart(9)} vSurf ${sp.toFixed(0).padStart(5)} vOrb ${V.len(v.v).toFixed(0).padStart(5)} Ap ${fmtDist(el.ra - E.R).padStart(9)} Pe ${fmtDist(el.rp - E.R).padStart(10)} thr ${v.throttle} stg ${v.stageIdx} m ${(massProps(v).m/1000).toFixed(2)}t q ${(v.dynP/1000||0).toFixed(1)}kPa flux ${((v.heatFlux||0)/1e3).toFixed(0)}kW Tmax ${Math.max(...v.parts.filter(p=>!p.dead).map(p=>p.T)).toFixed(0)}K ${v.situation}`); }
  if (v.landed && phase === 'reentry') { log.push(`LANDED at t=${ut.toFixed(0)}`); break; }
}
console.log(log.join('\n'));
console.log(events.join('\n'));
const sh = v.parts.find(p => !p.dead && PART[p.id].shield);
console.log(`maxQ ${(maxQ/1000).toFixed(1)} kPa, max flux ${(maxFlux/1e6).toFixed(3)} MW/m2, max part T ${maxT.toFixed(0)} K, ablator left ${sh ? sh.res.ABLATOR.toFixed(3) : 'n/a'}, destroyed=${!!v.destroyed} ${v.destroyCause||''}`);
