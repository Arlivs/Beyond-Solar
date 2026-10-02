'use strict';
// DOM interface: menus, space center, VAB panels, flight HUD, R&D, mission control, tracking.

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT_COLOR = { pod: '#9fb4c9', tank: '#e8e8e8', engine: '#ff9b3a', coupling: '#e8b51c', aero: '#cfd6de', wheels: '#c9a46a', utility: '#7fd0ff', science: '#7dff6b' };

const ui = {
  root: null, el: {},
  init() { this.root = $('#ui'); },
  clear() { this.root.innerHTML = ''; this.el = {}; $('#maplayer').innerHTML = ''; MAP.labels.clear(); },
  toast(msg, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = msg;
    if (kind === 'acc' || kind === 'good') sndUi(kind === 'acc' ? 'chime' : 'beep'); else if (kind === 'bad') sndUi('bad');
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = 0; setTimeout(() => t.remove(), 450); }, ms || 3200);
    const all = $('#toasts').children; if (all.length > 6) all[0].remove();
  },
  modal(title, html, buttons, cls) {
    this.closeModal();
    const bg = document.createElement('div');
    bg.className = 'modal-bg'; bg.id = 'modal';
    bg.innerHTML = `<div class="modal panel ${cls || ''}"><h2>${title}</h2><div class="body">${html}</div><div class="btns"></div></div>`;
    const bb = bg.querySelector('.btns');
    for (const b of buttons || [{ label: 'OK' }]) {
      const e = document.createElement('button');
      e.textContent = b.label; if (b.cls) e.className = b.cls;
      e.onclick = () => { if (!b.keep) this.closeModal(); b.onClick && b.onClick(bg); };
      bb.appendChild(e);
    }
    document.body.appendChild(bg);
    return bg;
  },
  closeModal() { const m = $('#modal'); if (m) m.remove(); },
  topbar(title, extra) {
    const g = Game.g;
    const career = isCareer(g);
    return `<div class="topbar"><span class="title">${title}</span>
      <div class="res">${career ? `<span>Средства <b>${fmtMoney(g.funds)}</b></span><span class="sci">Наука <b>${g.science.toFixed(1)}</b></span><span class="rep">Репутация <b>${Math.round(g.rep)}</b></span>` : '<span class="dim">Песочница: всё открыто, деньги не тратятся</span>'}</div>
      <span class="dim mono" style="margin-left:auto">${fmtDate(g.ut)}</span>${extra || ''}</div>`;
  },

  // ---------------------------------------------------------------- main menu
  menu() {
    this.clear();
    const saves = listSaves();
    const has = saves.length > 0;
    this.root.innerHTML = `<div id="menu">
      <h1>ОРБИТА</h1>
      <div class="sub">космическая программа · Солнечная система 1:10 · реальная орбитальная механика</div>
      ${has ? `<button class="mbtn" id="m-cont">▶ Продолжить <small>— ${esc(saves[0].name)}, ${fmtDate(saves[0].ut)}</small></button>` : ''}
      <button class="mbtn" id="m-race">Космическая гонка · 1957</button>
      <button class="mbtn" id="m-career">Новая карьера</button>
      <button class="mbtn" id="m-sand">Новая песочница</button>
      <button class="mbtn" id="m-load" ${has ? '' : 'disabled'}>Загрузить…</button>
      <button class="mbtn" id="m-imp">Импорт сохранения из файла</button>
      <button class="mbtn" id="m-help">Управление</button>
      <div class="foot">Карьера: наука, контракты, дерево технологий. Песочница: все детали сразу. F1 — помощь в любой момент.</div>
    </div>`;
    if (has) $('#m-cont').onclick = () => Game.loadSlot(saves[0].slot);
    $('#m-career').onclick = () => this.newGameDlg('career');
    $('#m-sand').onclick = () => this.newGameDlg('sandbox');
    $('#m-load').onclick = () => this.loadDlg();
    $('#m-race').onclick = () => Game.newGame('career', { race: true, start: RACE_START });
    $('#m-imp').onclick = () => Game.importFile();
    $('#m-help').onclick = () => this.help();
  },

  // start date of a new game: planets stand where they really stood (or will stand) on that day
  newGameDlg(mode) {
    const today = new Date(), iso = today.toISOString().slice(0, 10);
    const m = this.modal(mode === 'career' ? 'Новая карьера' : 'Новая песочница', `<div class="dim" style="margin-bottom:8px">Планеты движутся по настоящим орбитам: в выбранный день Луна, Марс и остальные стоят там же, где на настоящем небе, и окна перелётов совпадают с реальными.</div>
      <div class="vitem" data-d="j2000"><b>1 января 2000</b><span>классическая эпоха J2000</span></div>
      <div class="vitem" data-d="today"><b>Сегодня, ${fmtDay(dateToUt(today.getTime()))}</b><span>настоящее небо над вами</span></div>
      <div class="vitem"><div class="row"><b class="grow">Своя дата</b><input type="date" id="ng-date" value="${iso}" min="1950-01-01" max="2100-12-31"><button id="ng-go">Начать</button></div></div>`, [{ label: 'Отмена' }]);
    const go = (ms) => { this.closeModal(); Game.newGame(mode, { start: ms == null ? undefined : dateToUt(ms) }); };
    m.querySelector('.body').onclick = (e) => {
      const it = e.target.closest('[data-d]'); if (it) go(it.dataset.d === 'today' ? Date.now() : null);
      if (e.target.id === 'ng-go') { const v = m.querySelector('#ng-date').value; if (v) go(Date.parse(v + 'T09:00:00Z')); }
    };
  },
  // race mode: rockets are built before they fly
  buildDlg(design, site) {
    const g = Game.g, days = buildDays(design), cost = designCost(design);
    const prev = g.builds.reduce((mx, b) => Math.max(mx, b.ready), g.ut);
    this.modal('Сборка', `<p><b>${esc(design.name)}</b> · ${layoutDesign(design).length} деталей · ${fmtMoney(cost)}</p>
      <p>Сборка займёт <b>${days} д</b>${prev > g.ut ? ` после текущей очереди` : ''}: ракета будет готова <b>${fmtDay(prev + days * DAY)}</b>.</p>
      <p class="dim">Цех собирает по одной ракете. Пока идёт сборка, календарь можно перемотать в космоцентре — соперник тоже не стоит на месте.</p>`,
      [{ label: 'Начать сборку', cls: 'acc', onClick: () => { const b = startBuild(g, design, site); if (!b) { this.toast('Не хватает средств', 'bad'); return; } g.lastCraft = JSON.parse(JSON.stringify(design)); Game.autosave(); this.toast(`В сборке: ${esc(b.name)} — готово ${fmtDay(b.ready)}`, 'good', 4000); Game.toKSC(); } }, { label: 'Отмена' }]);
  },

  // ---------------------------------------------------------------- space center
  ksc() {
    this.clear();
    const g = Game.g;
    const nAct = isCareer(g) ? g.contracts.active.length : 0;
    const nV = g.vessels.length;
    this.root.innerHTML = `<div id="ksc">${this.topbar('КОСМОЦЕНТР', `<button id="k-menu">Меню</button>`)}
      <div class="bld">
        <div class="card panel" id="k-vab"><div class="ico">🛠</div><h3>Сборочный цех</h3><p>Соберите ракету из деталей и отправьте на старт.</p></div>
        <div class="card panel" id="k-pad"><div class="ico">🚀</div><h3>Стартовый стол</h3><p>${g.lastCraft ? 'Запустить «' + esc(g.lastCraft.name) + '»' : 'Нет последней ракеты'}</p></div>
        <div class="card panel" id="k-run"><div class="ico">🛫</div><h3>Взлётная полоса</h3><p>${g.lastCraft ? 'Вывести «' + esc(g.lastCraft.name) + '» на полосу' : 'Самолёты и роверы стартуют отсюда'}</p></div>
        <div class="card panel" id="k-track"><div class="ico">🛰</div><h3>Станция слежения</h3><p>Аппаратов в полёте: ${nV}. Ускорение времени, переключение.</p></div>
        ${g.race ? `<div class="card panel" id="k-race"><div class="ico">🏁</div><h3>Гонка</h3><p>Мы ${raceScore(g).us} : ${raceScore(g).rival} ${RIVAL}. Следующий рубеж: ${esc((RACE.find(it => !g.race.items[it.id]) || { title: '—' }).title)}</p></div>` : ''}
        ${g.race || g.builds.length ? `<div class="card panel wide" id="k-build"><div class="ico">🏗</div><h3>Сборка</h3>${g.builds.length ? g.builds.map(b => `<div class="row" style="margin:3px 0"><span class="grow">${esc(b.name)} · ${b.ready <= g.ut ? '<b class="good">готова</b>' : 'готова ' + fmtDay(b.ready)}</span>${b.ready <= g.ut ? `<button data-launch="${b.id}" class="acc">На ${b.site === 'runway' ? 'полосу' : 'стол'}</button>` : ''}<button data-cancel="${b.id}" class="danger" title="Разобрать: вернётся 80%">✕</button></div>`).join('') + (g.builds.some(b => b.ready > g.ut) ? `<button id="k-wait" style="margin-top:4px">Ждать готовности (${fmtDur(Math.min(...g.builds.filter(b => b.ready > g.ut).map(b => b.ready)) - g.ut, true)})</button>` : '') : '<p>Цех свободен. Соберите ракету и нажмите «Запуск».</p>'}</div>` : ''}
        ${REC.data && REC.data.frames.length > 4 ? `<div class="card panel" id="k-rpl"><div class="ico">🎬</div><h3>Повтор полёта</h3><p>«${esc(REC.data.name)}»: кинокамеры и запись видео.</p></div>` : ''}
        <div class="card panel" id="k-crew"><div class="ico">👩‍🚀</div><h3>Отряд космонавтов</h3><p>Готовы к полёту: ${g.crew.filter(c => c.status === 'ready').length}, в полёте: ${g.crew.filter(c => c.status === 'flight').length}.</p></div>
        ${isCareer(g) ? `<div class="card panel" id="k-rnd"><div class="ico">🔬</div><h3>НИИ</h3><p>Дерево технологий. Наука: ${g.science.toFixed(0)}</p></div>
        <div class="card panel" id="k-mc"><div class="ico">📡</div><h3>ЦУП</h3><p>Контракты: активных ${nAct}, предложений ${g.contracts.offered.length}.</p></div>` : ''}
        <div class="card panel" id="k-save"><div class="ico">💾</div><h3>Сохранить</h3><p>Слоты в браузере, экспорт в файл.</p></div>
      </div></div>`;
    $('#k-vab').onclick = () => Game.openVAB();
    $('#k-pad').onclick = () => g.lastCraft && Game.launch(JSON.parse(JSON.stringify(g.lastCraft)), 'pad');
    $('#k-run').onclick = () => g.lastCraft && Game.launch(JSON.parse(JSON.stringify(g.lastCraft)), 'runway');
    $('#k-track').onclick = () => Game.openTracking();
    $('#k-crew').onclick = () => Game.openScreen('crew');
    if ($('#k-rpl')) $('#k-rpl').onclick = () => Game.openReplay();
    if (g.race) $('#k-race').onclick = () => Game.openScreen('race');
    const kb = $('#k-build');
    if (kb) kb.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      if (b.id === 'k-wait') { Game.skipTo(Math.min(...g.builds.filter(x => x.ready > g.ut).map(x => x.ready))); this.ksc(); return; }
      const B = g.builds.find(x => x.id === (b.dataset.launch || b.dataset.cancel)); if (!B) return;
      g.builds = g.builds.filter(x => x !== B);
      if (b.dataset.launch) Game.launch(B.design, B.site, true);
      else { earn(g, B.cost * 0.8); this.toast('Ракета разобрана', '', 1500); Game.autosave(); this.ksc(); }
    };
    if (isCareer(g)) { $('#k-rnd').onclick = () => Game.openScreen('rnd'); $('#k-mc').onclick = () => Game.openScreen('mc'); }
    $('#k-save').onclick = () => this.saveDlg();
    $('#k-menu').onclick = () => this.modal('Меню', '', [
      { label: 'Загрузить', onClick: () => this.loadDlg() },
      { label: 'Экспорт в файл', onClick: () => Game.exportFile() },
      { label: 'Настройки', onClick: () => this.gfxDlg() },
      { label: 'Главное меню', onClick: () => Game.toMenu() },
      { label: 'Закрыть' }]);
  },

  // ---------------------------------------------------------------- VAB
  vab() {
    this.clear();
    const d = VAB.design;
    this.root.innerHTML = `<div id="vab">${this.topbar('СБОРОЧНЫЙ ЦЕХ', `<input id="v-name" value="${esc(d.name)}" style="width:180px"><button id="v-new">Новая</button><button id="v-load">Загрузить</button><button id="v-save">Сохранить</button><button id="v-crew">Экипаж</button><button id="v-share" title="Ссылка или код ракеты">Ссылка</button><button id="v-site">Старт: ${d.site === 'runway' ? 'полоса' : 'стол'}</button><button id="v-ksc">Выйти</button><button class="acc" id="v-launch">Запуск ▶</button>`)}
      <div class="pal panel"><div class="tabs" id="v-tabs"></div><div class="plist scroll" id="v-plist"></div><div class="pinfo" id="v-pinfo"><span class="dim">Выберите деталь слева, затем щёлкните по зелёному узлу или по борту ракеты.</span></div></div>
      <div class="tools"><div class="row sym"><span class="dim">Симметрия (X):</span><span id="v-sym"></span></div>
        <button id="v-snap">Привязка: выкл</button><button id="v-undo">↶ Отмена</button><button id="v-redo">↷</button><button id="v-del">Удалить взятое (Del)</button></div>
      <div class="side panel"><div class="stats" id="v-stats"></div><div class="staging scroll" id="v-stg"></div></div>
      <div class="hint">Щелчок по детали ракеты — взять её со всем, что ниже (Alt — только её) · щелчок по узлу или борту — прикрепить · щелчок по каталогу — удалить · ПКМ/Esc — вернуть на место · тяните кабину, чтобы поднять или опустить ракету · колесо — масштаб · ПКМ-тяга или Shift+колесо — камера вверх/вниз · Shift+клик — ставить серию</div></div>`;
    $('#v-name').oninput = (e) => { VAB.design.name = e.target.value; };
    $('#v-new').onclick = () => { vabPush(); vabOpen({ name: 'Новая ракета', stack: [], stages: [] }); this.vab(); };
    $('#v-load').onclick = () => this.craftDlg();
    $('#v-save').onclick = () => { Game.saveCraft(VAB.design); this.toast('Сохранено: ' + esc(VAB.design.name), 'good'); };
    $('#v-ksc').onclick = () => Game.toKSC();
    $('#v-crew').onclick = () => this.crewDlg();
    $('#v-share').onclick = () => this.shareDlg(VAB.design);
    $('#v-site').onclick = (e) => { VAB.design.site = VAB.design.site === 'runway' ? 'pad' : 'runway'; e.target.textContent = 'Старт: ' + (VAB.design.site === 'runway' ? 'полоса' : 'стол'); this.toast(VAB.design.site === 'runway' ? 'Старт с полосы: нос на восток, брюхом вниз — шасси крепите вниз (−90°)' : 'Старт со стартового стола', '', 3000); };
    $('#v-launch').onclick = () => Game.launch(JSON.parse(JSON.stringify(VAB.design)));
    $('#v-undo').onclick = () => vabUndo(); $('#v-redo').onclick = () => vabRedo();
    $('#v-del').onclick = () => vabDiscardHeld();
    // clicking the catalogue while holding a part deletes it (KSP-style)
    $('#vab .pal').addEventListener('mousedown', (e) => {
      if (!VAB.held || e.target.closest('.tabs')) return;
      if (VAB.held.kind !== 'new' || !e.target.closest('.pcard')) { e.stopPropagation(); e.preventDefault(); vabDiscardHeld(); }
    }, true);
    $('#v-snap').onclick = (e) => { VAB.snap = !VAB.snap; e.target.textContent = 'Привязка: ' + (VAB.snap ? 'вкл' : 'выкл'); e.target.classList.toggle('on', VAB.snap); };
    this.vabPalette();
    this.vabRefresh();
  },
  vabPalette() {
    const tabs = $('#v-tabs'); if (!tabs) return;
    tabs.innerHTML = CATS.map(([id, n]) => `<button data-c="${id}" class="${VAB.cat === id ? 'on' : ''}">${n}</button>`).join('');
    tabs.onclick = (e) => { const c = e.target.dataset.c; if (c) { VAB.cat = c; this.vabPalette(); } };
    const g = Game.g;
    const list = PARTS.filter(p => p.cat === VAB.cat && !p.hidden && partUnlocked(g, p.id));
    const heldId = VAB.held && VAB.held.kind === 'new' ? VAB.held.id : null;
    $('#vab .pal').classList.toggle('holding', !!VAB.held);
    $('#v-plist').innerHTML = list.map(p => `<div class="pcard ${heldId === p.id ? 'held' : ''}" data-id="${p.id}"><b>${esc(p.name)}</b><span>${p.wetMass.toFixed(p.wetMass < 1 ? 3 : 2)} т · ${fmtMoney(p.fullCost)}</span>${p.engine ? `<span><br>${p.engine.thrust} кН · ${p.engine.ispVac} с</span>` : p.res.LFO ? `<span><br>топливо ${p.res.LFO} т</span>` : ''}</div>`).join('') ||
      '<div class="dim">В этой категории пока нет открытых деталей.</div>';
    $('#v-plist').onclick = (e) => {
      const c = e.target.closest('.pcard'); if (!c) return;
      if (VAB.held && VAB.held.kind !== 'new') return;   // handled as delete in capture
      VAB.held = heldId === c.dataset.id ? null : { kind: 'new', id: c.dataset.id };
      this.vabPalette(); this.vabHover(VAB.held ? PART[c.dataset.id] : null);
    };
    $('#v-plist').onmouseover = (e) => { const c = e.target.closest('.pcard'); if (c) this.vabHover(PART[c.dataset.id]); };
  },
  vabHover(p) {
    const el = $('#v-pinfo'); if (!el) return;
    if (!p) {
      const hd = heldDef();
      el.innerHTML = hd ? `<b>${esc(hd.name)}</b>${VAB.held.kind !== 'new' ? ' <span class="accent">(взята с ракеты)</span>' : ''}<br><span class="dim">${heldMode() === 'surface' ? 'Крепится на борт: наведите на любую деталь ракеты.' : 'Наведите на зелёный узел или на борт любой детали.'} Щелчок по каталогу — удалить.</span>` : '<span class="dim">Выберите деталь слева или щёлкните по детали ракеты, чтобы взять её.</span>';
      return;
    }
    const res = Object.entries(p.res).map(([k, v]) => `${RES_NAMES[k]}: ${k === 'ELEC' ? v : v.toFixed(3) + ' т'}`).join(', ');
    el.innerHTML = `<b>${esc(p.name)}</b><br><span class="dim">${esc(p.desc || '')}</span><br>
      Масса: ${p.mass.toFixed(3)} т сухая / ${p.wetMass.toFixed(3)} т полная · ${fmtMoney(p.fullCost)}<br>
      ${p.engine ? `Тяга ${p.engine.thrust} кН (вакуум), УИ ${p.engine.ispSL}/${p.engine.ispVac} с${p.engine.gimbal ? ', качание ' + p.engine.gimbal + '°' : ''}<br>` : ''}
      ${res ? res + '<br>' : ''}${p.command ? `Экипаж: ${p.command.crew}, маховик ${p.command.torque} кН·м<br>` : ''}
      Макс. темп. ${p.maxTemp} K · удар ${p.crash} м/с · ${p.attach === 'radial' ? 'радиальная' : `стек ${p.dTop}/${p.dBot} м`}`;
  },
  vabRefresh() {
    const s = $('#v-sym'); if (!s) return;
    s.innerHTML = [1, 2, 3, 4, 6, 8].map(n => `<button data-s="${n}" class="${VAB.sym === n ? 'on' : ''}">×${n}</button>`).join('');
    s.onclick = (e) => { const n = +e.target.dataset.s; if (n) { VAB.sym = n; this.vabRefresh(); } };
    const st = vabStats();
    const sb = $('#v-stats');
    if (!st) { sb.innerHTML = '<div class="ttl">Характеристики</div><span class="dim">Начните с командного модуля (капсула или зонд).</span>'; $('#v-stg').innerHTML = ''; return; }
    const bodies = BODIES.filter(b => !b.gas && b.vis.type !== 'star' && b.R > 5e4);
    let tv = 0, ts = 0;
    const rows = st.stages.map(x => { tv += x.dvVac; ts += x.dvSL; return `<tr><td>${x.n}</td><td>${x.dvVac.toFixed(0)}</td><td>${x.dvSL.toFixed(0)}</td><td class="${x.twr > 0 && x.twr < 1 ? 'bad' : ''}">${x.twr ? x.twr.toFixed(2) : '—'}</td><td>${x.time ? x.time.toFixed(0) + 'с' : ''}</td></tr>`; }).reverse().join('');
    sb.innerHTML = `<div class="ttl">Характеристики</div>
      <div class="kv row"><span>Масса</span><b class="grow" style="text-align:right">${st.mass.toFixed(2)} т (сухая ${st.dry.toFixed(2)})</b></div>
      <div class="kv row"><span>Стоимость</span><b class="grow" style="text-align:right">${fmtMoney(st.cost)}</b></div>
      <div class="kv row"><span>Деталей / высота</span><b class="grow" style="text-align:right">${st.parts} / ${st.height.toFixed(1)} м</b></div>
      ${st.command ? '' : '<div class="bad">Нет командного модуля — кораблём нельзя управлять.</div>'}
      <div class="row" style="margin:6px 0"><span class="dim">Расчёт для:</span><select id="v-body">${bodies.map(b => `<option value="${b.id}" ${b.id === VAB.statBody ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>
      <table><tr><th>Ступ.</th><th>Δv вак</th><th>Δv атм</th><th>TWR</th><th>t</th></tr>${rows}
      <tr><td><b>Всего</b></td><td><b>${tv.toFixed(0)}</b></td><td><b>${ts.toFixed(0)}</b></td><td></td><td></td></tr></table>
      <div class="dim" style="margin-top:4px;font-size:11px">До орбиты Земли нужно ≈3400 м/с, к Луне и обратно ≈6000.</div>`;
    $('#v-body').onchange = (e) => { VAB.statBody = e.target.value; this.vabRefresh(); };
    // staging list (top = last stage), drag items between stages
    const d = VAB.design;
    const tplName = new Map(); const tplCount = new Map();
    for (const it of VAB.layout) { tplName.set(it.uid, it.def); tplCount.set(it.uid, (tplCount.get(it.uid) || 0) + 1); }
    const disp = d.stages.map((st2, i) => ({ dv: st.stages[i] ? st.stages[i].dvVac : 0, items: st2.filter(u => tplName.has(u)).map(u => ({ key: u, def: tplName.get(u), n: tplCount.get(u) })) }));
    $('#v-stg').innerHTML = `<div class="row"><div class="ttl grow">Ступени — перетаскивайте детали</div><button id="v-auto" style="padding:2px 8px;font-size:11px">Авто</button></div><div id="v-stl"></div>`;
    this.stageList($('#v-stl'), disp, 0, -1, (key, to, isNew) => vabMoveStageItem(key, to, isNew));
    $('#v-auto').onclick = () => vabAutoStage();
  },
  // shared drag-and-drop stage list. stages: [{dv, items:[{key, def, n}]}] in firing order;
  // first: first index shown; cur: index highlighted as next. onMove(key, toIndex, newStage)
  stageList(el, stages, first, cur, onMove) {
    const total = stages.length;
    let html = `<div class="gap" data-to="${total}"></div>`;
    for (let i = total - 1; i >= first; i--) {
      const s2 = stages[i];
      if (!s2.items.length) continue;
      html += `<div class="stage ${i === cur ? 'cur' : ''}" data-si="${i}"><div class="sh"><span>Ступень ${total - 1 - i}</span><span>${s2.dv > 0 ? 'Δv ' + s2.dv.toFixed(0) + ' м/с' : ''}</span></div>` +
        s2.items.map(it => `<div class="si" draggable="true" data-key="${it.key}" data-from="${i}"><i class="dot" style="background:${CAT_COLOR[it.def.cat]}"></i>${esc(it.def.name)}${it.n > 1 ? ' ×' + it.n : ''}<span class="grip">⋮⋮</span></div>`).join('') + '</div>' +
        `<div class="gap" data-to="${i}"></div>`;
    }
    el.innerHTML = html;
    el.ondragstart = (e) => {
      const it = e.target.closest('.si'); if (!it) return;
      ui._dragging = true;
      e.dataTransfer.setData('text/plain', it.dataset.key + '|' + it.dataset.from);
      e.dataTransfer.effectAllowed = 'move';
      it.classList.add('dragging');
    };
    el.ondragend = () => { ui._dragging = false; el.querySelectorAll('.over').forEach(x => x.classList.remove('over')); };
    el.ondragover = (e) => {
      const t = e.target.closest('.stage, .gap'); if (!t) return;
      if (t.dataset.si != null && +t.dataset.si < first) return;
      e.preventDefault();
      el.querySelectorAll('.over').forEach(x => x !== t && x.classList.remove('over'));
      t.classList.add('over');
    };
    el.ondrop = (e) => {
      e.preventDefault();
      ui._dragging = false;
      const t = e.target.closest('.stage, .gap'); if (!t) return;
      const [key, from] = e.dataTransfer.getData('text/plain').split('|');
      if (t.classList.contains('gap')) onMove(key, Math.max(first, +t.dataset.to), true, +from);
      else if (+t.dataset.si !== +from) onMove(key, +t.dataset.si, false, +from);
    };
  },
  async shareDlg(design) {
    if (!design.stack.length) { this.toast('Ракета пуста', 'bad'); return; }
    const code = await craftEncode(design), link = location.href.split('#')[0] + '#craft=' + code;
    const m = this.modal('Поделиться ракетой', `<p>«${esc(design.name)}» · ${layoutDesign(design).length} деталей · код ${code.length} символов.</p>
      <div class="ttl">Ссылка</div><textarea id="sh-link" readonly rows="3" style="width:100%">${esc(link)}</textarea>
      <div class="ttl" style="margin-top:8px">Код (вставляется в «Загрузить» → «Код или ссылка»)</div><textarea id="sh-code" readonly rows="3" style="width:100%">${esc(code)}</textarea>
      <div class="dim" style="margin-top:6px;font-size:12px">Ссылка откроет ракету у того, у кого игра открыта по тому же адресу (например, опубликована). Код работает везде.</div>`,
      [{ label: 'Скопировать ссылку', cls: 'acc', keep: true, onClick: () => this.copyText(link) }, { label: 'Скопировать код', keep: true, onClick: () => this.copyText(code) }, { label: 'Закрыть' }]);
    void m;
  },
  copyText(s) {
    const ok = () => this.toast('Скопировано', 'good', 1200);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(ok, () => this.toast('Не удалось скопировать — выделите текст вручную', 'bad'));
    else this.toast('Буфер обмена недоступен — выделите текст вручную', 'bad');
  },
  craftDlg() {
    const g = Game.g;
    const own = Object.values(g.crafts);
    const stock = stockDesigns().filter(d => designAllowed(g, d));
    const item = (d, src) => `<div class="vitem" data-src="${src}" data-n="${esc(d.name)}"><b>${esc(d.name)}</b><span>${layoutDesign(d).length} дет. · ${designMass(d).toFixed(1)} т · ${fmtMoney(designCost(d))}</span></div>`;
    const m = this.modal('Загрузить ракету', `<div class="ttl">Ваши ракеты</div>${own.map(d => item(d, 'own')).join('') || '<div class="dim">Пока нет сохранённых.</div>'}
      <div class="ttl" style="margin-top:10px">Стандартные</div>${stock.map(d => item(d, 'stock')).join('') || '<div class="dim">Откройте больше технологий.</div>'}
      <div class="ttl" style="margin-top:10px">Код или ссылка</div><div class="row"><input id="cr-code" class="grow" placeholder="ORB1… или ссылка с #craft="><button id="cr-paste">Открыть</button></div>`, [{ label: 'Закрыть' }]);
    m.querySelector('#cr-paste').onclick = async () => {
      try { const d = await craftDecode(m.querySelector('#cr-code').value); if (isCareer(g) && !designAllowed(g, d)) this.toast('В ракете есть неизученные детали: запустить её пока нельзя', '', 3500); vabPush(); vabOpen(d); this.closeModal(); this.vab(); }
      catch (e) { this.toast('Не получилось прочитать: ' + esc(e.message), 'bad'); }
    };
    m.querySelector('.body').onclick = (e) => {
      const it = e.target.closest('.vitem'); if (!it) return;
      const src = it.dataset.src === 'own' ? g.crafts[it.dataset.n] : stock.find(d => d.name === it.dataset.n);
      vabPush(); vabOpen(JSON.parse(JSON.stringify(src))); this.closeModal(); this.vab();
    };
  },

  // ---------------------------------------------------------------- flight HUD
  flight() {
    this.clear();
    const sasBtn = (m, t) => `<button data-sas="${m}" title="${t}"><img src="${markerTex(m === 'stab' ? 'pro' : m).image.toDataURL()}" ${m === 'stab' ? 'style="filter:grayscale(1) brightness(2)"' : ''}></button>`;
    this.root.innerHTML = `<div id="hud">
      <div class="top">
        <div class="warp panel"><button id="h-wd">◀◀</button><div class="lv" id="h-wl"></div><button id="h-wu">▶▶</button><span id="h-wr">×1</span><span class="dim" id="h-date"></span></div>
        <div class="altbox panel"><div class="v" id="h-alt">0 м</div><div class="l" id="h-radar" style="color:#9fe8ff"></div><div class="l" id="h-sit"></div></div>
        <div class="tbtn"><button id="h-alarm" title="Будильник">⏰</button><button id="h-plan" title="Планировщик перелётов">Перелёты</button><button id="h-map">Карта (M)</button><button id="h-menu">Меню (Esc)</button></div>
      </div>
      <div class="stages panel scroll" id="h-stages"></div>
      <div class="right scroll">
        <div class="panel" id="h-orbit"></div>
        <div class="panel" id="h-res"></div>
        <div class="panel" id="h-act"></div>
      </div>
      <div class="bottom">
        <div class="spd panel" id="h-spd"><div class="m" id="h-spdm">ОРБИТА</div><div class="v" id="h-spdv">0 м/с</div></div>
        <div class="hdg" id="h-hdg"></div>
        <div class="nbframe"><svg viewBox="0 0 190 190"><path d="M70 97 L83 97 L95 107 L107 97 L120 97" stroke="#ffb13a" stroke-width="4" fill="none" stroke-linejoin="round"/><circle cx="95" cy="95" r="3" fill="#ffb13a"/></svg></div>
        <div class="thr panel"><div class="fill" id="h-thr"></div><div class="lbl" id="h-thrl">0%</div></div>
        <div class="ind"><span id="h-sasi">SAS</span><span id="h-rcsi">RCS</span><span id="h-gi">ОПОРЫ</span><span id="h-bi">ТОРМ</span><span id="h-pi">ТОЧН</span></div>
        <div class="sas">${sasBtn('stab', 'Стабилизация')}${sasBtn('node', 'Манёвр')}${sasBtn('pro', 'Прогрейд')}${sasBtn('retro', 'Ретрогрейд')}${sasBtn('normal', 'Нормаль')}${sasBtn('anti', 'Антинормаль')}${sasBtn('radout', 'Радиально наружу')}${sasBtn('radin', 'Радиально внутрь')}<button class="half" data-sas="target" title="Носом на цель">К цели</button><button class="half" data-sas="antitarget" title="Кормой к цели">От цели</button></div>
      </div>
      <div class="dockind panel" id="h-dock" style="display:none"></div>
      <div class="tmark" id="h-tmark" style="display:none"><i></i><span></span></div>
      <div class="imark" id="h-imark" style="display:none"><i>✕</i><span></span></div>
      <div id="h-sites"></div>
      <div id="mnv" class="panel" style="display:none"></div>
    </div>`;
    $('#h-wd').onclick = () => Game.warpDown(); $('#h-wu').onclick = () => Game.warpUp();
    $('#h-map').onclick = () => Game.toggleMap(); $('#h-menu').onclick = () => this.pause();
    $('#h-alarm').onclick = () => this.alarms(); $('#h-plan').onclick = () => this.planner();
    $('#h-spd').onclick = () => Game.toggleSpeedMode();
    $('#h-sasi').onclick = () => Game.toggleSAS(); $('#h-rcsi').onclick = () => Game.toggleRCS(); $('#h-gi').onclick = () => Game.toggleLegs();
    $('#h-pi').onclick = () => { Game.precise = !Game.precise; };
    this.root.querySelector('.sas').onclick = (e) => { const b = e.target.closest('button'); if (b) Game.setSASMode(b.dataset.sas); };
    $('#h-act').onclick = (e) => { const b = e.target.closest('button[data-a]'); if (b) Game.action(b.dataset.a, b.dataset.r, b.dataset.x); };
    $('#h-stages').ondblclick = (e) => { if (e.target.closest('.stage.cur')) Game.stage(); };
    this._hudT = 0;
  },
  hud(force) {
    const W = Game.world, v = W && W.active;
    if (!v || !$('#hud')) return;
    const now = performance.now();
    const t = Game.g.ut;
    const b = v.body, alt = V.len(v.r) - b.R;
    // fast fields every frame
    const radar = v.radarAlt != null && !b.gas ? v.radarAlt : null;
    $('#h-alt').textContent = fmtDist(alt);
    const ra = $('#h-radar'); if (ra) ra.textContent = radar != null && radar < 20000 ? 'над поверхностью ' + fmtDist(Math.max(0, radar)) : '';
    const mode = navSpeedMode(v);
    const sv = navVelocity(v);
    $('#h-spdm').textContent = mode === 'surface' ? 'ПОВЕРХНОСТЬ' : mode === 'target' && v.tgtRel ? 'ЦЕЛЬ' : 'ОРБИТА';
    $('#h-spdv').textContent = fmtSpeed(V.len(sv));
    this.targetMarker(W, v, t);
    // historic sites within 15 km: a label over each
    const hs = $('#h-sites');
    if (hs) {
      let html = '';
      if (!W.map) for (const s of SITES) {
        if (s.body !== b.id || !siteExists(Game.g, s)) continue;
        const d = siteDir(s), abs = V.add(bodyAbsPos(b, t), bodyFixedToInertial(b, t, V.scale(d, b.R + siteGround(s) + 3)));
        const dist = V.dist(abs, V.add(bodyAbsPos(b, t), v.r)); if (dist > 15000) continue;
        const xy = projectAbs(abs); if (!xy) continue;
        const st = (Game.g.sites || {})[s.id] || {};
        html += `<div class="smark" style="transform:translate(${xy[0].toFixed(0)}px,${xy[1].toFixed(0)}px)"><i>${st.found ? '◆' : '◇'}</i>${esc(s.name)} · ${fmtDist(dist)}</div>`;
      }
      if (hs._h !== html) { hs.innerHTML = html; hs._h = html; }
    }
    const im = $('#h-imark');
    if (im) {
      const xy = !W.map && W.impact && projectAbs(V.add(bodyAbsPos(W.impact.body, t), bodyFixedToInertial(W.impact.body, t, W.impact.pF)));
      if (xy) { im.style.display = ''; im.style.transform = `translate(${xy[0].toFixed(1)}px, ${xy[1].toFixed(1)}px)`; im.lastChild.textContent = `посадка через ${fmtDur(W.impact.t - t, true)}`; } else im.style.display = 'none';
    }
    const thr = v.throttle;
    $('#h-thr').style.height = (thr * 164) + 'px';
    $('#h-thrl').textContent = Math.round(thr * 100) + '%';
    if (!force && now - this._hudT < 120) return;
    this._hudT = now;
    const up = V.norm(v.r), north = V.norm(V.reject([0, 0, 1], up)), east = V.cross(north, up);
    const fwd = Q.rot(ctrlQ(v), [0, 1, 0]);
    const pitch = Math.asin(clamp(V.dot(fwd, up), -1, 1)) / DEG;
    const hdg = wrap2Pi(Math.atan2(V.dot(fwd, east), V.dot(fwd, north))) / DEG;
    const vs = V.dot(v.v, up);
    $('#h-hdg').textContent = `курс ${hdg.toFixed(0).padStart(3, '0')}° · тангаж ${pitch.toFixed(0)}° · верт ${vs.toFixed(1)} м/с`;
    const bmId = vesselBiome(v, t), bm = bmId && biomeById(b, bmId);
    $('#h-sit').textContent = situationText(v, t) + (bm ? ' · ' + bm.name : '');
    $('#h-date').textContent = fmtDate(t) + (v.launchUT != null ? ' · T+' + fmtDur(t - v.launchUT, true) : '');
    // warp
    const lv = $('#h-wl');
    const n = W.warp > 0 ? W.warp : W.physWarp;
    lv.innerHTML = Game.warpLevels.slice(1).map((_, i) => `<i class="${W.warp > 0 && i < W.warp ? 'on' : W.warp === 0 && i < W.physWarp ? 'phys' : ''}"></i>`).join('');
    $('#h-wr').textContent = '×' + Game.warpRate().toLocaleString('ru-RU') + (W.warp === 0 && W.physWarp ? ' физ' : '');
    void n;
    // indicators
    $('#h-sasi').className = v.sas ? 'on' : ''; $('#h-rcsi').className = v.rcs ? 'on' : '';
    $('#h-gi').className = v.legs ? 'on' : ''; $('#h-pi').className = Game.precise ? 'on' : ''; $('#h-bi').className = Game.keys.KeyB && !isKerbalVessel(v) ? 'on' : '';
    $('#h-gi').textContent = v.parts.some(p => !p.dead && PART[p.id].gear && PART[p.id].gear.retract) ? 'ШАССИ' : 'ОПОРЫ';
    if (!hasControl(v)) $('#h-sasi').className = 'warn';
    this.root.querySelectorAll('.sas button').forEach(bt => { bt.classList.toggle('on', v.sas && bt.dataset.sas === v.sasMode); bt.classList.toggle('locked', !sasAllowed(Game.g, v, bt.dataset.sas)); });
    // orbit panel
    let oh = '<div class="ttl">Траектория</div>';
    if (!v.landed && !v.prelaunch) {
      const el = elFromState(v.r, v.v, b.mu, t);
      const kv = (k, x) => `<div class="kv"><span>${k}</span><b>${x}</b></div>`;
      const tAp = el.e < 1 ? elTimeAtNu(el, Math.PI, t) - t : NaN, tPe = elTimeAtNu(el, 0, t);
      oh += kv('Тело', b.name) + kv('Апоцентр', el.e < 1 ? fmtDist(el.ra - b.R) : '∞') + (el.e < 1 ? kv('  до Ап', fmtDur(tAp, true)) : '') +
        kv('Перицентр', fmtDist(el.rp - b.R)) + (tPe != null ? kv('  до Пе', fmtDur(tPe - t, true)) : '') +
        kv('Наклонение', (el.inc / DEG).toFixed(2) + '°') + kv('Эксцентриситет', el.e.toFixed(4)) + (el.e < 1 ? kv('Период', fmtDur(el.T, true)) : '') +
        kv('Перегрузка', (v.accel || 0).toFixed(2) + ' g');
      if (v.dynP > 1) oh += kv('Скор. напор', (v.dynP / 1000).toFixed(1) + ' кПа');
      if (b.atm && alt < b.atm.top) {
        const ua = Q.invRot(v.q, V.sub(v.v, V.cross(bodyOmega(b), v.r))), sp = V.len(ua);
        if (sp > 5) oh += kv('Мах', (sp / 340).toFixed(2)) + kv('Угол атаки', (Math.atan2(-ua[2], ua[1]) / DEG).toFixed(1) + '°');
      }
      if (W.traj) { const enc = W.traj.find(p => p.end === 'enter'); if (enc) oh += kv('Встреча', enc.next.name + ' через ' + fmtDur(enc.t1 - t, true)); }
      if (W.impact) {
        const im = W.impact, ksc = b.id === 'earth' ? Math.acos(clamp(Math.cos(im.lat) * Math.cos(im.lon - KSC.lon) * Math.cos(KSC.lat) + Math.sin(im.lat) * Math.sin(KSC.lat), -1, 1)) * b.R : null;
        oh += `<div class="kv" style="margin-top:4px"><span>Посадка (прогноз)</span><b style="color:#ff9a6a">через ${fmtDur(im.t - t, true)}</b></div>` + kv('  скорость касания', fmtSpeed(im.speed)) + (ksc != null ? kv('  до космоцентра', fmtDist(ksc)) : '');
      }
      const ts = targetState(W, t);
      if (ts) {
        const me = V.add(bodyAbsPos(b, t), v.r);
        oh += `<div class="kv" style="margin-top:4px"><span>Цель</span><b style="color:#ff8ae0">${esc(targetName(W))}</b></div>` + kv('Расстояние', fmtDist(V.dist(me, ts.r))) + (v.tgtRel ? kv('Отн. скорость', fmtSpeed(V.len(v.tgtRel))) : '');
        if (W.closest) oh += kv('Сближение', `${fmtDist(W.closest.d)} ${W.closest.t - t > 1 ? 'через ' + fmtDur(W.closest.t - t, true) : 'сейчас'}`) + (W.closest.relV != null ? kv('  скорость там', fmtSpeed(W.closest.relV)) : '');
      }
    } else oh += `<div class="kv"><span>${v.prelaunch ? (v.site === 'runway' ? 'На взлётной полосе' : 'На стартовом столе') : 'На поверхности'}</span><b>${b.name}</b></div>`;
    const hot = v.parts.filter(p => !p.dead).map(p => [p, p.T / PART[p.id].maxTemp]).sort((a, c) => c[1] - a[1])[0];
    if (hot && hot[1] > 0.35) oh += `<div class="kv"><span>Нагрев: ${esc(PART[hot[0].id].name)}</span><b class="${hot[1] > 0.8 ? 'bad' : ''}">${Math.round(hot[0].T)} K</b></div><div class="bar"><i style="width:${Math.min(100, hot[1] * 100)}%;background:${hot[1] > 0.8 ? 'var(--bad)' : 'var(--acc)'}"></i></div>`;
    $('#h-orbit').innerHTML = oh;
    // resources
    let rh = '<div class="ttl">Ресурсы</div>';
    const stageRes = Game.stageResources(v);
    for (const k of ['LFO', 'SOLID', 'MONO', 'ELEC', 'XENON', 'ABLATOR']) {
      const mx = vesselResMax(v, k); if (mx <= 0) continue;
      const cur = vesselRes(v, k);
      rh += `<div class="kv"><span>${RES_NAMES[k]}</span><b>${k === 'ELEC' ? cur.toFixed(0) : cur.toFixed(2)} / ${k === 'ELEC' ? mx.toFixed(0) : mx.toFixed(2)}</b></div><div class="bar"><i style="width:${(cur / mx * 100).toFixed(1)}%"></i></div>`;
    }
    const ekp = isKerbalVessel(v) ? kerbalPart(v) : null;
    if (ekp) rh += `<div class="kv"><span>Ранец ${v.evaJet ? '(вкл)' : '(выкл)'}</span><b>${(ekp.st.evaFuel || 0).toFixed(2)} / ${EVA.fuel}</b></div><div class="bar"><i style="width:${((ekp.st.evaFuel || 0) / EVA.fuel * 100).toFixed(0)}%"></i></div><div class="kv"><span>Δv ранца</span><b>${((ekp.st.evaFuel || 0) * EVA.dvPerUnit).toFixed(0)} м/с</b></div>`;
    if (stageRes) rh += `<div class="kv"><span>Топливо ступени</span><b>${stageRes.cur.toFixed(2)} / ${stageRes.max.toFixed(2)} т</b></div>`;
    const sim = Game.flightDV(v);
    if (sim) rh += `<div class="kv"><span>Δv ступени / всего</span><b>${sim.cur.toFixed(0)} / ${sim.total.toFixed(0)} м/с</b></div><div class="kv"><span>TWR (${esc(v.body.name)})</span><b>${sim.twr.toFixed(2)}</b></div>`;
    $('#h-res').innerHTML = rh;
    // actions + science
    let ah = '<div class="ttl">Действия</div><div class="mbtns">';
    if (v.landed && b.id === 'earth') ah += `<button data-a="recover" class="acc">Вернуть в ЦУП</button>`;
    if (v.parts.some(p => !p.dead && PART[p.id].chute && p.st.chute === 'stowed')) ah += `<button data-a="chutes">Парашюты</button>`;
    if (v.parts.some(p => !p.dead && (PART[p.id].legs || (PART[p.id].gear && PART[p.id].gear.retract)))) ah += `<button data-a="legs">${v.parts.some(p => !p.dead && PART[p.id].gear) ? 'Шасси' : 'Опоры'} (G)</button>`;
    if (v.parts.some(p => !p.dead && PART[p.id].solar)) ah += `<button data-a="solar">Панели</button>`;
    const scn = v.parts.find(p => !p.dead && PART[p.id].scanner);
    if (scn) ah += `<button data-a="scan" class="${scn.st.scan !== false ? 'on' : ''}">Картограф ${scn.st.scan !== false ? 'вкл' : 'выкл'}</button>`;
    if (b.terrain) ah += `<button data-a="atlas">Атлас</button>`;
    ah += `<button data-a="ksc">В космоцентр</button></div>`;
    if (W.target && !v.landed && !v.prelaunch && !isKerbalVessel(v)) {
      ah += `<div class="ttl" style="margin-top:8px">Перелёт</div><div class="mbtns"><button data-a="xfer">Перелёт к цели</button>${v.nodes && v.nodes.length ? '<button data-a="refine">Уточнить</button>' : ''}${targetVessel(W) ? '<button data-a="match">Уравнять скорость</button>' : ''}</div>`;
    }
    const ports = v.parts.filter(p => !p.dead && PART[p.id].dock && p.portDir);
    if (ports.length) {
      ah += '<div class="ttl" style="margin-top:8px">Стыковочные узлы</div>';
      ports.forEach((p, i) => {
        const nm = `${i + 1}. ${PART[p.id].name.replace('Стыковочный узел ', '')}${p.origName && p.origName !== v.name ? ' · ' + esc(p.origName) : ''}`;
        ah += `<div class="sciitem"><div>${nm}</div><div class="dim">${p.st.dock ? 'состыкован' : 'свободен'}${v.ctrlPort === p.rid ? ' · управление отсюда' : ''}</div><div class="mbtns">` +
          (p.st.dock ? `<button data-a="undock" data-r="${p.rid}">Расстыковать</button>` : `<button data-a="ctrl" data-r="${p.rid}" class="${v.ctrlPort === p.rid ? 'on' : ''}">${v.ctrlPort === p.rid ? 'Управлять от корабля' : 'Управлять отсюда'}</button>`) + '</div></div>';
      });
    }
    const kp = isKerbalVessel(v) ? kerbalPart(v) : null;
    if (kp) {
      const c = crewById(Game.g, kp.crew[0]), near = nearestHatch(W.vessels, v), reach = evaReach(W, v);
      const ground = (v.inContact || v.lock) && !b.gas;
      ah += `<div class="ttl" style="margin-top:8px">Космонавт</div><div class="sciitem"><div>${c ? esc(c.name) + ' · ' + CREW_ROLES[c.role] + ' ' + '★'.repeat(crewLevel(c)) : ''}</div>
        <div class="mbtns"><button data-a="jet" class="${v.evaJet ? 'on' : ''}">Ранец (R)</button><button data-a="board" ${near ? '' : 'disabled'}>В люк (B)${near ? ': ' + esc(near.vessel.name) : ''}</button>
        <button data-a="flag" ${ground && b.terrain ? '' : 'disabled'}>Флаг (F)</button>
        ${c && c.role === 'engineer' && reach.some(x => PART[x.p.id].chute && x.p.st.chute !== 'stowed' && x.p.st.chute !== 'armed') ? '<button data-a="repack">Перепаковать парашют</button>' : ''}
        ${c && c.role === 'scientist' && reach.some(x => PART[x.p.id].sci && x.p.st.used && !x.p.data.length) ? '<button data-a="reset">Перезапустить эксперимент</button>' : ''}</div></div>`;
    } else {
      const pods = v.parts.filter(p => !p.dead && p.crew && podSeats(p) > 0);
      if (pods.length) {
        ah += '<div class="ttl" style="margin-top:8px">Экипаж</div>';
        for (const p of pods) {
          ah += `<div class="sciitem"><div class="dim">${esc(PART[p.id].name)} · мест ${p.crew.length}/${podSeats(p)}</div>` + (p.crew.map(id => {
            const c = crewById(Game.g, id); if (!c) return '';
            return `<div class="row"><span class="grow">${esc(c.name)} <span class="dim">${CREW_ROLES[c.role]} ${'★'.repeat(crewLevel(c))}</span></span><button data-a="eva" data-r="${p.rid}" data-x="${id}" style="padding:2px 7px">Выход</button></div>`;
          }).join('') || '<div class="dim">пусто</div>') + '</div>';
        }
      }
    }
    const sc = Game.scienceList(v);
    if (sc.length) {
      ah += '<div class="ttl" style="margin-top:8px">Наука</div>';
      for (const s of sc) ah += `<div class="sciitem"><div>${esc(s.name)}</div><div class="dim">${s.status}</div><div class="mbtns">${s.buttons.map(bt => `<button data-a="${bt.a}" data-r="${bt.r}" data-x="${bt.x || ''}" ${bt.dis ? 'disabled' : ''}>${bt.label}</button>`).join('')}</div></div>`;
    }
    if (Game.g.mode === 'career' && Game.g.contracts.active.length) {
      ah += '<div class="ttl" style="margin-top:8px">Контракты</div>' + Game.g.contracts.active.map(c => `<div class="sciitem">${esc(c.title)}<div class="dim">осталось ${fmtDur(c.deadline - t, true)}</div></div>`).join('');
    }
    if ($('#h-act')._h !== ah) { $('#h-act').innerHTML = ah; $('#h-act')._h = ah; }
    this.stagesHud(v);
    this.dockIndicator(W, v, t);
  },
  // flight view: a marker over the target with its distance
  targetMarker(W, v, t) {
    const el = $('#h-tmark'); if (!el) return;
    const ts = !W.map && targetState(W, t);
    const xy = ts && projectAbs(ts.r);
    if (!xy) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${xy[0].toFixed(1)}px, ${xy[1].toFixed(1)}px)`;
    const d = V.dist(V.add(bodyAbsPos(v.body, t), v.r), ts.r);
    el.lastChild.textContent = `${targetName(W)} · ${fmtDist(d)}`;
  },
  // docking alignment: where the target port is in our port's frame and how fast it moves there
  dockIndicator(W, v, t) {
    const el = $('#h-dock'); if (!el) return;
    const tv = targetVessel(W);
    const mine = v.ctrlPort != null && v.parts[v.ctrlPort] && isFreePort(v.parts[v.ctrlPort]) ? v.parts[v.ctrlPort] : freePorts(v)[0];
    if (!tv || !mine || tv.body !== v.body || V.dist(tv.r, v.r) > 300) { el.style.display = 'none'; return; }
    const P = portWorld(v, mine);
    let best = null;
    for (const q of freePorts(tv)) { if (!portsMatch(mine, q)) continue; const Q2 = portWorld(tv, q); const d = V.dist(Q2.pos, P.pos); if (!best || d < best.d) best = { d, w: Q2 }; }
    if (!best) { el.style.display = ''; el.innerHTML = '<div class="ttl">Стыковка</div><div class="dim">У цели нет свободного узла того же размера</div>'; return; }
    const qc = Q.mul(v.q, Q.fromTo([0, 1, 0], portLocal(mine).ax));
    const ex = Q.rot(qc, [1, 0, 0]), ez = Q.rot(qc, [0, 0, 1]), n = P.ax;
    const dd = V.sub(best.w.pos, P.pos), rv = V.sub(best.w.vel, P.vel);
    const along = V.dot(dd, n), lx = V.dot(dd, ex), lz = V.dot(dd, ez);
    const close = -V.dot(rv, n), vx = V.dot(rv, ex), vz = V.dot(rv, ez);
    const ang = Math.acos(clamp(-V.dot(n, best.w.ax), -1, 1)) / DEG;
    const lat = Math.hypot(lx, lz);
    const s = (x) => Math.sign(x) * Math.min(1, Math.log10(1 + Math.abs(x) * 4) / 2.2) * 60;   // log scale, ±60 px
    const good = lat < 0.25 && ang < 12 && close < 1.2;
    el.style.display = '';
    el.innerHTML = `<div class="ttl">Стыковка${v.ctrlPort === mine.rid ? '' : ' <span class="dim">(управление от корабля)</span>'}</div>
      <svg viewBox="-70 -70 140 140" width="140" height="140">
        <circle r="62" fill="none" stroke="#3a4352"/><circle r="${s(0.25).toFixed(1)}" fill="none" stroke="${good ? '#5dff9a' : '#556'}" stroke-dasharray="3 3"/>
        <line x1="-66" y1="0" x2="66" y2="0" stroke="#2c3440"/><line x1="0" y1="-66" x2="0" y2="66" stroke="#2c3440"/>
        <line x1="${s(lx).toFixed(1)}" y1="${(-s(lz)).toFixed(1)}" x2="${(s(lx) + s(vx * 5)).toFixed(1)}" y2="${(-s(lz) - s(vz * 5)).toFixed(1)}" stroke="#37d5ff" stroke-width="2"/>
        <circle cx="${s(lx).toFixed(1)}" cy="${(-s(lz)).toFixed(1)}" r="6" fill="none" stroke="${good ? '#5dff9a' : '#ff8ae0'}" stroke-width="2.5"/>
      </svg>
      <div class="kv"><span>До узла</span><b>${fmtDist(Math.max(0, along))}</b></div>
      <div class="kv"><span>Сближение</span><b class="${close > 1.2 ? 'bad' : ''}">${close.toFixed(2)} м/с</b></div>
      <div class="kv"><span>Смещение</span><b class="${lat < 0.25 ? 'good' : ''}">${lat.toFixed(2)} м</b></div>
      <div class="kv"><span>Перекос</span><b class="${ang < 12 ? 'good' : ''}">${ang.toFixed(1)}°</b></div>`;
  },
  stagesHud(v) {
    const el = $('#h-stages'); if (!el || ui._dragging) return;
    const sim = Game.flightDVList(v);
    const disp = v.stages.map((st, i) => {
      const groups = new Map();
      for (const rid of st) { const p = v.parts[rid]; if (!p || p.dead) continue; const g = groups.get(p.uid) || { key: p.uid, def: PART[p.id], n: 0 }; g.n++; groups.set(p.uid, g); }
      const s2 = sim && sim.find(x => x.stage === i);
      return { dv: s2 ? s2.dv : 0, items: [...groups.values()] };
    });
    const sig = JSON.stringify([v.stageIdx, disp.map(d => [Math.round(d.dv), d.items.map(x => x.key + x.n)])]);
    if (el._sig === sig) return;
    el._sig = sig;
    el.innerHTML = '<div class="ttl">Ступени · ПРОБЕЛ · перетаскивайте</div><div id="h-stl"></div>' + (v.stageIdx >= v.stages.length ? '<div class="dim">Ступени закончились</div>' : '');
    this.stageList($('#h-stl'), disp, v.stageIdx, v.stageIdx, (key, to, isNew, from) => Game.moveStage(key, from, to, isNew));
  },
  mnv(v, node, info) {
    const el = $('#mnv'); if (!el) return;
    if (!node) { el.style.display = 'none'; return; }
    el.style.display = '';
    const t = Game.g.ut;
    const html = `<div class="row"><div class="ttl grow">Манёвр</div><button data-m="del" class="danger" style="padding:2px 8px">Удалить</button></div>
      <div class="kv"><span>Через</span><b>${fmtDur(node.t - t)}</b></div>
      <div class="kv"><span>Δv всего</span><b>${(node.dvTotal != null ? node.dvTotal : V.len(node.dv)).toFixed(1)} м/с</b></div>
      <div class="kv"><span>Время работы</span><b>${info && info.burn ? fmtDur(info.burn) : '—'}</b></div>
      ${['pro|Прогрейд|lbl-pro', 'nrm|Нормаль|lbl-nrm', 'rad|Радиально|lbl-rad'].map((s, i) => { const [k, n, c] = s.split('|'); return `<div class="dvrow"><span class="${c}">${n}</span><div class="ctl"><button data-m="${k}" data-d="-1">−</button><input data-i="${i}" value="${node.dv[i].toFixed(1)}"><button data-m="${k}" data-d="1">+</button></div></div>`; }).join('')}
      <div class="row" style="margin:4px 0"><span class="dim">Шаг:</span>${[0.1, 1, 10, 100].map(s => `<button data-step="${s}" class="${Game.nodeStep === s ? 'on' : ''}" style="padding:2px 6px">${s}</button>`).join('')}</div>
      <div class="row"><span class="dim">Время:</span><button data-m="t" data-d="-10">−10с</button><button data-m="t" data-d="10">+10с</button><button data-m="t" data-d="-600">−10м</button><button data-m="t" data-d="600">+10м</button><button data-m="orb" data-d="1">+виток</button></div>
      <div class="row" style="margin-top:6px"><button data-m="warp" class="acc">Ускорить к манёвру</button></div>`;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#mnv')) return;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    if (!el._wired) {
      el._wired = true;
      el.addEventListener('mousedown', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.step) { Game.nodeStep = +b.dataset.step; return; }
        const m = b.dataset.m; if (!m) return;
        const go = () => Game.nodeEdit(m, +b.dataset.d || 0);
        go();
        if (m === 'pro' || m === 'nrm' || m === 'rad') { clearInterval(this._rep); let k = 0; this._rep = setInterval(() => { k++; if (k > 3) go(); }, 90); }
      });
      window.addEventListener('mouseup', () => clearInterval(this._rep));
      el.addEventListener('change', (e) => { const i = e.target.dataset.i; if (i != null) Game.nodeSetDV(+i, parseFloat(e.target.value) || 0); });
    }
  },
  pause() {
    const W = Game.world;
    const L = W && W.launch;
    this.modal('Пауза', `<div class="dim">${esc(W.active ? W.active.name : '')} · ${fmtDate(Game.g.ut)}</div>`, [
      { label: 'Продолжить' },
      { label: 'Сохранить', onClick: () => this.saveDlg() },
      { label: 'Загрузить', onClick: () => this.loadDlg() },
      ...(L ? [{ label: 'Вернуться к запуску', onClick: () => Game.revert('launch') }, { label: 'Вернуться в цех', onClick: () => Game.revert('vab') }] : []),
      { label: 'В космоцентр', onClick: () => Game.leaveFlight() },
      ...(REC.data && REC.data.frames.length > 4 ? [{ label: 'Повтор полёта', onClick: () => Game.openReplay() }] : []),
      { label: 'Настройки', onClick: () => this.gfxDlg() },
      { label: 'Управление', onClick: () => this.help() },
    ]);
  },
  gfxDlg() {
    const names = { high: 'Высокое: MSAA, свечение, тени 2048, полное разрешение', medium: 'Среднее: разрешение ×1.5, тени 1024', low: 'Низкое: без теней и свечения, разрешение ×1' };
    const m = this.modal('Настройки', '<div class="ttl">Качество графики</div>' + Object.entries(names).map(([k, n]) => `<div class="vitem ${RV.quality === k ? 'sel' : ''}" data-q="${k}"><b>${n.split(':')[0]}</b><span>${n.split(':')[1]}</span></div>`).join('') +
      `<div class="ttl" style="margin-top:10px">Поле зрения</div><div class="mbtns">${[45, 50, 55, 60, 70].map(f => `<button data-f="${f}" class="${RV.fov === f ? 'on' : ''}">${f}°</button>`).join('')}</div>` +
      `<div class="ttl" style="margin-top:10px">Звук</div><div class="row"><span class="dim">Громкость</span><input type="range" id="snd-vol" min="0" max="100" value="${Math.round(SND.vol * 100)}" class="grow"><span id="snd-vv" class="mono">${Math.round(SND.vol * 100)}%</span></div>` +
      `<label class="row" style="margin-top:4px"><input type="checkbox" id="snd-ui" ${SND.ui ? 'checked' : ''}> <span>звуки интерфейса</span></label>`, [{ label: 'Закрыть' }]);
    m.querySelector('.body').onclick = (e) => {
      const it = e.target.closest('[data-q]'); if (it) { setQuality(it.dataset.q); this.toast('Графика: ' + names[it.dataset.q].split(':')[0], '', 1500); this.gfxDlg(); }
      const f = e.target.closest('[data-f]'); if (f) { setFov(+f.dataset.f); this.gfxDlg(); }
    };
    const vol = m.querySelector('#snd-vol');
    vol.oninput = () => { sndSetVolume(vol.value / 100); m.querySelector('#snd-vv').textContent = vol.value + '%'; };
    m.querySelector('#snd-ui').onchange = (e) => sndSetUi(e.target.checked);
  },
  destroyed(why) {
    const L = Game.world && Game.world.launch;
    this.modal('Корабль потерян', `<p>${esc(why || '')}</p>`, [
      ...(L ? [{ label: 'Вернуться к запуску', cls: 'acc', onClick: () => Game.revert('launch') }, { label: 'Вернуться в цех', onClick: () => Game.revert('vab') }] : []),
      { label: 'Смотреть повтор', onClick: () => Game.openReplay() },
      { label: 'В космоцентр', onClick: () => Game.leaveFlight(true) },
      { label: 'Остаться', onClick: () => {} },
    ], 'destroyed');
  },

  // ---------------------------------------------------------------- R&D
  rnd() {
    this.clear();
    const g = Game.g;
    const X = (c) => 30 + c * 205, Y = (r) => 20 + r * 105;
    let lines = '';
    for (const t of TECH) for (const r of t.req) { const a = TECH_BY_ID[r]; lines += `<line x1="${X(a.col) + 170}" y1="${Y(a.row) + 30}" x2="${X(t.col)}" y2="${Y(t.row) + 30}" stroke="${g.techs.includes(r) ? '#5dff9a' : '#556'}" stroke-width="2"/>`; }
    const nodes = TECH.map(t => {
      const st = g.techs.includes(t.id) ? 'done' : techAvailable(g, t) ? 'avail' : 'locked';
      return `<div class="tnode ${st}" data-t="${t.id}" style="left:${X(t.col)}px;top:${Y(t.row)}px"><b>${esc(t.name)}</b><span class="c">${st === 'done' ? '✓ изучено' : t.cost + ' науки'}</span> <span class="dim">· ${t.parts.length} дет.</span></div>`;
    }).join('');
    this.root.innerHTML = `<div id="rnd">${this.topbar('НИИ — ТЕХНОЛОГИИ', '<button id="r-back">Назад</button>')}<div class="tree scroll"><div class="canvas"><svg width="1700" height="760">${lines}</svg>${nodes}</div></div><div class="detail panel" id="r-det"><span class="dim">Щёлкните по технологии.</span></div></div>`;
    $('#r-back').onclick = () => Game.toKSC();
    this.root.querySelector('.canvas').onclick = (e) => {
      const n = e.target.closest('.tnode'); if (!n) return;
      const t = TECH_BY_ID[n.dataset.t];
      const st = g.techs.includes(t.id) ? 'done' : techAvailable(g, t) ? 'avail' : 'locked';
      $('#r-det').innerHTML = `<h3 style="margin:0 0 6px">${esc(t.name)}</h3><div class="dim">Требует: ${t.req.map(r => TECH_BY_ID[r].name).join(' или ') || '—'}</div>
        <div style="margin:8px 0">${t.parts.map(id => `<div class="row"><i class="dot" style="background:${CAT_COLOR[PART[id].cat]}"></i>${esc(PART[id].name)}</div>`).join('')}</div>
        ${st === 'avail' ? `<button class="acc" id="r-buy" ${g.science < t.cost ? 'disabled' : ''}>Изучить за ${t.cost} науки</button>` : st === 'done' ? '<span class="good">Изучено</span>' : '<span class="dim">Сначала изучите предыдущие технологии.</span>'}`;
      const bb = $('#r-buy'); if (bb) bb.onclick = () => { if (researchTech(g, t.id)) { this.toast('Изучено: ' + esc(t.name), 'good'); Game.autosave(); this.rnd(); } };
    };
  },

  // ---------------------------------------------------------------- Mission control
  mc() {
    this.clear();
    const g = Game.g;
    refreshOffers(g);
    const card = (c, btns) => `<div class="contract"><h4>${esc(c.title)}</h4><p>${esc(c.desc)}</p><div class="rw"><span>Аванс ${fmtMoney(c.advance)}</span><span class="accent">Награда ${fmtMoney(c.reward)}</span><span style="color:#7fd0ff">+${c.sci} науки</span>${c.state === 'active' ? `<span class="dim">срок ${fmtDur(c.deadline - g.ut, true)}</span>` : `<span class="dim">срок ${c.days} д.</span>`}<span class="bad">штраф ${fmtMoney(c.penalty)}</span></div><div class="row" style="margin-top:6px">${btns}</div></div>`;
    const ms = Object.keys(g.milestones).map(id => milestoneDef(id)).filter(Boolean);
    this.root.innerHTML = `<div id="mc">${this.topbar('ЦУП — КОНТРАКТЫ', '<button id="c-back">Назад</button>')}<div class="cols">
      <div class="col panel"><div class="ttl">Предложения</div><div class="list">${g.contracts.offered.map(c => card(c, `<button class="acc" data-acc="${c.id}">Принять</button><button data-dec="${c.id}">Отклонить</button>`)).join('') || '<div class="dim">Новых предложений нет.</div>'}</div></div>
      <div class="col panel"><div class="ttl">Активные (до 6)</div><div class="list">${g.contracts.active.map(c => card(c, `<button class="danger" data-can="${c.id}">Отказаться</button>`)).join('') || '<div class="dim">Нет активных контрактов.</div>'}</div></div>
      <div class="col panel"><div class="ttl">Достижения</div><div class="list">${ms.map(m => `<div class="sciitem">✓ ${esc(m[0])}</div>`).join('') || '<div class="dim">Пока ничего. Запустите первую ракету!</div>'}
        <div class="ttl" style="margin-top:10px">Выполнено контрактов: ${g.contracts.done.length}</div></div></div></div></div>`;
    $('#c-back').onclick = () => Game.toKSC();
    this.root.querySelector('.cols').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.acc) { if (!acceptContract(g, b.dataset.acc)) this.toast('Слишком много активных контрактов', 'bad'); }
      if (b.dataset.dec) declineContract(g, b.dataset.dec);
      if (b.dataset.can) cancelContract(g, b.dataset.can);
      Game.autosave(); this.mc();
    };
  },

  // ---------------------------------------------------------------- atlas: biome map of a body
  atlas(bodyId) {
    const g = Game.g, W = Game.world, t = g.ut;
    const bodies = BODIES.filter(b => b.terrain);
    let b = BODY[bodyId] && BODY[bodyId].terrain ? BODY[bodyId] : BODY.moon;
    const NX = BIOME_GRID.nLon, NY = BIOME_GRID.nLat, CW = 720, CH = 360;
    const m = this.modal('Атлас', `<div class="row"><select id="at-b">${bodies.map(x => `<option value="${x.id}" ${x === b ? 'selected' : ''}>${x.name}</option>`).join('')}</select><span class="dim" id="at-cov"></span><span class="grow"></span><span class="mono dim" id="at-hover"></span></div>
      <div class="pkwrap"><canvas id="at-cv" width="${CW}" height="${CH}"></canvas><div class="pkinfo" id="at-leg"></div></div>`, [{ label: 'Закрыть' }], 'wide');
    const cv = m.querySelector('#at-cv'), ctx = cv.getContext('2d');
    let cells = null;
    const build = () => {
      // per-cell biome and hillshade (coarse terrain), cached on the body
      if (b._atlas) return b._atlas;
      const bio = [], hs = new Float32Array(NX * NY), hh = new Float32Array(NX * NY);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const d = cellDir(j, i); hh[j * NX + i] = terrainHeight(b, d, 8000); bio.push(biomeAt(b, d)); }
      const q = bodyHeightQuantiles(b), span = Math.max(1, q[2] - q[0]);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, e = hh[j * NX + (i + 1) % NX] - hh[j * NX + (i + NX - 1) % NX], n = hh[Math.min(NY - 1, j + 1) * NX + i] - hh[Math.max(0, j - 1) * NX + i]; hs[k] = clamp(1 + (e - n) / span * 0.6, 0.55, 1.35); }
      return (b._atlas = { bio, hs, hh });
    };
    const draw = () => {
      cells = build();
      const grid = scanGrid(g, b.id), all = !isCareer(g);
      const cw = CW / NX, ch = CH / NY;
      ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, CW, CH);
      const seen = new Set();
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const k = j * NX + i, open = all || grid[k];
        const y = CH - (j + 1) * ch, x = i * cw;
        if (!open) { ctx.fillStyle = (i + j) % 2 ? '#151922' : '#121620'; ctx.fillRect(x, y, Math.ceil(cw), Math.ceil(ch)); continue; }
        const bm = biomeById(b, cells.bio[k]); seen.add(cells.bio[k]);
        const c = new THREE.Color(bm ? bm.color : '#777').multiplyScalar(cells.hs[k]);
        ctx.fillStyle = '#' + c.getHexString(); ctx.fillRect(x, y, Math.ceil(cw), Math.ceil(ch));
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      for (let lo = -150; lo <= 150; lo += 30) { const x = (lo + 180) / 360 * CW; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
      for (let la = -60; la <= 60; la += 30) { const y = (90 - la) / 180 * CH; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }
      // marks: vessels, flags, the space centre, a predicted landing
      const xy = (d) => { const la = Math.asin(clamp(d[2], -1, 1)) / DEG, lo = Math.atan2(d[1], d[0]) / DEG; return [(lo + 180) / 360 * CW, (90 - la) / 180 * CH]; };
      const dot = (d, col, r, label) => { const [x, y] = xy(d); ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke(); if (label) { ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.fillText(label, x + r + 3, y + 4); } };
      if (b.id === 'earth') dot(_KSC_DIR, '#e8b51c', 4, 'Космодром');
      const vs = W ? W.vessels : g.vessels.map(s => ({ name: s.name, body: BODY[s.body], r: s.r, parts: s.parts }));
      for (const v of vs) {
        if (!v.body || v.body !== b || v.destroyed) continue;
        const d = V.norm(inertialToBodyFixed(b, t, v.r)), flag = v.parts.some(p => PART[p.id].flag);
        dot(d, flag ? '#ff5d6c' : W && v === W.active ? '#37d5ff' : '#c9d4e2', flag ? 3 : 4, flag ? '' : v.name);
      }
      if (W && W.impact && W.impact.body === b) dot(V.norm(W.impact.pF), '#ff7a45', 4, '✕ посадка');
      for (const s of SITES) if (s.body === b.id && siteExists(g, s)) { const st = (g.sites || {})[s.id] || {}; dot(siteDir(s), st.found ? '#ffd34f' : '#b98cff', 4, '◆ ' + s.name); }
      const cov = scanCoverage(grid);
      m.querySelector('#at-cov').textContent = all ? 'песочница: всё открыто' : `снято ${(cov * 100).toFixed(0)}% поверхности`;
      m.querySelector('#at-leg').innerHTML = `<div class="ttl">${b.name}: биомы</div>` + biomeSet(b).map(([id, n, col]) => `<div class="row" style="${all || seen.has(id) ? '' : 'opacity:.35'}"><i class="dot" style="background:${col}"></i>${n}</div>`).join('') +
        `<div class="dim" style="margin-top:8px;font-size:12px">${all ? '' : 'Тёмные клетки ещё не сняты: выведите на орбиту аппарат с картографом. '}Эксперименты на поверхности и в нижней атмосфере засчитываются в каждом биоме отдельно.</div>`;
    };
    cv.onmousemove = (e) => {
      if (!cells) return;
      const rc = cv.getBoundingClientRect(), x = (e.clientX - rc.left) / rc.width, y = (e.clientY - rc.top) / rc.height;
      const i = clamp(Math.floor(x * NX), 0, NX - 1), j = clamp(NY - 1 - Math.floor(y * NY), 0, NY - 1), k = j * NX + i;
      const open = !isCareer(g) || scanGrid(g, b.id)[k], bm = open && biomeById(b, cells.bio[k]);
      m.querySelector('#at-hover').textContent = `${((j + 0.5) * 2 - 90).toFixed(0)}°, ${((i + 0.5) * 2 - 180).toFixed(0)}° · ${bm ? bm.name + ' · ' + fmtDist(cells.hh[k]) : 'не снято'}`;
    };
    m.querySelector('#at-b').onchange = (e) => { b = BODY[e.target.value]; draw(); };
    draw();
  },

  // ---------------------------------------------------------------- transfer planner (porkchop)
  planner() {
    const g = Game.g, W = Game.world, A = W && Game.screen === 'flight' ? W.active : null;
    const sibs = BODIES.filter(b => b.parent && b.vis.type !== 'star' && BODIES.some(o => o !== b && o.parent === b.parent));
    let from = A && sibs.includes(A.body) ? A.body : BODY.earth;
    const tg = W && W.target && BODY[W.target];
    let to = tg && tg.parent === from.parent && tg !== from ? tg : from.id === 'earth' ? BODY.mars : sibs.find(b => b.parent === from.parent && b !== from);
    const S = this._pk = { from, to, capture: true, G: null, sel: null };
    const opt = (list, cur) => list.map(b => `<option value="${b.id}" ${b === cur ? 'selected' : ''}>${b.name}${b.parent.id !== 'sun' ? ' (' + b.parent.name + ')' : ''}</option>`).join('');
    const shortDate = fmtDay;
    const m = this.modal('Окна перелёта', `<div class="row"><span class="dim">Откуда</span><select id="pk-f">${opt(sibs, from)}</select><span class="dim">куда</span><select id="pk-t"></select>
        <label class="row"><input type="checkbox" id="pk-c" checked> <span>с выходом на орбиту</span></label><button class="acc" id="pk-go">Рассчитать</button></div>
      <div class="pkwrap"><canvas id="pk-cv" width="640" height="400"></canvas><div class="pkinfo" id="pk-i"><span class="dim">Диаграмма «порк-чоп»: по горизонтали дата старта, по вертикали время в пути, цвет — затраты Δv (ярче — дешевле). Щёлкните по точке, чтобы выбрать окно.</span></div></div>`, [{ label: 'Закрыть' }], 'wide');
    const cv = m.querySelector('#pk-cv'), ctx = cv.getContext('2d'), info = m.querySelector('#pk-i');
    const PL = { l: 58, r: 10, t: 10, b: 34 };
    const fillTo = () => { const list = sibs.filter(b => b.parent === S.from.parent && b !== S.from); if (!list.includes(S.to)) S.to = list[0]; m.querySelector('#pk-t').innerHTML = opt(list, S.to); };
    fillTo();
    const pal = ['#0b0f2a', '#2b0f63', '#5d0a8f', '#8e1a8a', '#bd3976', '#e06054', '#f4903b', '#fbc32f', '#f6f05a'];
    const col = (x) => { const k = clamp(x, 0, 1) * (pal.length - 1), i = Math.floor(k), f = k - i; const a = new THREE.Color(pal[i]), b2 = new THREE.Color(pal[Math.min(pal.length - 1, i + 1)]); return '#' + a.lerp(b2, f).getHexString(); };
    const W2 = cv.width - PL.l - PL.r, H2 = cv.height - PL.t - PL.b;
    const draw = () => {
      const G = S.G; ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (!G) return;
      const cw = W2 / G.nx, ch = H2 / G.ny, best = G.best ? G.best.dv : 1;
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const v = G.dv[j * G.nx + i];
        ctx.fillStyle = isFinite(v) ? col(1 - Math.log(v / best) / Math.log(4)) : '#0b0d12';
        ctx.fillRect(PL.l + i * cw, PL.t + (G.ny - 1 - j) * ch, Math.ceil(cw), Math.ceil(ch));
      }
      ctx.fillStyle = '#9aa6b6'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      for (let k = 0; k <= 4; k++) { const x = PL.l + W2 * k / 4; ctx.fillText(shortDate(G.t0 + G.span * k / 4), x, cv.height - 18); ctx.fillRect(x, PL.t + H2, 1, 4); }
      ctx.fillText('дата старта', PL.l + W2 / 2, cv.height - 4);
      ctx.textAlign = 'right';
      for (let k = 0; k <= 4; k++) { const y = PL.t + H2 - H2 * k / 4; ctx.fillText(((G.tof0 + (G.tof1 - G.tof0) * k / 4) / DAY).toFixed(0) + ' д', PL.l - 6, y + 4); }
      const mark = (c, cl, cross) => { const x = PL.l + (c.i + 0.5) * cw, y = PL.t + (G.ny - 0.5 - c.j) * ch; ctx.strokeStyle = cl; ctx.lineWidth = 2; ctx.beginPath(); if (cross) { ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); } else ctx.arc(x, y, 6, 0, TAU); ctx.stroke(); };
      if (G.best) mark(G.best, '#ffffff');
      if (S.sel) mark(S.sel, '#37d5ff', true);
    };
    const show = (c) => {
      const G = S.G, tr = transferAt(G, c.td, c.tof);
      if (!tr) { info.innerHTML = '<span class="dim">Здесь решения нет</span>'; return; }
      const canNode = A && !A.landed && A.body === G.from && elFromState(A.r, A.v, A.body.mu, g.ut).e < 1;
      info.innerHTML = `<div class="ttl">${G.from.name} → ${G.to.name}</div>
        <div class="kv"><span>Старт</span><b>${shortDate(c.td)} · через ${fmtDur(c.td - g.ut, true)}</b></div>
        <div class="kv"><span>В пути</span><b>${(c.tof / DAY).toFixed(0)} д</b></div>
        <div class="kv"><span>Разгон с орбиты</span><b>${tr.dep.toFixed(0)} м/с</b></div>
        <div class="kv"><span>Торможение у цели</span><b>${tr.arr.toFixed(0)} м/с</b></div>
        <div class="kv"><span>Итого</span><b class="accent">${(tr.dep + (G.capture ? tr.arr : 0)).toFixed(0)} м/с</b></div>
        <div class="kv"><span>Фазовый угол</span><b>${tr.phase.toFixed(1)}°</b></div>
        <div class="kv"><span>Угол выхода к прогрейду</span><b>${tr.eject.toFixed(1)}°</b></div>
        <div class="mbtns" style="margin-top:8px"><button data-pk="alarm">Будильник на старт</button>${W && Game.screen === 'flight' ? `<button data-pk="target">Цель: ${G.to.name}</button>` : ''}${canNode ? '<button data-pk="node" class="acc">Создать манёвр</button>' : ''}</div>
        ${A && !canNode ? `<div class="dim" style="margin-top:6px">Манёвр строится с замкнутой орбиты вокруг «${G.from.name}».</div>` : ''}`;
    };
    const run = () => {
      S.G = null; S.sel = null; draw();
      info.innerHTML = '<span class="dim">Считаю…</span>';
      porkchop(S.from, S.to, g.ut + 3600, { capture: S.capture }, (G) => { S.G = G; if (G.best) { S.sel = G.best; show(G.best); } draw(); }, (f) => { info.innerHTML = `<span class="dim">Считаю… ${Math.round(f * 100)}%</span>`; });
    };
    m.querySelector('#pk-f').onchange = (e) => { S.from = BODY[e.target.value]; fillTo(); };
    m.querySelector('#pk-t').onchange = (e) => { S.to = BODY[e.target.value]; };
    m.querySelector('#pk-c').onchange = (e) => { S.capture = e.target.checked; };
    m.querySelector('#pk-go').onclick = run;
    cv.onclick = (e) => {
      const G = S.G; if (!G) return;
      const rc = cv.getBoundingClientRect(), x = (e.clientX - rc.left) * cv.width / rc.width - PL.l, y = (e.clientY - rc.top) * cv.height / rc.height - PL.t;
      const i = clamp(Math.floor(x / W2 * G.nx), 0, G.nx - 1), j = clamp(G.ny - 1 - Math.floor(y / H2 * G.ny), 0, G.ny - 1);
      S.sel = { i, j, td: G.t0 + G.span * i / (G.nx - 1), tof: G.tof0 + (G.tof1 - G.tof0) * j / (G.ny - 1) };
      show(S.sel); draw();
    };
    info.onclick = (e) => {
      const b = e.target.closest('[data-pk]'); if (!b || !S.sel) return;
      const G = S.G, c = S.sel;
      if (b.dataset.pk === 'alarm') { addAlarm(g, { t: c.td - Math.min(DAY, (c.td - g.ut) * 0.1), title: `Окно: ${G.from.name} → ${G.to.name}`, vid: A ? A.id : null }); this.toast('Будильник поставлен', 'good'); }
      if (b.dataset.pk === 'target') { W.target = G.to.id; W.trajT = -1; this.toast('Цель: ' + G.to.name, '', 1500); }
      if (b.dataset.pk === 'node') {
        const tr = transferAt(G, c.td, c.tof), nd = ejectionNode(A, tr.vinf, c.td, g.ut);
        if (!nd) return;
        A.nodes = [{ t: nd.t, dv: nd.dv }]; W.selNode = 0; W.target = G.to.id; computeTraj();
        this.closeModal();
        this.toast('Манёвр создан. Уточняю под встречу…', '', 2500);
        Game.refineTransfer();
      }
    };
    if (S.to) run();
  },

  // ---------------------------------------------------------------- alarm clock
  alarms() {
    const g = Game.g, W = Game.world, t = g.ut, A = W && Game.screen === 'flight' ? W.active : null;
    const list = (g.alarms || []).filter(a => a.t > t);
    const vname = (id) => { const v = W && W.vessels.find(x => x.id === id); return v ? v.name : ''; };
    let add = '';
    if (A && !A.destroyed) {
      const el = !A.landed && !A.prelaunch ? elFromState(A.r, A.v, A.body.mu, t) : null;
      const btn = (k, label, ok) => `<button data-add="${k}" ${ok ? '' : 'disabled'}>${label}</button>`;
      const soi = W.traj && W.traj.find(pt => pt.end === 'enter' || pt.end === 'exit');
      add = `<div class="ttl" style="margin-top:10px">Добавить для «${esc(A.name)}»</div><div class="mbtns">
        ${btn('node', 'Манёвр', A.nodes && A.nodes.length)}${btn('ap', 'Апоцентр', el && el.e < 1)}${btn('pe', 'Перицентр', el && el.rp > A.body.R)}${btn('soi', 'Смена сферы влияния', !!soi)}</div>`;
    }
    const m = this.modal('Будильник', `${list.length ? list.map(a => `<div class="vitem"><div class="row"><div class="grow"><b>${esc(a.title)}</b><span>${a.vid ? esc(vname(a.vid)) + ' · ' : ''}через ${fmtDur(a.t - t, true)} · ${fmtDate(a.t)}</span></div><button data-go="${a.id}">Ускорить</button><button data-del="${a.id}" class="danger" style="padding:2px 8px">✕</button></div></div>`).join('') : '<div class="dim">Будильников нет. Ускорение времени остановится перед каждым.</div>'}
      ${add}
      <div class="ttl" style="margin-top:10px">Через</div><div class="row"><input id="al-d" type="number" min="0" value="0" style="width:60px"> д <input id="al-h" type="number" min="0" value="1" style="width:60px"> ч <input id="al-m" type="number" min="0" value="0" style="width:60px"> м <input id="al-n" placeholder="подпись" class="grow"><button id="al-add">Добавить</button></div>
      <label class="row" style="margin-top:8px"><input type="checkbox" id="al-auto" ${g.autoNodeAlarm !== false ? 'checked' : ''}> <span>останавливать ускорение перед каждым манёвром</span></label>`, [{ label: 'Закрыть' }]);
    m.querySelector('.body').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.del) { removeAlarm(g, b.dataset.del); this.alarms(); return; }
      if (b.dataset.go) { const a = (g.alarms || []).find(x => x.id === b.dataset.go); if (a && W) { W.warpTo = a.t - 1; this.closeModal(); if (Game.screen === 'track') Game.warpUp(); } return; }
      if (b.dataset.add && A) {
        const k = b.dataset.add, el = elFromState(A.r, A.v, A.body.mu, t);
        let at = null, title = '';
        if (k === 'node') { const info = nodeInfo(A); at = A.nodes[0].t - (info && info.burn ? info.burn / 2 : 0) - 30; title = 'Манёвр'; }
        if (k === 'ap') { at = elTimeAtNu(el, Math.PI, t) - 60; title = 'Апоцентр'; }
        if (k === 'pe') { at = elTimeAtNu(el, 0, t) - 60; title = 'Перицентр'; }
        if (k === 'soi') { const pt = W.traj.find(x => x.end === 'enter' || x.end === 'exit'); at = pt.t1 - 30; title = pt.end === 'enter' ? 'Вход в СВ: ' + pt.next.name : 'Выход из СВ: ' + pt.body.name; }
        if (at != null && at > t) { addAlarm(g, { t: at, title, vid: A.id }); this.toast('Будильник: ' + esc(title), 'good', 1500); }
        this.alarms(); return;
      }
      if (b.id === 'al-add') {
        const dt = (+$('#al-d').value || 0) * DAY + (+$('#al-h').value || 0) * 3600 + (+$('#al-m').value || 0) * 60;
        if (dt > 0) addAlarm(g, { t: t + dt, title: $('#al-n').value || 'Будильник', vid: A ? A.id : null });
        this.alarms();
      }
    };
    m.querySelector('#al-auto').onchange = (e) => { g.autoNodeAlarm = e.target.checked; };
  },

  // ---------------------------------------------------------------- replay
  replay() {
    this.clear();
    const cams = [['auto', 'Режиссёр'], ['chase', 'Погоня'], ['flyby', 'Пролёт'], ['tower', 'Башня'], ['orbit', 'Облёт']];
    this.root.innerHTML = `<div id="rpl" class="panel"><button id="rp-play">❚❚</button><div class="rp-sp">${[0.25, 0.5, 1, 2, 4, 8].map(s => `<button data-sp="${s}">${s < 1 ? '¼½'[s === 0.25 ? 0 : 1] : s}×</button>`).join('')}</div>
      <input type="range" id="rp-t" min="0" max="1000" value="0" class="grow"><span id="rp-time" class="mono"></span>
      <div class="rp-cam">${cams.map(([k, n]) => `<button data-cam="${k}">${n}</button>`).join('')}</div>
      <button id="rp-rec" class="danger">● Видео</button><button id="rp-exit">Выход</button></div><div id="rp-title" class="dim"></div>`;
    const D = REC.data, t0 = D.frames[0].t, t1 = D.frames[D.frames.length - 1].t;
    $('#rp-play').onclick = () => { RPL.playing = !RPL.playing; if (RPL.playing && RPL.t >= t1) RPL.t = t0; };
    $('#rpl .rp-sp').onclick = (e) => { const b = e.target.closest('[data-sp]'); if (b) RPL.speed = +b.dataset.sp; this.replayHud(null, null, true); };
    $('#rpl .rp-cam').onclick = (e) => { const b = e.target.closest('[data-cam]'); if (b) { RPL.cam = b.dataset.cam; RPL.shot = null; RPL.fly = null; } this.replayHud(null, null, true); };
    $('#rp-t').oninput = (e) => { RPL.t = t0 + (t1 - t0) * e.target.value / 1000; };
    $('#rp-rec').onclick = () => { if (RPL.recorder) Game.stopVideo(); else { if (RPL.t >= t1 - 0.1) RPL.t = t0; Game.startVideo(); } this.replayHud(null, null, true); };
    $('#rp-exit').onclick = () => Game.closeReplay();
    this.replayHud(null, null, true);
  },
  replayHud(D, focus, force) {
    const now = performance.now();
    if (!force && now - (this._rpT || 0) < 150) return;
    this._rpT = now;
    D = D || REC.data; if (!D || !$('#rpl')) return;
    const t0 = D.frames[0].t, t1 = D.frames[D.frames.length - 1].t;
    const sl = $('#rp-t'); if (document.activeElement !== sl) sl.value = Math.round((RPL.t - t0) / Math.max(1e-6, t1 - t0) * 1000);
    $('#rp-time').textContent = `T+${fmtDur(RPL.t - (D.launchUT != null ? D.launchUT : t0), true)} / ${fmtDur(t1 - t0, true)}`;
    $('#rp-play').textContent = RPL.playing ? '❚❚' : '▶';
    this.root.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === RPL.speed));
    this.root.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === RPL.cam));
    $('#rp-rec').textContent = RPL.recorder ? '■ Стоп' : '● Видео';
    if (focus) $('#rp-title').textContent = `${focus.name} · ${fmtDate(RPL.t)} · ${focus.body.name}, высота ${fmtDist(V.len(focus.r) - focus.body.R)}`;
  },

  // ---------------------------------------------------------------- the space race
  race() {
    this.clear();
    const g = Game.g, sc = raceScore(g), t = g.ut;
    const row = (it) => {
      const s = g.race.items[it.id], r = raceReward(it);
      const st = !s ? (t < it.ut ? `<span class="dim">осталось ${fmtDur(it.ut - t, true)}</span>` : '') : s.by === 'us' ? `<b class="good">🏆 мы первые · ${fmtDay(s.ut)}</b>` : s.by === 'rival' ? `<span class="bad">${RIVAL} · ${fmtDay(s.ut)}</span>` : `<span class="dim">повторили · ${fmtDay(s.ut)}</span>`;
      return `<tr class="${s ? '' : 'open'}"><td><b>${esc(it.title)}</b></td><td class="mono">${fmtDay(it.ut)}</td><td>${st}</td><td class="dim">${fmtMoney(r.funds)} · +${r.rep} реп.</td></tr>`;
    };
    const sites = SITES.filter(s => siteExists(g, s));
    this.root.innerHTML = `<div id="crew">${this.topbar('КОСМИЧЕСКАЯ ГОНКА', '<button id="rc-back">Назад</button>')}
      <div class="body panel scroll"><div class="row" style="font-size:18px;margin-bottom:8px"><b>ОРБИТА ${sc.us}</b><span class="dim">:</span><b>${sc.rival} ${RIVAL}</b><span class="grow"></span><span class="dim" style="font-size:12px">${RIVAL} идёт по настоящей хронологии. Успейте раньше — рубеж ваш.</span></div>
      <table class="crewt"><tr><th>Рубеж</th><th>Дата соперника</th><th>Итог</th><th>Награда за первенство</th></tr>${RACE.map(row).join('')}</table>
      <div class="ttl" style="margin-top:14px">Памятные места${sites.length ? '' : ' — пока нет'}</div>
      ${sites.map(s => { const st = (g.sites || {})[s.id] || {}; return `<div class="row"><span>${st.inspected ? '◆' : st.found ? '◈' : '◇'}</span><b>${esc(s.name)}</b><span class="dim">${BODY[s.body].name} · ${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}° · ${st.inspected ? 'осмотрено' : st.found ? 'найдено' : 'не найдено'}</span></div>`; }).join('')}
      <div class="dim" style="margin-top:6px;font-size:12px">Посадите аппарат ближе 2.5 км к месту — оно найдено; подойдите космонавтом ближе 40 м — осмотрено. Места видны в Атласе.</div></div></div>`;
    $('#rc-back').onclick = () => Game.toKSC();
  },

  // ---------------------------------------------------------------- astronaut corps
  crew() {
    this.clear();
    const g = Game.g;
    const where = (c) => {
      if (c.status === 'kia') return '<span class="bad">погиб(ла)</span>';
      if (c.status === 'missing') return '<span class="accent">ждёт спасения</span>';
      if (c.status === 'ready') return '<span class="good">готов(а)</span>';
      const s = g.vessels.find(v => (v.parts || []).some(p => p.crew && p.crew.includes(c.id)));
      return s ? 'в полёте: ' + esc(s.name) : 'в полёте';
    };
    const logTxt = (c) => Object.entries(c.log).map(([b, L]) => `${BODY[b].name}: ${Object.keys(L).map(k => ({ soi: 'пролёт', orbit: 'орбита', landed: 'посадка', space: 'космос', flag: 'флаг' }[k])).join(', ')}`).join(' · ');
    const row = (c) => `<tr><td><b>${esc(c.name)}</b></td><td>${CREW_ROLES[c.role]}</td><td class="accent">${'★'.repeat(crewLevel(c))}${'☆'.repeat(5 - crewLevel(c))}</td><td class="mono">${c.xp.toFixed(1)}${crewLevel(c) < 5 ? ' / ' + XP_LEVELS[crewLevel(c)] : ''}</td><td class="mono">${c.flights}</td><td>${where(c)}</td><td class="dim" style="font-size:11px">${logTxt(c) || '—'}</td></tr>`;
    const live = g.crew.filter(c => c.status !== 'kia'), dead = g.crew.filter(c => c.status === 'kia');
    this.root.innerHTML = `<div id="crew">${this.topbar('ОТРЯД КОСМОНАВТОВ', '<button id="cr-back">Назад</button>')}
      <div class="body panel scroll"><table class="crewt"><tr><th>Имя</th><th>Роль</th><th>Уровень</th><th>Опыт</th><th>Полётов</th><th>Где</th><th>Бывал(а)</th></tr>${live.map(row).join('')}</table>
      ${dead.length ? `<div class="ttl" style="margin-top:12px">Память</div><table class="crewt">${dead.map(row).join('')}</table>` : ''}
      <div class="ttl" style="margin-top:14px">Набор${isCareer(g) ? ` · ${fmtMoney(hireCost(g))}` : ''}</div>
      <div class="mbtns">${Object.entries(CREW_ROLES).map(([r, n]) => `<button data-hire="${r}">Нанять: ${n}</button>`).join('')}</div>
      <div class="dim" style="margin-top:10px;font-size:12px">${Object.entries(CREW_ROLE_HINT).map(([r, h]) => `<div><b>${CREW_ROLES[r]}.</b> ${h}</div>`).join('')}
        <div style="margin-top:6px">Опыт копится за пролёты, орбиты, посадки и флаги у разных тел и засчитывается, когда космонавт возвращается на Землю. Уровни: ${XP_LEVELS.join(', ')} опыта.</div></div></div></div>`;
    $('#cr-back').onclick = () => Game.toKSC();
    this.root.querySelector('.body').onclick = (e) => {
      const b = e.target.closest('[data-hire]'); if (!b) return;
      const k = hireKerbal(g, b.dataset.hire);
      if (!k) { this.toast('Не хватает средств', 'bad'); return; }
      this.toast(`В отряде: ${esc(k.name)} (${CREW_ROLES[k.role]})`, 'good'); Game.autosave(); this.crew();
    };
  },
  crewDlg() {
    const g = Game.g, d = VAB.design;
    const pods = []; const seen = new Set();
    for (const it of VAB.layout) if (it.def.command && it.def.command.crew > 0 && !seen.has(it.uid)) { seen.add(it.uid); pods.push(it); }
    if (!pods.length) { this.toast('В ракете нет капсул', '', 1800); return; }
    d.crew = d.crew || {};
    const ready = g.crew.filter(c => c.status === 'ready');
    const render = () => pods.map(it => {
      const sel = d.crew[it.uid];
      const seats = Array.from({ length: it.def.command.crew }, (_, i) => `<select data-u="${it.uid}" data-i="${i}" ${sel ? '' : 'disabled'}><option value="">— пусто —</option>${ready.map(c => `<option value="${c.id}" ${sel && sel[i] === c.id ? 'selected' : ''}>${esc(c.name)} · ${CREW_ROLES[c.role]} ${'★'.repeat(crewLevel(c))}</option>`).join('')}</select>`).join('');
      return `<div class="sciitem"><div class="row"><b class="grow">${esc(it.def.name)}</b><label><input type="checkbox" data-auto="${it.uid}" ${sel ? '' : 'checked'}> авто</label></div><div class="seats">${seats}</div></div>`;
    }).join('');
    const m = this.modal('Экипаж', `<div class="dim" style="margin-bottom:6px">«Авто» сажает готовых космонавтов при старте (пилот — первым). Снимите галочку, чтобы выбрать вручную.</div><div id="cw">${render()}</div>`, [{ label: 'Готово' }]);
    const box = m.querySelector('#cw');
    box.onchange = (e) => {
      const a = e.target.dataset.auto;
      if (a) { if (e.target.checked) delete d.crew[a]; else d.crew[a] = []; box.innerHTML = render(); return; }
      const u = e.target.dataset.u; if (!u) return;
      const arr = d.crew[u] || (d.crew[u] = []);
      arr[+e.target.dataset.i] = e.target.value || null;
      // one person, one seat
      for (const k in d.crew) d.crew[k] = d.crew[k].map((x, i) => (x && x === e.target.value && !(k === u && i === +e.target.dataset.i)) ? null : x);
      box.innerHTML = render();
    };
  },

  // ---------------------------------------------------------------- Tracking station
  track() {
    this.clear();
    this.root.innerHTML = `<div id="track">${this.topbar('СТАНЦИЯ СЛЕЖЕНИЯ', '<div class="warp row"><button id="t-wd">◀◀</button><span id="t-wr" class="mono">×1</span><button id="t-wu">▶▶</button></div><button id="t-atlas">Атлас</button><button id="t-alarm">⏰ Будильник</button><button id="t-plan">Перелёты</button><button id="t-back">Назад</button>')}
      <div class="list panel"><div class="ttl">Аппараты</div><div class="scroll grow" id="t-list"></div><div id="t-sel"></div></div></div>`;
    $('#t-back').onclick = () => Game.toKSC();
    $('#t-wd').onclick = () => Game.warpDown(); $('#t-wu').onclick = () => Game.warpUp();
    $('#t-alarm').onclick = () => this.alarms(); $('#t-plan').onclick = () => this.planner();
    $('#t-atlas').onclick = () => { const W = Game.world, sv = W && W.vessels.find(v => v.id === W.trackSel); this.atlas(sv && sv.body.terrain ? sv.body.id : 'moon'); };
    this.trackList();
  },
  trackList() {
    const W = Game.world; if (!W || !$('#t-list')) return;
    const t = Game.g.ut;
    $('#t-list').innerHTML = W.vessels.filter(v => !v.destroyed).map(v => `<div class="vitem ${W.trackSel === v.id ? 'sel' : ''}" data-v="${v.id}"><b>${esc(v.name)}</b><span>${esc(situationText(v, t))}</span></div>`).join('') || '<div class="dim">В полёте ничего нет.</div>';
    $('#t-list').onclick = (e) => { const it = e.target.closest('.vitem'); if (it) Game.trackSelect(it.dataset.v); };
    const sv = W.vessels.find(v => v.id === W.trackSel);
    $('#t-sel').innerHTML = sv ? `<div class="mbtns" style="margin-top:8px"><button class="acc" id="t-fly">Управлять</button>${sv.landed && sv.body.id === 'earth' ? '<button id="t-rec">Вернуть</button>' : ''}<button class="danger" id="t-del">Удалить</button></div>` : '';
    if (sv) {
      $('#t-fly').onclick = () => Game.flyVessel(sv.id);
      const r = $('#t-rec'); if (r) r.onclick = () => Game.recoverTracked(sv.id);
      $('#t-del').onclick = () => this.modal('Удалить аппарат?', esc(sv.name), [{ label: 'Удалить', cls: 'danger', onClick: () => Game.terminate(sv.id) }, { label: 'Отмена' }]);
    }
  },

  // ---------------------------------------------------------------- save / load
  saveDlg() {
    const saves = listSaves();
    const m = this.modal('Сохранить игру', `<div class="row"><input id="s-name" class="grow" value="${esc(Game.g.name)}"><button class="acc" id="s-new">Новый слот</button></div>
      <div class="ttl" style="margin-top:10px">Перезаписать</div>${saves.map(s => `<div class="vitem" data-s="${s.slot}"><b>${esc(s.name)} ${s.label ? '· ' + esc(s.label) : ''}</b><span>${s.mode === 'career' ? 'Карьера' : 'Песочница'} · ${fmtDate(s.ut)} · ${new Date(s.date).toLocaleString('ru-RU')}</span></div>`).join('') || '<div class="dim">Слотов пока нет.</div>'}`,
      [{ label: 'Экспорт в файл', onClick: () => Game.exportFile() }, { label: 'Закрыть' }]);
    $('#s-new').onclick = () => { const n = $('#s-name').value || 'Сохранение'; Game.g.name = n; Game.saveTo('s' + Date.now().toString(36), 'вручную'); this.closeModal(); };
    m.querySelector('.body').onclick = (e) => { const it = e.target.closest('.vitem'); if (it) { Game.saveTo(it.dataset.s, 'вручную'); this.closeModal(); } };
  },
  loadDlg() {
    const saves = listSaves();
    const m = this.modal('Загрузить', saves.map(s => `<div class="vitem" data-s="${s.slot}"><div class="row"><div class="grow"><b>${esc(s.name)} ${s.label ? '· ' + esc(s.label) : ''}</b><span>${s.mode === 'career' ? 'Карьера' : 'Песочница'} · ${fmtDate(s.ut)} · ${new Date(s.date).toLocaleString('ru-RU')}</span></div><button data-del="${s.slot}" class="danger" style="padding:2px 8px">✕</button></div></div>`).join('') || '<div class="dim">Нет сохранений.</div>',
      [{ label: 'Импорт из файла', onClick: () => Game.importFile() }, { label: 'Закрыть' }]);
    m.querySelector('.body').onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { e.stopPropagation(); deleteSlot(d.dataset.del); this.loadDlg(); return; }
      const it = e.target.closest('.vitem'); if (it) { this.closeModal(); Game.loadSlot(it.dataset.s); }
    };
  },
  help() {
    const old = $('#help'); if (old) { old.remove(); return; }
    const h = document.createElement('div'); h.id = 'help';
    h.innerHTML = `<div class="panel"><h2 style="margin-top:0">Управление</h2>
      <p><kbd>W</kbd><kbd>S</kbd> тангаж · <kbd>A</kbd><kbd>D</kbd> рыскание · <kbd>Q</kbd><kbd>E</kbd> крен</p>
      <p><kbd>Shift</kbd>/<kbd>Ctrl</kbd> тяга ± · <kbd>Z</kbd> полная · <kbd>X</kbd> ноль</p>
      <p><kbd>Пробел</kbd> следующая ступень</p>
      <p><kbd>T</kbd> SAS · <kbd>R</kbd> РСУ · <kbd>G</kbd> опоры и шасси · <kbd>B</kbd> тормоз · <kbd>CapsLock</kbd> точное управление</p>
      <p>Самолёт: <kbd>S</kbd> взять на себя, <kbd>A</kbd><kbd>D</kbd> руль и руление по полосе. Ровер: <kbd>W</kbd><kbd>S</kbd> газ, <kbd>A</kbd><kbd>D</kbd> руль</p>
      <p><kbd>H</kbd><kbd>N</kbd> РСУ вперёд/назад · <kbd>I</kbd><kbd>K</kbd> вверх/вниз · <kbd>J</kbd><kbd>L</kbd> влево/вправо</p>
      <p><kbd>M</kbd> карта · <kbd>Tab</kbd> фокус на карте · щелчок по траектории — манёвр</p>
      <p><kbd>.</kbd> / <kbd>,</kbd> ускорение времени ± · <kbd>/</kbd> сбросить · <kbd>Alt</kbd>+<kbd>.</kbd> физическое ускорение</p>
      <p><kbd>[</kbd> <kbd>]</kbd> переключить аппарат рядом</p>
      <p>Выход в открытый космос: <kbd>WASD</kbd> движение относительно камеры · <kbd>Shift</kbd>/<kbd>Ctrl</kbd> вверх/вниз · <kbd>R</kbd> ранец · <kbd>Пробел</kbd> прыжок · <kbd>B</kbd> в люк · <kbd>F</kbd> флаг</p>
      <p>Повтор (Esc → «Повтор полёта»): <kbd>Пробел</kbd> пауза · <kbd>←</kbd><kbd>→</kbd> перемотка · мышь — камера · «● Видео» — запись в файл</p>
      <p><kbd>F5</kbd> быстрое сохранение · <kbd>F9</kbd> загрузка · <kbd>Esc</kbd> пауза</p>
      <p>Мышь: тянуть — вращение камеры, колесо — масштаб</p>
      <p><b>Как выйти на орбиту:</b> старт вертикально, на 1–2 км начните плавно наклонять на восток (<kbd>D</kbd>), к 40 км почти горизонтально. Когда апоцентр выше 75 км — выключите тягу, у апоцентра разгоняйтесь по прогрейду, пока перицентр не выйдет из атмосферы (70 км).</p>
      <p><b>Возвращение:</b> тормозите ретрогрейдом до перицентра ~30 км, сбросьте всё кроме капсулы, держите теплощит вперёд (SAS ретрогрейд), парашюты откроются сами, когда станет безопасно.</p>
      <p class="dim">Щёлкните, чтобы закрыть · F1</p></div>`;
    h.onclick = () => h.remove();
    document.body.appendChild(h);
  },
};
