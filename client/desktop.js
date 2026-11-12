// Širokoúhlý (počítačový) režim: postranní panely vedle karty, větší herní karta a klávesové zkratky.
// Na telefonu a v úzkém okně se nic z toho nezobrazí; nic tu nemění logiku hry.
(function () {
  const PANEL_W = 270, GAP = 20, PAD = 8;
  const FULL_W = 760;                         // šířka herní karty v duelu na velkém monitoru
  const mqPointer = window.matchMedia('(hover:hover) and (pointer:fine)');
  const root = document.createElement('div');
  root.id = 'sidePanels';
  document.body.appendChild(root);

  const cache = { hist: null, daily: null, weekly: null, elo: null, at: 0, loading: false };
  const panels = {};
  const kbd = (k) => `<span class="kbd">${k}</span>`;

  function panel(id) {
    if (!panels[id]) {
      const el = document.createElement('aside');
      el.className = 'side';
      el.id = 'side-' + id;
      el.hidden = true;
      root.appendChild(el);
      panels[id] = el;
    }
    return panels[id];
  }
  function setHtml(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }
  function hideAll() { Object.values(panels).forEach(p => { p.hidden = true; }); document.body.classList.remove('desk-duel'); }

  // ----- data pro menu -----
  function loadMenuData() {
    const now = Date.now();
    if (cache.loading || (cache.at && now - cache.at < 60000)) return;
    cache.loading = true;
    let pending = 4;
    const done = () => { if (--pending === 0) { cache.loading = false; cache.at = Date.now(); window.__menuDataReady = true; schedule(); } };
    socket.emit('get_daily_leaderboard', (r) => { cache.daily = Array.isArray(r) ? r.slice(0, 5) : []; done(); });
    socket.emit('get_weekly_leaderboard', (r) => { cache.weekly = r && Array.isArray(r.rows) ? r.rows.slice(0, 5) : []; done(); });
    socket.emit('get_leaderboard', { mode: 2 }, (r) => { cache.elo = Array.isArray(r) ? r.slice(0, 3) : []; done(); });
    socket.emit('get_daily_history', (r) => { cache.hist = Array.isArray(r) ? r : []; done(); });
    setTimeout(() => { if (cache.loading) { cache.loading = false; } }, 6000);
  }

  const rows = (items, empty) => items.length ? items.join('') : `<div class="row dim">${empty}</div>`;
  function dayLabel(iso) {
    try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' }); }
    catch { return iso; }
  }

  function renderMenuPanels() {
    loadMenuData();
    const daily = cache.daily, weekly = cache.weekly, elo = cache.elo, hist = cache.hist;
    setHtml(panel('dailyTop'), `<h4>🏆 Žebříček dne <small>denní výzva</small></h4>` + (daily === null ? '<div class="row dim">···</div>' : rows(daily.map((e, i) =>
      `<div class="row"><span class="rk${i < 3 ? ' g' : ''}">${i + 1}</span><span class="nm">${esc(e.name)}</span><span class="v">${e.count}</span></div>`), 'Zatím nikdo nehrál.')) +
      `<div class="hint">Zadání se odhalí až po spuštění — pro všechny stejné.</div>`);
    setHtml(panel('weeklyTop'), `<h4>🏆 Žebříček týdne <small>týdenní výzva</small></h4>` + (weekly === null ? '<div class="row dim">···</div>' : rows(weekly.map((e, i) =>
      `<div class="row"><span class="rk${i < 3 ? ' g' : ''}">${i + 1}</span><span class="nm">${esc(e.name)}</span><span class="v">${e.count}</span></div>`), 'Zatím nikdo nehrál.')) +
      `<div class="hint">Jedno zadání na celý týden, počítá se počet slov.</div>`);
    setHtml(panel('eloTop'), `<h4>⚔ Nejlepší hráči <small>2 písmena · ELO</small></h4>` + (elo === null ? '<div class="row dim">···</div>' : rows(elo.map((e, i) =>
      `<div class="row"><span class="rk g">${i + 1}</span><span class="nm">${esc(e.name)}</span><span class="v">${e.elo}</span></div>`), 'Zatím žádné zápasy.')));
    setHtml(panel('dailyHist'), `<h4>📅 Poslední výzvy <small>zadání · vítěz</small></h4>` + (hist === null ? '<div class="row dim">···</div>' : rows(hist.map(h =>
      `<div class="row hist"><span class="hd">${esc(dayLabel(h.date))}</span><span class="hp">${esc(String(h.pattern || '').toUpperCase())}···</span><span class="nm">${h.top ? esc(h.top) : '<i class="dim">nikdo</i>'}</span><span class="v">${h.top ? h.count : ''}</span></div>`), 'Zatím žádná historie.')));
    setHtml(panel('keys'), `<h4>Klávesy</h4>
      <div class="row">${kbd('Enter')}<span class="nm">Hrát online</span></div>
      <div class="row">${kbd('Backspace')}<span class="nm">zpět</span></div>`);
    return { left: ['dailyTop', 'weeklyTop', 'eloTop'], right: ['dailyHist', 'keys'] };
  }

  // ----- duel -----
  function renderDuelPanels() {
    const feed = document.getElementById('feed');
    const items = feed ? [...feed.children].slice(0, 14) : [];
    const you = game.youAre;
    const total = feed ? feed.children.length : 0;
    setHtml(panel('words'), `<h4>Slova ve hře <small>${total}</small></h4>` + (items.length ? items.map(d => {
      const t = d.textContent || '';
      const i = t.indexOf(': ');
      const name = i > 0 ? t.slice(0, i) : '', word = i > 0 ? t.slice(i + 2) : t;
      const mine = d.className.includes('p' + you);
      return `<div class="row"><span class="rk${mine ? ' g' : ''}">${esc((name[0] || '?').toUpperCase())}</span><span class="nm">${esc(word)}</span><span class="dim">${esc(name)}</span></div>`;
    }).join('') : '<div class="row dim">Zatím žádná slova.</div>'));
    const st = game.opponentStats;
    const winPct = st && st.games ? Math.round((st.wins / st.games) * 100) : null;
    setHtml(panel('opp'), `<h4>Soupeř</h4>
      <div class="row"><span class="nm big">${esc(game.opponentName)}</span></div>
      <div class="row"><span class="nm dim">ELO soupeře</span><span class="v">${game.opponentElo != null ? game.opponentElo : '–'}</span></div>
      <div class="row"><span class="nm dim">Tvoje ELO</span><span>${game.myElo != null ? game.myElo : '–'}</span></div>` +
      (st ? `<div class="row"><span class="nm dim">Odehráno</span><span>${st.games} her</span></div>
      <div class="row"><span class="nm dim">Výhry</span><span>${st.wins}${winPct != null ? ' · ' + winPct + ' %' : ''}</span></div>`
          : `<div class="row dim">Host — bez statistik.</div>`) +
      `<div class="row"><span class="nm dim">Režim</span><span>${esc(MODE_LABEL[game.mode] || '')}</span></div>`);
    setHtml(panel('keys'), `<h4>Klávesy</h4>
      <div class="row">${kbd('Enter')}<span class="nm">odeslat slovo</span></div>
      <div class="row">${kbd('Esc')}<span class="nm">smazat pole</span></div>
      <div class="row">${kbd('Tab')}<span class="nm">reakce a tlačítka</span></div>
      <div class="hint">Na počítači stačí psát na klávesnici.</div>`);
    return { left: ['words'], right: ['opp', 'keys'] };
  }

  // ----- denní výzva (hra) -----
  function renderDailyPanels() {
    loadMenuData();
    const feed = document.getElementById('feed');
    const total = feed ? feed.children.length : 0;
    setHtml(panel('dWords'), `<h4>Nalezená slova</h4><div class="bignum">${total}</div><div class="hint">${total === 1 ? 'slovo' : (total >= 2 && total <= 4 ? 'slova' : 'slov')} v této výzvě</div>`);
    const daily = cache.daily;
    const best = daily && daily.length ? daily[0] : null;
    setHtml(panel('dTop'), `<h4>🏆 Žebříček dne <small>k překonání</small></h4>` + (daily === null ? '<div class="row dim">···</div>' : rows(daily.map((e, i) =>
      `<div class="row"><span class="rk${i < 3 ? ' g' : ''}">${i + 1}</span><span class="nm">${esc(e.name)}</span><span class="v">${e.count}</span></div>`), 'Zatím nikdo — buď první.')) +
      (best ? `<div class="hint">Nejlepší dnes: ${best.count} slov.</div>` : ''));
    setHtml(panel('dKeys'), `<h4>Klávesy</h4>
      <div class="row">${kbd('Enter')}<span class="nm">odeslat slovo</span></div>
      <div class="row">${kbd('Esc')}<span class="nm">smazat pole</span></div>
      <div class="hint">Denní výzvu lze hrát jen jednou za den.</div>`);
    return { left: ['dWords'], right: ['dTop', 'dKeys'] };
  }

  // ----- Battle Royale -----
  function renderBrPanels() {
    const st = br.st, you = br.youAre;
    const order = st.players.map((p, i) => ({ p, i })).sort((a, b) => (b.p.alive - a.p.alive) || (a.p.alive ? b.p.lives - a.p.lives : a.p.place - b.p.place));
    const cur = st.phase === 'turn' ? st.turn : st.nextTurn;
    setHtml(panel('bPlayers'), `<h4>Hráči <small>${st.players.filter(p => p.alive).length} z ${st.players.length}</small></h4>` + order.map(({ p, i }) => {
      const hearts = p.alive ? '❤'.repeat(Math.max(0, p.lives)) : `${p.place}. místo`;
      const off = p.alive && !p.connected ? ' ⚠' : '';
      return `<div class="row${p.alive ? '' : ' dim'}"><span class="rk" style="background:${brColor(i).hex};color:${brColor(i).on}">${i === cur && p.alive ? '▶' : ''}</span><span class="nm">${esc(p.name)}${i === you ? ' (ty)' : ''}${off}</span><span class="v">${hearts}</span></div>`;
    }).join(''));
    const log = (br.log || []).slice(-14).reverse();
    setHtml(panel('bLog'), `<h4>Průběh hry <small>kolo ${st.round}</small></h4>` + (log.length ? log.map(e =>
      `<div class="row"><span class="rk" style="background:${brColor(e.seat).hex};color:${brColor(e.seat).on}">${e.r}</span><span class="nm">${esc(e.t)}</span></div>`).join('')
      : '<div class="row dim">Zatím se nic nestalo.</div>'));
    setHtml(panel('bKeys'), `<h4>Klávesy</h4>
      <div class="row">${kbd('Enter')}<span class="nm">odeslat slovo</span></div>
      <div class="row">${kbd('Esc')}<span class="nm">smazat pole</span></div>
      <div class="hint">Poslední přeživší vyhrává.</div>`);
    return { left: ['bPlayers'], right: ['bLog', 'bKeys'] };
  }

  // ----- které obrazovce odpovídáme -----
  function currentScreen() {
    if (document.getElementById('playBtn') && document.querySelector('.page.home')) return 'menu';
    if (typeof game !== 'undefined' && game && !game.finished && document.getElementById('wordInput') &&
        document.querySelector('.card.game-card') && !document.querySelector('.card.br-card')) return 'duel';
    if (typeof dailyState !== 'undefined' && dailyState && document.getElementById('wordInput') && document.querySelector('.card')) return 'daily';
    if (typeof br !== 'undefined' && br && typeof brScreen !== 'undefined' && brScreen === 'game' && br.st && !br.over && document.querySelector('.card.br-card')) return 'br';
    return null;
  }

  function place(ids, left) {
    const card = document.querySelector('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = left ? r.left - GAP - PANEL_W : r.right + GAP;
    const fits = left ? x >= PAD : x + PANEL_W <= window.innerWidth - PAD;
    let y = r.top + 10;
    ids.forEach(id => {
      const el = panels[id];
      el.hidden = !fits;
      if (!fits) return;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      y += el.offsetHeight + 14;
    });
  }

  let raf = 0;
  // Překreslení panelů nejvýš ~5× za sekundu (odpočty v kartě mění DOM každou chvíli);
  // změna velikosti okna se řeší hned.
  let lastSync = 0, syncT = 0;
  function schedule(now) {
    if (raf || syncT) return;
    const wait = now === true ? 0 : Math.max(0, 200 - (Date.now() - lastSync));
    const run = () => { syncT = 0; raf = requestAnimationFrame(() => { raf = 0; lastSync = Date.now(); sync(); }); };
    if (wait) syncT = setTimeout(run, wait); else run();
  }

  function sync() {
    if (!mqPointer.matches || window.innerWidth < 1060) { hideAll(); return; }
    const scr = currentScreen();
    if (!scr) { hideAll(); return; }
    const duelFull = scr === 'duel' && window.innerWidth >= FULL_W + 2 * (PANEL_W + GAP + PAD);
    document.body.classList.toggle('desk-duel', duelFull);
    if (scr === 'duel' && !duelFull) { Object.values(panels).forEach(p => { p.hidden = true; }); return; }
    const layout = scr === 'menu' ? renderMenuPanels() : scr === 'daily' ? renderDailyPanels() : scr === 'br' ? renderBrPanels() : renderDuelPanels();
    Object.keys(panels).forEach(id => { if (![...layout.left, ...layout.right].includes(id)) panels[id].hidden = true; });
    place(layout.left, true);
    place(layout.right, false);
  }

  const appEl = document.getElementById('app');
  // Panely se překreslují jen při přidání/odebrání prvků (ne při každém tiknutí odpočtu, které mění jen text);
  // pro jistotu navíc jednou za sekundu, dokud je karta vidět (setHtml nic nepřepisuje, když se obsah nezměnil).
  const hasElement = (list) => { for (const n of list) if (n.nodeType === 1) return true; return false; };
  if (appEl) new MutationObserver((recs) => { for (const r of recs) if (hasElement(r.addedNodes) || hasElement(r.removedNodes)) { schedule(); return; } }).observe(appEl, { childList: true, subtree: true });
  setInterval(() => { if (!document.hidden) schedule(); }, 1000);
  window.addEventListener('resize', () => schedule(true));
  mqPointer.addEventListener && mqPointer.addEventListener('change', () => schedule(true));
  if (window.ResizeObserver) new ResizeObserver(() => schedule(true)).observe(document.body);
  schedule();

  // ----- hlasitost: posuvník vedle ikony reproduktoru (jen myš / počítač) -----
  function syncVolume() {
    document.querySelectorAll('#soundBtn').forEach(btn => {
      let pop = btn.nextElementSibling && btn.nextElementSibling.classList.contains('vol-pop') ? btn.nextElementSibling : null;
      if (!mqPointer.matches) { if (pop) pop.remove(); return; }
      if (!pop) {
        pop = document.createElement('div');
        pop.className = 'vol-pop';
        pop.innerHTML = '<input type="range" min="0" max="100" step="1" aria-label="Hlasitost" title="Hlasitost">';
        btn.after(pop);
        const r = pop.firstChild;
        r.addEventListener('input', () => {
          const v = +r.value;
          setSoundVolume(v / 100);
          r.style.setProperty('--v', v + '%');
          if (v === 0 && soundEnabled) setSoundEnabled(false);          // úplně dolů = vypnuto
          else if (v > 0 && !soundEnabled) setSoundEnabled(true);
        });
        r.addEventListener('change', () => { if (soundEnabled) playClick(); r.blur(); });
      }
      const r = pop.firstChild, v = soundEnabled ? Math.round(soundVolume * 100) : 0;
      if (+r.value !== v && document.activeElement !== r) r.value = v;
      r.style.setProperty('--v', r.value + '%');
      pop.hidden = false;
    });
  }
  window.addEventListener('dopisto-sound', syncVolume);
  let volRaf = 0;
  const volObs = new MutationObserver(() => { if (!volRaf) volRaf = requestAnimationFrame(() => { volRaf = 0; syncVolume(); }); });
  if (appEl) volObs.observe(appEl, { childList: true, subtree: true });
  mqPointer.addEventListener && mqPointer.addEventListener('change', syncVolume);
  syncVolume();

  // ----- klávesové zkratky -----
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    const tag = t && t.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    // Okno s pravidly / nastavením zavře Esc i Backspace.
    const sheet = document.getElementById('infoSheet');
    if (sheet && !typing && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); closeInfoSheet(); return; }
    if (document.querySelector('.nick-modal, .sheet-box, #acctPop, .report-modal')) return;
    // Backspace = zpět (jen mimo hru a mimo psaní).
    if (e.key === 'Backspace' && !typing && tag !== 'BUTTON' && tag !== 'A') {
      const back = document.querySelector('#infoBackBtn, #playBackBtn, #backToMenuBtn, #dailyMenuBtn, #menuBtn, #brMenuBtn');
      if (back && !document.getElementById('wordInput')) { e.preventDefault(); back.click(); }
      return;
    }
    if (e.key === 'Escape') {
      const wi = document.getElementById('wordInput');
      if (wi && t === wi && wi.value) { wi.value = ''; wi.dispatchEvent(new Event('input', { bubbles: true })); e.preventDefault(); }
      return;
    }
    if (typing || tag === 'BUTTON' || tag === 'A') return;     // tlačítko si Enter/mezerník vyřídí samo
    if (e.key === 'Enter') {
      const b = document.getElementById('playBtn') || document.getElementById('findBtn');
      if (b) { e.preventDefault(); b.click(); }
    }
  });
})();
