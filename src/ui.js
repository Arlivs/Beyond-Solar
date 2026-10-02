'use strict';
// DOM interface: menus, space center, VAB panels, flight HUD, R&D, mission control, tracking.

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT_COLOR = { pod: '#9fb4c9', tank: '#e8e8e8', engine: '#ff9b3a', coupling: '#e8b51c', aero: '#cfd6de', utility: '#7fd0ff', science: '#7dff6b' };

const ui = {
  root: null, el: {},
  init() { this.root = $('#ui'); },
  clear() { this.root.innerHTML = ''; this.el = {}; $('#maplayer').innerHTML = ''; MAP.labels.clear(); },
  toast(msg, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = msg;
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
      <button class="mbtn" id="m-career">Новая карьера</button>
      <button class="mbtn" id="m-sand">Новая песочница</button>
      <button class="mbtn" id="m-load" ${has ? '' : 'disabled'}>Загрузить…</button>
      <button class="mbtn" id="m-imp">Импорт сохранения из файла</button>
      <button class="mbtn" id="m-help">Управление</button>
      <div class="foot">Карьера: наука, контракты, дерево технологий. Песочница: все детали сразу. F1 — помощь в любой момент.</div>
    </div>`;
    if (has) $('#m-cont').onclick = () => Game.loadSlot(saves[0].slot);
    $('#m-career').onclick = () => Game.newGame('career');
    $('#m-sand').onclick = () => Game.newGame('sandbox');
    $('#m-load').onclick = () => this.loadDlg();
    $('#m-imp').onclick = () => Game.importFile();
    $('#m-help').onclick = () => this.help();
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
        <div class="card panel" id="k-track"><div class="ico">🛰</div><h3>Станция слежения</h3><p>Аппаратов в полёте: ${nV}. Ускорение времени, переключение.</p></div>
        ${isCareer(g) ? `<div class="card panel" id="k-rnd"><div class="ico">🔬</div><h3>НИИ</h3><p>Дерево технологий. Наука: ${g.science.toFixed(0)}</p></div>
        <div class="card panel" id="k-mc"><div class="ico">📡</div><h3>ЦУП</h3><p>Контракты: активных ${nAct}, предложений ${g.contracts.offered.length}.</p></div>` : ''}
        <div class="card panel" id="k-save"><div class="ico">💾</div><h3>Сохранить</h3><p>Слоты в браузере, экспорт в файл.</p></div>
      </div></div>`;
    $('#k-vab').onclick = () => Game.openVAB();
    $('#k-pad').onclick = () => g.lastCraft && Game.launch(JSON.parse(JSON.stringify(g.lastCraft)));
    $('#k-track').onclick = () => Game.openTracking();
    if (isCareer(g)) { $('#k-rnd').onclick = () => Game.openScreen('rnd'); $('#k-mc').onclick = () => Game.openScreen('mc'); }
    $('#k-save').onclick = () => this.saveDlg();
    $('#k-menu').onclick = () => this.modal('Меню', '', [
      { label: 'Загрузить', onClick: () => this.loadDlg() },
      { label: 'Экспорт в файл', onClick: () => Game.exportFile() },
      { label: 'Графика', onClick: () => this.gfxDlg() },
      { label: 'Главное меню', onClick: () => Game.toMenu() },
      { label: 'Закрыть' }]);
  },

  // ---------------------------------------------------------------- VAB
  vab() {
    this.clear();
    const d = VAB.design;
    this.root.innerHTML = `<div id="vab">${this.topbar('СБОРОЧНЫЙ ЦЕХ', `<input id="v-name" value="${esc(d.name)}" style="width:180px"><button id="v-new">Новая</button><button id="v-load">Загрузить</button><button id="v-save">Сохранить</button><button id="v-ksc">Выйти</button><button class="acc" id="v-launch">Запуск ▶</button>`)}
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
    const list = PARTS.filter(p => p.cat === VAB.cat && partUnlocked(g, p.id));
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
  craftDlg() {
    const g = Game.g;
    const own = Object.values(g.crafts);
    const stock = stockDesigns().filter(d => designAllowed(g, d));
    const item = (d, src) => `<div class="vitem" data-src="${src}" data-n="${esc(d.name)}"><b>${esc(d.name)}</b><span>${layoutDesign(d).length} дет. · ${designMass(d).toFixed(1)} т · ${fmtMoney(designCost(d))}</span></div>`;
    const m = this.modal('Загрузить ракету', `<div class="ttl">Ваши ракеты</div>${own.map(d => item(d, 'own')).join('') || '<div class="dim">Пока нет сохранённых.</div>'}
      <div class="ttl" style="margin-top:10px">Стандартные</div>${stock.map(d => item(d, 'stock')).join('') || '<div class="dim">Откройте больше технологий.</div>'}`, [{ label: 'Закрыть' }]);
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
        <div class="tbtn"><button id="h-map">Карта (M)</button><button id="h-menu">Меню (Esc)</button></div>
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
        <div class="ind"><span id="h-sasi">SAS</span><span id="h-rcsi">RCS</span><span id="h-gi">ОПОРЫ</span><span id="h-pi">ТОЧН</span></div>
        <div class="sas">${sasBtn('stab', 'Стабилизация')}${sasBtn('node', 'Манёвр')}${sasBtn('pro', 'Прогрейд')}${sasBtn('retro', 'Ретрогрейд')}${sasBtn('normal', 'Нормаль')}${sasBtn('anti', 'Антинормаль')}${sasBtn('radout', 'Радиально наружу')}${sasBtn('radin', 'Радиально внутрь')}<button class="full" data-sas="target">К цели</button></div>
      </div>
      <div id="mnv" class="panel" style="display:none"></div>
    </div>`;
    $('#h-wd').onclick = () => Game.warpDown(); $('#h-wu').onclick = () => Game.warpUp();
    $('#h-map').onclick = () => Game.toggleMap(); $('#h-menu').onclick = () => this.pause();
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
    const sv = mode === 'surface' ? V.sub(v.v, V.cross(bodyOmega(b), v.r)) : v.v;
    $('#h-spdm').textContent = mode === 'surface' ? 'ПОВЕРХНОСТЬ' : 'ОРБИТА';
    $('#h-spdv').textContent = fmtSpeed(V.len(sv));
    const thr = v.throttle;
    $('#h-thr').style.height = (thr * 164) + 'px';
    $('#h-thrl').textContent = Math.round(thr * 100) + '%';
    if (!force && now - this._hudT < 120) return;
    this._hudT = now;
    const up = V.norm(v.r), north = V.norm(V.reject([0, 0, 1], up)), east = V.cross(north, up);
    const fwd = Q.rot(v.q, [0, 1, 0]);
    const pitch = Math.asin(clamp(V.dot(fwd, up), -1, 1)) / DEG;
    const hdg = wrap2Pi(Math.atan2(V.dot(fwd, east), V.dot(fwd, north))) / DEG;
    const vs = V.dot(v.v, up);
    $('#h-hdg').textContent = `курс ${hdg.toFixed(0).padStart(3, '0')}° · тангаж ${pitch.toFixed(0)}° · верт ${vs.toFixed(1)} м/с`;
    $('#h-sit').textContent = situationText(v, t);
    $('#h-date').textContent = fmtDate(t) + (v.launchUT != null ? ' · T+' + fmtDur(t - v.launchUT, true) : '');
    // warp
    const lv = $('#h-wl');
    const n = W.warp > 0 ? W.warp : W.physWarp;
    lv.innerHTML = Game.warpLevels.slice(1).map((_, i) => `<i class="${W.warp > 0 && i < W.warp ? 'on' : W.warp === 0 && i < W.physWarp ? 'phys' : ''}"></i>`).join('');
    $('#h-wr').textContent = '×' + Game.warpRate().toLocaleString('ru-RU') + (W.warp === 0 && W.physWarp ? ' физ' : '');
    void n;
    // indicators
    $('#h-sasi').className = v.sas ? 'on' : ''; $('#h-rcsi').className = v.rcs ? 'on' : '';
    $('#h-gi').className = v.legs ? 'on' : ''; $('#h-pi').className = Game.precise ? 'on' : '';
    if (!hasControl(v)) $('#h-sasi').className = 'warn';
    this.root.querySelectorAll('.sas button').forEach(bt => bt.classList.toggle('on', v.sas && bt.dataset.sas === v.sasMode));
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
      if (W.traj) { const enc = W.traj.find(p => p.end === 'enter'); if (enc) oh += kv('Встреча', enc.next.name + ' через ' + fmtDur(enc.t1 - t, true)); }
    } else oh += `<div class="kv"><span>${v.prelaunch ? 'На стартовом столе' : 'На поверхности'}</span><b>${b.name}</b></div>`;
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
    if (stageRes) rh += `<div class="kv"><span>Топливо ступени</span><b>${stageRes.cur.toFixed(2)} / ${stageRes.max.toFixed(2)} т</b></div>`;
    const sim = Game.flightDV(v);
    if (sim) rh += `<div class="kv"><span>Δv ступени / всего</span><b>${sim.cur.toFixed(0)} / ${sim.total.toFixed(0)} м/с</b></div><div class="kv"><span>TWR (${esc(v.body.name)})</span><b>${sim.twr.toFixed(2)}</b></div>`;
    $('#h-res').innerHTML = rh;
    // actions + science
    let ah = '<div class="ttl">Действия</div><div class="mbtns">';
    if (v.landed && b.id === 'earth') ah += `<button data-a="recover" class="acc">Вернуть в ЦУП</button>`;
    if (v.parts.some(p => !p.dead && PART[p.id].chute && p.st.chute === 'stowed')) ah += `<button data-a="chutes">Парашюты</button>`;
    if (v.parts.some(p => !p.dead && PART[p.id].legs)) ah += `<button data-a="legs">Опоры (G)</button>`;
    if (v.parts.some(p => !p.dead && PART[p.id].solar)) ah += `<button data-a="solar">Панели</button>`;
    ah += `<button data-a="ksc">В космоцентр</button></div>`;
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
      { label: 'Графика', onClick: () => this.gfxDlg() },
      { label: 'Управление', onClick: () => this.help() },
    ]);
  },
  gfxDlg() {
    const names = { high: 'Высокое: MSAA, свечение, тени 2048, полное разрешение', medium: 'Среднее: разрешение ×1.5, тени 1024', low: 'Низкое: без теней и свечения, разрешение ×1' };
    this.modal('Графика', '<div class="ttl">Качество</div>' + Object.entries(names).map(([k, n]) => `<div class="vitem ${RV.quality === k ? 'sel' : ''}" data-q="${k}"><b>${n.split(':')[0]}</b><span>${n.split(':')[1]}</span></div>`).join('') +
      `<div class="ttl" style="margin-top:10px">Поле зрения</div><div class="mbtns">${[45, 50, 55, 60, 70].map(f => `<button data-f="${f}" class="${RV.fov === f ? 'on' : ''}">${f}°</button>`).join('')}</div>`, [{ label: 'Закрыть' }])
      .querySelector('.body').onclick = (e) => {
        const it = e.target.closest('[data-q]'); if (it) { setQuality(it.dataset.q); this.toast('Графика: ' + names[it.dataset.q].split(':')[0], '', 1500); this.gfxDlg(); }
        const f = e.target.closest('[data-f]'); if (f) { setFov(+f.dataset.f); this.gfxDlg(); }
      };
  },
  destroyed(why) {
    const L = Game.world && Game.world.launch;
    this.modal('Корабль потерян', `<p>${esc(why || '')}</p>`, [
      ...(L ? [{ label: 'Вернуться к запуску', cls: 'acc', onClick: () => Game.revert('launch') }, { label: 'Вернуться в цех', onClick: () => Game.revert('vab') }] : []),
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

  // ---------------------------------------------------------------- Tracking station
  track() {
    this.clear();
    this.root.innerHTML = `<div id="track">${this.topbar('СТАНЦИЯ СЛЕЖЕНИЯ', '<div class="warp row"><button id="t-wd">◀◀</button><span id="t-wr" class="mono">×1</span><button id="t-wu">▶▶</button></div><button id="t-back">Назад</button>')}
      <div class="list panel"><div class="ttl">Аппараты</div><div class="scroll grow" id="t-list"></div><div id="t-sel"></div></div></div>`;
    $('#t-back').onclick = () => Game.toKSC();
    $('#t-wd').onclick = () => Game.warpDown(); $('#t-wu').onclick = () => Game.warpUp();
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
      <p><kbd>T</kbd> SAS · <kbd>R</kbd> РСУ · <kbd>G</kbd> опоры · <kbd>CapsLock</kbd> точное управление</p>
      <p><kbd>H</kbd><kbd>N</kbd> РСУ вперёд/назад · <kbd>I</kbd><kbd>K</kbd> вверх/вниз · <kbd>J</kbd><kbd>L</kbd> влево/вправо</p>
      <p><kbd>M</kbd> карта · <kbd>Tab</kbd> фокус на карте · щелчок по траектории — манёвр</p>
      <p><kbd>.</kbd> / <kbd>,</kbd> ускорение времени ± · <kbd>/</kbd> сбросить · <kbd>Alt</kbd>+<kbd>.</kbd> физическое ускорение</p>
      <p><kbd>[</kbd> <kbd>]</kbd> переключить аппарат рядом</p>
      <p><kbd>F5</kbd> быстрое сохранение · <kbd>F9</kbd> загрузка · <kbd>Esc</kbd> пауза</p>
      <p>Мышь: тянуть — вращение камеры, колесо — масштаб</p>
      <p><b>Как выйти на орбиту:</b> старт вертикально, на 1–2 км начните плавно наклонять на восток (<kbd>D</kbd>), к 40 км почти горизонтально. Когда апоцентр выше 75 км — выключите тягу, у апоцентра разгоняйтесь по прогрейду, пока перицентр не выйдет из атмосферы (70 км).</p>
      <p><b>Возвращение:</b> тормозите ретрогрейдом до перицентра ~30 км, сбросьте всё кроме капсулы, держите теплощит вперёд (SAS ретрогрейд), парашюты откроются сами, когда станет безопасно.</p>
      <p class="dim">Щёлкните, чтобы закрыть · F1</p></div>`;
    h.onclick = () => h.remove();
    document.body.appendChild(h);
  },
};
