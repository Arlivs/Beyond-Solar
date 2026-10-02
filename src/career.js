'use strict';
// Game state: career / sandbox progress, science, contracts, milestones, saves.

const SAVE_VERSION = 1;

function newGame(mode, name) {
  const g = {
    v: SAVE_VERSION, mode, name: name || (mode === 'career' ? 'Карьера' : 'Песочница'), created: Date.now(), ut: 0,
    funds: 25000, science: 0, rep: 0,
    techs: mode === 'career' ? ['start'] : TECH.map(t => t.id),
    subjects: {}, milestones: {}, records: { alt: 0 },
    contracts: { offered: [], active: [], done: [], failed: [], seq: 1, lastGen: -1e9 },
    crafts: {}, vessels: [], lastCraft: null, stats: { launches: 0, recoveries: 0 },
  };
  if (mode === 'career') refreshOffers(g);
  return g;
}
const isCareer = (g) => g.mode === 'career';

// ---- tech ----
function partUnlocked(g, id) { return g.techs.includes(PART[id].tech); }
function techAvailable(g, t) { return !g.techs.includes(t.id) && (t.req.length === 0 || t.req.some(r => g.techs.includes(r))); }
function researchTech(g, id) {
  const t = TECH_BY_ID[id];
  if (!t || !techAvailable(g, t) || g.science < t.cost) return false;
  g.science -= t.cost; g.techs.push(id);
  return true;
}
function designAllowed(g, design) { return designPartIds(design).every(id => partUnlocked(g, id)); }

// ---- funds ----
function spend(g, x) { if (!isCareer(g)) return true; if (g.funds < x) return false; g.funds -= x; return true; }
function earn(g, x) { if (isCareer(g)) g.funds += x; }

// ---- science ----
function subjectId(exp, bodyId, sit) { return exp + '@' + bodyId + ':' + sit; }
function subjectTitle(exp, bodyId, sit) { return `${EXPERIMENTS[exp].name}: ${BODY[bodyId].name}, ${SIT_NAMES[sit]}`; }
function sciMult(body, sit) { return body.sci[SIT_INDEX[sit]] || 0; }
function subjectRemaining(g, exp, bodyId, sit) {
  const e = EXPERIMENTS[exp], m = sciMult(BODY[bodyId], sit);
  return Math.max(0, e.cap * m - (g.subjects[subjectId(exp, bodyId, sit)] || 0));
}
// value if credited now
function dataValue(g, d, transmit) {
  const e = EXPERIMENTS[d.exp], m = sciMult(BODY[d.body], d.sit);
  const full = e.base * m * (transmit ? e.xmit : 1);
  return Math.min(full, subjectRemaining(g, d.exp, d.body, d.sit));
}
function creditData(g, d, transmit) {
  const x = dataValue(g, d, transmit);
  if (x <= 0) return 0;
  const id = subjectId(d.exp, d.body, d.sit);
  g.subjects[id] = (g.subjects[id] || 0) + x;
  if (isCareer(g)) g.science += x;
  contractEvent(g, 'science', { exp: d.exp, body: d.body, sit: d.sit });
  return x;
}
// can experiment exp run here?
function expAvailable(exp, v) {
  const e = EXPERIMENTS[exp], sit = sciSituation(v), b = v.body;
  if (!e.sits.split(' ').includes(sit)) return { ok: false, why: 'не работает ' + SIT_NAMES[sit] };
  if (e.needAtm && !b.atm) return { ok: false, why: 'нет атмосферы' };
  if (sciMult(b, sit) <= 0) return { ok: false, why: 'здесь нечего изучать' };
  return { ok: true, sit };
}
// run the experiment of part p (or crew report from pod); returns data or {error}
function runExperiment(g, v, p, exp) {
  const a = expAvailable(exp, v);
  if (!a.ok) return { error: a.why };
  const e = EXPERIMENTS[exp];
  if (exp === 'crew') {
    if (p.data.some(d => d.exp === 'crew' && d.body === v.body.id && d.sit === a.sit)) return { error: 'такой доклад уже есть' };
  } else {
    if (p.data.length) return { error: 'данные уже собраны' };
    if (e.single && p.st.used) return { error: 'эксперимент израсходован' };
  }
  const d = { exp, body: v.body.id, sit: a.sit, title: subjectTitle(exp, v.body.id, a.sit) };
  p.data.push(d);
  if (e.single) p.st.used = true;
  return { data: d, value: dataValue(g, d, false), xmit: dataValue(g, d, true) };
}

// ---- recovery ----
function recoveryFactor(v) {
  if (v.body.id !== 'earth') return 0;
  const ll = latLon(v.body, v._ut || 0, v.r);
  const d = Math.acos(clamp(Math.cos(ll.lat) * Math.cos(ll.lon - KSC.lon), -1, 1)) * v.body.R;
  return clamp(1 - d / (Math.PI * v.body.R) * 0.4, 0.6, 1) * 0.98;
}
function recoverVessel(g, v) {
  const f = recoveryFactor(v);
  let funds = 0, sci = 0;
  const items = [];
  for (const p of v.parts) {
    if (p.dead) continue;
    const d = PART[p.id];
    let c = d.cost;
    for (const k in p.res) c += (RES_COST[k] || 0) * (k === 'ELEC' ? 0 : p.res[k]);
    funds += c * f;
    for (const dt of p.data) { const x = creditData(g, dt, false); sci += x; items.push([dt.title, x]); }
  }
  earn(g, funds);
  g.stats.recoveries++;
  // returns
  const ret = [];
  const fb = v.flags.bodies || {};
  if (fb.earth && fb.earth.orbit) ret.push(milestone(g, 'return_orbit'));
  for (const id in fb) {
    if (id === 'earth') continue;
    ret.push(milestone(g, 'return_' + id));
    contractEvent(g, 'recovered', { flags: fb, body: id });
  }
  contractEvent(g, 'recovered', { flags: fb });
  return { funds: isCareer(g) ? funds : 0, sci, items, factor: f, milestones: ret.filter(Boolean) };
}

// ---- milestones ----
function milestoneDef(id) {
  const fixed = {
    launch: ['Первый запуск', 2000, 0, 2],
    alt_5k: ['Высота 5 км', 1500, 1, 1], alt_10k: ['Высота 10 км', 2500, 2, 1], alt_20k: ['Высота 20 км', 3500, 3, 2],
    alt_40k: ['Высота 40 км', 5000, 4, 2],
    space: ['Первый выход в космос', 9000, 6, 5], orbit_earth: ['Первая орбита Земли', 15000, 10, 8],
    return_orbit: ['Возвращение с орбиты', 10000, 8, 6], escape_earth: ['Покинуть сферу Земли', 18000, 12, 8],
  };
  if (fixed[id]) return fixed[id];
  const m = id.match(/^(soi|orbit|land|return)_(\w+)$/);
  if (!m || !BODY[m[2]]) return null;
  const b = BODY[m[2]], k = 1 + b.diff * 0.8;
  const T = { soi: ['Пролёт: ', 8000, 6], orbit: ['Орбита: ', 12000, 10], land: ['Посадка: ', 20000, 18], return: ['Возвращение с тела: ', 24000, 14] }[m[1]];
  return [T[0] + b.name, Math.round(T[1] * k / 100) * 100, Math.round(T[2] * k), Math.round(5 * k)];
}
function milestone(g, id) {
  if (g.milestones[id]) return null;
  const d = milestoneDef(id);
  if (!d) return null;
  g.milestones[id] = g.ut || 1;
  earn(g, d[1]);
  if (isCareer(g)) { g.science += d[2]; g.rep += d[3]; }
  return { id, title: d[0], funds: d[1], sci: d[2] };
}
// called ~1 Hz by the flight scene; returns newly reached milestones
function progressTick(g, v, ut) {
  const out = [];
  const b = v.body, alt = V.len(v.r) - b.R;
  const fb = v.flags.bodies || (v.flags.bodies = {});
  const f = fb[b.id] || (fb[b.id] = {});
  f.soi = true;
  if (b.id !== 'earth') out.push(milestone(g, 'soi_' + b.id));
  if (b.id === 'earth') {
    if (alt > g.records.alt) g.records.alt = alt;
    for (const [k, h] of [['alt_5k', 5e3], ['alt_10k', 1e4], ['alt_20k', 2e4], ['alt_40k', 4e4]]) if (alt > h) out.push(milestone(g, k));
    if (alt > b.atm.top) out.push(milestone(g, 'space'));
  } else if (BODY.earth && !isDescendant(b, BODY.earth)) out.push(milestone(g, 'escape_earth'));
  const el = elFromState(v.r, v.v, b.mu, ut);
  const safe = b.R + (b.atm ? b.atm.top : Math.min(10000, b.R * 0.05));
  if (el.e < 1 && el.rp > safe && el.ra < b.soi && !v.landed) { f.orbit = true; out.push(milestone(g, 'orbit_' + b.id)); }
  if (v.landed && !v.prelaunch && b.id !== 'earth') { f.landed = true; out.push(milestone(g, 'land_' + b.id)); }
  if (v.landed && !v.prelaunch && b.id === 'earth' && v.launchUT != null) f.landed = true;
  contractTick(g, v, ut, el);
  return out.filter(Boolean);
}
function isDescendant(b, anc) { for (let c = b; c; c = c.parent) if (c === anc) return true; return false; }

// ---- contracts ----
const CONTRACT_TYPES = {
  alt: 'Рекорд высоты', space: 'Выход в космос', orbit: 'Выход на орбиту', flyby: 'Пролёт', land: 'Посадка',
  return: 'Посадка и возвращение', science: 'Научные данные', satellite: 'Спутник',
};
function reachableBodies(g) {
  let maxDiff = 0;
  for (const b of BODIES) if (g.milestones['soi_' + b.id]) maxDiff = Math.max(maxDiff, b.diff);
  if (!g.milestones.orbit_earth) return [BODY.earth];
  return BODIES.filter(b => b.id !== 'sun' && b.diff <= maxDiff + 1);
}
function makeContract(g, rnd) {
  const bodies = reachableBodies(g);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const types = [];
  if (!g.milestones.space) { types.push('alt', 'alt', 'space', 'science'); }
  else if (!g.milestones.orbit_earth) { types.push('orbit', 'science', 'science'); }
  else types.push('orbit', 'flyby', 'land', 'return', 'science', 'science', 'satellite');
  const type = pick(types);
  let b = pick(bodies.filter(x => type === 'land' || type === 'return' ? !x.gas : true));
  if (!b) b = BODY.earth;
  if ((type === 'flyby' || type === 'land' || type === 'return') && b.id === 'earth') b = bodies.find(x => x.id === 'moon') || BODY.moon;
  const k = 1 + b.diff * 0.9;
  const c = { id: 'c' + g.contracts.seq++, type, body: b.id, state: 'offered', made: g.ut };
  let funds = 0, sci = 0;
  switch (type) {
    case 'alt': {
      const opts = [6000, 12000, 25000, 50000].filter(h => h > g.records.alt);
      c.alt = opts.length ? opts[0] : 50000;
      c.title = `Поднимитесь выше ${(c.alt / 1000).toFixed(0)} км`;
      c.desc = 'Наберите высоту над Землёй. Подойдёт любой аппарат.';
      funds = 3000 + c.alt * 0.12; sci = 2 + c.alt / 10000;
      break;
    }
    case 'space':
      c.title = 'Достигните космоса'; c.desc = `Пересеките границу атмосферы Земли (${BODY.earth.atm.top / 1000} км).`;
      funds = 14000; sci = 8; break;
    case 'orbit':
      c.title = `Выйдите на орбиту: ${b.name}`; c.desc = `Стабильная орбита вокруг тела «${b.name}» с перицентром выше атмосферы.`;
      funds = (b.id === 'earth' ? 20000 : 26000 * k); sci = 10 * k; break;
    case 'flyby':
      c.title = `Пролёт: ${b.name}`; c.desc = `Войдите в сферу влияния тела «${b.name}».`;
      funds = 17000 * k; sci = 8 * k; break;
    case 'land':
      c.title = `Посадка: ${b.name}`; c.desc = `Совершите мягкую посадку на «${b.name}».`;
      funds = 40000 * k; sci = 20 * k; break;
    case 'return':
      c.title = `Слетайте на «${b.name}» и вернитесь`; c.desc = `Посадите аппарат на «${b.name}», затем верните его на Землю и спишите в ЦУПе.`;
      funds = 60000 * k; sci = 30 * k; break;
    case 'science': {
      const sits = ['L', 'FL', 'FH', 'SL', 'SH'].filter(s => sciMult(b, s) > 0 && (s[0] !== 'F' || b.atm) && !(s === 'L' && b.gas));
      const sit = pick(sits.length ? sits : ['SL']);
      const exps = Object.keys(EXPERIMENTS).filter(e => EXPERIMENTS[e].sits.split(' ').includes(sit) && (!EXPERIMENTS[e].needAtm || b.atm) &&
        (e === 'crew' || PARTS.some(p => p.sci === e && partUnlocked(g, p.id))));
      const exp = pick(exps.length ? exps : ['crew']);
      Object.assign(c, { exp, sit });
      c.title = `${EXPERIMENTS[exp].name}: ${b.name}`; c.desc = `Получите данные «${EXPERIMENTS[exp].name}» ${SIT_NAMES[sit]} (${b.name}) и передайте их или верните на Землю.`;
      funds = 6000 * k * (1 + sciMult(b, sit) * 0.15); sci = 6 * k; break;
    }
    case 'satellite': {
      const base = b.R + (b.atm ? b.atm.top : b.R * 0.05);
      const lo = base + (b.R * (0.1 + rnd() * 0.6));
      const hi = lo * (1 + rnd() * 0.8);
      c.ap = hi; c.pe = lo; c.tol = 0.12;
      c.inc = rnd() < 0.5 ? null : Math.round(rnd() * 8) * 10;
      c.title = `Спутник на орбите: ${b.name}`;
      c.desc = `Беспилотный аппарат (без экипажа) на орбите «${b.name}»: апоцентр ${fmtDist(hi - b.R)}, перицентр ${fmtDist(lo - b.R)} (±12%)` + (c.inc != null ? `, наклонение ${c.inc}° ±5°.` : '.');
      funds = 24000 * k + (c.inc ? 6000 : 0); sci = 8 * k; break;
    }
  }
  c.advance = Math.round(funds * 0.2 / 100) * 100;
  c.reward = Math.round(funds * 0.8 / 100) * 100;
  c.sci = Math.round(sci);
  c.rep = Math.round(3 * k);
  c.penalty = Math.round(funds * 0.25 / 100) * 100;
  c.days = Math.round((type === 'alt' || type === 'space' ? 60 : 120) * (1 + b.diff * 1.5));
  return c;
}
function refreshOffers(g, force) {
  const C = g.contracts;
  C.offered = C.offered.filter(c => c.state === 'offered');
  const rnd = rng((g.contracts.seq * 7919 + Math.floor(g.ut / DAY)) >>> 0);
  let tries = 0;
  while (C.offered.length < 5 && tries++ < 40) {
    const c = makeContract(g, rnd);
    const dupe = [...C.offered, ...C.active].some(x => x.title === c.title);
    const doneSame = c.type !== 'science' && c.type !== 'satellite' && [...C.done].some(x => x.title === c.title);
    if (!dupe && !doneSame) C.offered.push(c);
  }
  C.lastGen = g.ut;
}
function acceptContract(g, id) {
  const C = g.contracts, i = C.offered.findIndex(c => c.id === id);
  if (i < 0 || C.active.length >= 6) return false;
  const c = C.offered.splice(i, 1)[0];
  c.state = 'active'; c.accepted = g.ut; c.deadline = g.ut + c.days * DAY;
  C.active.push(c);
  earn(g, c.advance);
  refreshOffers(g);
  return true;
}
function declineContract(g, id) {
  const C = g.contracts; C.offered = C.offered.filter(c => c.id !== id); refreshOffers(g);
}
function cancelContract(g, id) {
  const C = g.contracts, i = C.active.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = C.active.splice(i, 1)[0];
  c.state = 'failed'; C.failed.push(c);
  earn(g, -c.penalty); g.rep -= c.rep;
}
function completeContract(g, c) {
  const C = g.contracts;
  C.active = C.active.filter(x => x !== c);
  c.state = 'done'; c.doneAt = g.ut; C.done.push(c);
  earn(g, c.reward);
  if (isCareer(g)) { g.science += c.sci; g.rep += c.rep; }
  (g._notify || (() => {}))(`Контракт выполнен: ${c.title}  +${fmtMoney(c.reward)}  +${c.sci} науки`);
}
function contractTick(g, v, ut, el) {
  if (!isCareer(g)) return;
  const b = v.body, alt = V.len(v.r) - b.R;
  for (const c of [...g.contracts.active]) {
    if (ut > c.deadline) { cancelContract(g, c.id); (g._notify || (() => {}))('Контракт провален (срок): ' + c.title); continue; }
    if (c.body !== b.id) continue;
    let ok = false;
    switch (c.type) {
      case 'alt': ok = alt > c.alt; break;
      case 'space': ok = b.atm && alt > b.atm.top; break;
      case 'orbit': ok = el.e < 1 && el.rp > b.R + (b.atm ? b.atm.top : 5000) && el.ra < b.soi && !v.landed; break;
      case 'flyby': ok = true; break;
      case 'land': ok = v.landed && !v.prelaunch; break;
      case 'satellite': {
        const crewed = isCrewed(v), probe = v.parts.some(p => !p.dead && PART[p.id].command && !PART[p.id].command.crew);
        ok = !crewed && probe && el.e < 1 && Math.abs(el.ra - c.ap) < c.ap * c.tol && Math.abs(el.rp - c.pe) < c.pe * c.tol &&
          (c.inc == null || Math.abs(el.inc / DEG - c.inc) < 5);
        break;
      }
    }
    if (ok) completeContract(g, c);
  }
}
function contractEvent(g, type, d) {
  if (!isCareer(g)) return;
  for (const c of [...g.contracts.active]) {
    if (type === 'science' && c.type === 'science' && c.exp === d.exp && c.body === d.body && c.sit === d.sit) completeContract(g, c);
    if (type === 'recovered' && c.type === 'return' && d.flags[c.body] && d.flags[c.body].landed) completeContract(g, c);
  }
}

// ---- vessel (de)serialization ----
function serializeVessel(v) {
  return {
    id: v.id, name: v.name, body: v.body.id, r: v.r, v: v.v, q: v.q, w: v.w || [0, 0, 0], lock: v.lock || null,
    landed: !!v.landed, prelaunch: !!v.prelaunch, parts: v.parts.map(p => ({
      id: p.id, uid: p.uid, k: p.k, pos: p.pos, dir: p.dir, ang: p.ang, role: p.role, res: p.res, T: p.T, st: p.st, data: p.data,
      dead: !!p.dead, pEdge: p.pEdge,
    })), edges: v.edges, stages: v.stages, stageIdx: v.stageIdx, throttle: 0, sas: v.sas, sasMode: v.sasMode, rcs: v.rcs,
    flags: v.flags, maxAlt: v.maxAlt, design: v.design, launchUT: v.launchUT, debris: !!v.debris, nodes: v.nodes || [],
    craftName: v.craftName || null,
  };
}
function deserializeVessel(s) {
  const v = Object.assign({}, s);
  v.body = BODY[s.body];
  v.parts = s.parts.map((p, i) => Object.assign({}, p, { rid: i }));
  v.nodes = (s.nodes || []).map(n => Object.assign({}, n));
  vesselTopology(v);
  v._comPrev = massProps(v).com.slice();
  return v;
}

// ---- persistence (localStorage) ----
const LS_PREFIX = 'orbita.';
function lsGet(k, d) { try { const x = localStorage.getItem(LS_PREFIX + k); return x == null ? d : JSON.parse(x); } catch (e) { return d; } }
function lsSet(k, val) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(val)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* ignore */ } }
function gameToJSON(g) {
  const o = {};
  for (const k in g) if (k[0] !== '_') o[k] = g[k];
  return JSON.parse(JSON.stringify(o));
}
function saveSlot(slot, g, label) {
  const data = gameToJSON(g);
  const ok = lsSet('save.' + slot, data);
  const idx = lsGet('saves', []).filter(s => s.slot !== slot);
  idx.unshift({ slot, name: g.name, label: label || '', mode: g.mode, ut: g.ut, date: Date.now(), funds: g.funds, science: g.science });
  lsSet('saves', idx.slice(0, 30));
  return ok;
}
function loadSlot(slot) {
  const g = lsGet('save.' + slot, null);
  if (!g || g.v !== SAVE_VERSION) return null;
  return g;
}
function listSaves() { return lsGet('saves', []); }
function deleteSlot(slot) { lsDel('save.' + slot); lsSet('saves', listSaves().filter(s => s.slot !== slot)); }
