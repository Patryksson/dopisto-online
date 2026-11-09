// ==== Battle Royale (2–5 hráčů v kruhu) ====
// Samostatný soubor — používá globální pomocné funkce z app.js (app, socket, esc,
// zvuky, vlastní klávesnice, renderMenu, …). Serverová logika je v server/br.js.

window.brRenderReady = true;
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
    <div class="card mid" style="text-align:center">
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">${esc(text)}</p>
      <button class="secondary small" id="brCancelBtn" style="width:100%; margin-top:10px">Zrušit</button>
    </div>`;
  document.getElementById('brCancelBtn').onclick = () => { socket.emit('br_leave_lobby'); renderBrMenu(); };
}

function renderBrQueue(count) {
  brScreen = 'queue';
  app.innerHTML = `
    <div class="card mid" style="text-align:center">
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
    <div class="card mid" style="text-align:center">
      <p style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:0">Battle Royale · lobby</p>
      <div class="lobby-code" id="lobbyCodeNum">${esc(d.code)}</div>
      <div class="lobby-time">⏱ Čas na odpověď: <b>${d.turnSec || 15} s</b></div>
      <p style="color:var(--muted); font-size:11px">Pošli tento kód kamarádům, ať ho zadají v Hrát online → Royale → „Připojit“.</p>
      <div class="br-lobby-list">${rows}</div>
      ${d.isHost
        ? `<button id="brStartBtn" ${d.players.length < d.min ? 'disabled' : ''} style="width:100%; margin-top:12px">${d.players.length < d.min ? `Čekám na hráče (min. ${d.min})` : `Spustit hru (${d.players.length})`}</button>`
        : '<p style="color:var(--ink-soft); font-size:13px">Čekám, až hostitel spustí hru…</p>'}
      <div class="row" style="margin-top:10px">
        <button class="secondary small" id="brCopyBtn">Kód</button>
        <button class="secondary small" id="brLinkBtn">Odkaz</button>
        <button class="secondary small" id="brCancelBtn">Opustit</button>
      </div>
    </div>`;
  document.getElementById('brCancelBtn').onclick = () => { socket.emit('br_leave_lobby'); renderBrMenu(); };
  document.getElementById('brCopyBtn').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(d.code).catch(() => {}); };
  document.getElementById('brLinkBtn').onclick = (e) => shareInvite(e.currentTarget, d.code, true);
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

// Kruh hráčů se postaví jednou; pak se jen opravují změněné části (animace běží dál, nic nebliká).
function brRingHtml() {
  const st = br.st;
  const n = st.players.length;
  return st.players.map((p, i) => {
    const ang = (90 + ((i - br.youAre + n) % n) * (360 / n)) * Math.PI / 180;
    const x = 50 + 39 * Math.cos(ang);
    const y = 48 + 40 * Math.sin(ang);
    return `
      <div class="br-seat${i === br.youAre ? ' me' : ''}" id="brSeat${i}" style="left:${x.toFixed(1)}%; top:${y.toFixed(1)}%; --pc:${brColor(i).hex}; --pcrgb:${brColor(i).rgb}">
        <div class="br-name"></div>
        <div class="br-hearts"></div>
        <div class="br-meterwrap"></div>
      </div>`;
  }).join('');
}

function brRingSync() {
  const host = document.getElementById('brSeats');
  if (!host || !br) return;
  const st = br.st;
  const sig = st.players.length + ':' + br.youAre + ':' + st.players.map(p => p.color).join(',');
  if (host.dataset.sig !== sig) { host.innerHTML = brRingHtml(); host.dataset.sig = sig; }
  st.players.forEach((p, i) => {
    const el = document.getElementById('brSeat' + i);
    if (!el) return;
    const active = st.phase === 'turn' && st.turn === i;
    const upNext = st.phase !== 'turn' && st.nextTurn === i && p.alive;
    el.classList.toggle('active', active);
    el.classList.toggle('next', upNext);
    el.classList.toggle('dead', !p.alive);
    el.classList.toggle('offline', !p.connected && p.alive);
    const dcSec = !p.connected && p.alive && p.dcLeft ? Math.ceil(Math.max(0, p.dcLeft - (Date.now() - (br.stAt || Date.now()))) / 1000) : 0;
    const nm = (p.alive ? '' : '💀 ') + p.name + (!p.connected && p.alive ? ' ⚠' + (dcSec ? ' ' + dcSec : '') : '');
    const nameEl = el.children[0];
    if (nameEl.dataset.k !== nm) { nameEl.dataset.k = nm; nameEl.innerHTML = `<span class="br-dot"></span>${esc(nm)}`; }
    // srdce: přeříznu jen to, které se změnilo
    const hEl = el.children[1];
    const hk = p.alive ? `${p.lives}/${st.maxLives}` : `p${p.place}`;
    if (hEl.dataset.k !== hk) {
      const prev = hEl.dataset.k !== undefined && hEl.dataset.lives !== undefined ? Number(hEl.dataset.lives) : null;
      hEl.dataset.k = hk;
      hEl.dataset.lives = p.alive ? String(p.lives) : '';
      hEl.innerHTML = p.alive ? brHeartsHtml(p, st.maxLives) : `<span class="br-place">${p.place}. místo</span>`;
      if (p.alive && prev !== null && !isNaN(prev) && prev !== p.lives) {
        const kids = hEl.children;
        const lo = Math.min(prev, p.lives), hi = Math.max(prev, p.lives);
        for (let k = lo; k < hi && k < kids.length; k++) kids[k].classList.add(p.lives < prev ? 'lose' : 'gain');
      }
    }
    const mEl = el.children[2];
    const mk = p.alive ? `${p.meter}/${st.meterGoal}` : '';
    if (mEl.dataset.k !== mk) {
      const prevM = mEl.dataset.m !== undefined && mEl.dataset.m !== '' ? Number(mEl.dataset.m) : null;
      mEl.dataset.k = mk;
      mEl.dataset.m = p.alive ? String(p.meter) : '';
      mEl.innerHTML = p.alive ? brMeterHtml(p, st.meterGoal) : '';
      if (p.alive && prevM !== null && p.meter > prevM) { const pip = mEl.querySelectorAll('.br-pip')[p.meter - 1]; if (pip) pip.classList.add('fill'); }
    }
  });
  brSpotSync();
}

// Světelný kroužek, který plynule putuje k hráči, který je na tahu.
function brSpotSync() {
  const spot = document.getElementById('brSpot');
  if (!spot || !br) return;
  const st = br.st;
  const actor = st.phase === 'turn' ? st.turn : st.nextTurn;
  const seat = document.getElementById('brSeat' + actor);
  const alive = st.players[actor] && st.players[actor].alive;
  if (!seat || !alive) { spot.classList.remove('on'); return; }
  spot.style.left = seat.style.left;
  spot.style.top = seat.style.top;
  spot.classList.toggle('dim', st.phase !== 'turn');
  if (!spot.classList.contains('on')) {
    spot.classList.add('on');
    if (!spot.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => spot.classList.add('ready')));
  }
}

function renderBrGame() {
  brScreen = 'game';
  closeBrOverlay();
  br.spectatorNote = false;
  const st = br.st;
  const me = st.players[br.youAre];
  app.innerHTML = `
    <div class="card game-card br-card fit">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <div class="br-head">
        <span class="br-round" id="brRound"></span>
        <button id="brLeaveBtn" class="br-leave" type="button">✕ Opustit</button>
        <span class="br-dir" id="brDir"></span>
      </div>
      ${dailyBonusChipHtml(st.bonus, 'gameBonusChip').replace('· +3 s', '· metr ❤')}
      <div class="br-ring" id="brRing">
        <svg class="br-dir-svg" id="brDirSvg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="48" rx="39" ry="40"/></svg>
        <div class="br-spot" id="brSpot"></div>
        <div class="br-center">
          <div id="brPattern"></div>
          <div class="br-timer" id="brTimer"></div>
          <div class="br-yturn" id="brYTurn">🔔 Tvůj tah</div>
        </div>
        <div id="brSeats"></div>
      </div>
      <div class="turn-timer-wrap" id="brBarWrap">
        <div class="turn-timer-bar-bg"><div class="turn-timer-bar" id="brBar"></div></div>
      </div>
      <div class="turn-status" id="brStatus"></div>
      <div class="last-word" id="brBanner"></div>
      <div id="brInputBox">${wordInputHtml('')}</div>
      <div class="br-power" id="brPower">
        <button type="button" class="br-pw" id="brPassBtn"><b>⏭ Přeskočit</b><small>pošle řadu dál</small></button>
        <button type="button" class="br-pw" id="brRevBtn"><b>⇄ Obrátit směr</b><small>řada jde zpět</small></button>
      </div>
      <div class="used-count" id="brUsed"></div>
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
  const dsvg = q('brDirSvg');
  if (dsvg) dsvg.classList.toggle('ccw', st.dir === -1);
  brRingSync();

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
  const yt = q('brYTurn'); if (yt) yt.classList.toggle('show', mine);
  if (!mine && br.badgeOn) brTurnBadge(false);
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
    if (document.hidden) brTurnBadge(true);
    if (wordInput && document.activeElement !== wordInput) wordInput.focus();
  }
  br.lastKey = key;
  brSyncNewPattern();
  brTimers();
  brStartLoop();
}

// Velké okno s novým zadáním (po ztrátě života) / začátkem zápasu — s odpočtem.
function brReasonText(ev, st) {
  if (!ev || ev.type !== 'timeout') return '';
  const n = esc(st.players[ev.seat].name);
  if (ev.eliminated) return `💀 ${n} vypadl(a)!`;
  if (ev.saved) return `${BR_HEART} Bonusové srdce zachránilo hráče ${n}`;
  return `💥 ${n} nestihl(a) odpovědět — ztrácí ${BR_HEART}`;
}

function brSyncNewPattern() {
  if (!br || brScreen !== 'game') return;
  const st = br.st;
  let o = document.getElementById('brNew');
  const active = st.phase === 'break' || st.phase === 'reveal';
  if (!active) {
    if (o && !o.classList.contains('out')) { o.classList.add('out'); setTimeout(() => o.remove(), 230); }
    br.newKey = null;
    return;
  }
  const key = st.phase + ':' + st.pattern.type + st.pattern.value;
  const next = st.players[st.nextTurn];
  const nextHtml = next ? `${st.phase === 'reveal' ? 'Začíná' : 'Pokračuje'}: <b>${esc(next.name)}</b>` : '';
  if (o && br.newKey === key) return; // už zobrazeno
  br.newKey = key;
  if (o) o.remove();
  o = document.createElement('div');
  o.id = 'brNew';
  o.className = 'brn';
  o.innerHTML = `
    <div class="brn-box">
      <div class="brn-label">${st.phase === 'reveal' ? 'Začíná zápas' : 'Nové zadání'}</div>
      <div class="brn-reason">${st.phase === 'break' ? (br.breakReason || '') : 'Poslední přeživší vyhrává'}</div>
      <div class="brn-tiles">${patternTilesHtml(st.pattern, 'reveal')}</div>
      <div class="brn-instr">${esc(patternInstruction(st.pattern))}</div>
      <div class="brn-count" id="brnCount"></div>
      <div class="brn-next">${nextHtml}</div>
    </div>`;
  document.body.appendChild(o);
  br.brnSec = null;
  fxFlash(brColor(st.nextTurn).rgb);
  playSwoosh();
  brTimers();
}

// Čas mezi serverovými tiky (200 ms) si dopočítává klient — odpočet pak běží hladce.
function brSetBase(st) { br.tickAt = performance.now(); br.base = st.phase === 'turn' ? st.turnLeft : st.breakLeft; }
function brCur(st) {
  if (br.base == null) return st.phase === 'turn' ? st.turnLeft : st.breakLeft;
  return Math.max(0, br.base - (performance.now() - br.tickAt));
}
let brRaf = 0;
function brFrame() {
  brRaf = 0;
  if (!br || br.over || brScreen !== 'game') return;
  brTimers();
  brTickSound();
  brRaf = requestAnimationFrame(brFrame);
}
function brStartLoop() { if (!brRaf) brRaf = requestAnimationFrame(brFrame); }

// Tikání: do 5 s zrychluje a stoupá výškou. Já slyším silněji, ostatní jen posledních 3 s tiše.
const BR_TICK_TH = [5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250];
function brTickSound() {
  const st = br.st;
  if (st.phase !== 'turn') { br.tkKey = null; return; }
  const key = st.round + ':' + st.turn;
  if (br.tkKey !== key) { br.tkKey = key; br.tkIdx = 0; br.lastSec = null; }
  const left = brCur(st);
  const mine = st.turn === br.youAre && st.players[br.youAre].alive;
  if (left > 5000) {
    if (mine) { const sec = Math.ceil(left / 1000); if (sec !== br.lastSec) { br.lastSec = sec; playTick(); } }
    return;
  }
  const n = BR_TICK_TH.filter(x => left <= x).length;
  if (n > br.tkIdx) {
    br.tkIdx = n;
    if (mine) { playTickUrgent(1300 + n * 130); if (n >= 3) vibrate(12); }
    else if (n >= 3) playTick();
  }
}

// „Tvůj tah“ i když je aplikace v pozadí: titulek karty + odznak na ikoně (pokud ho prohlížeč podporuje).
const BR_BASE_TITLE = document.title;
function brTurnBadge(on) {
  if (br) br.badgeOn = on;
  try {
    document.title = on ? '🔔 Tvůj tah! · Dopišto' : BR_BASE_TITLE;
    if (on && navigator.setAppBadge) navigator.setAppBadge(1).catch(() => {});
    if (!on && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && br && br.badgeOn) brTurnBadge(false); });

function brTimers() {
  if (!br || brScreen !== 'game') return;
  const st = br.st;
  const cur = brCur(st);
  const cn = document.getElementById('brnCount');
  if (cn && st.phase !== 'turn') {
    const s2 = Math.max(1, Math.ceil(cur / 1000));
    if (br.brnSec !== s2) { br.brnSec = s2; cn.textContent = String(s2); cn.classList.remove('pulse'); void cn.offsetWidth; cn.classList.add('pulse'); }
  }
  fxDanger(st.phase === 'turn' && cur < 3000);
  const t = document.getElementById('brTimer');
  const bar = document.getElementById('brBar');
  if (!t) return;
  let txt, cls, scale, urgent = false;
  if (st.phase === 'turn') {
    txt = cur > 5000 ? String(Math.ceil(cur / 1000)) : (cur / 1000).toFixed(1);
    urgent = cur < 5000;
    cls = 'br-timer' + (urgent ? ' urgent' : '');
    scale = Math.max(0, Math.min(1, cur / st.turnMs));
  } else {
    txt = String(Math.max(1, Math.ceil(cur / 1000)));
    cls = 'br-timer count';
    scale = 0;
  }
  if (br.tTxt !== txt) { br.tTxt = txt; t.textContent = txt; }
  if (br.tCls !== cls) { br.tCls = cls; t.className = cls; }
  if (bar) {
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(' + scale + ')';
    if (br.tUrg !== urgent) { br.tUrg = urgent; bar.classList.toggle('urgent', urgent); }
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
    fxHeartBurst(document.getElementById('brSeat' + ev.seat), ev.eliminated);
    if (ev.eliminated) { fxShatter(document.getElementById('brSeat' + ev.seat), brColor(ev.seat).rgb); brSeatFlash(ev.seat, 'shatter'); }
    if (ev.seat === me) fxFlash('255,59,48');
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
  const n = document.getElementById('brNew');
  if (n) n.remove();
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
  const wcol = d.winnerSeat != null ? brColor(d.winnerSeat) : null;
  const total = d.ranking.length;
  const STEP = 450, T0 = 500;
  const winAt = T0 + Math.max(0, total - 1) * STEP;
  if (iWon) setTimeout(playVictory, winAt - 150); else playDefeat();
  if (wcol) {
    const pal = [wcol.hex, wcol.soft, '#ffffff', '#ffc93c', wcol.hex];
    setTimeout(() => fxConfetti(pal, 1), winAt);
    setTimeout(() => fxConfetti(pal, 0.6), winAt + 1400);
    setTimeout(() => fxConfetti(pal, 0.6), winAt + 2800);
  }
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const names = {};
  br.players.forEach(p => { names[p.seat] = p.name; });
  const rows = d.ranking.map(r => `
    <div class="br-rank rise${r.seat === meSeat ? ' me' : ''}${r.place === 1 ? ' gold' : ''}" style="animation-delay:${T0 + (total - r.place) * STEP}ms${r.place === 1 && wcol ? `; --wc:${wcol.rgb}` : ''}">
      <span class="br-rank-pos">${medals[r.place] || r.place + '.'}</span>
      <span class="br-rank-name">${esc(r.name)}</span>
      <span class="br-rank-words">${r.words} slov</span>
    </div>`).join('');
  const hist = (d.history || []).map(h => `<div class="p${h.seat === meSeat ? 0 : 1}">${esc(names[h.seat] || '?')}: ${esc(h.word)}</div>`).join('') || '<div style="color:var(--muted)">Nepadlo žádné slovo.</div>';
  app.innerHTML = `
    <div class="card result">
      <h2 class="${iWon ? 'win' : 'lose'} fin" style="animation-delay:${winAt}ms">${iWon ? '👑 Vyhrál(a) jsi!' : 'Konec hry'}</h2>
      <div style="color:var(--muted); font-size:13px">${d.winnerSeat != null ? `Vítěz: <b style="color:${wcol ? wcol.hex : 'var(--ink)'}">${esc(names[d.winnerSeat] || '?')}</b>` : ''}</div>
      <div class="br-ranking">${rows}</div>
      <div class="rules">
        <button type="button" class="rules-summary" data-panel="brhist"><span class="ic">▤</span><span>Historie slov (${(d.history || []).length})</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-brhist"><div class="rules-body feed word-history" style="max-height:220px">${hist}</div></div>
      </div>
      <div class="menu-list" style="margin-top:20px">
        <button class="menu-item" id="brRematchBtn"><span class="ic">🔁</span><span id="brRematchTxt">Odveta se stejnými hráči</span></button>
        <button class="secondary small" id="brAgainBtn" style="width:100%">Najít nové hráče</button>
        <button class="secondary small" id="brMenuBtn" style="width:100%">Zpět do menu</button>
      </div>
    </div>`;
  bindRulesPanels();
  br.rm = br.rm || { ready: [], total: 0, mine: false, note: '' };
  brRematchRender();
  document.getElementById('brRematchBtn').onclick = () => {
    if (!br) return;
    if (br.rm.mine) { br.rm.mine = false; br.rm.note = ''; socket.emit('br_rematch_cancel', { roomId: br.roomId }); }
    else { br.rm.mine = true; br.rm.note = ''; socket.emit('br_rematch', { roomId: br.roomId }); }
    brRematchRender();
  };
  document.getElementById('brAgainBtn').onclick = () => {
    const n = loadNickname();
    if (br) socket.emit('br_rematch_cancel', { roomId: br.roomId });
    br = null;
    socket.emit('br_find', { nickname: n });
    renderBrQueue(1);
  };
  document.getElementById('brMenuBtn').onclick = () => { if (br) socket.emit('br_rematch_cancel', { roomId: br.roomId }); br = null; renderMenu(); };
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

function brRematchRender() {
  const t = document.getElementById('brRematchTxt');
  const b = document.getElementById('brRematchBtn');
  if (!t || !b || !br || !br.rm) return;
  const { ready, total, mine, note } = br.rm;
  b.classList.toggle('active', !!mine);
  if (note) t.textContent = note;
  else if (mine) t.textContent = `Čekám na ostatní (${ready.length}/${Math.max(total, ready.length)}) · zrušit`;
  else if (ready.length) t.textContent = `Odveta: ${ready.length}/${total} chce hrát · přidat se`;
  else t.textContent = 'Odveta se stejnými hráči';
}
socket.on('br_rematch_state', (d) => {
  if (!br || d.roomId !== br.roomId) return;
  br.rm = br.rm || { ready: [], total: 0, mine: false, note: '' };
  if (!br.rm.mine && !br.rm.ready.length && d.ready.length) vibrate(20);
  br.rm.ready = d.ready; br.rm.total = d.total; br.rm.mine = d.mine; br.rm.note = '';
  brRematchRender();
});
socket.on('br_rematch_expired', (d) => {
  if (!br || d.roomId !== br.roomId) return;
  br.rm = { ready: [], total: 0, mine: false, note: 'Odveta nevyšla — ostatní odešli.' };
  brRematchRender();
  setTimeout(() => { if (br && br.rm && br.rm.note) { br.rm.note = ''; brRematchRender(); } }, 4000);
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
  if (ev && ev.type === 'timeout') br.breakReason = brReasonText(ev, st);
  br.st = st; br.stAt = Date.now();
  brLogPush(ev, st);
  if (prev && st.players.some((p, i) => i !== br.youAre && prev.players[i] && prev.players[i].connected && !p.connected && p.alive)) vibrate([30, 50, 30]);
  brSetBase(st);
  if (brScreen !== 'game') return;
  brRender();
  brHandleEvent(ev, prev && prev.players);
});

// Záznam událostí hry (zobrazuje ho panel vedle karty na počítači).
function brLogPush(ev, st) {
  if (!ev || !br) return;
  const n = (i) => (st.players[i] ? st.players[i].name : '?');
  let t = null;
  if (ev.type === 'word') t = `${n(ev.seat)}: ${ev.word}${ev.bonusHit ? ' ★' : ''}${ev.heart ? ' ' + BR_HEART : ''}`;
  else if (ev.type === 'timeout') t = ev.eliminated ? `💀 ${n(ev.seat)} vypadl(a)` : ev.saved ? `${BR_HEART} bonus zachránil: ${n(ev.seat)}` : `💥 ${n(ev.seat)} nestihl(a), −${BR_HEART}`;
  else if (ev.type === 'pass') t = `⏭ ${n(ev.seat)} přeskočil(a)`;
  else if (ev.type === 'reverse') t = `⇄ ${n(ev.seat)} obrátil(a) směr`;
  else if (ev.type === 'left') t = `🚪 ${n(ev.seat)} odešel(a)`;
  if (!t) return;
  (br.log = br.log || []).push({ r: st.round, seat: ev.seat, t });
  if (br.log.length > 60) br.log.shift();
}

let brLastTickSec = null;
socket.on('br_tick', (t) => {
  if (!br || br.over || brScreen !== 'game') return;
  const st = br.st;
  st.phase = t.phase;
  if (t.phase === 'turn') {
    st.turn = t.turn; st.turnLeft = t.turnLeft; st.turnMs = t.turnMs || st.turnMs;
  } else {
    st.breakLeft = t.breakLeft;
    const sec = Math.ceil(t.breakLeft / 1000);
    if (sec !== br.lastBreakSec) { br.lastBreakSec = sec; if (sec > 0) playTick(); }
  }
  brSetBase(st);
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
  closeBrOverlay();
  hideReconnectOverlay();
  fxDanger(false);
  if (d.winnerSeat != null) { const w = document.getElementById('brSeat' + d.winnerSeat); if (w && !w.querySelector('.br-crown')) { w.classList.add('winner'); w.insertAdjacentHTML('afterbegin', '<span class="br-crown">👑</span>'); } }
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
  br.st = d.state; br.stAt = Date.now(); br.players = d.players;
  renderBrGame();
});
socket.on('br_rejoin_failed', () => {
  hideReconnectOverlay();
  if (!br) return;
  br = null;
  renderMenu('Spojení s Battle Royale se nepodařilo obnovit — hra mezitím skončila.');
});

// Odpočet u odpojeného hráče (jednou za vteřinu)
setInterval(() => {
  if (br && !br.over && brScreen === 'game' && br.st && br.st.players.some(p => p.alive && !p.connected && p.dcLeft)) brRingSync();
}, 1000);

// Barevné pozadí platí jen ve hře — na jiných obrazovkách se vypne.
setInterval(() => {
  if (brScreen !== 'game' && document.body.classList.contains('br-live')) {
    document.body.classList.remove('br-live', 'vk-themed');
    if (br && br.badgeOn) brTurnBadge(false);
    const bn = document.getElementById('brNew'); if (bn) bn.remove();
    ['--vk-main', '--vk-fg', '--vk-bg', '--vk-rgb', '--vk-on', '--br-rgb'].forEach(k => document.body.style.removeProperty(k));
  }
}, 400);
