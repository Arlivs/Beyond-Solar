'use strict';
// The 1957 space race: a rival agency works through the real chronology of space "firsts". Beat a date and the
// first is yours (big reward); miss it and the rival gets the headline. Historic landing sites appear as
// points of interest once they exist on the calendar. Rockets take time to build (race mode).

const RIVAL = 'Агентство «Горизонт»';
// [id, title, real date (UTC), milestone ids that count]
const RACE = [
  ['sat', 'Первый спутник', [1957, 10, 4], ['orbit_earth']],
  ['moonfly', 'Пролёт Луны', [1959, 1, 4], ['soi_moon']],
  ['crew_orbit', 'Человек на орбите', [1961, 4, 12], ['orbit_crew_earth']],
  ['venusfly', 'Пролёт Венеры', [1962, 12, 14], ['soi_venus']],
  ['eva', 'Выход в открытый космос', [1965, 3, 18], ['eva']],
  ['marsfly', 'Пролёт Марса', [1965, 7, 15], ['soi_mars']],
  ['moonland', 'Мягкая посадка на Луну', [1966, 2, 3], ['land_moon']],
  ['dock', 'Стыковка на орбите', [1966, 3, 16], ['dock']],
  ['moonorbit', 'Спутник Луны', [1966, 4, 3], ['orbit_moon']],
  ['crew_moonorbit', 'Люди на орбите Луны', [1968, 12, 24], ['orbit_crew_moon']],
  ['crew_moonland', 'Люди на Луне', [1969, 7, 20], ['land_crew_moon']],
  ['rover', 'Ровер на Луне', [1970, 11, 17], ['rover_moon']],
  ['venusland', 'Посадка на Венеру', [1970, 12, 15], ['land_venus']],
  ['station', 'Орбитальная станция', [1971, 4, 19], ['station']],
  ['marsland', 'Посадка на Марс', [1971, 12, 2], ['land_mars']],
  ['jupiter', 'Пролёт Юпитера', [1973, 12, 3], ['soi_jupiter']],
  ['mercury', 'Пролёт Меркурия', [1974, 3, 29], ['soi_mercury']],
  ['saturn', 'Пролёт Сатурна', [1979, 9, 1], ['soi_saturn']],
  ['uranus', 'Пролёт Урана', [1986, 1, 24], ['soi_uranus']],
  ['neptune', 'Пролёт Нептуна', [1989, 8, 25], ['soi_neptune']],
  ['titan', 'Посадка на Титан', [2005, 1, 14], ['land_titan']],
  ['interstellar', 'Выход в межзвёздное пространство', [2012, 8, 25], ['interstellar']],
  ['pluto', 'Пролёт Плутона', [2015, 7, 14], ['soi_pluto']],
].map(([id, title, [y, m, d], ms], i) => ({ id, title, ut: dateToUt(Date.UTC(y, m - 1, d, 12)), ms, i }));
const RACE_START = dateToUt(Date.UTC(1957, 0, 1, 12));

// reward for a first, scaled along the chronology
function raceReward(it) { return { funds: Math.round((30000 + it.i * 9000) / 1000) * 1000, rep: 12 + it.i, sci: 6 + it.i * 2 }; }

// a milestone was just reached: settle the race item it belongs to (if still open)
function raceOnMilestone(g, msId) {
  if (!g.race) return null;
  for (const it of RACE) {
    if (!it.ms.includes(msId) || g.race.items[it.id]) continue;
    const first = g.ut < it.ut;
    g.race.items[it.id] = { by: first ? 'us' : 'late', ut: g.ut };
    if (first) { const r = raceReward(it); earn(g, r.funds); g.rep += r.rep; g.science += r.sci; return { first: true, it, r }; }
    g.rep += 2;
    return { first: false, it };
  }
  return null;
}
// the rival claims every first whose date has passed; returns the ones claimed now
function raceTick(g) {
  if (!g.race) return [];
  const out = [];
  for (const it of RACE) if (!g.race.items[it.id] && g.ut >= it.ut) { g.race.items[it.id] = { by: 'rival', ut: it.ut }; g.rep -= 4; out.push(it); }
  return out;
}
function raceScore(g) { let us = 0, rival = 0; for (const k in (g.race && g.race.items) || {}) { const s = g.race.items[k].by; if (s === 'us') us++; else if (s === 'rival') rival++; } return { us, rival }; }

// ---- build times (race mode): one assembly hall, rockets are built one after another ----
function buildDays(design) { const L = layoutDesign(design); return Math.round(3 + designCost(design) / 2500 + L.length * 0.15); }
function startBuild(g, design, site) {
  const cost = designCost(design);
  if (isCareer(g) && g.funds < cost) return null;
  spend(g, cost);
  const prev = g.builds.reduce((m, b) => Math.max(m, b.ready), g.ut);
  const b = { id: 'b' + Date.now().toString(36), name: design.name, design: JSON.parse(JSON.stringify(design)), site: site || design.site || 'pad', ready: prev + buildDays(design) * DAY, cost };
  g.builds.push(b);
  return b;
}

// ---- historic landing sites: [id, name, body, lat, lon (deg), real date, race item that creates it] ----
const SITES = [
  ['luna9', '«Луна-9»', 'moon', 7.08, -64.37, [1966, 2, 3], 'moonland'],
  ['apollo11', '«Аполлон-11»', 'moon', 0.67, 23.47, [1969, 7, 20], 'crew_moonland'],
  ['lunokhod1', '«Луноход-1»', 'moon', 38.24, -35.0, [1970, 11, 17], 'rover'],
  ['luna16', '«Луна-16»', 'moon', -0.68, 56.3, [1970, 9, 20], null],
  ['apollo17', '«Аполлон-17»', 'moon', 20.19, 30.77, [1972, 12, 11], null],
  ['change4', '«Чанъэ-4»', 'moon', -45.44, 177.6, [2019, 1, 3], null],
  ['venera7', '«Венера-7»', 'venus', -5.0, -9.0, [1970, 12, 15], 'venusland'],
  ['venera9', '«Венера-9»', 'venus', 31.0, -68.4, [1975, 10, 22], null],
  ['mars3', '«Марс-3»', 'mars', -45.0, -158.0, [1971, 12, 2], 'marsland'],
  ['viking1', '«Викинг-1»', 'mars', 22.27, -49.97, [1976, 7, 20], null],
  ['pathfinder', '«Марс Пасфайндер»', 'mars', 19.13, -33.22, [1997, 7, 4], null],
  ['curiosity', '«Кьюриосити»', 'mars', -4.59, 137.44, [2012, 8, 6], null],
  ['huygens', '«Гюйгенс»', 'titan', -10.57, -167.7, [2005, 1, 14], 'titan'],
].map(([id, name, body, lat, lon, [y, m, d], raceId]) => ({ id, name, body, lat, lon, ut: dateToUt(Date.UTC(y, m - 1, d, 12)), raceId }));

// in the race a site exists once someone has landed there; otherwise once its date has passed
function siteExists(g, s) {
  if (g.race && s.raceId) { const it = g.race.items[s.raceId]; return !!it && it.by === 'rival'; }
  return g.ut >= s.ut;
}
function siteDir(s) { return [Math.cos(s.lat * DEG) * Math.cos(s.lon * DEG), Math.cos(s.lat * DEG) * Math.sin(s.lon * DEG), Math.sin(s.lat * DEG)]; }
// ground height at a site (static, cached)
function siteGround(s) { return s._gh != null ? s._gh : (s._gh = groundHeight(BODY[s.body], siteDir(s), 2)); }
// a landed vessel (or astronaut) near a site discovers it; an astronaut within 40 m inspects it
function siteCheck(g, v, ut) {
  if (!(v.landed || v.inContact)) return [];
  const out = [], b = v.body, d = V.norm(inertialToBodyFixed(b, ut, v.r));
  g.sites = g.sites || {};
  for (const s of SITES) {
    if (s.body !== b.id || !siteExists(g, s)) continue;
    const dist = Math.acos(clamp(V.dot(d, siteDir(s)), -1, 1)) * b.R, st = g.sites[s.id] || (g.sites[s.id] = {});
    const k = 1 + b.diff;
    if (!st.found && dist < 2500) { st.found = g.ut; const sci = 8 * k; if (isCareer(g)) { g.science += sci; g.rep += 3; } out.push({ s, what: 'found', sci, dist }); }
    if (!st.inspected && dist < 40 && v.parts.some(p => !p.dead && PART[p.id].kerbal)) { st.inspected = g.ut; const sci = 15 * k; if (isCareer(g)) { g.science += sci; g.rep += 5; } out.push({ s, what: 'inspected', sci, dist }); }
  }
  return out;
}
