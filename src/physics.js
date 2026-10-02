'use strict';
// Flight physics. A vessel is a rigid body; state is relative to its SOI body:
//   v.r, v.v  centre-of-mass position / velocity (inertial axes, m, m/s)
//   v.q       local -> world rotation (local +Y = nose, +X = right, +Z = "top")
//   v.w       angular velocity in local axes (rad/s)
// Forces: point-mass gravity of the SOI body, engines (pressure-dependent Isp),
// per-part aerodynamic drag in co-rotating air (gives real CoP/CoM stability),
// fin normal forces, parachutes, re-entry heating, spring-damper ground contact.

const PHYS_DT = 0.02;
const HEAT_K = 4.2e-3;          // convective heating constant (tuned for 1:10 velocities)
const ABLATE_J = 8e9;           // J absorbed per tonne of ablator
const SIGMA = 5.670e-8;
const SKIN = 0.25;               // fraction of dry mass that heats as skin

// ---- aero / contact geometry (recomputed on topology change) ----
function vesselGeometry(v) {
  const cols = new Map();
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    if (d.attach !== 'stack') continue;
    const key = Math.round(p.pos[0] * 20) + ',' + Math.round(p.pos[2] * 20);
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push(p);
  }
  const front = new Map(), back = new Map(); // rid -> CdA exposed
  for (const list of cols.values()) {
    list.sort((a, b) => b.pos[1] - a.pos[1]);
    for (let i = 0; i < list.length; i++) {
      const d = PART[list[i].id];
      const above = i > 0 ? PART[list[i - 1].id].dBot : 0;
      const below = i < list.length - 1 ? PART[list[i + 1].id].dTop : 0;
      const aTop = Math.max(0, d.dTop * d.dTop - above * above) * Math.PI / 4;
      const aBot = Math.max(0, d.dBot * d.dBot - below * below) * Math.PI / 4;
      const cdTop = i === 0 ? (d.nose != null ? d.nose : 0.9) : 0.7;
      const cdBot = d.shield ? 1.3 : d.engine ? 0.6 : d.shape === 'pod' ? 0.9 : 0.9;
      if (aTop > 0) front.set(list[i].rid, aTop * cdTop);
      if (aBot > 0) back.set(list[i].rid, aBot * cdBot);
    }
  }
  const g = { front, back, frontSum: 0, backSum: 0, side: [], fins: [], contacts: [] };
  for (const x of front.values()) g.frontSum += x;
  for (const x of back.values()) g.backSum += x;
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    if (d.fin) {
      const dir = p.dir || [1, 0, 0];
      g.fins.push({ rid: p.rid, n: [dir[2], 0, -dir[0]], area: d.fin.area });
    }
    let side;
    if (d.attach === 'stack') side = 0.55 * (d.dTop + d.dBot) / 2 * d.h;
    else side = 0.6 * (d.w || 0.2) * d.h;
    const fr = d.attach === 'stack' ? 0 : 0.6 * (d.w || 0.2) * (d.depth || 0.2);
    g.side.push({ rid: p.rid, cda: side, fr });
    // contact points
    if (d.attach === 'stack') {
      const rt = Math.max(d.dTop / 2, 0.05), rb = Math.max(d.dBot / 2, 0.05);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
        g.contacts.push({ rid: p.rid, pt: [p.pos[0] + c * rb, p.pos[1] - d.h / 2, p.pos[2] + s * rb] });
        g.contacts.push({ rid: p.rid, pt: [p.pos[0] + c * rt, p.pos[1] + d.h / 2, p.pos[2] + s * rt] });
      }
    } else if (p.dir) {
      const o = V.scale(p.dir, (d.depth || 0.2) / 2);
      g.contacts.push({ rid: p.rid, pt: [p.pos[0] + o[0], p.pos[1] - d.h / 2, p.pos[2] + o[2]] });
      g.contacts.push({ rid: p.rid, pt: [p.pos[0] + o[0], p.pos[1] + d.h / 2, p.pos[2] + o[2]] });
    }
  }
  v.geo = g;
  return g;
}

function legFoot(p) {
  const d = PART[p.id];
  const L = d.legs.len;
  return [p.pos[0] + p.dir[0] * (d.depth / 2 + L * 0.45), p.pos[1] - d.h / 2 - L * 0.8, p.pos[2] + p.dir[2] * (d.depth / 2 + L * 0.45)];
}

// ---- resources ----
function poolTotal(v, rids, key) { let s = 0; for (const r of rids) { const p = v.parts[r]; if (!p.dead) s += p.res[key] || 0; } return s; }
function poolDraw(v, rids, key, amount) {
  if (amount <= 0) return 0;
  const tot = poolTotal(v, rids, key);
  if (tot <= 0) return 0;
  const take = Math.min(amount, tot), f = take / tot;
  for (const r of rids) { const p = v.parts[r]; if (!p.dead && p.res[key]) { p.res[key] -= p.res[key] * f; if (p.res[key] < 1e-9) p.res[key] = 0; } }
  v.massDirty = true;
  return take;
}
function allRids(v) { return v._all || (v._all = v.parts.filter(p => !p.dead).map(p => p.rid)); }
function vesselRes(v, key) { return poolTotal(v, allRids(v), key); }
function vesselResMax(v, key) { let s = 0; for (const p of v.parts) if (!p.dead) s += PART[p.id].res[key] || 0; return s; }
function engineSources(v, p) {
  const e = PART[p.id].engine;
  if (e.prop === 'SOLID') return [p.rid];
  if (e.prop === 'XENON') return allRids(v);
  const dm = v.domain[p.rid];
  return dm >= 0 ? v.domains[dm] : [];
}

// ---- control authority ----
function hasControl(v) {
  for (const p of v.parts) {
    if (p.dead) continue;
    const c = PART[p.id].command;
    if (!c) continue;
    if (c.crew > 0) return true;
    if (vesselRes(v, 'ELEC') > 0.01) return true;
  }
  return false;
}
function isCrewed(v) { return v.parts.some(p => !p.dead && PART[p.id].command && PART[p.id].command.crew > 0); }

function torqueAuthority(v, mp, thrusts) {
  const T = [0, 0, 0];
  const ec = vesselRes(v, 'ELEC') > 0.01;
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    const tq = (d.command && d.command.torque) || (d.wheel && d.wheel.torque) || 0;
    if (tq && ec) { T[0] += tq * 1000; T[1] += tq * 1000; T[2] += tq * 1000; }
    if (d.rcs && v.rcs && vesselRes(v, 'MONO') > 0) {
      const dy = Math.abs(p.pos[1] - mp.com[1]), rr = Math.hypot(p.pos[0] - mp.com[0], p.pos[2] - mp.com[2]);
      const f = d.rcs.thrust * 1000;
      T[0] += f * (dy + 0.3); T[2] += f * (dy + 0.3); T[1] += f * rr;
    }
  }
  if (thrusts) for (const [p, F] of thrusts) {
    const g = PART[p.id].engine.gimbal;
    if (!g || F <= 0) continue;
    const dy = Math.abs(p.pos[1] - mp.com[1]), rr = Math.hypot(p.pos[0] - mp.com[0], p.pos[2] - mp.com[2]);
    const s = Math.sin(g * DEG) * F;
    T[0] += s * dy; T[2] += s * dy; T[1] += s * rr;
  }
  return T;
}

// ---- SAS ----
function sasTargetDir(v, mode, ut) {
  const b = v.body;
  const surfMode = navSpeedMode(v) === 'surface';
  const vel = surfMode ? V.sub(v.v, V.cross(bodyOmega(b), v.r)) : v.v;
  if (V.len(vel) < 0.05 && mode !== 'stab' && mode !== 'node' && mode !== 'radout' && mode !== 'radin') return null;
  const pro = V.norm(vel), nrm = V.norm(V.cross(v.r, vel)), rad = V.cross(pro, nrm);
  switch (mode) {
    case 'pro': return pro;
    case 'retro': return V.neg(pro);
    case 'normal': return nrm;
    case 'anti': return V.neg(nrm);
    case 'radout': return V.len(vel) > 0.05 ? rad : V.norm(v.r);
    case 'radin': return V.len(vel) > 0.05 ? V.neg(rad) : V.neg(V.norm(v.r));
    case 'node': return v.nodeBurn && V.len(v.nodeBurn) > 1e-3 ? V.norm(v.nodeBurn) : null;
    case 'target': return v.targetDir || null;
  }
  return null;
}

function sasControl(v, mp, auth, ut) {
  const I = mp.I;
  let e = [0, 0, 0];
  let holdRoll = false;
  if (v.sasMode === 'stab' || !v.sasMode) {
    if (!v.sasHold) v.sasHold = v.q.slice();
    const qe = Q.mul(Q.conj(v.q), v.sasHold);
    const s = qe[3] < 0 ? -1 : 1;
    const vl = Math.hypot(qe[0], qe[1], qe[2]);
    const ang = 2 * Math.atan2(vl, Math.abs(qe[3]));
    if (vl > 1e-9) e = [qe[0] * s / vl * ang, qe[1] * s / vl * ang, qe[2] * s / vl * ang];
    holdRoll = true;
  } else {
    const d = sasTargetDir(v, v.sasMode, ut);
    if (!d) { v.sasHold = null; return [-v.w[0] * 4, -v.w[1] * 4, -v.w[2] * 4].map((x, i) => clamp(x * I[i] / Math.max(auth[i], 1), -1, 1)); }
    const dl = Q.invRot(v.q, d);
    const ax = [dl[2], 0, -dl[0]];
    const al = Math.hypot(ax[0], ax[2]);
    const ang = Math.acos(clamp(dl[1], -1, 1));
    if (al > 1e-9) e = [ax[0] / al * ang, 0, ax[2] / al * ang];
    else if (dl[1] < 0) e = [Math.PI, 0, 0];
  }
  const u = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (i === 1 && !holdRoll) { u[i] = clamp(-v.w[1] * I[1] / 0.3 / Math.max(auth[1], 1), -1, 1); continue; }
    const alpha = Math.max(auth[i] / I[i], 1e-4);
    const ei = e[i];
    let wd = Math.sign(ei) * Math.min(Math.sqrt(2 * alpha * Math.abs(ei) * 0.5), 1.8 * Math.abs(ei), 0.6);
    const tq = I[i] * (wd - v.w[i]) / 0.18;
    u[i] = clamp(tq / Math.max(auth[i], 1), -1, 1);
  }
  return u;
}

// navball speed reference: surface inside the lower part of the SOI, orbit above
function navSpeedMode(v) {
  if (v.speedMode && v.speedMode !== 'auto') return v.speedMode;
  const b = v.body, alt = V.len(v.r) - b.R;
  const lim = b.atm ? b.atm.top * 0.5 : Math.min(b.R * 0.05, 30000);
  return alt < lim ? 'surface' : 'orbit';
}

// ---- landed lock ----
function lockLanded(v, ut) {
  const b = v.body;
  v.lock = { pf: inertialToBodyFixed(b, ut, v.r), qf: Q.mul(Q.conj(bodyRotQuat(b, ut)), v.q) };
  v.w = [0, 0, 0];
  v.landed = true;
}
function applyLock(v, ut) {
  const b = v.body;
  v.r = bodyFixedToInertial(b, ut, v.lock.pf);
  v.v = V.cross(bodyOmega(b), v.r);
  v.q = Q.norm(Q.mul(bodyRotQuat(b, ut), v.lock.qf));
}
function unlock(v) { v.lock = null; v.landed = false; v.restT = 0; }

// shift CoM bookkeeping after mass changes so the hull does not jump
function recenter(v) {
  const prev = v._comPrev;
  const mp = massProps(v);
  if (prev) {
    const dl = V.sub(mp.com, prev);
    if (V.len2(dl) > 1e-12) {
      const dw = Q.rot(v.q, dl);
      v.r = V.add(v.r, dw);
      if (v.lock) v.lock.pf = V.add(v.lock.pf, Q.rot(Q.conj(bodyRotQuat(v.body, v._ut || 0)), dw));
    }
  }
  v._comPrev = mp.com.slice();
  return mp;
}

// ---- main step ----
// ctl: {pitch, yaw, roll, tx, ty, tz} each -1..1. hooks.event(type, data)
function physicsStep(v, dt, ut, ctl, hooks) {
  v._ut = ut;
  const b = v.body;
  if (v.massDirty || !v._mp) recenter(v);
  const mp = massProps(v);
  const m = mp.m;
  if (!v.geo) vesselGeometry(v);
  const g = v.geo;

  const rLen = V.len(v.r);
  const alt = rLen - b.R;
  const atm = atmAt(b, alt);
  const omegaB = bodyOmega(b);
  const vAir = V.sub(v.v, V.cross(omegaB, v.r));
  const control = hasControl(v);

  // locked on the ground: wait for thrust
  if (v.lock) {
    applyLock(v, ut);
    if (!v.prelaunchHold && thrustWanted(v)) unlock(v);
    else { tickResources(v, dt, ut, false, null, mp); v.situation = v.prelaunch ? 'PRELAUNCH' : 'LANDED'; return; }
  }

  let F = [0, 0, 0];
  const tau = [0, 0, 0];
  const qInv = Q.conj(v.q);

  // engines
  const thrusts = [];
  let thrustTotal = 0;
  for (const p of v.parts) {
    if (p.dead || !p.st.eng || !p.st.eng.on) continue;
    const d = PART[p.id], e = d.engine;
    const thr = e.throttle ? (control ? v.throttle : 0) : 1;
    p.st.eng.thr = 0;
    if (thr <= 0) continue;
    const md = engineMdot(e) * thr;
    const need = md * dt / 1000;
    const key = e.prop;
    const got = poolDraw(v, engineSources(v, p), key, need);
    let f = need > 0 ? got / need : 0;
    if (e.elec) {
      const en = e.elec * thr * dt, eg = poolDraw(v, allRids(v), 'ELEC', en);
      f = Math.min(f, en > 0 ? eg / en : 0);
    }
    if (f < 1e-4) { if (!p.st.eng.out) { p.st.eng.out = true; hooks && hooks.event && hooks.event('flameout', { part: p }); } continue; }
    p.st.eng.out = false;
    const Fn = md * engineIsp(e, atm.p) * G0 * f;
    p.st.eng.thr = thr * f;
    thrusts.push([p, Fn]);
    thrustTotal += Fn;
    // thrust along local +Y through engine position
    const arm = V.sub(p.pos, mp.com);
    const Fl = [0, Fn, 0];
    const tq = V.cross(arm, Fl);
    tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2];
  }
  if (thrustTotal > 0) F = V.add(F, Q.rot(v.q, [0, thrustTotal, 0]));
  v.thrustNow = thrustTotal;

  // attitude control
  const auth = torqueAuthority(v, mp, thrusts);
  v.auth = auth;
  let u = [0, 0, 0];
  if (control) {
    const inp = [-(ctl.pitch || 0), ctl.roll || 0, -(ctl.yaw || 0)];
    const anyInput = inp.some(x => Math.abs(x) > 0.01);
    if (v.sas) {
      if (anyInput && v.sasMode === 'stab') v.sasHold = null;
      u = sasControl(v, mp, auth, ut);
    }
    for (let i = 0; i < 3; i++) if (Math.abs(inp[i]) > 0.01) u[i] = inp[i];
    tau[0] += u[0] * auth[0]; tau[1] += u[1] * auth[1]; tau[2] += u[2] * auth[2];
    // RCS translation
    if (v.rcs && (ctl.tx || ctl.ty || ctl.tz)) {
      let n = 0; for (const p of v.parts) if (!p.dead && PART[p.id].rcs) n++;
      if (n) {
        const fmax = n * 1000;
        const need = fmax * (Math.abs(ctl.tx || 0) + Math.abs(ctl.ty || 0) + Math.abs(ctl.tz || 0)) / (240 * G0) * dt / 1000;
        const got = poolDraw(v, allRids(v), 'MONO', need);
        const f = need > 0 ? got / need : 0;
        F = V.add(F, Q.rot(v.q, [(ctl.tx || 0) * fmax * f, (ctl.ty || 0) * fmax * f, (ctl.tz || 0) * fmax * f]));
      }
    }
  }
  v.ctlOut = u;

  // aerodynamics
  let heatFlux = 0, dynP = 0;
  if (atm.rho > 0) {
    const ua = Q.rot(qInv, vAir); // air-relative velocity of CoM, local
    const sp = V.len(ua);
    dynP = 0.5 * atm.rho * sp * sp;
    if (sp > 0.01) {
      const rho = atm.rho;
      // axial
      const vy = ua[1];
      const cdaAx = vy > 0 ? g.frontSum + 0.15 * g.backSum : g.backSum + 0.15 * g.frontSum;
      const fAx = -0.5 * rho * cdaAx * Math.abs(vy) * vy;
      const Fl = [0, fAx, 0];
      // lateral per part
      for (const s of g.side) {
        const p = v.parts[s.rid];
        if (p.dead) continue;
        const arm = V.sub(p.pos, mp.com);
        const vp = V.add(ua, V.cross(v.w, arm));
        const vl = Math.hypot(vp[0], vp[2]);
        const k = -0.5 * rho * s.cda * vl;
        const f = [k * vp[0], -0.5 * rho * s.fr * Math.abs(vp[1]) * vp[1], k * vp[2]];
        Fl[0] += f[0]; Fl[1] += f[1]; Fl[2] += f[2];
        const tq = V.cross(arm, f); tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2];
      }
      for (const fn of g.fins) {
        const p = v.parts[fn.rid];
        if (p.dead) continue;
        const arm = V.sub(p.pos, mp.com);
        const vp = V.add(ua, V.cross(v.w, arm));
        const vn = V.dot(vp, fn.n);
        const k = -0.5 * rho * V.len(vp) * fn.area * 2.2 * vn;
        const f = V.scale(fn.n, k);
        Fl[0] += f[0]; Fl[1] += f[1]; Fl[2] += f[2];
        const tq = V.cross(arm, f); tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2];
      }
      // parachutes
      for (const p of v.parts) {
        if (p.dead || !p.st.chute) continue;
        const c = PART[p.id].chute;
        const stt = p.st.chute;
        if (stt === 'armed' && atm.p > c.minP && sp < c.safe) { p.st.chute = 'semi'; p.st.chuteT = 0; hooks && hooks.event && hooks.event('chute', { part: p, state: 'semi' }); }
        if (p.st.chute === 'semi' && (v.radarAlt != null ? v.radarAlt : alt) < c.deployAlt) { p.st.chute = 'full'; p.st.chuteT = 0; hooks && hooks.event && hooks.event('chute', { part: p, state: 'full' }); }
        if (p.st.chute === 'semi' || p.st.chute === 'full') {
          p.st.chuteT = Math.min(1, (p.st.chuteT || 0) + dt / (p.st.chute === 'full' ? 2.5 : 1.0));
          const target = p.st.chute === 'full' ? c.full : c.semi;
          const prev = p.st.chute === 'full' ? c.semi : 0;
          const cda = prev + (target - prev) * p.st.chuteT;
          const arm0 = V.sub(p.pos, mp.com);
          const vp = V.add(ua, V.cross(v.w, arm0));
          const vps = V.len(vp);
          if (vps > 0.01) {
            const dirFlow = V.scale(vp, 1 / vps);
            const arm = V.sub(arm0, V.scale(dirFlow, 4)); // canopy trails behind
            const f = V.scale(vp, -0.5 * rho * cda * vps);
            Fl[0] += f[0]; Fl[1] += f[1]; Fl[2] += f[2];
            const tq = V.cross(arm, f); tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2];
          }
          if (sp > c.safe * 1.6 && p.st.chute === 'full') { p.st.chute = 'cut'; hooks && hooks.event && hooks.event('chuteRip', { part: p }); }
        }
      }
      F = V.add(F, Q.rot(v.q, Fl));
      // heating
      heatFlux = HEAT_K * Math.sqrt(rho) * sp * sp * sp;
      applyHeating(v, dt, heatFlux, ua, sp, mp, hooks);
    }
  } else {
    // cool down in vacuum / parachutes in vacuum stay armed
    applyHeating(v, dt, 0, null, 0, mp, hooks);
  }
  v.heatFlux = heatFlux; v.dynP = dynP;

  // gravity
  const gAcc = V.scale(v.r, -b.mu / (rLen * rLen * rLen));

  // ground contact against the local terrain plane
  let contact = false;
  const bnd = v._bnd || (v._bnd = vesselBounds(v));
  v.radarAlt = alt;
  if (!b.gas && alt < b.hMax + bnd.size + 60) {
    const gnd = vesselGround(v, ut);
    v.radarAlt = alt - gnd.h;
    if (v.radarAlt < bnd.size + 50) contact = groundContact(v, dt, ut, mp, F, tau, hooks, gnd);
  }
  if (b.gas && alt < 0) { hooks && hooks.event && hooks.event('crushed', {}); destroyVessel(v, hooks, 'Раздавлен давлением атмосферы ' + b.name); return; }

  // integrate translation
  const acc = V.add(gAcc, V.scale(F, 1 / m));
  v.accel = V.len(V.scale(F, 1 / m)) / G0; // g-load from non-gravity forces
  v.v = V.addS(v.v, acc, dt);
  v.r = V.addS(v.r, v.v, dt);
  // integrate rotation (Euler's equations, diagonal inertia)
  const I = mp.I, w = v.w;
  const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
  const gyro = V.cross(w, Iw);
  v.w = [w[0] + (tau[0] - gyro[0]) / I[0] * dt, w[1] + (tau[1] - gyro[1]) / I[1] * dt, w[2] + (tau[2] - gyro[2]) / I[2] * dt];
  const wl = V.len(v.w);
  if (wl > 20) v.w = V.scale(v.w, 20 / wl);
  v.q = Q.integrate(v.q, v.w, dt);

  tickResources(v, dt, ut, true, u, mp);

  // landed detection
  if (contact) {
    const rel = V.len(V.sub(v.v, V.cross(omegaB, v.r)));
    if (rel < 0.4 && V.len(v.w) < 0.06 && !thrustWanted(v)) {
      v.restT = (v.restT || 0) + dt;
      if (v.restT > 1.0) {
        lockLanded(v, ut);
        for (const p of v.parts) if (!p.dead && (p.st.chute === 'full' || p.st.chute === 'semi')) p.st.chute = 'cut';
        hooks && hooks.event && hooks.event('landed', { body: b });
      }
    } else v.restT = 0;
  } else v.restT = 0;
  v.inContact = contact;
  v.situation = contact ? 'LANDED' : (alt < (b.atm ? b.atm.top : 0) ? 'FLYING' : 'SPACE');
}

function thrustWanted(v) {
  for (const p of v.parts) {
    if (p.dead || !p.st.eng || !p.st.eng.on || p.st.eng.out) continue;
    const e = PART[p.id].engine;
    if (!e.throttle || v.throttle > 0) return true;
  }
  return false;
}

// terrain under the vessel (cached ~10 cm of travel or 0.1 s)
function vesselGround(v, ut) {
  const g = v._gnd;
  if (g && g.body === v.body && Math.abs(ut - g.ut) < 0.1 && V.dist(inertialToBodyFixed(v.body, ut, v.r), g.pf) < 0.1) return g;
  const r = groundAt(v.body, ut, v.r);
  r.body = v.body; r.ut = ut; r.pf = inertialToBodyFixed(v.body, ut, v.r);
  v._gnd = r;
  return r;
}

function groundContact(v, dt, ut, mp, F, tau, hooks, gnd) {
  const b = v.body;
  const omegaB = bodyOmega(b);
  const m = mp.m;
  const kpt = m * Math.pow(TAU * 3, 2) / 4;
  const cpt = 2 * 0.9 * Math.sqrt(kpt * m / 4);
  const wWorld = Q.rot(v.q, v.w);
  const pts = [];
  for (const c of v.geo.contacts) pts.push([c.rid, c.pt, false]);
  for (const p of v.parts) if (!p.dead && p.st.legs) pts.push([p.rid, legFoot(p), true]);
  const prev = v._contactPrev || new Set();
  const now = new Set();
  let any = false;
  const Fadd = [0, 0, 0];
  const kill = new Set();
  for (const [rid, pt, isLeg] of pts) {
    if (v.parts[rid].dead) continue;
    const armL = V.sub(pt, mp.com);
    const armW = Q.rot(v.q, armL);
    const pw = V.add(v.r, armW);
    // distance below the terrain plane through the ground point under the vessel
    const pr = V.len(pw);
    const pg = V.scale(V.norm(v.r), b.R + gnd.h);
    const n = gnd.n;
    const pen = V.dot(V.sub(pg, pw), n);
    void pr;
    if (pen <= 0) continue;
    any = true;
    const key = rid + (isLeg ? 'L' : '') + ':' + pt[0].toFixed(2) + pt[1].toFixed(2) + pt[2].toFixed(2);
    now.add(key);
    const vpt = V.sub(V.add(v.v, V.cross(wWorld, armW)), V.cross(omegaB, pw));
    const vn = V.dot(vpt, n);
    if (!prev.has(key)) {
      const d = PART[v.parts[rid].id];
      const tol = (isLeg ? d.legs.crash : d.crash) * (gnd.water ? 1.6 : 1);
      if (-vn > tol) { kill.add(rid); continue; }
    }
    const k = isLeg ? kpt * 0.6 : kpt, c = (isLeg ? cpt * 1.3 : cpt) * (gnd.water ? 1.8 : 1);
    const fn = Math.max(0, k * pen - c * vn);
    const vt = V.sub(vpt, V.scale(n, vn));
    const vtl = V.len(vt);
    let f = V.scale(n, fn);
    if (vtl > 1e-4) {
      const ft = gnd.water ? m * 0.6 * vtl / 4 : Math.min(0.9 * fn, m * 2.5 * vtl / 4);
      f = V.addS(f, vt, -ft / vtl);
    }
    Fadd[0] += f[0]; Fadd[1] += f[1]; Fadd[2] += f[2];
    const tq = V.cross(armL, Q.rot(Q.conj(v.q), f));
    tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2];
  }
  F[0] += Fadd[0]; F[1] += Fadd[1]; F[2] += Fadd[2];
  v._contactPrev = now;
  v.splashed = any && gnd.water;
  if (kill.size) {
    for (const rid of kill) explodePart(v, rid, hooks, 'удар о поверхность');
  }
  return any;
}

function applyHeating(v, dt, flux, ua, sp, mp, hooks) {
  const g = v.geo;
  const fwd = ua ? ua[1] / Math.max(sp, 1e-6) : 0; // + nose-first, - tail-first
  const exposed = fwd >= 0 ? g.front : g.back;
  let burnt = null;
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    const kg = SKIN * d.mass * 1000 + 40; // thermal mass of the outer skin
    const areaSurf = d.attach === 'stack' ? Math.PI * (d.dTop + d.dBot) / 2 * d.h + 0.5 : 2 * (d.w || 0.2) * d.h + 0.2;
    let qin = 0;
    if (flux > 0) {
      const aFront = (exposed.get(p.rid) || 0) * Math.abs(fwd);
      const sideAmt = (d.attach === 'stack' ? (d.dTop + d.dBot) / 2 * d.h : (d.w || 0.2) * d.h) * 0.12 * Math.sqrt(Math.max(0, 1 - fwd * fwd));
      qin = flux * (aFront + sideAmt + (d.fin ? d.fin.area * 0.15 : 0));
      if (d.shield && (p.res.ABLATOR || 0) > 0 && aFront > 0) {
        const absorb = Math.min(qin * dt, p.res.ABLATOR * ABLATE_J);
        p.res.ABLATOR = Math.max(0, p.res.ABLATOR - absorb / ABLATE_J);
        qin -= absorb / dt * 0.97;
        v.massDirty = true;
      }
    }
    const cool = 0.8 * SIGMA * areaSurf * (Math.pow(p.T, 4) - Math.pow(250, 4));
    p.T += (qin - cool) * dt / (kg * 800);
    if (p.T < 3) p.T = 3;
    if (p.T > d.maxTemp && !burnt) burnt = p;
  }
  if (burnt) explodePart(v, burnt.rid, hooks, 'перегрев');
}

function tickResources(v, dt, ut, active, u, mp) {
  // electricity: probe cores, reaction wheels, solar panels
  let use = 0, gen = 0;
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    if (d.command && d.command.elecUse) use += d.command.elecUse;
    if (d.solar && p.st.solar) {
      if (v._sunT == null || ut - v._sunT > 2 || ut < v._sunT) { v._sunF = sunExposure(v.body, v.r, ut); v._sunT = ut; }
      gen += d.solar.rate * v._sunF * (d.shape === 'solarBig' ? 1 : 0.55);
    }
  }
  if (u) {
    const used = (Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2])) / 3;
    let wheel = 0;
    for (const p of v.parts) { if (p.dead) continue; const d = PART[p.id]; wheel += (d.command && d.command.torque) || (d.wheel && d.wheel.torque) || 0; }
    use += used * wheel * 0.05;
    if (v.rcs) {
      let mono = 0;
      for (const p of v.parts) if (!p.dead && PART[p.id].rcs) mono += PART[p.id].rcs.thrust * 1000 / (240 * G0);
      const sasUse = used * mono * 0.25 * dt / 1000;
      if (sasUse > 0) poolDraw(v, allRids(v), 'MONO', sasUse);
    }
  }
  const all = allRids(v);
  if (use > 0) poolDraw(v, all, 'ELEC', use * dt);
  if (gen > 0) {
    // fill batteries proportionally to free capacity
    let free = 0;
    for (const r of all) { const p = v.parts[r]; const mx = PART[p.id].res.ELEC || 0; free += Math.max(0, mx - (p.res.ELEC || 0)); }
    if (free > 0) {
      const add = Math.min(free, gen * dt);
      for (const r of all) { const p = v.parts[r]; const mx = PART[p.id].res.ELEC || 0; if (mx > 0) p.res.ELEC = (p.res.ELEC || 0) + add * (mx - (p.res.ELEC || 0)) / free; }
    }
  }
}

// ---- part loss / staging ----
function explodePart(v, rid, hooks, why) {
  const p = v.parts[rid];
  if (!p || p.dead || v.destroyed) return;
  p.dead = true; p.deathCause = why;
  hooks && hooks.event && hooks.event('explode', { vessel: v, part: p, why });
  const hadCommand = !v.debris;
  if (hadCommand && PART[p.id].command && !v.parts.some(q => !q.dead && PART[q.id].command)) {
    destroyVessel(v, hooks, PART[p.id].name + ': ' + why); return;
  }
  if (!v.parts.some(q => !q.dead)) { destroyVessel(v, hooks, why); return; }
  topologyChanged(v, hooks);
}

function destroyVessel(v, hooks, why) {
  if (v.destroyed) return;
  v.destroyed = true; v.destroyCause = why;
  for (const p of v.parts) p.dead = true;
  hooks && hooks.event && hooks.event('destroyed', { vessel: v, why });
}

function topologyChanged(v, hooks) {
  v._all = null; v._bnd = null; v.geo = null;
  vesselTopology(v);
  // split off disconnected parts
  const comps = vesselComponents(v);
  if (comps.length > 1) {
    const mainComp = comps.find(c => c.includes(v.root)) || comps[0];
    for (const c of comps) {
      if (c === mainComp) continue;
      const nv = extractVessel(v, c);
      hooks && hooks.event && hooks.event('split', { vessel: v, child: nv });
    }
    v._all = null; v._bnd = null; v.geo = null;
    vesselTopology(v);
  }
  v.massDirty = true;
  recenter(v);
}

// detach parts (rids) of v into a new vessel with the same motion
function extractVessel(v, rids) {
  const mpOld = massProps(v);
  const set = new Set(rids);
  const map = new Map();
  const parts = rids.map((r, i) => { map.set(r, i); const p = v.parts[r]; return Object.assign({}, p, { rid: i, st: JSON.parse(JSON.stringify(p.st)), res: Object.assign({}, p.res), data: p.data.slice() }); });
  const edges = [], emap = new Map();
  v.edges.forEach((e, i) => { if (set.has(e.a) && set.has(e.b) && !e.cut) { emap.set(i, edges.length); edges.push({ a: map.get(e.a), b: map.get(e.b), cut: false }); } });
  for (const p of parts) p.pEdge = p.pEdge != null && emap.has(p.pEdge) ? emap.get(p.pEdge) : null;
  const nv = {
    id: 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    name: v.name + (parts.some(p => PART[p.id].command) ? ' (отделён)' : ' — обломки'),
    parts, edges, stages: [], stageIdx: 0, throttle: 0, sas: false, sasMode: 'stab', rcs: false,
    flags: JSON.parse(JSON.stringify(v.flags)), maxAlt: v.maxAlt, design: null,
    body: v.body, q: v.q.slice(), w: v.w.slice(), launchUT: v.launchUT,
  };
  // remaining stages that reference these parts
  for (let s = v.stageIdx; s < v.stages.length; s++) {
    const st = v.stages[s].filter(r => set.has(r)).map(r => map.get(r));
    if (st.length) nv.stages.push(st);
  }
  vesselTopology(nv);
  const mpN = massProps(nv);
  // kinematics: position from old CoM frame
  const off = Q.rot(v.q, V.sub(mpN.com, mpOld.com));
  nv.r = V.add(v.r, off);
  nv.v = V.add(v.v, V.cross(Q.rot(v.q, v.w), off));
  nv._comPrev = mpN.com.slice();
  if (v.lock) { nv.lock = null; }
  for (const r of rids) v.parts[r].dead = true, v.parts[r].detached = true;
  nv.debris = !parts.some(p => PART[p.id].command);
  return nv;
}

// activate the next stage; returns list of new vessels split off
function activateStage(v, ut, hooks) {
  if (v.stageIdx >= v.stages.length) return [];
  const st = v.stages[v.stageIdx++];
  const out = [];
  const localHooks = { event: (t, d) => { if (t === 'split') out.push(d.child); hooks && hooks.event && hooks.event(t, d); } };
  let decoupled = false;
  v.prelaunchHold = false;
  for (const rid of st) {
    const p = v.parts[rid];
    if (!p || p.dead) continue;
    const d = PART[p.id];
    if (d.engine) { p.st.eng.on = true; p.st.eng.out = false; }
    if (d.chute && p.st.chute === 'stowed') p.st.chute = 'armed';
    if (d.decoupler && p.pEdge != null && !v.edges[p.pEdge].cut) { v.edges[p.pEdge].cut = true; decoupled = true; }
  }
  if (v.prelaunch) { v.prelaunch = false; if (v.lock) unlock(v); hooks && hooks.event && hooks.event('launch', { vessel: v }); }
  if (decoupled) {
    topologyChanged(v, localHooks);
    // separation impulse
    for (const nv of out) {
      const away = V.sub(nv.r, v.r);
      const al = V.len(away);
      const dirW = al > 1e-6 ? V.scale(away, 1 / al) : Q.rot(v.q, [0, -1, 0]);
      nv.v = V.addS(nv.v, dirW, 1.6);
      const mN = massProps(nv).m, mM = massProps(v).m;
      v.v = V.addS(v.v, dirW, -1.6 * mN / Math.max(mM, 1) * 0.5);
    }
  }
  if (v.lock && !v.prelaunch) unlock(v);
  hooks && hooks.event && hooks.event('stage', { vessel: v, index: v.stageIdx - 1 });
  return out;
}

// ---- orbit info helpers ----
function vesselOrbit(v, ut) {
  return elFromState(v.r, v.v, v.body.mu, ut);
}
function sciSituation(v) {
  const b = v.body, alt = V.len(v.r) - b.R;
  if (v.landed || v.inContact || v.situation === 'PRELAUNCH') return 'L';
  if (b.atm && alt < b.atm.top) return alt < b.flyHigh ? 'FL' : 'FH';
  return alt < b.spaceHigh ? 'SL' : 'SH';
}
function situationText(v, ut) {
  const b = v.body;
  if (v.situation === 'PRELAUNCH') return 'Стартовый стол, ' + b.name;
  if (v.landed || v.inContact) return 'На поверхности: ' + b.name;
  const alt = V.len(v.r) - b.R;
  if (b.atm && alt < b.atm.top) return 'Полёт в атмосфере: ' + b.name;
  const el = elFromState(v.r, v.v, b.mu, ut);
  if (el.e >= 1 || el.ra > b.soi) return 'Уход с орбиты: ' + b.name;
  if (el.rp < b.R + (b.atm ? b.atm.top : 0)) return 'Суборбитальный полёт: ' + b.name;
  return 'Орбита: ' + b.name;
}

// ---- rails (time warp > physics) ----
function enterRails(v, ut) {
  v.w = [0, 0, 0];
  if (v.lock || v.landed) { v.rails = { landed: true }; return; }
  v.rails = { landed: false };
  railsRepredict(v, ut);
}
function railsRepredict(v, ut) {
  const pts = predictTrajectory(v.body, v.r, v.v, ut, { maxPatches: 1, atmo: true, terrain: true });
  v.rails.patch = pts[0];
}
// advance an on-rails vessel to tTarget; returns {t, event} where event in
// null | 'soi' | 'atmo' | 'impact'
function railsAdvance(v, tNow, tTarget) {
  if (v.rails.landed) { if (v.lock) applyLock(v, tTarget); return { t: tTarget, event: null }; }
  let t = tNow, guard = 0;
  while (t < tTarget && guard++ < 50) {
    let pt = v.rails.patch;
    if (!pt || pt.body !== v.body) { railsRepredict(v, t); pt = v.rails.patch; }
    const ev = pt.end;
    const tEv = pt.t1;
    if (ev === 'none') {
      if (tEv <= tTarget) { // completed an orbit: re-predict for possible encounters
        const st = elState(pt.el, tEv); v.r = st.r; v.v = st.v; t = tEv;
        railsRepredict(v, t); continue;
      }
      const st = elState(pt.el, tTarget); v.r = st.r; v.v = st.v; return { t: tTarget, event: null };
    }
    if (ev === 'impact' && tEv - 60 <= tTarget) {
      const tt = Math.max(t, tEv - 60);
      const st = elState(pt.el, tt); v.r = st.r; v.v = st.v; return { t: tt, event: 'impact' };
    }
    if (tEv > tTarget) { const st = elState(pt.el, tTarget); v.r = st.r; v.v = st.v; return { t: tTarget, event: null }; }
    const st = elState(pt.el, tEv);
    if (ev === 'atmo') { v.r = st.r; v.v = st.v; return { t: tEv, event: 'atmo' }; }
    if (ev === 'exit') {
      const ps = bodyRelState(v.body, tEv);
      v.r = V.add(st.r, ps.r); v.v = V.add(st.v, ps.v); v.body = v.body.parent;
      t = tEv; railsRepredict(v, t); return { t, event: 'soi' };
    }
    if (ev === 'enter') {
      const cs = bodyRelState(pt.next, tEv);
      v.r = V.sub(st.r, cs.r); v.v = V.sub(st.v, cs.v); v.body = pt.next;
      t = tEv; railsRepredict(v, t); return { t, event: 'soi' };
    }
    if (ev === 'node') { v.r = st.r; v.v = st.v; t = tEv; railsRepredict(v, t); continue; }
    const st2 = elState(pt.el, tTarget); v.r = st2.r; v.v = st2.v; return { t: tTarget, event: null };
  }
  return { t, event: null };
}

// SOI transitions during physics
function checkSOI(v, ut) {
  const b = v.body;
  const rl = V.len(v.r);
  if (b.parent && rl > b.soi) {
    const ps = bodyRelState(b, ut);
    v.r = V.add(v.r, ps.r); v.v = V.add(v.v, ps.v); v.body = b.parent;
    return true;
  }
  for (const c of b.children) {
    if (rl < c.el.rp - c.soi * 1.5 || rl > c.el.ra + c.soi * 1.5) continue;
    const cs = bodyRelState(c, ut);
    if (V.dist(v.r, cs.r) < c.soi) {
      v.r = V.sub(v.r, cs.r); v.v = V.sub(v.v, cs.v); v.body = c;
      return true;
    }
  }
  return false;
}

// place a fresh vessel on the launch pad (prelaunch, locked)
function placeOnPad(v, ut, site) {
  const b = BODY[(site && site.body) || KSC.body];
  v.body = b;
  const lat = (site && site.lat) || KSC.lat, lon = (site && site.lon) || KSC.lon;
  const mp = massProps(v);
  const bnd = vesselBounds(v);
  const upF = V.norm(surfacePoint(b, lat, lon, 0));
  const eastF = V.norm(V.cross([0, 0, 1], upF));
  const southF = V.neg(V.cross(upF, eastF));
  const gh = groundHeight(b, upF, 2);
  const pf = V.addS(surfacePoint(b, lat, lon, gh), upF, mp.com[1] - bnd.minY + 0.02);
  const qf = Q.fromBasis(eastF, upF, southF);
  v.lock = { pf, qf };
  v.landed = true;
  v.prelaunch = true; v.prelaunchHold = true;
  v.situation = 'PRELAUNCH';
  v.w = [0, 0, 0];
  v._comPrev = mp.com.slice();
  applyLock(v, ut);
}
