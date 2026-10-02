'use strict';
// EVA: an astronaut outside is a one-part vessel ("kerbal" part). Gravity, contact and drag come from the
// normal physics step; on top of it the suit is driven kinematically: walking keeps the feet on the ground
// and the body upright, the jetpack accelerates along camera-relative directions on a small propellant budget.

const EVA = { walk: 1.7, jump: 3.0, jetAcc: 2.2, fuel: 6, dvPerUnit: 20, board: 2.5, turn: 6 };   // jetpack lifts off the Moon, not Earth/Mars

function isKerbalVessel(v) { const p = v && v.parts.find(x => !x.dead); return !!(p && PART[p.id].kerbal); }
function kerbalPart(v) { return v.parts.find(x => !x.dead && PART[x.id].kerbal) || null; }

// hatch of a crew pod, vessel axes (the hatch sits on the pod's +X side, a little below the middle)
function hatchLocal(p) { const d = PART[p.id]; return partPt(p, [(d.dTop + d.dBot) / 4 + 0.35, -0.08 * d.h, 0]); }
function hatchWorld(v, p) { const mp = massProps(v); return V.add(v.r, Q.rot(v.q, V.sub(hatchLocal(p), mp.com))); }
function podSeats(p) { const c = PART[p.id].command; return c && !PART[p.id].kerbal ? c.crew : 0; }
function podFree(p) { return podSeats(p) - (p.crew ? p.crew.length : podSeats(p)); }

// nearest pod with a free seat whose hatch is within reach of the astronaut
function nearestHatch(vessels, k) {
  let best = null;
  for (const v of vessels) {
    if (v === k || v.destroyed || v.body !== k.body || isKerbalVessel(v)) continue;
    if (V.dist(v.r, k.r) > 60) continue;
    for (const p of v.parts) {
      if (p.dead || podFree(p) <= 0) continue;
      const d = V.dist(hatchWorld(v, p), k.r);
      if (d < EVA.board && (!best || d < best.d)) best = { d, vessel: v, part: p };
    }
  }
  return best;
}

// orientation with +Y = up and +Z = facing (the visor), slerped from the current one
function evaFace(v, up, face, k) {
  const z = V.norm(V.reject(face, up));
  if (V.len(z) < 1e-6) return;
  const x = V.cross(up, z);
  const target = Q.fromBasis(x, up, z);
  let q = v.q;
  if (q[0] * target[0] + q[1] * target[1] + q[2] * target[2] + q[3] * target[3] < 0) q = q.map(c => -c);
  v.q = Q.norm(q.map((c, i) => c + (target[i] - c) * k));
  v.w = [0, 0, 0];
}

// inp: { fwd, right, up: camera unit vectors (world); mx, mz, my: move -1..1 (right, forward, up); jump, jet }
// returns the jetpack acceleration used this step (m/s^2) for effects
function evaStep(v, inp, dt) {
  const p = kerbalPart(v); if (!p) return 0;
  const b = v.body, upL = V.norm(v.r);
  const st = p.st;
  if (st.evaFuel == null) st.evaFuel = EVA.fuel;
  const moving = Math.abs(inp.mx) + Math.abs(inp.mz) + Math.abs(inp.my) > 0.01;
  const grounded = (v.inContact || v.lock) && !b.gas;
  if (v.lock && (moving || inp.jump || inp.jet && inp.my > 0)) unlock(v);
  let jet = 0;
  if (grounded && !(inp.jet && inp.my > 0)) {
    // walking: drive the velocity along the ground towards the wanted one, keep the vertical part
    const fwdH = V.norm(V.reject(inp.fwd, upL)), rightH = V.cross(fwdH, upL);
    let want = V.add(V.scale(fwdH, inp.mz), V.scale(rightH, inp.mx));
    const wl = V.len(want);
    const spd = EVA.walk * clamp(Math.pow(b.g0 / 9.8, 0.25), 0.55, 1);
    want = wl > 1e-6 ? V.scale(want, spd / Math.max(1, wl)) : [0, 0, 0];
    if (!v.lock) {
      const vg = V.cross(bodyOmega(b), v.r), rel = V.sub(v.v, vg);
      const vn = V.dot(rel, upL), vt = V.reject(rel, upL);
      const vt2 = V.add(vt, V.scale(V.sub(want, vt), 1 - Math.exp(-dt * 7)));
      v.v = V.add(vg, V.add(V.scale(upL, vn), vt2));
      if (inp.jump && vn < 0.5) v.v = V.addS(v.v, upL, EVA.jump * clamp(Math.pow(b.g0 / 9.8, 0.15), 0.7, 1));   // legs push about the same anywhere
    }
    evaFace(v, upL, wl > 1e-6 ? want : Q.rot(v.q, [0, 0, 1]), 1 - Math.exp(-dt * EVA.turn));
    st.walk = V.len(want);
  } else {
    st.walk = 0;
    if (inp.jet && st.evaFuel > 0 && moving) {
      let a = V.add(V.add(V.scale(inp.right, inp.mx), V.scale(inp.fwd, inp.mz)), V.scale(inp.up, inp.my));
      const al = V.len(a);
      if (al > 1) a = V.scale(a, 1 / al);
      jet = EVA.jetAcc * Math.min(1, al);
      v.v = V.addS(v.v, a, EVA.jetAcc * dt);
      st.evaFuel = Math.max(0, st.evaFuel - jet * dt / EVA.dvPerUnit);
    }
    // floating: face where the camera looks, head towards camera-up; near the ground stay upright
    const near = !b.gas && v.radarAlt != null && v.radarAlt < 6;
    const up = near ? upL : inp.up;
    evaFace(v, up, inp.fwd, 1 - Math.exp(-dt * EVA.turn * 0.5));
  }
  st.jet = jet;
  return jet;
}
