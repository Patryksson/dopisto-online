// ==== Týdenní výzva ====
// Jedno zadání na celý týden (po–ne, UTC). Bez časového limitu: otevřeš ji kdy chceš, slova se
// ti sčítají a server je drží. Tady je jen karta v menu a obrazovka s hrou (data jsou na serveru).

let weeklyState = null;
let weeklyTimer = null;

function pluralSlov(n) { return n === 1 ? 'slovo' : (n >= 2 && n <= 4 ? 'slova' : 'slov'); }

// Karta v menu: zadání týdne, odpočet a tvůj počet slov / pořadí.
function loadWeeklyCard(onEnd) {
  socket.emit('weekly_me', { nickname: loadNickname() }, (info) => {
    const pat = document.getElementById('wkPattern');
    const note = document.getElementById('wkNote');
    const btn = document.getElementById('weeklyBtn');
    if (!info || !pat || !note) return;
    pat.classList.remove('locked');
    pat.classList.toggle('has-sub', !!info.pattern.sub);
    pat.innerHTML = `<span class="big">${esc(info.pattern.short)}</span>${info.pattern.sub ? `<span class="sub">${esc(info.pattern.sub)}</span>` : ''}`;
    note.textContent = info.count
      ? `${info.count} ${pluralSlov(info.count)}${info.rank ? ` · ${info.rank}. místo` : ''}`
      : 'Bez časového limitu';
    if (btn) btn.firstElementChild.textContent = info.count ? 'Pokračovat' : 'Hrát';
    if (onEnd) onEnd(info.endsAt);
  });
}

function openWeekly(notice) {
  socket.emit('open_weekly', { nickname: loadNickname() }, (data) => {
    if (!data) return;
    if (data.nicknameRejected) {
      try { localStorage.removeItem('dopisto_nickname'); } catch {}
      renderMenu(data.message || 'Přezdívka není povolená.');
      return;
    }
    renderWeekly(data, notice);
  });
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">Načítám týdenní výzvu…</p>
    </div>`;
}

function weeklyStatsHtml() {
  const s = weeklyState;
  const gap = s.rank && s.rank > 1 ? s.leaderCount - s.count : 0;
  return `
    <div class="wk-stat"><b id="wkCount">${s.count}</b><span>${pluralSlov(s.count)}</span></div>
    <div class="wk-stat"><b id="wkRank">${s.rank ? s.rank + '.' : '–'}</b><span>${s.rank ? `z ${s.total} ${s.total === 1 ? 'hráče' : 'hráčů'}` : (s.count ? 'bez pořadí (host)' : 'najdi první slovo')}</span></div>
    <div class="wk-stat"><b id="wkGap">${s.rank === 1 ? '👑' : (s.rank ? '−' + gap : '–')}</b><span>${s.rank === 1 ? 'vedeš' : 'do 1. místa'}</span></div>`;
}

function renderWeekly(data, notice) {
  weeklyState = {
    weekId: data.weekId, endsAt: data.endsAt, pattern: data.pattern,
    words: data.words.slice().reverse(),        // nejnovější první
    count: data.count, rank: data.rank, total: data.total, leaderCount: data.leaderCount,
  };
  const prev = data.prev;
  app.innerHTML = `
    <div class="card fit weekly-screen">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <div class="wk-head">
        <button type="button" class="link-btn wk-back" id="weeklyMenuBtn">‹ Menu</button>
        <span class="wk-title">🏆 Týdenní výzva</span>
        <span class="wk-timer" id="wkClock"></span>
      </div>
      <div class="letter-tiles">${data.pattern.tiles.map(t => `<div class="letter-tile ${t.k}">${esc(t.t)}</div>`).join('')}</div>
      ${data.pattern.sub ? `<div class="wk-sub">${esc(data.pattern.sub)}</div>` : ''}
      <div class="used-count" id="wkInstr">${esc(data.pattern.hint)}</div>
      <div class="wk-stats" id="wkStats">${weeklyStatsHtml()}</div>
      ${wordInputHtml(data.pattern.placeholder)}
      <div class="wk-actions">
        <button type="button" class="link-btn" id="wkBoardBtn">Žebříček týdne</button>
        <button type="button" class="link-btn" id="wkShareBtn">Sdílet</button>
        ${prev ? `<span class="wk-prev" title="Minulý týden">Minule: ${esc(prev.name)} · ${prev.count}</span>` : ''}
      </div>
      <div class="feed wk-words" id="feed"></div>
    </div>`;
  fillWeeklyWords();
  if (notice) inputFeedback('bad', esc(notice));

  document.getElementById('soundBtn').onclick = toggleSound;
  document.getElementById('weeklyMenuBtn').onclick = () => { leaveWeekly(); renderMenu(); };
  document.getElementById('wkBoardBtn').onclick = showWeeklyBoard;
  document.getElementById('wkShareBtn').onclick = shareWeekly;

  const wordInput = document.getElementById('wordInput');
  document.getElementById('sendBtn').onclick = () => sendWeeklyWord();
  wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendWeeklyWord(); });
  bindWordInputExtras(wordInput);
  const prefill = soundPrefs.prefill === true ? (data.pattern.prefill || '') : '';
  wordInput.dataset.prefill = prefill;
  wordInput.value = prefill;
  wordInput.dispatchEvent(new Event('input', { bubbles: true }));
  if (!notice) wordInput.focus();

  const tick = () => {
    const el = document.getElementById('wkClock');
    if (!el) { leaveWeekly(); return; }
    const left = weeklyState.endsAt - Date.now();
    if (left <= 0) { openWeekly('Začal nový týden, máš nové zadání.'); return; }
    el.textContent = 'zbývá ' + fmtWeekLeft(left);
  };
  clearInterval(weeklyTimer);
  tick();
  weeklyTimer = setInterval(tick, 30000);

  let busy = false;
  function sendWeeklyWord() {
    const word = wordInput.value.trim();
    if (!word || busy) return;
    busy = true;
    wordInput.value = prefill;
    wordInput.dispatchEvent(new Event('input', { bubbles: true }));
    socket.emit('submit_weekly_word', { nickname: loadNickname(), weekId: weeklyState.weekId, word }, (res) => {
      busy = false;
      if (!weeklyState || !document.getElementById('wkStats')) return;
      if (!res) return;
      if (res.nicknameRejected) { leaveWeekly(); try { localStorage.removeItem('dopisto_nickname'); } catch {} renderMenu(res.message); return; }
      if (res.stale) { openWeekly('Začal nový týden, máš nové zadání.'); return; }
      if (!res.ok) {
        inputFeedback('bad', esc(res.reason || 'Slovo se nepodařilo přidat.'));
        vibrate([40, 30, 60]);
        return;
      }
      weeklyState.words.unshift(res.word);
      Object.assign(weeklyState, { count: res.count, rank: res.rank, total: res.total, leaderCount: res.leaderCount });
      document.getElementById('wkStats').innerHTML = weeklyStatsHtml();
      const c = document.getElementById('wkCount');
      if (c) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
      addWeeklyChip(res.word);
      playSwoosh();
      inputFeedback('ok'); vibrate(15);
    });
    wordInput.focus();
  }
}

function leaveWeekly() { clearInterval(weeklyTimer); weeklyTimer = null; weeklyState = null; }

function fillWeeklyWords() {
  const feed = document.getElementById('feed');
  if (!feed) return;
  feed.innerHTML = weeklyState.words.length
    ? weeklyState.words.map(w => `<span class="wk-chip">${esc(w)}</span>`).join('')
    : '<div class="wk-empty">Zatím žádná slova. Napiš první a každé další se ti za týden sčítá.</div>';
}
function addWeeklyChip(word) {
  const feed = document.getElementById('feed');
  if (!feed) return;
  const empty = feed.querySelector('.wk-empty'); if (empty) empty.remove();
  const chip = document.createElement('span');
  chip.className = 'wk-chip new';
  chip.textContent = word;
  feed.prepend(chip);
}

function showWeeklyBoard() {
  showInfoSheet('Týdenní žebříček', '<div id="wkBoardBody"><div style="color:var(--muted);font-size:13px">Načítám…</div></div>', () => {
    socket.emit('get_weekly_leaderboard', (res) => {
      const el = document.getElementById('wkBoardBody');
      if (!el || !res) return;
      if (!res.rows.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px">Zatím nikdo nehrál. Buď první!</div>'; return; }
      const me = (loadNickname() || '').trim().toLowerCase();
      el.innerHTML = `<div class="wk-board-sub">Týden končí za ${fmtWeekLeft(res.endsAt - Date.now())}. Hosté se do žebříčku nepočítají.</div>` +
        res.rows.map((r, i) => `<div class="dl-row${r.name.trim().toLowerCase() === me ? ' me' : ''}"><span class="dl-pos">${i + 1}.</span><span class="dl-name">${esc(r.name)}</span><span class="dl-score">${r.count}</span></div>`).join('');
    });
  });
}

function shareWeekly() {
  if (!weeklyState) return;
  const s = weeklyState;
  const text = `Dopišto · týdenní výzva (${s.pattern.label}): mám ${s.count} ${pluralSlov(s.count)}${s.rank ? `, jsem ${s.rank}.` : '.'} Dokážeš víc? ${location.origin}`;
  if (navigator.share) { navigator.share({ title: 'Dopišto — Týdenní výzva', text }).catch(() => {}); return; }
  const done = () => { const h = document.getElementById('gameErr'); if (h) { h.textContent = 'Text ke sdílení je zkopírovaný.'; setTimeout(() => { if (h) h.textContent = ''; }, 2500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
}
