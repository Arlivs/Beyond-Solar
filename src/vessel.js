'use strict';
// Vessel designs (editable templates) and runtime vessels (flat part lists).
//
// design = { name, stack: [stackPart], stages: [[uid...]], customStages }
//   stackPart = { uid, id, radial: [group] }                     (top -> bottom)
//   group     = { uid, sym, y, ang, mount: {uid,id}|null, column: [colPart], anchor }
//   colPart   = { uid, id, radial: [group] }  (nested groups: radial-only parts, no mount)
// Symmetric instances share the template uid; staging works on template uids.

let _uidSeq = 1;
function newUid() { return 'p' + (_uidSeq++).toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

function partRadiusAt(def, yRel) {
  if (def.attach !== 'stack') return (def.depth || 0.2) / 2;
  const t = clamp((yRel + def.h / 2) / def.h, 0, 1);
  return (def.dBot + (def.dTop - def.dBot) * t) / 2;
}
function colRadius(def) { return def.attach === 'stack' ? Math.max(def.dTop, def.dBot) / 2 : (def.depth || 0.3) / 2; }

// ---- layout: design -> placed part instances ----
// item: { uid, id, def, k, pos, dir, ang, role, parent (index or -1), si, tpl, group }
function layoutDesign(design) {
  const out = [];
  let yTop = 0, prev = -1;
  design.stack.forEach((sp, si) => {
    const def = PART[sp.id];
    const yc = yTop - def.h / 2;
    const idx = out.length;
    out.push({ uid: sp.uid, id: sp.id, def, k: 0, pos: [0, yc, 0], dir: null, ang: 0, role: 'stack', parent: prev, si, tpl: sp });
    for (const g of sp.radial || []) layoutGroup(out, g, def, [0, yc, 0], 0, idx, si);
    prev = idx;
    yTop -= def.h;
  });
  return out;
}

// a group hangs N symmetric copies of {optional radial decoupler + column of parts} on a parent
// part's surface. Column parts may carry their own groups (any depth).
function groupIsRadialOnly(g) { return !g.mount && g.column.length === 1 && PART[g.column[0].id].attach === 'radial'; }
function layoutGroup(out, g, pdef, pc, baseAng, pIdx, si) {
  if (!g.mount && !g.column.length) return;
  const yRel = clamp(g.y, -pdef.h / 2, pdef.h / 2);
  const rP = pdef.attach === 'stack' ? partRadiusAt(pdef, yRel) : colRadius(pdef);
  const ya = pc[1] + yRel;
  const radialOnly = groupIsRadialOnly(g);
  for (let k = 0; k < g.sym; k++) {
    const ang = baseAng + g.ang + k * TAU / g.sym;
    const dir = [Math.cos(ang), 0, Math.sin(ang)];
    if (radialOnly) {
      const c = g.column[0], d = PART[c.id];
      out.push({ uid: c.uid, id: c.id, def: d, k, pos: [pc[0] + dir[0] * (rP + d.depth / 2), ya, pc[2] + dir[2] * (rP + d.depth / 2)],
        dir, ang, role: 'radial', parent: pIdx, si, tpl: c, group: g });
      continue;
    }
    let base = rP, anchorParent = pIdx;
    if (g.mount) {
      const md = PART[g.mount.id];
      anchorParent = out.length;
      out.push({ uid: g.mount.uid, id: g.mount.id, def: md, k, pos: [pc[0] + dir[0] * (rP + md.depth / 2), ya, pc[2] + dir[2] * (rP + md.depth / 2)],
        dir, ang, role: 'mount', parent: pIdx, si, tpl: g.mount, group: g });
      base = rP + md.depth;
    }
    if (!g.column.length) continue;
    const cR = Math.max(...g.column.map(c => colRadius(PART[c.id])));
    const rc = base + cR;
    const ys = columnYs(g.column, g.anchor, ya);
    const b0 = out.length;
    g.column.forEach((c, j) => {
      const par = j === g.anchor ? anchorParent : (j < g.anchor ? b0 + j + 1 : b0 + j - 1);
      out.push({ uid: c.uid, id: c.id, def: PART[c.id], k, pos: [pc[0] + dir[0] * rc, ys[j], pc[2] + dir[2] * rc], dir, ang, role: 'column',
        parent: par, si, tpl: c, group: g, cj: j });
    });
    g.column.forEach((c, j) => { for (const g2 of c.radial || []) layoutGroup(out, g2, PART[c.id], out[b0 + j].pos, ang, b0 + j, si); });
  }
}

function columnYs(col, anchor, ya) {
  const ys = []; ys[anchor] = ya;
  let top = ya + PART[col[anchor].id].h / 2;
  for (let j = anchor - 1; j >= 0; j--) { const h = PART[col[j].id].h; ys[j] = top + h / 2; top += h; }
  let bot = ya - PART[col[anchor].id].h / 2;
  for (let j = anchor + 1; j < col.length; j++) { const h = PART[col[j].id].h; ys[j] = bot - h / 2; bot -= h; }
  return ys;
}

// all template entries in a design (for lookups)
function designTemplates(design) {
  const list = [];
  const walkGroup = (g, owner) => {
    if (g.mount) list.push({ t: g.mount, kind: 'mount', group: g, owner });
    const ro = groupIsRadialOnly(g);
    g.column.forEach((c, j) => { list.push({ t: c, kind: ro ? 'radial' : 'column', group: g, owner, j }); (c.radial || []).forEach(g2 => walkGroup(g2, c)); });
  };
  design.stack.forEach((s, i) => { list.push({ t: s, kind: 'stack', i }); (s.radial || []).forEach(g => walkGroup(g, s)); });
  return list;
}

// ---- staging ----
function autoStage(design) {
  const L = layoutDesign(design);
  const tplOf = new Map(L.map(it => [it.uid, it]));
  // stack sections split by stack decouplers (section 0 = bottom)
  const n = design.stack.length;
  const secOfStack = new Array(n);
  const stackDecAbove = []; // decoupler uid at top of section s
  let sec = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = PART[design.stack[i].id];
    secOfStack[i] = sec;
    if (d.decoupler === 'stack') { stackDecAbove[sec] = design.stack[i].uid; sec++; }
  }
  const nSec = sec + 1;
  const engines = Array.from({ length: nSec }, () => new Set());
  const radDecs = Array.from({ length: nSec }, () => new Set());
  const chutes = new Set(), sails = new Set();
  for (const it of L) {
    const s = secOfStack[it.si];
    if (it.def.chute) chutes.add(it.uid);
    else if (it.def.sail) sails.add(it.uid);
    else if (it.def.engine) engines[s].add(it.uid);
    else if (it.def.decoupler === 'radial') radDecs[s].add(it.uid);
  }
  const stages = [];
  for (let s = 0; s < nSec; s++) {
    const st = [];
    if (s > 0 && stackDecAbove[s - 1]) st.push(stackDecAbove[s - 1]);
    st.push(...engines[s]);
    if (st.length) stages.push(st);
    if (radDecs[s].size) stages.push([...radDecs[s]]);
  }
  if (sails.size) stages.push([...sails]);
  if (chutes.size) stages.push([...chutes]);
  design.stages = stages;
  design.customStages = false;
  void tplOf;
  return stages;
}

// keep custom staging consistent after edits
function syncStages(design) {
  if (!design.customStages) return autoStage(design);
  const present = new Set(designTemplates(design).filter(e => PART[e.t.id].stageable).map(e => e.t.uid));
  const seen = new Set();
  design.stages = design.stages.map(s => s.filter(u => present.has(u) && !seen.has(u) && seen.add(u))).filter(s => s.length);
  const missing = [...present].filter(u => !seen.has(u));
  if (missing.length) design.stages.push(missing);
  return design.stages;
}

// ---- runtime vessel ----
let _vesselSeq = 1;
function buildVessel(design, name) {
  const L = layoutDesign(design);
  const parts = L.map((it, i) => {
    const d = it.def;
    const p = {
      rid: i, id: it.id, uid: it.uid, k: it.k, pos: it.pos, dir: it.dir, ang: it.ang, role: it.role,
      res: Object.assign({}, d.res), T: 288, data: [], st: {},
    };
    if (d.engine) p.st.eng = { on: false, out: false };
    if (d.chute) p.st.chute = 'stowed';
    if (d.legs) p.st.legs = false;
    if (d.gear && d.gear.retract) p.st.gear = true;
    if (d.solar) p.st.solar = true;
    if (d.sail) p.st.sail = false;
    if (d.light) p.st.light = false;
    return p;
  });
  parts.forEach((p, i) => { if (PART[p.id].dock) p.portDir = dockFacing(L, i); });
  const edges = [];
  L.forEach((it, i) => { if (it.parent >= 0) { edges.push({ a: it.parent, b: i, cut: false }); parts[i].pEdge = edges.length - 1; } });
  const byUid = {};
  for (const p of parts) (byUid[p.uid] = byUid[p.uid] || []).push(p.rid);
  const v = {
    id: 'v' + Date.now().toString(36) + (_vesselSeq++), name: name || design.name || 'Корабль',
    parts, edges, gone: [],
    stages: (design.stages || []).map(s => s.flatMap(u => byUid[u] || [])).filter(s => s.length),
    stageIdx: 0,
    throttle: 0, sas: false, sasMode: 'stab', rcs: false, legs: false,
    flags: { bodies: {} }, maxAlt: 0, design: JSON.parse(JSON.stringify(design)),
  };
  vesselTopology(v);
  return v;
}

function partDef(p) { return PART[p.id]; }
// ---- part orientation in vessel axes ----
// Stack parts stand upright, radial parts are turned about +Y by -ang. Parts that joined through a docking
// port carry an explicit quaternion p.q (they can be upside down or rolled relative to the vessel).
function partQ(p) { return p.q || (p.dir ? Q.axisAngle([0, 1, 0], -p.ang) : [0, 0, 0, 1]); }
function partPt(p, local) { return V.add(p.pos, p.q || p.dir ? Q.rot(partQ(p), local) : local); }
function partAxis(p) { return p.q ? Q.rot(p.q, [0, 1, 0]) : [0, 1, 0]; }
// which end of a docking port is free (+1 top, -1 bottom, 0 covered), from the stack neighbours' positions.
// items: layout items or runtime parts (anything with pos and id)
function dockFacing(items, i) {
  const it = items[i], d = PART[it.id], top = it.pos[1] + d.h / 2, bot = it.pos[1] - d.h / 2;
  let up = false, down = false;
  for (const o of items) {
    if (o === it || o.dead || PART[o.id].attach !== 'stack') continue;
    if (Math.abs(o.pos[0] - it.pos[0]) > 0.05 || Math.abs(o.pos[2] - it.pos[2]) > 0.05) continue;
    const od = PART[o.id];
    if (Math.abs((o.pos[1] - od.h / 2) - top) < 0.02) up = true;
    if (Math.abs((o.pos[1] + od.h / 2) - bot) < 0.02) down = true;
  }
  return !up ? 1 : !down ? -1 : 0;
}
function liveParts(v) { return v.parts.filter(p => !p.dead); }

// recompute root, fuel domains and adjacency after topology changes
function vesselTopology(v) {
  const n = v.parts.length;
  const adj = Array.from({ length: n }, () => []);
  for (const e of v.edges) {
    if (e.cut || v.parts[e.a].dead || v.parts[e.b].dead) continue;
    adj[e.a].push(e.b); adj[e.b].push(e.a);
  }
  v.adj = adj;
  // root = first live command part in rid order (stack order top-down), else first live part
  let root = -1;
  for (const p of v.parts) if (!p.dead && PART[p.id].command) { root = p.rid; break; }
  if (root < 0) for (const p of v.parts) if (!p.dead) { root = p.rid; break; }
  v.root = root;
  // fuel domains: components without decoupler nodes
  const dom = new Array(n).fill(-1);
  let nd = 0;
  for (const p of v.parts) {
    if (p.dead || dom[p.rid] >= 0 || PART[p.id].decoupler) continue;
    const stack = [p.rid]; dom[p.rid] = nd;
    while (stack.length) {
      const a = stack.pop();
      for (const b of adj[a]) if (dom[b] < 0 && !PART[v.parts[b].id].decoupler) { dom[b] = nd; stack.push(b); }
    }
    nd++;
  }
  v.domain = dom;
  v.domains = Array.from({ length: nd }, () => []);
  for (const p of v.parts) if (!p.dead && dom[p.rid] >= 0) v.domains[dom[p.rid]].push(p.rid);
  v.massDirty = true;
}

// components of the live graph; returns array of rid arrays
function vesselComponents(v) {
  const seen = new Set(), comps = [];
  for (const p of v.parts) {
    if (p.dead || seen.has(p.rid)) continue;
    const c = [], st = [p.rid]; seen.add(p.rid);
    while (st.length) { const a = st.pop(); c.push(a); for (const b of v.adj[a]) if (!seen.has(b)) { seen.add(b); st.push(b); } }
    comps.push(c);
  }
  return comps;
}

// mass properties in SI: m kg, com local m, I diag kg m^2 (about com, vessel axes)
function massProps(v) {
  if (!v.massDirty && v._mp) return v._mp;
  let m = 0, cx = 0, cy = 0, cz = 0;
  const pm = [];
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    let mt = d.mass;
    for (const k in p.res) if (k !== 'ELEC') mt += p.res[k];
    const kg = mt * 1000;
    pm.push([p, kg, d]);
    m += kg; cx += kg * p.pos[0]; cy += kg * p.pos[1]; cz += kg * p.pos[2];
  }
  if (m <= 0) m = 1;
  const com = [cx / m, cy / m, cz / m];
  let Ix = 0, Iy = 0, Iz = 0;
  for (const [p, kg, d] of pm) {
    const r = d.attach === 'stack' ? Math.max(d.dTop, d.dBot) / 2 : 0.2, h = d.h;
    const dx = p.pos[0] - com[0], dy = p.pos[1] - com[1], dz = p.pos[2] - com[2];
    const it = kg * (3 * r * r + h * h) / 12, ia = 0.5 * kg * r * r;
    Ix += it + kg * (dy * dy + dz * dz);
    Iy += ia + kg * (dx * dx + dz * dz);
    Iz += it + kg * (dx * dx + dy * dy);
  }
  v._mp = { m, com, I: [Math.max(Ix, 1), Math.max(Iy, 1), Math.max(Iz, 1)] };
  v.massDirty = false;
  return v._mp;
}

// bounding info for camera / contacts
function vesselBounds(v) {
  let minY = Infinity, maxY = -Infinity, maxR = 0;
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    minY = Math.min(minY, p.pos[1] - d.h / 2); maxY = Math.max(maxY, p.pos[1] + d.h / 2);
    maxR = Math.max(maxR, Math.hypot(p.pos[0], p.pos[2]) + colRadius(d));
  }
  return { minY, maxY, maxR, size: Math.max(maxY - minY, maxR * 2) };
}

// engine helpers
function engineIsp(e, pAtm) { return Math.max(1, e.ispVac + (e.ispSL - e.ispVac) * Math.min(pAtm, 20)); }
function engineMdot(e) { return e.thrust * 1000 / (e.ispVac * G0); } // kg/s at full throttle

// parts that would separate if decoupler rid fires (not containing root)
function partsDetachedBy(v, rid, cutSet) {
  const p = v.parts[rid];
  if (p.pEdge == null) return [];
  const cut = new Set(cutSet || []); cut.add(p.pEdge);
  const n = v.parts.length, adj = Array.from({ length: n }, () => []);
  v.edges.forEach((e, i) => { if (!cut.has(i) && !e.cut && !v.parts[e.a].dead && !v.parts[e.b].dead) { adj[e.a].push(e.b); adj[e.b].push(e.a); } });
  const seen = new Set([v.root]), st = [v.root];
  while (st.length) { const a = st.pop(); for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); st.push(b); } }
  return v.parts.filter(q => !q.dead && !seen.has(q.rid)).map(q => q.rid);
}

// Δv per remaining stage (event-driven burn simulation, full throttle).
function simulateStages(v, pAtm, gRef) {
  const parts = v.parts;
  const alive = new Set(parts.filter(p => !p.dead).map(p => p.rid));
  const res = new Map(parts.map(p => [p.rid, Object.assign({}, p.res)]));
  const cut = new Set(v.edges.map((e, i) => (e.cut ? i : -1)).filter(i => i >= 0));
  const on = new Set(parts.filter(p => !p.dead && p.st.eng && p.st.eng.on && !p.st.eng.out).map(p => p.rid));
  const mass = () => { let m = 0; for (const rid of alive) { const d = PART[parts[rid].id]; m += d.mass; const r = res.get(rid); for (const k in r) if (k !== 'ELEC') m += r[k]; } return m * 1000; };
  const detach = (rid) => {
    const p = parts[rid]; if (p.pEdge == null) return;
    cut.add(p.pEdge);
    const n = parts.length, adj = Array.from({ length: n }, () => []);
    v.edges.forEach((e, i) => { if (!cut.has(i) && alive.has(e.a) && alive.has(e.b)) { adj[e.a].push(e.b); adj[e.b].push(e.a); } });
    const seen = new Set([v.root]), st = [v.root];
    while (st.length) { const a = st.pop(); for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); st.push(b); } }
    for (const r of [...alive]) if (!seen.has(r)) { alive.delete(r); on.delete(r); }
  };
  const fuelOf = (rid) => {
    const d = PART[parts[rid].id], pr = d.engine.prop;
    if (pr === 'SOLID') return [rid];
    if (pr === 'XENON') return [...alive].filter(r => (res.get(r).XENON || 0) > 1e-9);
    const dm = v.domain[rid];
    return [...alive].filter(r => v.domain[r] === dm && (res.get(r)[pr] || 0) > 1e-9);
  };
  const out = [];
  // engines already burning form a pseudo-stage (index stageIdx-1) that is simulated first
  const start = v.stageIdx - (on.size ? 1 : 0);
  for (let s = start; s < v.stages.length; s++) {
    if (s >= v.stageIdx) for (const rid of v.stages[s]) {
      if (!alive.has(rid)) continue;
      const d = PART[parts[rid].id];
      if (d.engine) on.add(rid);
      if (d.decoupler) detach(rid);
    }
    // engines dropped by the next decoupling stage define when this stage ends
    let stopSet = null;
    for (let s2 = s + 1; s2 < v.stages.length && !stopSet; s2++) {
      const decs = v.stages[s2].filter(r => alive.has(r) && PART[parts[r].id].decoupler);
      if (!decs.length) continue;
      const drop = new Set();
      for (const r of decs) for (const x of partsDetachedBy(v, r, cut)) drop.add(x);
      stopSet = new Set([...on].filter(r => drop.has(r)));
      if (!stopSet.size) stopSet = null;
      break;
    }
    const m0 = mass();
    let m = m0, dv = 0, tb = 0, F0 = 0;
    for (let iter = 0; iter < 60; iter++) {
      const act = [...on].filter(r => alive.has(r) && fuelOf(r).length);
      if (!act.length) break;
      if (stopSet && ![...stopSet].some(r => act.includes(r))) break;
      // group consumers by fuel source key
      const draw = new Map(); // source rid -> kg/s
      let F = 0, mdot = 0;
      for (const r of act) {
        const e = PART[parts[r].id].engine, md = engineMdot(e), src = fuelOf(r);
        let tot = 0; const key = e.prop;
        for (const x of src) tot += res.get(x)[key];
        for (const x of src) draw.set(x + ':' + key, (draw.get(x + ':' + key) || 0) + md * res.get(x)[key] / tot);
        F += md * engineIsp(e, pAtm) * G0; mdot += md;
      }
      if (iter === 0) F0 = F;
      let dt = Infinity;
      for (const [k, rate] of draw) { const [x, key] = k.split(':'); dt = Math.min(dt, res.get(+x)[key] * 1000 / rate); }
      if (!isFinite(dt) || dt <= 0) break;
      const m1 = m - mdot * dt;
      dv += (F / mdot) * Math.log(m / m1);
      tb += dt; m = m1;
      for (const [k, rate] of draw) { const [x, key] = k.split(':'); const r = res.get(+x); r[key] = Math.max(0, r[key] - rate * dt / 1000); if (r[key] < 1e-7) r[key] = 0; }
      for (const r of [...on]) if (!fuelOf(r).length) on.delete(r);
    }
    out.push({ stage: s, dv, time: tb, m0, m1: m, thrust: F0, twr: F0 / (m0 * (gRef || G0)) });
  }
  return out;
}

function designCost(design) {
  return layoutDesign(design).reduce((s, it) => s + it.def.fullCost, 0);
}
function designMass(design) {
  return layoutDesign(design).reduce((s, it) => s + it.def.wetMass, 0);
}
function designHasCommand(design) { return layoutDesign(design).some(it => it.def.command); }
function designPartIds(design) { return [...new Set(layoutDesign(design).map(it => it.id))]; }

// ---- craft codes: a design compressed into text (and into links as #craft=...) ----
const CRAFT_TAG = 'ORB1';
const b64u = { enc: (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } };
async function craftEncode(design) {
  const d = { name: design.name, stack: design.stack, stages: design.stages, customStages: !!design.customStages, site: design.site, vabY: design.vabY };
  const raw = new TextEncoder().encode(JSON.stringify(d));
  if (typeof CompressionStream === 'undefined') return CRAFT_TAG + 'j' + b64u.enc(raw);
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return CRAFT_TAG + 'z' + b64u.enc(z);
}
// accepts a bare code or any text/link containing one; throws on anything that is not a valid design
async function craftDecode(text) {
  const m = String(text).match(/ORB1([jz])([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('нет кода ракеты');
  let bytes = b64u.dec(m[2]);
  if (m[1] === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (!d || !Array.isArray(d.stack) || !d.stack.length) throw new Error('пустая ракета');
  for (const e of designTemplates(d)) if (!PART[e.t.id] || PART[e.t.id].hidden) throw new Error('неизвестная деталь ' + e.t.id);
  layoutDesign(d); syncStages(d);
  d.name = String(d.name || 'Ракета').slice(0, 60);
  return d;
}

// ---- stock designs ----
// spec: array of ids or {id, r:[{sym, y, mount:'dec_r', col:[ids], anchor, part, r:[...]}]}
function makeDesign(name, spec, extra) {
  const mkGroup = (g, ownerDef) => {
    const grp = { uid: newUid(), sym: g.sym || 1, y: (g.y || 0) * ownerDef.h, ang: (g.ang || 0) * DEG, mount: null, column: [], anchor: g.anchor || 0 };
    if (g.mount) { grp.mount = { uid: newUid(), id: g.mount }; grp.column = (g.col || []).map(c => mkCol(c)); }
    else grp.column = [{ uid: newUid(), id: g.part, radial: [] }];
    return grp;
  };
  const mkCol = (c) => {
    if (typeof c === 'string') return { uid: newUid(), id: c, radial: [] };
    return { uid: newUid(), id: c.id, radial: (c.r || []).map(g => mkGroup(g, PART[c.id])) };
  };
  const stack = spec.map(s => {
    if (typeof s === 'string') return { uid: newUid(), id: s, radial: [] };
    return { uid: newUid(), id: s.id, radial: (s.r || []).map(g => mkGroup(g, PART[s.id])) };
  });
  const d = Object.assign({ name, stack, stages: [] }, extra || {});
  autoStage(d);
  return d;
}

function stockDesigns() {
  return [
    makeDesign('Прыгун', ['chute_s', 'pod_k1', 'srb_flea']),
    makeDesign('Высотник', ['chute_s', { id: 'pod_k1', r: [{ sym: 1, y: 0, part: 'sci_thermo', ang: 90 }] }, 'shield_s1', 'dec_s1',
      { id: 'srb_hammer', r: [{ sym: 3, y: -0.4, part: 'fin' }] }]),
    makeDesign('Орбитер-1', ['chute_s', 'pod_k1', 'shield_s1', 'dec_s1', 'tank_t1l', 'eng_terrier', 'dec_s1',
      'tank_t1xl', { id: 'tank_t1xl', r: [{ sym: 4, y: -0.42, part: 'fin' }] }, 'eng_swivel']),
    makeDesign('Лунник', ['chute_s', 'pod_k1', 'shield_s1', 'dec_s1',
      { id: 'tank_t1l', r: [{ sym: 4, y: -0.2, part: 'legs' }] }, 'eng_terrier', 'dec_s1',
      'tank_t1xl', 'eng_terrier', 'dec_s1',
      { id: 'tank_t1xl', r: [{ sym: 2, y: 0.1, mount: 'dec_r', col: ['nose_s1', 'srb_kickback'], anchor: 1 }] },
      { id: 'tank_t1xl', r: [{ sym: 4, y: -0.42, part: 'fin' }] }, 'eng_swivel']),
    makeDesign('Стриж', [{ id: 'pod_cockpit', r: [{ sym: 1, y: -0.32, ang: -90, part: 'gear_s' }] }, 'tank_t1m',
      { id: 'tank_t1l', r: [{ sym: 2, y: 0.12, part: 'wing_m' }, { sym: 1, y: 0.07, ang: -70, part: 'gear_s' }, { sym: 1, y: 0.07, ang: -110, part: 'gear_s' },
        { sym: 1, y: -0.3, ang: 90, part: 'fin_big' }] }, { id: 'jet_basic', r: [{ sym: 2, y: 0.22, part: 'elevon' }] }], { site: 'runway' }),
    makeDesign('Луноход', [{ id: 'probe_p1', r: [{ sym: 1, y: 0, ang: -30, part: 'wheel_rover' }, { sym: 1, y: 0, ang: -150, part: 'wheel_rover' }] },
      { id: 'battery_l', r: [{ sym: 2, y: 0, ang: 60, part: 'solar_s' }] },
      { id: 'tank_t1m', r: [{ sym: 1, y: -0.35, ang: -30, part: 'wheel_rover' }, { sym: 1, y: -0.35, ang: -150, part: 'wheel_rover' }, { sym: 1, y: 0.3, ang: 90, part: 'antenna' }] }], { site: 'runway' }),
    makeDesign('Стыковщик', ['dock_s', { id: 'pod_k1', r: [{ sym: 4, y: 0.15, part: 'rcs' }, { sym: 2, y: -0.25, ang: 45, part: 'chute_r' }] }, 'shield_s1', 'dec_s1',
      'mono_s1', 'tank_t1l', 'eng_terrier', 'dec_s1', { id: 'tank_t1xl', r: [{ sym: 2, y: 0.1, mount: 'dec_r', col: ['nose_s1', 'srb_hammer'], anchor: 1 }] },
      { id: 'tank_t1xl', r: [{ sym: 4, y: -0.42, part: 'fin' }] }, 'eng_swivel']),
    // interstellar: a chemical first stage lifts it out of the thick air, then the fusion drive takes over
    makeDesign('Дедал', [{ id: 'pod_k3', r: [{ sym: 4, y: -0.1, ang: 45, part: 'rtg' }, { sym: 1, y: 0.25, ang: 0, part: 'antenna' }, { sym: 2, y: -0.3, ang: 0, part: 'light' }] },
      'cryo', 'reactor', 'tank_he3', 'eng_fusion', 'dec_s2', { id: 'tank_t2l', r: [{ sym: 4, y: -0.42, part: 'fin_big' }] }, 'eng_skipper']),
  ].concat(SCIFI.on ? [
    // science fiction: a warp ship with a photon drive, and a shipyard base (lifted by the fusion stage)
    makeDesign('Пилигрим', [{ id: 'pod_k3', r: [{ sym: 2, y: -0.3, ang: 0, part: 'light' }, { sym: 1, y: 0.25, ang: 90, part: 'antenna' }] }, 'cryo', 'reactor', 'reactor',
      'tank_exotic_l', 'warp_core', 'tank_am', 'eng_photon', 'dec_s3', { id: 'tank_t3l', r: [{ sym: 4, y: -0.42, part: 'fin_big' }] }, 'eng_mammoth']),
    makeDesign('Звёздный док', [{ id: 'pod_k3', r: [{ sym: 4, y: 0, ang: 45, part: 'rtg' }] }, 'shipyard', 'reactor', 'reactor', 'reactor', 'reactor', 'exotic_synth', 'tank_exotic',
      'tank_he3_l', 'eng_fusion', 'dec_s3', { id: 'tank_t3l', r: [{ sym: 4, y: -0.42, part: 'fin_big' }] }, 'eng_mammoth']),
  ] : []);
}
