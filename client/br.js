// ==== Battle Royale (2–5 hráčů v kruhu) ====
// Samostatný soubor — používá globální pomocné funkce z app.js (app, socket, esc,
// zvuky, vlastní klávesnice, renderMenu, …). Serverová logika je v server/br.js.

let br = null; // { roomId, youAre, token, st, spectating, over, lastKey, ... }
let brScreen = 'none'; // none | menu | joining | queue | lobby | game | result

const BR_HEART = '❤';

// Barvy hráčů — podle toho, kdo je na tahu, se mění barva celého rozhraní.
const BR_COLORS = {
  blue:   { name: 'Modrá',    hex: '#3b82f6', soft: '#7aa8f8', on: '#fff', rgb: '59,130,246' },
  green:  { name: 'Zelená',   hex: '#22c55e', soft: '#62da8b', on: '#06240f', rgb: '34,197,94' },
  yellow: { name: 'Žlutá',    hex: '#facc15', soft: '#fcdc5e', on: '#2a2100', rgb: '250,204,21' },
  purple: { name: 'Fialová',  hex: '#a855f7', soft: '#c08bf9', on: '#fff', rgb: '168,85,247' },
  orange: { name: 'Oranžová', hex: '#fb923c', soft: '#fcb072', on: '#2b1200', rgb: '251,146,60' },
};
function brColor(seat) {
  const p = br && br.st && br.st.players[seat];
  return (p && BR_COLORS[p.color]) || BR_COLORS.blue;
}

function brName(seat) {
  const p = br && br.st && br.st.players[seat];
  return p ? esc(p.name) : '?';
}

// ---- vstup do Battle Royale je v menu "Hrát online" (záložka Royale) ----
function renderBrMenu(notice) {
  brScreen = 'none';
  selectedMode = 'br';
  renderPlayMenu(notice ? esc(notice) : '');
}

function renderBrWait(text) {
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">${esc(text)}</p>
      <button class="secondary small" id="brCancelBtn" style="width:100%; margin-top:10px">Zrušit</button>
    </div>`;
  document.getElementById('brCancelBtn').onclick = () => { socket.emit('br_leave_lobby'); renderBrMenu(); };
}

function renderBrQueue(count) {
  brScreen = 'queue';
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <p style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:0">Battle Royale</p>
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px; margin-bottom:6px">Hledám hráče…</p>
      <div class="br-queue-count"><span id="brQueueCount">${count}</span> / 5</div>
      <p style="color:var(--muted); font-size:11px">Hra začne, jakmile je plno. Po 45 s se spustí i od 3 hráčů.</p>
      <button class="secondary small" id="brCancelBtn" style="width:100%; margin-top:10px">Zrušit</button>
    </div>`;
  document.getElementById('brCancelBtn').onclick = () => { socket.emit('br_cancel'); renderBrMenu(); };
}

function renderBrLobby(d) {
  brScreen = 'lobby';
  const rows = d.players.map((n, i) => `<div class="br-lobby-player"><span>${i === 0 ? '👑' : '👤'}</span><b>${esc(n)}</b></div>`).join('')
    + Array.from({ length: d.max - d.players.length }, () => '<div class="br-lobby-player empty"><span>·</span><i>volné místo</i></div>').join('');
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <p style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:0">Battle Royale · lobby</p>
      <div class="lobby-code" id="lobbyCodeNum">${esc(d.code)}</div>
      <p style="color:var(--muted); font-size:11px">Pošli tento kód kamarádům, ať ho zadají v Hrát online → Royale → „Připojit“.</p>
      <div class="br-lobby-list">${rows}</div>
      ${d.isHost
        ? `<button id="brStartBtn" ${d.players.length < d.min ? 'disabled' : ''} style="width:100%; margin-top:12px">${d.players.length < d.min ? `Čekám na hráče (min. ${d.min})` : `Spustit hru (${d.players.length})`}</button>`
        : '<p style="color:var(--ink-soft); font-size:13px">Čekám, až hostitel spustí hru…</p>'}
      <div class="row" style="margin-top:10px">
        <button class="secondary small" id="brCopyBtn">Zkopírovat kód</button>
        <button class="secondary small" id="brCancelBtn">Opustit</button>
      </div>
    </div>`;
  document.getElementById('brCancelBtn').onclick = () => { socket.emit('br_leave_lobby'); renderBrMenu(); };
  document.getElementById('brCopyBtn').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(d.code).catch(() => {}); };
  const sb = document.getElementById('brStartBtn');
  if (sb) sb.onclick = () => socket.emit('br_start_lobby');
}

// ---- herní obrazovka ----
function brHeartsHtml(p, max) {
  let h = '';
  for (let i = 0; i < max; i++) {
    const on = i < p.lives;
    h += `<span class="br-heart${i >= 2 ? ' bonus' : ''}${on ? ' on' : ''}">${BR_HEART}</span>`;
  }
  return h;
}

function brMeterHtml(p, goal) {
  let h = '';
  for (let i = 0; i < goal; i++) h += `<span class="br-pip${i < p.meter ? ' on' : ''}"></span>`;
  return `<div class="br-meter" title="Denní bonusy → bonusové srdce">${h}</div>`;
}

function brRingHtml() {
  const st = br.st;
  const n = st.players.length;
  return st.players.map((p, i) => {
    const ang = (90 + ((i - br.youAre + n) % n) * (360 / n)) * Math.PI / 180;
    const x = 50 + 39 * Math.cos(ang);
    const y = 48 + 40 * Math.sin(ang);
    const active = st.phase === 'turn' && st.turn === i;
    const upNext = st.phase !== 'turn' && st.nextTurn === i && p.alive;
    const cls = ['br-seat', active ? 'active' : '', upNext ? 'next' : '', !p.alive ? 'dead' : '', i === br.youAre ? 'me' : '', !p.connected && p.alive ? 'offline' : ''].join(' ');
    return `
      <div class="${cls}" id="brSeat${i}" style="left:${x.toFixed(1)}%; top:${y.toFixed(1)}%; --pc:${brColor(i).hex}; --pcrgb:${brColor(i).rgb}">
        <div class="br-name"><span class="br-dot"></span>${p.alive ? '' : '💀 '}${esc(p.name)}${!p.connected && p.alive ? ' ⚠' : ''}</div>
        <div class="br-hearts">${p.alive ? brHeartsHtml(p, st.maxLives) : `<span class="br-place">${p.place}. místo</span>`}</div>
        ${p.alive ? brMeterHtml(p, st.meterGoal) : ''}
      </div>`;
  }).join('');
}

function renderBrGame() {
  brScreen = 'game';
  closeBrOverlay();
  br.spectatorNote = false;
  const st = br.st;
  const me = st.players[br.youAre];
  app.innerHTML = `
    <div class="card game-card br-card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <div class="br-head">
        <span class="br-round" id="brRound"></span>
        <span class="br-dir" id="brDir"></span>
      </div>
      ${dailyBonusChipHtml(st.bonus, 'gameBonusChip').replace('· +3 s', '· metr ❤')}
      <div class="br-ring" id="brRing">
        <div class="br-center">
          <div id="brPattern"></div>
          <div class="br-timer" id="brTimer"></div>
        </div>
        <div id="brSeats"></div>
      </div>
      <div class="turn-timer-wrap" id="brBarWrap">
        <div class="turn-timer-bar-bg"><div class="turn-timer-bar" id="brBar" style="width:100%"></div></div>
      </div>
      <div class="turn-status" id="brStatus"></div>
      <div class="last-word" id="brBanner"></div>
      <div id="brInputBox">${wordInputHtml('')}</div>
      <div class="br-power" id="brPower">
        <button type="button" class="br-pw" id="brPassBtn"><b>⏭ Přeskočit</b><small>pošle řadu dál</small></button>
        <button type="button" class="br-pw" id="brRevBtn"><b>⇄ Obrátit směr</b><small>řada jde zpět</small></button>
      </div>
      <div class="used-count" id="brUsed"></div>
      <div class="game-footer"><button id="brLeaveBtn" class="link-btn giveup-link">Opustit hru</button></div>
      <div class="feed" id="feed"></div>
    </div>`;
  document.getElementById('soundBtn').onclick = toggleSound;

  const wordInput = document.getElementById('wordInput');
  const send = () => {
    const word = wordInput.value.trim();
    const pre = wordInput.dataset.prefill || '';
    if (!word) return;
    const s = br.st;
    if (!(s.phase === 'turn' && s.turn === br.youAre)) { inputFeedback('bad', s.phase === 'turn' ? `Na tahu je ${brName(s.turn)}.` : 'Počkej na odpočet.'); return; }
    wordInput.value = pre;
    wordInput.dispatchEvent(new Event('input', { bubbles: true }));
    socket.emit('br_submit_word', { roomId: br.roomId, word });
    wordInput.focus();
  };
  document.getElementById('sendBtn').onclick = send;
  wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  bindWordInputExtras(wordInput);

  document.getElementById('brPassBtn').onclick = () => socket.emit('br_pass', { roomId: br.roomId });
  document.getElementById('brRevBtn').onclick = () => socket.emit('br_reverse', { roomId: br.roomId });
  document.getElementById('brLeaveBtn').onclick = () => {
    const alive = br.st.players[br.youAre].alive;
    if (alive && !confirm('Opravdu chceš opustit hru? Vypadneš z ní.')) return;
    brLeaveToMenu();
  };

  br.shownPattern = null;
  brRender(true);
  if (me.alive) wordInput.focus();
}

function brLeaveToMenu() {
  if (br) socket.emit('br_leave', { roomId: br.roomId });
  closeBrOverlay();
  br = null;
  renderMenu();
}

// Překreslí dynamické části podle br.st (bez zásahu do rozepsaného slova).
function brRender(force) {
  if (!br || brScreen !== 'game') return;
  const st = br.st;
  const me = st.players[br.youAre];
  const q = (id) => document.getElementById(id);

  // Barva rozhraní = barva hráče, který je právě na tahu (mezi tahy toho, kdo bude následovat).
  const actor = st.phase === 'turn' ? st.turn : st.nextTurn;
  const col = brColor(actor);
  const card = document.querySelector('.br-card');
  if (card) {
    card.style.setProperty('--accent', col.hex);
    card.style.setProperty('--accent-soft', col.soft);
    card.style.setProperty('--br-rgb', col.rgb);
  }
  document.body.style.setProperty('--br-rgb', col.rgb);
  document.body.classList.add('br-live');
  // Klávesnice (mimo #app) má vždy barvu, kterou máš ty — nemění se podle toho, kdo je na tahu.
  const myCol = brColor(br.youAre);
  document.body.style.setProperty('--vk-main', myCol.hex);
  document.body.style.setProperty('--vk-fg', myCol.soft);
  document.body.style.setProperty('--vk-bg', `rgba(${myCol.rgb}, .2)`);
  document.body.style.setProperty('--vk-rgb', myCol.rgb);
  document.body.style.setProperty('--vk-on', myCol.on);
  document.body.classList.add('vk-themed');

  q('brRound').textContent = `Kolo ${st.round} · ${Math.round(st.turnMs / 1000)} s na tah`;
  q('brDir').innerHTML = st.dir === 1 ? '↻ po směru' : '↺ proti směru';
  q('brSeats').innerHTML = brRingHtml();

  const patKey = st.pattern.type + st.pattern.value;
  const wordInput = q('wordInput');
  if (br.shownPattern !== patKey) {
    const first = br.shownPattern === null;
    br.shownPattern = patKey;
    q('brPattern').innerHTML = patternTilesHtml(st.pattern, 'br-tiles reveal');
    wordInput.placeholder = patternInputPlaceholder(st.pattern);
    const pre = patternPrefill(st.pattern);
    wordInput.dataset.prefill = pre;
    wordInput.value = pre;
    wordInput.dispatchEvent(new Event('input', { bubbles: true }));
    q('brUsed').textContent = `${patternInstruction(st.pattern)} · Slov: ${st.usedCount}`;
    if (!first) playSwoosh();
  } else {
    q('brUsed').textContent = `${patternInstruction(st.pattern)} · Slov: ${st.usedCount}`;
  }

  const mine = st.phase === 'turn' && st.turn === br.youAre && me.alive;
  const status = q('brStatus');
  status.classList.toggle('mine', mine);
  if (st.phase === 'reveal') status.innerHTML = `Tvoje barva: <b class="br-mycolor" style="color:${brColor(br.youAre).hex}">${brColor(br.youAre).name}</b> · začíná <b>${brName(st.nextTurn)}</b>`;
  else if (st.phase === 'break') status.innerHTML = `Nové zadání · pokračuje <b>${brName(st.nextTurn)}</b>`;
  else status.innerHTML = mine ? '<span class="ts-dot"></span> Jsi na tahu — piš!' : `Na tahu je ${brName(st.turn)}…`;

  // vstup a powerupy: jen živý hráč; pozorovatel vidí jen kruh
  const spectator = !me.alive;
  q('brInputBox').hidden = spectator;
  q('brPower').hidden = spectator;
  const row = q('wordInputRow');
  if (row) row.classList.toggle('waiting', !mine);
  q('brPassBtn').disabled = !(mine && me.pass);
  q('brRevBtn').disabled = !(mine && me.reverse);
  q('brPassBtn').classList.toggle('used', !me.pass);
  q('brRevBtn').classList.toggle('used', !me.reverse);

  if (spectator) {
    status.classList.remove('mine');
    if (!br.spectatorNote) {
      br.spectatorNote = true;
      const note = document.createElement('div');
      note.className = 'br-spectate';
      note.textContent = '👁 Pozoruješ hru';
      status.after(note);
    }
  }

  // začátek mého tahu: zvuk, vibrace, fokus
  const key = `${st.round}:${st.turn}:${st.phase}`;
  if (st.phase === 'turn' && key !== br.lastKey && st.turn === br.youAre && me.alive) {
    playGo(); vibrate(40);
    if (wordInput && document.activeElement !== wordInput) wordInput.focus();
  }
  br.lastKey = key;
  brTimers();
}

function brTimers() {
  if (!br || brScreen !== 'game') return;
  const st = br.st;
  const t = document.getElementById('brTimer');
  const bar = document.getElementById('brBar');
  if (!t) return;
  if (st.phase === 'turn') {
    const left = st.turnLeft;
    t.textContent = left > 5000 ? String(Math.ceil(left / 1000)) : (left / 1000).toFixed(1);
    t.className = 'br-timer' + (left < 5000 ? ' urgent' : '');
    if (bar) { bar.style.width = Math.max(0, Math.min(100, left / st.turnMs * 100)) + '%'; bar.classList.toggle('urgent', left < 5000); }
  } else {
    const sec = Math.max(1, Math.ceil(st.breakLeft / 1000));
    t.textContent = String(sec);
    t.className = 'br-timer count';
    if (bar) { bar.style.width = '0%'; bar.classList.remove('urgent'); }
  }
}

function brBanner(html, cls) {
  const el = document.getElementById('brBanner');
  if (!el) return;
  el.className = 'last-word ' + (cls || '');
  el.innerHTML = html;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

function brSeatFlash(seat, cls) {
  const el = document.getElementById('brSeat' + seat);
  if (el) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 900); }
}

function brHandleEvent(ev, prevPlayers) {
  if (!ev) return;
  const me = br.youAre;
  if (ev.type === 'word') {
    brBanner(`${brName(ev.seat)}: ${esc(ev.word)}`, ev.seat === me ? 'p0' : 'p1');
    const feed = document.getElementById('feed');
    if (feed) { const d = document.createElement('div'); d.className = ev.seat === me ? 'p0' : 'p1'; d.textContent = `${br.st.players[ev.seat].name}: ${ev.word}`; feed.prepend(d); }
    playSwoosh();
    if (ev.seat === me) { inputFeedback('ok'); vibrate(15); } else vibrate(25);
    if (ev.bonusHit) { brSeatFlash(ev.seat, 'bonus'); if (ev.seat === me) { const chip = document.getElementById('gameBonusChip'); if (chip) { chip.classList.remove('hit'); void chip.offsetWidth; chip.classList.add('hit'); } } playGo(); }
    if (ev.heart) { brSeatFlash(ev.seat, 'heal'); brBanner(`${BR_HEART} ${brName(ev.seat)} získal(a) bonusové srdce!`, 'br-gold'); }
  } else if (ev.type === 'timeout') {
    brSeatFlash(ev.seat, 'hit');
    playPenalty();
    if (ev.seat === me) { vibrate([60, 40, 120]); const c = document.querySelector('.card'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } }
    if (ev.eliminated) brBanner(`💀 ${brName(ev.seat)} vypadl(a)!`, 'p1');
    else if (ev.saved) brBanner(`${BR_HEART} Bonusové srdce zachránilo hráče ${brName(ev.seat)}`, 'br-gold');
    else brBanner(`💥 ${brName(ev.seat)} nestihl(a) odpovědět — ztrácí ❤`, 'p1');
  } else if (ev.type === 'pass') {
    brBanner(`⏭ ${brName(ev.seat)} přeskočil(a)`, 'br-info'); playClick();
  } else if (ev.type === 'reverse') {
    brBanner(`⇄ ${brName(ev.seat)} obrátil(a) směr`, 'br-info'); playClick();
  } else if (ev.type === 'left') {
    brBanner(`🚪 ${brName(ev.seat)} opustil(a) hru`, 'br-info');
  }
}

function closeBrOverlay() {
  const o = document.getElementById('brOverlay');
  if (o) o.remove();
}

function showBrEliminated(place) {
  closeBrOverlay();
  const o = document.createElement('div');
  o.id = 'brOverlay';
  o.className = 'br-overlay';
  o.innerHTML = `
    <div class="br-modal">
      <div class="br-modal-ic">💀</div>
      <h2>Vypadl(a) jsi</h2>
      <p>Skončil(a) jsi na <b>${place}. místě</b>.</p>
      <button id="brWatchBtn">👁 Pozorovat hru</button>
      <button class="secondary" id="brQuitBtn">Opustit hru</button>
    </div>`;
  document.body.appendChild(o);
  document.getElementById('brWatchBtn').onclick = () => { br.spectating = true; closeBrOverlay(); };
  document.getElementById('brQuitBtn').onclick = () => brLeaveToMenu();
}

function renderBrResult(d) {
  brScreen = 'result';
  closeBrOverlay();
  const meSeat = br.youAre;
  const iWon = d.winnerSeat === meSeat;
  if (iWon) playVictory(); else { playDefeat(); }
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const names = {};
  br.players.forEach(p => { names[p.seat] = p.name; });
  const rows = d.ranking.map(r => `
    <div class="br-rank${r.seat === meSeat ? ' me' : ''}">
      <span class="br-rank-pos">${medals[r.place] || r.place + '.'}</span>
      <span class="br-rank-name">${esc(r.name)}</span>
      <span class="br-rank-words">${r.words} slov</span>
    </div>`).join('');
  const hist = (d.history || []).map(h => `<div class="p${h.seat === meSeat ? 0 : 1}">${esc(names[h.seat] || '?')}: ${esc(h.word)}</div>`).join('') || '<div style="color:var(--muted)">Nepadlo žádné slovo.</div>';
  app.innerHTML = `
    <div class="card result">
      <h2 class="${iWon ? 'win' : 'lose'}">${iWon ? '👑 Vyhrál(a) jsi!' : 'Konec hry'}</h2>
      <div style="color:var(--muted); font-size:13px">${d.winnerSeat != null ? `Vítěz: <b style="color:var(--ink)">${esc(names[d.winnerSeat] || '?')}</b>` : ''}</div>
      <div class="br-ranking">${rows}</div>
      <div class="rules">
        <button type="button" class="rules-summary" data-panel="brhist"><span class="ic">▤</span><span>Historie slov (${(d.history || []).length})</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-brhist"><div class="rules-body feed word-history" style="max-height:220px">${hist}</div></div>
      </div>
      <div class="menu-list" style="margin-top:20px">
        <button class="menu-item" id="brAgainBtn"><span class="ic">🔎</span><span>Hrát znovu</span></button>
        <button class="secondary small" id="brMenuBtn" style="width:100%">Zpět do menu</button>
      </div>
    </div>`;
  bindRulesPanels();
  document.getElementById('brAgainBtn').onclick = () => {
    const n = loadNickname();
    br = null;
    socket.emit('br_find', { nickname: n });
    renderBrQueue(1);
  };
  document.getElementById('brMenuBtn').onclick = () => { br = null; renderMenu(); };
}

// ---- socket události ----
socket.on('br_queue', ({ count }) => {
  const el = document.getElementById('brQueueCount');
  if (el && brScreen === 'queue') el.textContent = count;
});

socket.on('br_lobby', (d) => {
  if (['joining', 'lobby'].includes(brScreen)) renderBrLobby(d);
});

socket.on('br_lobby_closed', ({ message }) => {
  if (['joining', 'lobby'].includes(brScreen)) renderBrMenu(message);
});

socket.on('br_error', ({ message }) => {
  if (['joining', 'queue', 'lobby'].includes(brScreen)) renderBrMenu(message);
});

socket.on('br_found', (d) => {
  clearInterval(menuTimer);
  br = { roomId: d.roomId, youAre: d.youAre, token: d.token, players: d.players, st: d.state, spectating: false, over: false, lastKey: null, shownPattern: null, spectatorNote: false };
  ensureAudioCtx();
  playGo();
  renderBrGame();
});

socket.on('br_state', (st) => {
  if (!br || br.over || st.roomId !== br.roomId) return;
  const prev = br.st;
  const ev = st.event;
  br.st = st;
  if (brScreen !== 'game') return;
  brRender();
  brHandleEvent(ev, prev && prev.players);
});

let brLastTickSec = null;
socket.on('br_tick', (t) => {
  if (!br || br.over || brScreen !== 'game') return;
  const st = br.st;
  st.phase = t.phase;
  if (t.phase === 'turn') {
    st.turn = t.turn; st.turnLeft = t.turnLeft; st.turnMs = t.turnMs || st.turnMs;
    if (st.turn === br.youAre && st.players[br.youAre].alive) {
      const half = Math.floor(t.turnLeft / 500);
      if (t.turnLeft <= 5000) { if (half !== br.lastHalf) { br.lastHalf = half; if (half > 0) playTickUrgent(); } }
      else { const sec = Math.ceil(t.turnLeft / 1000); if (sec !== br.lastSec) { br.lastSec = sec; playTick(); } }
    }
  } else {
    st.breakLeft = t.breakLeft;
    const sec = Math.ceil(t.breakLeft / 1000);
    if (sec !== br.lastBreakSec) { br.lastBreakSec = sec; if (sec > 0) playTick(); }
  }
  brTimers();
});

socket.on('br_rejected', ({ reason, penaltyMs }) => {
  if (!br || brScreen !== 'game') return;
  if (penaltyMs) {
    playPenalty(); vibrate([60, 40, 120]);
    const c = document.querySelector('.card'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
    brSeatFlash(br.youAre, 'hit');
    inputFeedback('bad', `<span class="penalty-note">${esc(reason)} (−${penaltyMs / 1000} s)</span>`);
  } else inputFeedback('bad', esc(reason));
});

socket.on('br_eliminated', ({ place }) => {
  if (!br || br.over) return;
  setTimeout(() => { if (br && !br.over && brScreen === 'game' && !br.spectating) showBrEliminated(place); }, 900);
});

socket.on('br_over', (d) => {
  if (!br || d.roomId !== br.roomId) return;
  br.over = true;
  hideReconnectOverlay();
  setTimeout(() => { if (br && br.over) renderBrResult(d); }, 1400);
  const ev = d.event;
  if (ev && ev.type === 'timeout') brBanner(ev.eliminated ? `💀 ${brName(ev.seat)} vypadl(a)!` : '', 'p1');
});

// ---- reconnect ----
socket.on('disconnect', () => {
  if (br && !br.over && brScreen === 'game') showReconnectOverlay();
});
socket.on('connect', () => {
  if (br && !br.over && br.roomId) socket.emit('br_rejoin', { roomId: br.roomId, seat: br.youAre, token: br.token });
});
socket.on('br_rejoined', (d) => {
  if (!br) return;
  hideReconnectOverlay();
  br.st = d.state; br.players = d.players;
  renderBrGame();
});
socket.on('br_rejoin_failed', () => {
  hideReconnectOverlay();
  if (!br) return;
  br = null;
  renderMenu('Spojení s Battle Royale se nepodařilo obnovit — hra mezitím skončila.');
});

// Barevné pozadí platí jen ve hře — na jiných obrazovkách se vypne.
setInterval(() => {
  if (brScreen !== 'game' && document.body.classList.contains('br-live')) {
    document.body.classList.remove('br-live', 'vk-themed');
    ['--vk-main', '--vk-fg', '--vk-bg', '--vk-rgb', '--vk-on', '--br-rgb'].forEach(k => document.body.style.removeProperty(k));
  }
}, 400);
