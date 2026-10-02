// In-page test autopilot: advances the real game loop logic (simulate/updateLoaded/computeTraj/progress)
// without rendering, so long missions can be checked quickly in a headless browser.
window.AP = {
  log: [],
  step(n, ctrl) {
    const W = Game.world;
    for (let i = 0; i < n; i++) {
      if (ctrl) ctrl();
      simulate(0.1);
      if (i % 3 === 0) { updateLoaded(); computeTraj(); const A = Game.world.active; if (A && !A.destroyed) for (const m of progressTick(Game.g, A, Game.g.ut)) AP.log.push('milestone ' + m.id); }
      if (!Game.world || !Game.world.active || Game.world.active.destroyed) break;
    }
  },
  A() { return Game.world.active; },
  alt() { const A = AP.A(); return V.len(A.r) - A.body.R; },
  el() { const A = AP.A(); return elFromState(A.r, A.v, A.body.mu, Game.g.ut); },
  running() { return AP.A().parts.some(q => !q.dead && q.st.eng && q.st.eng.on && !q.st.eng.out); },
  toOrbit(apTarget) {
    const A = AP.A(), E = A.body;
    A.throttle = 1; A.sas = true; A.sasMode = 'target'; Game.stage();
    Game.world.physWarp = 3;
    let phase = 'ascent', guard = 0;
    let lastLog = -1e9;
    while (phase !== 'done' && guard++ < 4000 && !A.destroyed) {
      if (AP.verbose && Game.g.ut - lastLog > 15) { lastLog = Game.g.ut; const el = AP.el(); AP.log.push(`${phase} t=${Game.g.ut | 0} alt=${AP.alt() / 1e3 | 0}k Ap=${el.e < 1 ? (el.ra - E.R) / 1e3 | 0 : 'inf'} Pe=${(el.rp - E.R) / 1e3 | 0} stg=${A.stageIdx} thr=${A.throttle} run=${AP.running()} m=${(massProps(A).m / 1000).toFixed(1)} warp=${Game.world.warp}/${Game.world.physWarp}`); }
      AP.step(1, () => {
        const up = V.norm(A.r), east = V.norm(V.cross([0, 0, 1], up)), alt = AP.alt(), el = AP.el();
        if (phase === 'ascent') {
          const k = Math.min(1, Math.max(0, (alt - 800) / 45000)), e = (90 - 88 * Math.pow(k, 0.55)) * Math.PI / 180;
          A.targetDir = V.add(V.scale(up, Math.sin(e)), V.scale(east, Math.cos(e)));
          if (!AP.running() && A.stageIdx < A.stages.length) Game.stage();
          if (el.ra - E.R > apTarget) { A.throttle = 0; phase = 'coast'; }
        } else if (phase === 'coast') {
          A.sasMode = 'pro';
          const tAp = elTimeAtNu(el, Math.PI, Game.g.ut) - Game.g.ut;
          if (alt > E.atm.top && tAp > 60 && Game.world.warp === 0) Game.world.warp = 3;
          if (tAp < 45 && Game.world.warp > 0) { Game.stopWarp(); Game.world.physWarp = 3; }
          if (tAp < 25) phase = 'circ';
        } else if (phase === 'circ') {
          const fwd = Q.rot(A.q, [0, 1, 0]);
          A.throttle = V.dot(fwd, V.norm(A.v)) > 0.995 ? 1 : 0;
          if (A.throttle && !AP.running() && A.stageIdx < A.stages.length) Game.stage();
          if (el.rp - E.R > E.atm.top + 5000) { A.throttle = 0; phase = 'done'; }
        }
      });
    }
    const el = AP.el();
    return `orbit: Ap ${(el.ra - E.R) / 1e3 | 0} km, Pe ${(el.rp - E.R) / 1e3 | 0} km, ut ${Game.g.ut | 0}, stage ${A.stageIdx}/${A.stages.length}, vessels ${Game.world.vessels.length}`;
  },
  // retro burn until periapsis below pe, then drop to the last stages and fall
  deorbitAndLand(pe) {
    const A = AP.A(), E = A.body;
    A.sas = true; A.sasMode = 'retro';
    AP.step(80);
    let g = 0;
    while (AP.el().rp - E.R > pe && g++ < 3000) {
      AP.step(1, () => { A.throttle = 1; if (!AP.running() && A.stageIdx < A.stages.length - 1) Game.stage(); });
    }
    A.throttle = 0;
    // drop all but the last stage (chutes)
    while (A.stageIdx < A.stages.length - 1) Game.stage();
    Game.world.warp = 4;
    g = 0;
    while (!A.landed && !A.destroyed && g++ < 20000) {
      AP.step(1, () => { A.sasMode = 'retro'; if (AP.alt() < 25000 && A.stageIdx < A.stages.length) Game.stage(); });
    }
    const hot = Math.max(...A.parts.filter(p => !p.dead).map(p => p.T));
    return `land: landed=${!!A.landed} destroyed=${!!A.destroyed} ${A.destroyCause || ''} ut=${Game.g.ut | 0} body=${A.body.id} parts=${A.parts.filter(p => !p.dead).length} T=${hot | 0}`;
  },
};
