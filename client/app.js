const socket = io();

// ==== Pomocné funkce pro zadání kola ====
function patternTilesHtml(pattern, extraClass) {
  const letters = pattern.value.toUpperCase().split('');
  const letterTiles = letters.map(ch => `<div class="letter-tile hl">${ch}</div>`).join('');
  const cls = `letter-tiles${extraClass ? ' ' + extraClass : ''}`;
  if (pattern.type === 'infix2') {
    return `<div class="${cls}"><div class="letter-tile dim">···</div>${letterTiles}<div class="letter-tile dim">···</div></div>`;
  }
  return `<div class="${cls}">${letterTiles}<div class="letter-tile dim">···</div></div>`;
}

function patternDisplayBlock(pattern, extraClass) {
  return patternTilesHtml(pattern, extraClass);
}

function patternInstruction(pattern) {
  if (pattern.type === 'infix2') return `Slovo musí obsahovat "${pattern.value}" (kdekoliv).`;
  return `Slovo musí začínat na "${pattern.value}".`;
}

function patternInputPlaceholder(pattern) {
  if (pattern.type === 'infix2') return `Napiš slovo obsahující '${pattern.value}'…`;
  return `Napiš slovo na '${pattern.value}'…`;
}

function currentInstructionText() { return patternInstruction(game.pattern); }
function currentPlaceholder() { return patternInputPlaceholder(game.pattern); }

function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

// ==== Přezdívka (bez účtů) ====
function loadNickname() {
  return localStorage.getItem('dopisto_nickname') || '';
}
function saveNickname(n) {
  localStorage.setItem('dopisto_nickname', n);
}

const MODE_LABEL = { speed: '1 písmeno', 2: '2 písmena', middle: 'Uprostřed' };
const MODE_ICON = { speed: '⚡', 2: 'Aa', middle: '·A·' };
const MODE_ORDER = ['speed', 2, 'middle'];
function isBigIcon(m) { return m === 'speed'; }

// Malý náhled zadání nad segmentovaným přepínačem, á la "[⚡P] [AA] [⚽] [·A·]".
function modePreviewText(m) {
  if (m === 2) return '[AA]';
  if (m === 'speed') return '[⚡P]';
  return '[·A·]';
}

function modeSegmentedHtml(selected) {
  return `
    <div class="mode-preview-row">
      ${MODE_ORDER.map(m => `<span data-mode="${m}" class="${selected === m ? 'active' : ''}">${modePreviewText(m)}</span>`).join('')}
    </div>
    <div class="mode-segmented" id="modeSegmented">
      <div class="seg-indicator" id="segIndicator"></div>
      ${MODE_ORDER.map(m => `<button class="seg-btn ${selected === m ? 'active' : ''}" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')}
    </div>
  `;
}

// Posune klouzavý indikátor na pozici aktivního tlačítka. Bez animace
// (animate=false) se použije jen při prvním vykreslení, ať pilulka
// nenajíždí odnikud, ale je hned na svém místě.
function positionModeIndicator(animate) {
  const wrap = document.getElementById('modeSegmented');
  const indicator = document.getElementById('segIndicator');
  const active = wrap && wrap.querySelector('.seg-btn.active');
  if (!wrap || !indicator || !active) return;
  if (!animate) indicator.style.transition = 'none';
  indicator.style.left = active.offsetLeft + 'px';
  indicator.style.width = active.offsetWidth + 'px';
  if (!animate) {
    void indicator.offsetWidth; // vynutí reflow před obnovením přechodu
    indicator.style.transition = '';
  }
}

// Místo prokliknutí (znovuvykreslení) celé stránky jen animuje indikátor
// a přepne třídy — žádný blik, žádné zbytečné znovusestavení DOM. Volitelný
// onModeChange callback dostane nový mód pro cokoliv, co reálně potřebuje
// data (např. znovunačtení žebříčku).
function bindModeSegmented(getMode, onModeChange) {
  positionModeIndicator(false);
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.mode;
      const newMode = (m === '2') ? Number(m) : m;
      if (newMode === getMode()) return;

      document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.mode-preview-row span').forEach(s => s.classList.toggle('active', s.dataset.mode === m));
      positionModeIndicator(true);

      if (onModeChange) onModeChange(newMode);
    };
  });
}


// ==== Zvuk (Web Audio API — žádné externí soubory) ====
let audioCtx = null;
// Nastavení zvuku po kategoriích + vibrace (uloženo v prohlížeči).
const SOUND_PREFS_INFO = {
  ticks:   { icon: '⏱️', label: 'Tikání hodin',  desc: 'Tikot hodin, zrychlí v posledních sekundách' },
  clicks:  { icon: '👆', label: 'Kliknutí',      desc: 'Zvuk při stisku tlačítek' },
  words:   { icon: '💬', label: 'Slova a tahy',  desc: 'Zvuk při odeslání slova a předání tahu' },
  penalty: { icon: '⚠️', label: 'Penalizace',    desc: 'Varovný zvuk při chybě a ztrátě času' },
  results: { icon: '🏆', label: 'Výhra / prohra', desc: 'Fanfára nebo smutný tón na konci hry' },
  vibrate: { icon: '📳', label: 'Vibrace',       desc: 'Jemné vibrace na mobilu (chyba, tvůj tah, konec)' },
};
let soundPrefs = { ticks: true, clicks: true, words: true, penalty: true, results: true, vibrate: true };
try { Object.assign(soundPrefs, JSON.parse(localStorage.getItem('dopisto_sound_prefs') || '{}')); } catch {}
function saveSoundPrefs() { try { localStorage.setItem('dopisto_sound_prefs', JSON.stringify(soundPrefs)); } catch {} }
function soundOn(cat) { return soundEnabled && soundPrefs[cat] !== false; }
function vibrate(pattern) {
  if (soundPrefs.vibrate === false || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}

let soundEnabled = localStorage.getItem('word_duel_sound') !== 'off';

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick() {
  if (!soundOn('ticks')) return;
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1200;
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

function playTickUrgent() {
  if (!soundOn('ticks')) return;
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1700;
  gain.gain.setValueAtTime(0.11, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.09);
}

function playPenalty() {
  if (!soundOn('penalty')) return;
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.35);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.35);
}

function playVictory() {
  if (!soundOn('results')) return;
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + i * 0.13;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

function playDefeat() {
  if (!soundOn('results')) return;
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  const notes = [392.0, 349.23, 293.66];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const start = now + i * 0.19;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.36);
  });
}

function playGo() {
  if (!soundOn('words')) return;
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  [880, 1174.66].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + i * 0.09;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  });
}

function playSwoosh() {
  if (!soundOn('words')) return;
  const ctx = ensureAudioCtx();
  const duration = 0.28;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const volumeMul = 0.9 + Math.random() * 0.2;
  const pitchMul = 0.88 + Math.random() * 0.24;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(3200 * pitchMul, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(220 * pitchMul, ctx.currentTime + duration);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  noiseGain.gain.exponentialRampToValueAtTime(0.38 * volumeMul, ctx.currentTime + 0.025);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  noise.start();
  noise.stop(ctx.currentTime + duration);

  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(260 * pitchMul, ctx.currentTime);
  thump.frequency.exponentialRampToValueAtTime(60 * pitchMul, ctx.currentTime + duration);
  thumpGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  thumpGain.gain.exponentialRampToValueAtTime(0.22 * volumeMul, ctx.currentTime + 0.02);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start();
  thump.stop(ctx.currentTime + duration);
}

// Klik má lehce proměnlivou výšku tónu (±5 %), ať nezní pokaždé identicky.
function playClick() {
  if (!soundOn('clicks')) return;
  const ctx = ensureAudioCtx();
  const pitchMul = 0.95 + Math.random() * 0.1;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 700 * pitchMul;
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.035);
}

// Ikona reproduktoru: s vlnami = zvuk zapnutý, přeškrtnutá = vypnutý.
function soundIconHtml() {
  const base = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>';
  const on = '<path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.7a9 9 0 0 1 0 12.6"/>';
  const off = '<path d="M17 9l5 6M22 9l-5 6"/>';
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${base}${soundEnabled ? on : off}</svg>`;
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('word_duel_sound', soundEnabled ? 'on' : 'off');
  const btn = document.getElementById('soundBtn');
  if (btn) { btn.innerHTML = soundIconHtml(); btn.title = soundEnabled ? 'Zvuk zapnutý' : 'Zvuk vypnutý'; }
}

// ==== Texty pravidel (normální psaní, ne jen tiskací — viz CSS override) ====
const HOW_IT_WORKS_HTML = `
  Zadej přezdívku, vyber herní režim a klikni na „Najít soupeře" – systém tě
  spáruje s někým dalším online. Pokud chceš hrát s kamarádem, můžeš si
  založit soukromou hru a pozvat ho pomocí kódu. Na začátku dostanete
  zadání, kterému musí každé napsané slovo odpovídat. Poté se střídáte
  v psaní platných slov, dokud jednomu z vás nevyprší čas.
`;

const RULES_HTML = `
  <ol style="margin:6px 0; padding-left:20px">
    <li><b>1 písmeno</b> — jen 1 písmeno na začátku — kromě 60 s hlavního
      času má každý hráč na každý jednotlivý tah jen 10 sekund — nestihneš-li
      odpovědět včas, prohráváš okamžitě, i kdyby ti ještě zbýval hlavní
      čas.</li>
    <li><b>2 písmena</b> — slovo musí začínat danou dvojicí (90 s na
      hráče).</li>
    <li><b>Uprostřed</b> — daná dvojice písmen se ve slově může nacházet
      kdekoliv — na začátku, uprostřed i na konci (90 s na hráče).</li>
  </ol>

  <p>Každý režim má vlastní, oddělený žebříček ELO.</p>

  <p><b>Čas:</b> hlavní čas ubíhá jako u šachových hodin — jen tomu, kdo je
  na tahu. Dojde-li hráči čas, prohrává.</p>

  <p><b>Bonus:</b> za každé správně odeslané slovo se ti k hlavnímu času
  přidá +3 s (v režimu 1 písmeno jen +1 s) — nejde ale přesáhnout startovní
  hodnotu.</p>

  <p><b>Tresty:</b></p>
  <ul style="margin:6px 0; padding-left:20px">
    <li>Slovo, které není ve slovníku → −1 s</li>
    <li>Slovo, které už bylo v tomto kole použito → −3 s</li>
    <li>V režimu Uprostřed: slovo, které neobsahuje dané dvojpísmí → −3 s</li>
  </ul>
  <p>Trest se odečítá z hlavního času hráče na tahu, přičemž tah mu
  zůstává.</p>

  <p><b>Vzdání kola:</b> hráč na tahu může kolo kdykoliv vzdát.</p>

  <p><b>ELO:</b> po kole se hodnocení obou hráčů přepočítá standardním ELO
  vzorcem (K=32).</p>
`;

// ==== Stav aplikace ====
const app = document.getElementById('app');
let selectedMode = 2;
function dailyBonusChipHtml(b, id) {
  if (!b) return '';
  return `<div class="daily-bonus-chip" ${id ? `id="${id}"` : ''} title="${b.desc}"><span class="dbc-ic">✦</span><span>Bonus dne: <b>${b.label}</b> · +3 s</span></div>`;
}
function showDailyBonusHit(clockId) {
  const clockEl = document.getElementById(clockId);
  const chip = document.getElementById('gameBonusChip');
  if (chip) { chip.classList.remove('hit'); void chip.offsetWidth; chip.classList.add('hit'); }
  if (clockEl) {
    const el = document.createElement('div');
    el.className = 'bonus-popup daily-hit';
    el.textContent = '✦ bonus dne';
    clockEl.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  playGo();
}

let game = null; // aktivní kolo (zrcadlo serverového stavu)

// ==== Menu ====
// Přezdívka: při prvním spuštění vstupní pole, potom jen řádek "Hraješ jako …".
function nicknameBlockHtml() {
  const n = loadNickname();
  if (!n) {
    return `
      <div class="nick-intro">Jak ti máme říkat?</div>
      <div class="nickname-box">
        <svg class="nickname-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"></path></svg>
        <input id="nickname" placeholder="Tvoje přezdívka" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="20" />
      </div>`;
  }
  return `<div class="player-line" id="playerLine">👤 Hraješ jako <b>${esc(n)}</b> <button type="button" class="link-btn" id="changeNickBtn">změnit</button></div>`;
}

// Aktuální přezdívka — z vstupního pole, pokud je zrovna vidět, jinak uložená.
function currentNick() {
  const input = document.getElementById('nickname');
  return (input ? input.value : loadNickname()).trim();
}

function bindNicknameBlock() {
  const btn = document.getElementById('changeNickBtn');
  if (!btn) return;
  btn.onclick = () => {
    const line = document.getElementById('playerLine');
    line.outerHTML = `
      <div class="nickname-box" id="nickEdit">
        <svg class="nickname-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"></path></svg>
        <input id="nickname" placeholder="Tvoje přezdívka" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="20" value="${esc(loadNickname())}" />
      </div>`;
    const input = document.getElementById('nickname');
    input.focus(); input.select();
  };
}

// Ověří přezdívku; vrátí ji, nebo zobrazí chybu a vrátí ''.
function requireNick() {
  const n = currentNick();
  const err = document.getElementById('err');
  if (!n) { if (err) err.textContent = 'Zadej přezdívku.'; return ''; }
  if (n.length < 2) { if (err) err.textContent = 'Přezdívka musí mít aspoň 2 znaky.'; return ''; }
  saveNickname(n);
  return n;
}

function msUntilUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
}
function fmtCountdown(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

let menuTimer = null;

function settingsHtml() {
  return Object.keys(SOUND_PREFS_INFO).map(k => {
    const i = SOUND_PREFS_INFO[k];
    return `
    <label class="setting-row">
      <span class="setting-ic">${i.icon}</span>
      <span class="setting-text"><b>${i.label}</b><small>${i.desc}</small></span>
      <input type="checkbox" class="switch" data-pref="${k}" ${soundPrefs[k] !== false ? 'checked' : ''} />
    </label>`;
  }).join('') + '<div class="setting-note">Všechny zvuky naráz vypne ikona reproduktoru vpravo nahoře.</div>';
}

function renderMenu(notice) {
  clearInterval(menuTimer);
  const saved = getSavedDailyResult();

  app.innerHTML = `
    <div class="page">
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <img class="logo" src="logo.png" alt="Dopišto" />
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>

      ${nicknameBlockHtml()}
      <div class="error" id="err">${notice || ''}</div>

      <div class="menu-list">
        <button class="menu-item" id="playBtn"><span class="ic">⚔</span><span>Hrát online</span></button>
      </div>

      <div class="daily-card">
        <div class="dc-head"><span class="dc-title">🔥 Denní výzva</span><span class="dc-timer" id="dcTimer"></span></div>
        <div class="dc-pattern" id="dcPattern">···</div>
        <div class="dc-bonus" id="dcBonus"></div>
        <div class="menu-list"><button class="menu-item" id="dailyBtn"><span>${saved ? `Zobrazit výsledek · ${saved.wordCount} slov` : 'Hrát výzvu'}</span></button></div>
        ${streakHtml()}
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="p1"><span class="ic">ⓘ</span><span>Jak to funguje</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-p1"><div class="rules-body">${HOW_IT_WORKS_HTML}</div></div>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="p2"><span class="ic">▤</span><span>Pravidla</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-p2"><div class="rules-body">${RULES_HTML}</div></div>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" id="leaderboardLinkBtn"><span class="ic">★</span><span>Žebříček</span><span class="chevron">›</span></button>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="p3"><span class="ic">🔊</span><span>Zvuky a vibrace</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-p3"><div class="rules-body" id="settingsBody">${settingsHtml()}</div></div>
      </div>
    </div>

    ${footerHtml()}
    <div class="version-tag">Dopišto · v1.0</div>
    </div>
  `;

  document.getElementById('soundBtn').onclick = toggleSound;
  bindNicknameBinding();
  bindRulesPanels();
  document.querySelectorAll('#settingsBody input[data-pref]').forEach(cb => {
    cb.onchange = () => {
      soundPrefs[cb.dataset.pref] = cb.checked;
      saveSoundPrefs();
      if (cb.checked) {
        ensureAudioCtx();
        ({ ticks: playTick, clicks: playClick, words: playSwoosh, penalty: playPenalty, results: playVictory }[cb.dataset.pref] || (() => {}))();
        if (cb.dataset.pref === 'vibrate') vibrate(40);
      }
    };
  });
  document.getElementById('leaderboardLinkBtn').onclick = () => renderLeaderboard(selectedMode);
  document.getElementById('playBtn').onclick = () => {
    if (!requireNick()) return;
    ensureAudioCtx();
    renderPlayMenu();
  };

  // Karta denní výzvy: dnešní zadání, bonus dne a odpočet do půlnoci (UTC).
  const tick = () => { const t = document.getElementById('dcTimer'); if (t) t.textContent = 'zbývá ' + fmtCountdown(msUntilUtcMidnight()); };
  tick();
  menuTimer = setInterval(tick, 30000);
  socket.emit('get_daily_info', (info) => {
    const pat = document.getElementById('dcPattern');
    const bon = document.getElementById('dcBonus');
    if (!info || !pat || !bon) return;
    pat.textContent = info.pattern.value.toUpperCase() + '···';
    bon.innerHTML = `<span class="dbc-ic">✦</span> Bonus dne: <b>${esc(info.bonus.label)}</b> · +3 s<div class="daily-bonus-desc">${esc(info.bonus.desc)}</div>`;
  });

  document.getElementById('dailyBtn').onclick = () => {
    if (!requireNick()) return;
    const err = document.getElementById('err');
    try {
      ensureAudioCtx();
      startDailyChallenge();
    } catch (e) {
      console.error(e);
      err.textContent = 'Denní výzvu se nepodařilo spustit: ' + (e && e.message ? e.message : e);
    }
  };
}

function bindNicknameBinding() { bindNicknameBlock(); }

// Rozbalovací panely pravidel (společné pro menu).
function bindRulesPanels() {
  document.querySelectorAll('.rules-summary[data-panel]').forEach(btn => {
    btn.onclick = () => {
      const panel = document.getElementById('panel-' + btn.dataset.panel);
      const isOpen = btn.classList.contains('open');
      if (isOpen) { panel.style.maxHeight = '0px'; btn.classList.remove('open'); }
      else { panel.style.maxHeight = panel.scrollHeight + 'px'; btn.classList.add('open'); }
    };
  });
}

// Druhá úroveň: výběr režimu, hledání soupeře, lobby.
function renderPlayMenu(notice) {
  clearInterval(menuTimer);
  app.innerHTML = `
    <div class="page">
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <button type="button" class="back-link" id="playBackBtn">‹ Zpět</button>
      <h1 class="play-title">Hrát online</h1>
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>

      <div class="mode-select">
        ${modeSegmentedHtml(selectedMode)}
      </div>
      <div class="error" id="err">${notice || ''}</div>

      <div class="or-sep"><span class="line"></span><span>hrát proti náhodnému hráči</span><span class="line"></span></div>

      <div class="menu-list">
        <button class="menu-item" id="findBtn"><span class="ic">🔎</span><span>Najít soupeře</span></button>
      </div>

      <div class="or-sep"><span class="line"></span><span>nebo hraj jen s kamarádem</span><span class="line"></span></div>

      <div class="menu-list">
        <button class="menu-item" id="createLobbyBtn"><span class="ic">＋</span><span>Vytvořit lobby</span></button>
      </div>
      <div class="lobby-row">
        <div class="code-boxes" id="joinCodeBoxes">
          ${[0, 1, 2, 3, 4].map(i => `<input class="code-box" data-idx="${i}" maxlength="1" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" />`).join('')}
        </div>
        <button id="joinLobbyBtn">Připojit</button>
      </div>
    </div>
    </div>
  `;

  document.getElementById('soundBtn').onclick = toggleSound;
  document.getElementById('playBackBtn').onclick = () => renderMenu();
  bindModeSegmented(() => selectedMode, (newMode) => { selectedMode = newMode; });

  document.getElementById('findBtn').onclick = () => {
    const n = requireNick(); if (!n) return;
    ensureAudioCtx();
    socket.emit('find_match', { nickname: n, mode: selectedMode });
    renderSearching(n);
  };

  document.getElementById('createLobbyBtn').onclick = () => {
    const n = requireNick(); if (!n) return;
    ensureAudioCtx();
    socket.emit('create_lobby', { nickname: n, mode: selectedMode });
    renderLobbyWaiting();
  };

  document.getElementById('joinLobbyBtn').onclick = () => {
    const err = document.getElementById('err');
    const n = requireNick(); if (!n) return;
    const code = getJoinCode();
    if (code.length < 5) { err.textContent = 'Zadej celý kód lobby.'; return; }
    ensureAudioCtx();
    socket.emit('join_lobby', { nickname: n, code });
    renderJoining();
  };

  setupCodeBoxes();
}


// ==== Informační stránky (patička menu) ====
const SITE = window.SITE || {};
const TODO = (txt) => `<span class="todo">${txt}</span>`;
const siteOperator = () => esc(SITE.operator) || TODO('[doplň provozovatele v client/site-config.js]');
const siteEmail = () => SITE.email
  ? `<a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>`
  : TODO('[doplň e-mail v client/site-config.js]');

function footerHtml() {
  const socials = [['facebook', 'FB', 'Facebook'], ['instagram', 'IG', 'Instagram'], ['discord', 'DC', 'Discord']]
    .filter(([k]) => /^https?:\/\//.test(SITE[k] || ''))
    .map(([k, ab, label]) => `<a href="${esc(SITE[k])}" target="_blank" rel="noopener noreferrer" class="social-link" aria-label="${label}">${ab}</a>`)
    .join('');
  return `
    ${socials ? `<div class="social-links">${socials}</div>` : ''}
    <footer class="site-footer">
      <a href="#faq">Časté dotazy</a>
      <a href="#podminky">Obchodní podmínky</a>
      <a href="#ochrana-udaju">Ochrana údajů</a>
      <a href="#kontakt">Kontakt</a>
      <a href="#nahlasit">Nahlásit chybu</a>
      <a href="#cookies">Nastavení cookies</a>
    </footer>`;
}

const FAQ_ITEMS = [
  ['Jak se hra hraje?', 'Na začátku dostanete zadání (např. slovo musí začínat na „TA“). Hráči se střídají a píší platná česká slova podle zadání. Každý má šachové hodiny — čas běží jen tomu, kdo je na tahu. Komu dojde čas, prohrává.'],
  ['Musím se registrovat?', 'Ne. Stačí zadat přezdívku. Přezdívka se ukládá jen ve tvém prohlížeči.'],
  ['Proč mi nebylo uznáno slovo?', 'Hra používá slovník základních tvarů — jednotné číslo, 1. pád (u sloves infinitiv). Skloňované a časované tvary, vlastní jména a zkratky neplatí. Pokud ti chybí běžné slovo, pošli ho přes „Nahlásit chybu“.'],
  ['Co jsou režimy 1 písmeno, 2 písmena a Uprostřed?', '„1 písmeno“: slovo musí začínat daným písmenem a máš jen 10 s na tah. „2 písmena“: slovo začíná danou dvojicí. „Uprostřed“: dvojice se může objevit kdekoliv ve slově. Každý režim má vlastní žebříček ELO.'],
  ['Co jsou penalizace a bonusy za slovo?', 'Slovo mimo slovník: −1 s, už použité slovo: −3 s, špatné zadání: −3 s. Za každé správné slovo dostaneš bonus k času (+3 s, v režimu 1 písmeno +1 s), ale ne nad startovní čas.'],
  ['Co je bonus dne?', 'Každý den je jeden bonus (např. slovo s 8+ písmeny nebo dvěma stejnými samohláskami). Když ho splníš, dostaneš navíc +3 s — a ten smí přesáhnout startovní čas. Bonus dne je pro všechny stejný a ukazuje se v kartě Denní výzva.'],
  ['Jak funguje Denní výzva?', 'Je to sólová hra na 180 s. Zadání je pro celý svět stejné a mění se o půlnoci (UTC). Můžeš ji hrát jen jednou za den. Série ukazuje, kolik dní po sobě jsi ji odehrál(a), a výsledek můžeš sdílet jako obrázek.'],
  ['Co je ELO?', 'Číslo, které odhaduje tvou sílu. Začínáš na 1000. Vyhra nad silnějším soupeřem ti přidá víc bodů než výhra nad slabším. Každý režim má vlastní ELO a žebříček.'],
  ['Jak hrát s kamarádem?', 'V „Hrát online“ klikni na „Vytvořit lobby“, pošli kamarádovi pětimístný kód a on ho zadá do políček a stiskne „Připojit“.'],
  ['Co je odveta?', 'Po zápase můžeš soupeři poslat návrh na odvetu. Ten ji musí přijmout do několika sekund. Pokud hráč odešel do menu nebo zavřel stránku, odveta už není možná.'],
  ['Spojení se mi přerušilo. Prohrál(a) jsem?', 'Ne hned. Máš 15 sekund na znovupřipojení do rozehrané hry. Poté soupeř vyhrává.'],
  ['Jak smažu svá data?', 'Otevři „Nastavení cookies“ a klikni na „Smazat data z tohoto zařízení“. ELO a žebříček jsou ale uložené na serveru podle přezdívky — o jejich smazání napiš přes „Kontakt“.'],
];

function infoPageContent(key) {
  switch (key) {
    case 'faq':
      return { title: 'Časté dotazy', body: FAQ_ITEMS.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('') };
    case 'kontakt':
      return { title: 'Kontakt', body: `
        <p>Máš dotaz, nápad nebo problém? Ozvi se nám.</p>
        <h2>Provozovatel</h2><p>${siteOperator()}${SITE.address ? '<br>' + esc(SITE.address) : ''}</p>
        <h2>E-mail</h2><p>${siteEmail()}</p>
        <h2>Chyby a nápady</h2><p>Nejrychlejší je <a href="#nahlasit">formulář pro nahlášení chyby</a>.</p>` };
    case 'podminky':
      return { title: 'Obchodní podmínky', body: `
        <p>Tyto podmínky upravují používání webové hry ${esc(SITE.name || 'Dopišto')} (dále „hra“). Provozovatel: ${siteOperator()}.</p>
        <h2>1. Používání hry</h2>
        <p>Hra je poskytována zdarma, bez registrace. Používáním hry souhlasíš s těmito podmínkami. Hra je určena pro zábavu a nezaručuje nepřetržitou dostupnost.</p>
        <h2>2. Pravidla chování</h2>
        <ul><li>Nepoužívej urážlivé, vulgární nebo klamavé přezdívky.</li>
        <li>Nepokoušej se narušit chod hry (automatizované požadavky, zneužití chyb, obcházení omezení).</li>
        <li>Nevydávej se za jiného hráče.</li></ul>
        <p>Provozovatel může přezdívku odmítnout či odstranit z žebříčku a omezit přístup při porušení pravidel.</p>
        <h2>3. Žebříček a výsledky</h2>
        <p>ELO a výsledky jsou orientační a mohou být upraveny či resetovány (např. při chybě nebo při změně pravidel).</p>
        <h2>4. Odpovědnost</h2>
        <p>Hra je poskytována „tak, jak je“. Provozovatel neodpovídá za škody způsobené výpadkem nebo chybou hry v rozsahu, v jakém to dovoluje zákon.</p>
        <h2>5. Změny podmínek</h2>
        <p>Podmínky se mohou měnit. Aktuální znění je vždy na této stránce.</p>
        <p style="color:var(--muted);font-size:12px">Poslední úprava: říjen 2026. Tento text je obecná šablona — před veřejným spuštěním ho nech zkontrolovat.</p>` };
    case 'ochrana-udaju':
      return { title: 'Ochrana údajů', body: `
        <p>Správcem osobních údajů je ${siteOperator()}. Kontakt: ${siteEmail()}.</p>
        <h2>Jaké údaje zpracováváme</h2>
        <ul>
          <li><b>Přezdívka</b> — zadáváš ji sám/sama. Zobrazuje se soupeři a v žebříčku.</li>
          <li><b>Výsledky her</b> — ELO, počet výher a proher, výsledky Denní výzvy (nejlepší výsledek dne podle přezdívky, uchovává se několik dní).</li>
          <li><b>IP adresa</b> — používá se pouze dočasně v paměti serveru k ochraně proti zneužití (omezení počtu spojení). Neukládá se do databáze.</li>
          <li><b>Hlášení chyb</b> — text, který sám odešleš přes formulář, a volitelný kontakt.</li>
        </ul>
        <h2>Co ukládáme ve tvém prohlížeči</h2>
        <p>Přezdívku, nastavení zvuku, sérii Denní výzvy a dnešní výsledek. Hra nepoužívá sledovací cookies ani analytiku třetích stran.</p>
        <h2>Účel a doba uložení</h2>
        <p>Údaje slouží k provozu hry (hledání soupeřů, žebříček). Přezdívka a ELO se uchovávají, dokud hra běží nebo dokud nepožádáš o smazání.</p>
        <h2>Tvá práva</h2>
        <p>Můžeš požádat o přístup k údajům, jejich opravu nebo smazání a podat stížnost u Úřadu pro ochranu osobních údajů (uoou.cz). Napiš na ${siteEmail()}.</p>
        <p style="color:var(--muted);font-size:12px">Poslední úprava: říjen 2026. Tento text je obecná šablona — před veřejným spuštěním ho nech zkontrolovat.</p>` };
    case 'cookies':
      return { title: 'Nastavení cookies', body: `
        <p>Hra nepoužívá cookies pro sledování ani reklamu. K fungování používá pouze <b>úložiště v prohlížeči</b> (localStorage):</p>
        <ul><li>přezdívka,</li><li>nastavení zvuku a vibrací,</li><li>série a dnešní výsledek Denní výzvy.</li></ul>
        <p>Toto úložiště je nezbytné pro fungování hry, proto se k němu neptáme na souhlas.</p>
        <div class="menu-list" style="margin-top:16px"><button class="secondary small" id="clearDataBtn" style="width:100%">Smazat data z tohoto zařízení</button></div>
        <div class="info-ok" id="clearDataMsg"></div>` };
    case 'nahlasit':
      return { title: 'Nahlásit chybu', body: `
        <p>Něco nefunguje, chybí ti slovo ve slovníku nebo chceš nahlásit hráče? Napiš nám.</p>
        <div class="info-form">
          <label for="repType">O co jde</label>
          <select id="repType">
            <option value="bug">Chyba ve hře</option>
            <option value="word">Chybí / je špatně slovo ve slovníku</option>
            <option value="player">Nahlásit hráče</option>
            <option value="idea">Nápad na vylepšení</option>
          </select>
          <label for="repText">Popis</label>
          <textarea id="repText" maxlength="1000" placeholder="Popiš, co se stalo, nebo napiš slovo / přezdívku hráče…"></textarea>
          <label for="repContact">Kontakt (nepovinné)</label>
          <input id="repContact" maxlength="80" placeholder="E-mail, pokud chceš odpověď" />
          <div class="menu-list" style="margin-top:16px"><button class="menu-item" id="repSend"><span>Odeslat</span></button></div>
          <div class="error" id="repErr"></div>
          <div class="info-ok" id="repOk"></div>
        </div>` };
    default:
      return null;
  }
}

function renderInfoPage(key) {
  const page = infoPageContent(key);
  if (!page) { renderMenu(); return; }
  clearInterval(menuTimer);
  app.innerHTML = `
    <div class="page">
    <div class="card info-card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <button type="button" class="back-link" id="infoBackBtn">‹ Zpět</button>
      <h1>${page.title}</h1>
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>
      <div class="info-body">${page.body}</div>
    </div>
    </div>`;
  document.getElementById('soundBtn').onclick = toggleSound;
  document.getElementById('infoBackBtn').onclick = () => { location.hash = ''; renderMenu(); };
  window.scrollTo(0, 0);

  if (key === 'cookies') {
    document.getElementById('clearDataBtn').onclick = () => {
      if (!confirm('Smazat přezdívku, nastavení a uložené výsledky z tohoto zařízení?')) return;
      try { localStorage.clear(); } catch {}
      document.getElementById('clearDataMsg').textContent = 'Hotovo — data z tohoto zařízení byla smazána.';
    };
  }
  if (key === 'nahlasit') {
    document.getElementById('repSend').onclick = () => {
      const text = document.getElementById('repText').value.trim();
      const err = document.getElementById('repErr');
      const ok = document.getElementById('repOk');
      err.textContent = ''; ok.textContent = '';
      if (text.length < 5) { err.textContent = 'Napiš prosím aspoň pár slov.'; return; }
      socket.emit('submit_report', {
        type: document.getElementById('repType').value,
        text,
        contact: document.getElementById('repContact').value.trim(),
        nickname: loadNickname(),
      }, (res) => {
        if (res && res.ok) { ok.textContent = 'Díky! Hlášení bylo odesláno.'; document.getElementById('repText').value = ''; }
        else err.textContent = (res && res.message) || 'Odeslání se nepovedlo, zkus to později.';
      });
    };
  }
}

// Stránky jsou adresovatelné přes #hash (sdílitelné odkazy, tlačítko zpět).
const INFO_KEYS = ['faq', 'kontakt', 'podminky', 'ochrana-udaju', 'cookies', 'nahlasit'];
function routeFromHash() {
  const key = location.hash.replace('#', '');
  if (INFO_KEYS.includes(key) && !game && !dailyState) renderInfoPage(key);
  else if (!key && document.querySelector('.info-card')) renderMenu();
}
window.addEventListener('hashchange', routeFromHash);

// Pět samostatných políček pro kód lobby — auto-přeskakování na další/
// předchozí políčko při psaní/mazání, vkládání (paste) rozdělí celý kód.
function getJoinCode() {
  return Array.from(document.querySelectorAll('.code-box')).map(b => b.value.trim()).join('');
}

function setupCodeBoxes() {
  const boxes = Array.from(document.querySelectorAll('.code-box'));
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.toUpperCase().slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
      }
      if (e.key === 'Enter') {
        document.getElementById('joinLobbyBtn').click();
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
      for (let j = 0; j < boxes.length; j++) boxes[j].value = text[j] || '';
      const last = boxes[Math.min(text.length, boxes.length) - 1];
      if (last) last.focus();
    });
  });
}

// ==== Žebříček — samostatná stránka ====
function renderLeaderboard(mode) {
  app.innerHTML = `
    <div class="card">
      <h1 style="font-size:20px; letter-spacing:4px">★ Žebříček</h1>
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>

      <div class="mode-select">
        ${modeSegmentedHtml(mode)}
      </div>

      <div id="leaderboardBody" style="min-height:60px">Načítám…</div>

      <div class="menu-list" style="margin-top:18px">
        <button class="secondary small" id="backToMenuBtn" style="width:100%">Zpět do menu</button>
      </div>
    </div>
  `;

  let currentLbMode = mode;
  bindModeSegmented(() => currentLbMode, (newMode) => {
    currentLbMode = newMode;
    selectedMode = newMode;
    loadLeaderboardBody(newMode);
  });
  document.getElementById('backToMenuBtn').onclick = () => renderMenu();

  loadLeaderboardBody(mode);
}

// Jen přenačte a jemně prolne obsah žebříčku — zbytek stránky (mode
// přepínač, tlačítka) zůstává na místě, žádné blikání celé karty.
function loadLeaderboardBody(mode) {
  const body = document.getElementById('leaderboardBody');
  if (body) body.style.opacity = '0.3';

  socket.emit('get_leaderboard', { mode }, (list) => {
    const body = document.getElementById('leaderboardBody');
    if (!body) return; // uživatel mezitím přešel jinam
    body.innerHTML = list && list.length ? `
      <table style="width:100%; border-collapse:collapse; margin-top:6px">
        <thead><tr><th style="text-align:left">#</th><th style="text-align:left">Hráč</th><th style="text-align:left">ELO</th><th style="text-align:left">V/P</th></tr></thead>
        <tbody>
          ${list.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.elo}</td><td>${p.wins}/${p.losses}</td></tr>`).join('')}
        </tbody>
      </table>` : '<div style="color:var(--muted); text-align:center; padding:20px 0">Zatím nikdo v tomto režimu nehrál (max. 100 nejlepších).</div>';
    body.style.opacity = '1';
  });
}

// ==== Denní výzva — sólo, bez soupeře ====
// "Dnešní datum" pro kontrolu "už jsi dnes hrál" je lokální datum hráče
// (jednoduché a předvídatelné pro uživatele); samotné zadání dne počítá
// server podle UTC, takže je pro všechny na světě stejné — u půlnoci může
// dojít k drobnému nesouladu mezi "tvým dnem" a "serverovým dnem", což je
// u denních výzev běžný a neškodný detail.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dailyStorageKey() { return `dopisto_daily_${todayKey()}`; }

function getSavedDailyResult() {
  try {
    const raw = localStorage.getItem(dailyStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveDailyResult(data) {
  try { localStorage.setItem(dailyStorageKey(), JSON.stringify(data)); } catch {}
  updateStreak();
}

// Série dní po sobě, kdy byla denní výzva odehrána (lokální datum).
function dateKeyOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function readStreak() {
  try {
    const s = JSON.parse(localStorage.getItem('dopisto_streak') || 'null');
    if (!s) return { count: 0, best: 0, last: null };
    return s;
  } catch { return { count: 0, best: 0, last: null }; }
}
function updateStreak() {
  const s = readStreak();
  const today = todayKey();
  if (s.last === today) return s;
  s.count = s.last === dateKeyOffset(-1) ? s.count + 1 : 1;
  s.best = Math.max(s.best || 0, s.count);
  s.last = today;
  try { localStorage.setItem('dopisto_streak', JSON.stringify(s)); } catch {}
  return s;
}
// Aktuální série pro zobrazení — po vynechaném dni už neplatí.
function currentStreak() {
  const s = readStreak();
  if (s.last === todayKey() || s.last === dateKeyOffset(-1)) return s.count;
  return 0;
}
function streakHtml() {
  const n = currentStreak();
  if (!n) return '';
  const best = readStreak().best || n;
  return `<div class="streak-chip">🔥 Série: <b>${n}</b> ${n === 1 ? 'den' : (n < 5 ? 'dny' : 'dní')} v řadě${best > n ? ` · rekord ${best}` : ''}</div>`;
}

function loadDailyLeaderboard(elId) {
  socket.emit('get_daily_leaderboard', (rows) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = '<div style="color:var(--muted); font-size:13px">Zatím nikdo nehrál.</div>'; return; }
    const me = (loadNickname() || '').trim().toLowerCase();
    el.innerHTML = rows.map((r, i) => {
      const safe = String(r.name).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      return `<div class="dl-row${r.name.trim().toLowerCase() === me ? ' me' : ''}"><span class="dl-pos">${i + 1}.</span><span class="dl-name">${safe}</span><span class="dl-score">${r.count}</span></div>`;
    }).join('');
  });
}

let dailyState = null;

function startDailyChallenge() {
  const saved = getSavedDailyResult();
  if (saved) {
    renderDailyResult(saved, true);
    return;
  }
  socket.emit('start_daily_challenge', { nickname: loadNickname() });
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">Připravuji dnešní výzvu…</p>
    </div>
  `;
}

function renderDailyReveal(data) {
  dailyState = {
    pattern: data.pattern,
    dailyBonus: data.dailyBonus || null,
    myName: loadNickname(),
    timeLeft: data.timeLeft,
    usedWordsCount: 0,
    lastWholeSecond: 999,
    lastHalfStep: 999,
  };

  app.innerHTML = `
    <div class="card">
      <div class="countdown-label">🔥 Denní výzva</div>
      ${patternTilesHtml(data.pattern, 'reveal')}
      ${dailyBonusChipHtml(data.dailyBonus)}
      <div class="countdown-num" id="countNum">3</div>
    </div>
  `;
  ensureAudioCtx();
  playGo();

  let n = 3;
  const numEl = document.getElementById('countNum');
  function pulse(text) {
    if (!numEl) return;
    numEl.textContent = text;
    numEl.classList.remove('pulse');
    void numEl.offsetWidth;
    numEl.classList.add('pulse');
  }
  function step() {
    if (n > 0) {
      pulse(String(n));
      playTick();
      n--;
      setTimeout(step, 800);
    } else {
      pulse('START!');
      playGo();
      setTimeout(() => renderDailyGame(), 550);
    }
  }
  setTimeout(step, 550);
}

function renderDailyGame() {
  app.innerHTML = `
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      ${patternTilesHtml(dailyState.pattern)}
      ${dailyBonusChipHtml(dailyState.dailyBonus, 'gameBonusChip')}
      <div class="used-count" id="usedCount">${patternInstruction(dailyState.pattern)} · Slov: 0</div>
      <div class="clocks">
        <div class="clock active" id="clockMe"><div class="name">${esc(dailyState.myName)}</div><div class="time">${fmtTime(dailyState.timeLeft)}</div></div>
      </div>
      <div class="last-word" id="lastWordBanner"></div>
      ${wordInputHtml(patternInputPlaceholder(dailyState.pattern))}
      <button id="endDailyBtn" class="link-btn giveup-link" style="display:block;margin:12px auto 0">Ukončit pokus</button>
      <div class="feed" id="feed"></div>
    </div>
  `;
  document.getElementById('soundBtn').onclick = toggleSound;
  document.getElementById('endDailyBtn').onclick = () => {
    if (confirm('Opravdu ukončit pokus? Denní výzvu lze hrát jen jednou za den a výsledek se uloží.')) {
      socket.emit('end_daily_challenge');
    }
  };

  const wordInput = document.getElementById('wordInput');
  document.getElementById('sendBtn').onclick = () => sendDailyWord();
  wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDailyWord(); });
  bindWordInputExtras(wordInput);
  wordInput.addEventListener('focus', () => {
    setTimeout(() => {
      const banner = document.getElementById('lastWordBanner');
      (banner || wordInput).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 300);
  });
  wordInput.focus();

  function sendDailyWord() {
    const word = wordInput.value.trim();
    if (!word) return;
    wordInput.value = '';
    socket.emit('submit_daily_word', { word });
    wordInput.focus();
  }
}

function updateDailyClockUI() {
  const el = document.getElementById('clockMe');
  if (!el) return;
  el.classList.toggle('low', dailyState.timeLeft < 15000);
  const t = el.querySelector('.time');
  if (t) t.textContent = fmtTime(dailyState.timeLeft);
}

function renderDailyResult(data, fromCache) {
  const historyHtml = data.words.length ? data.words.map(w => `<div class="p0">${w}</div>`).join('')
    : '<div style="color:var(--muted)">Ani jedno slovo se dnes nepovedlo — zkus to zítra znovu!</div>';

  app.innerHTML = `
    <div class="card result">
      <h2 class="win">🔥 Denní výzva hotová!</h2>
      <div style="color:var(--muted); font-size:13px">
        Zadání: <b style="color:var(--accent)">${data.pattern.value.toUpperCase()}···</b>
        ${fromCache ? ' · dnes už jsi hrál(a)' : ''}
      </div>
      <div style="font-family:'Archivo Black','Space Grotesk',sans-serif; font-size:64px; color:var(--accent); margin:14px 0 0; line-height:1;">${data.wordCount}</div>
      <div style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:16px">SLOV ZA 180 SEKUND</div>

      ${streakHtml()}
      <div class="rules">
        <button type="button" class="rules-summary" data-panel="dailylb"><span class="ic">★</span><span>Žebříček dne</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-dailylb"><div class="rules-body" id="dailyLbBody"><div style="color:var(--muted); font-size:13px">Načítám…</div></div></div>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="dailyhist"><span class="ic">▤</span><span>Tvoje slova (${data.words.length})</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-dailyhist"><div class="rules-body feed word-history" style="max-height:220px">${historyHtml}</div></div>
      </div>

      <div class="menu-list" style="margin-top:20px">
        <button class="menu-item" id="shareDailyBtn" style="justify-content:center; text-align:center"><span class="ic">📤</span><span>Sdílet výsledek</span></button>
        <button class="secondary small" id="dailyMenuBtn" style="width:100%">Zpět do menu</button>
      </div>
    </div>
  `;

  document.querySelectorAll('.rules-summary').forEach(btn => {
    btn.onclick = () => {
      const panel = document.getElementById('panel-' + btn.dataset.panel);
      const isOpen = btn.classList.contains('open');
      if (isOpen) { panel.style.maxHeight = '0px'; btn.classList.remove('open'); }
      else { panel.style.maxHeight = panel.scrollHeight + 'px'; btn.classList.add('open'); }
    };
  });

  loadDailyLeaderboard('dailyLbBody');
  // panel se rozbaluje podle výšky — po načtení žebříčku ji přepočítej
  setTimeout(() => { const p = document.getElementById('panel-dailylb'); if (p && p.previousElementSibling.classList.contains('open')) p.style.maxHeight = p.scrollHeight + 'px'; }, 500);
  document.getElementById('shareDailyBtn').onclick = () => shareDailyResult(data);
  document.getElementById('dailyMenuBtn').onclick = () => renderMenu();
}

// Vykreslí výsledek na plátno a nabídne sdílení (Web Share API na mobilu)
// nebo stažení obrázku (na PC).
function generateDailyShareImage(data) {
  const MAX_WORDS = 90;          // víc slov se na obrázek nevejde rozumně
  const WORD_FONT = '15px Arial, sans-serif';
  const LINE_H = 24;
  const words = (data.words || []).slice(0, MAX_WORDS);
  const extra = Math.max(0, (data.words || []).length - words.length);

  // Nejdřív změř, kolik řádků slova zaberou, ať má obrázek správnou výšku.
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = WORD_FONT;
  const lines = layoutWordLines(probe, words.map(w => w.toUpperCase()), 480);
  if (extra) lines.push(`+ ${extra} dalších`);
  const wordsTop = 520;
  const height = Math.max(760, wordsTop + (lines.length || 1) * LINE_H + 90);

  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 600, height);
  ctx.fillStyle = '#ff3131';
  ctx.fillRect(0, 0, 600, 12);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 42px Arial, sans-serif';
  ctx.fillText('DOPIŠTO', 300, 100);

  ctx.fillStyle = '#ff3131';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('DENNÍ VÝZVA', 300, 132);

  ctx.fillStyle = '#8890a6';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('cs-CZ'), 300, 160);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px Arial, sans-serif';
  ctx.fillText(data.pattern.value.toUpperCase() + '···', 300, 230);

  ctx.fillStyle = '#ff3131';
  ctx.font = '700 130px Arial, sans-serif';
  ctx.fillText(String(data.wordCount), 300, 390);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText('SLOV ZA 180 SEKUND', 300, 430);

  // oddělovací čára + nadpis seznamu slov
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(60, 458, 480, 1);
  ctx.fillStyle = '#ff3131';
  ctx.font = '700 13px Arial, sans-serif';
  ctx.fillText('MÁ SLOVA', 300, 488);

  ctx.fillStyle = '#c9ccd6';
  ctx.font = WORD_FONT;
  if (!lines.length) ctx.fillText('—', 300, wordsTop);
  lines.forEach((line, i) => ctx.fillText(line, 300, wordsTop + i * LINE_H));

  ctx.fillStyle = '#5a5a5a';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText((window.SITE && window.SITE.domain) || location.host || 'Dopišto', 300, height - 30);

  return canvas;
}

// Rozdělí slova do řádků (oddělených „ · “) tak, aby se vešly do maxWidth.
function layoutWordLines(ctx, words, maxWidth) {
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} · ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const testLine = line ? line + ' ' + word : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, curY);
}

function shareDailyResult(data) {
  const canvas = generateDailyShareImage(data);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], 'dopisto-denni-vyzva.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: 'Dopišto — Denní výzva',
        text: `Zvládl(a) jsem ${data.wordCount} slov v Denní výzvě Dopišto!`,
      }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dopisto-denni-vyzva.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }, 'image/png');
}

// ==== Hledání soupeře (matchmaking) ====
function renderSearching(nickname) {
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <p style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:0">Režim: ${MODE_LABEL[selectedMode]}</p>
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">Hledám soupeře…</p>
      <button class="secondary small" id="cancelBtn" style="width:100%; margin-top:10px">Zrušit</button>
    </div>
  `;
  document.getElementById('cancelBtn').onclick = () => {
    socket.emit('cancel_find_match');
    renderMenu();
  };
}

// ==== Vytvoření lobby — čekání na soupeře s kódem ====
let currentLobbyCode = null;

function renderLobbyWaiting() {
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <p style="color:var(--muted); font-size:12px; letter-spacing:1px; margin-bottom:0">Režim: ${MODE_LABEL[selectedMode]}</p>
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px; margin-bottom:0">Čekání na soupeře…</p>
      <div class="lobby-code" id="lobbyCodeNum">·····</div>
      <p style="color:var(--muted); font-size:11px">Pošli tento kód kamarádovi, ať ho zadá v „Připojit se kódem“.</p>
      <div class="row">
        <button class="secondary small" id="copyCodeBtn">Zkopírovat kód</button>
        <button class="secondary small" id="cancelLobbyBtn">Zrušit</button>
      </div>
    </div>
  `;
  document.getElementById('cancelLobbyBtn').onclick = () => {
    socket.emit('cancel_lobby');
    renderMenu();
  };
  document.getElementById('copyCodeBtn').onclick = () => {
    if (currentLobbyCode && navigator.clipboard) {
      navigator.clipboard.writeText(currentLobbyCode).catch(() => {});
    }
  };
}

function renderJoining() {
  app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="spinner"></div>
      <p style="color:var(--ink-soft); font-size:13px">Připojuji se ke hře…</p>
      <button class="secondary small" id="cancelBtn" style="width:100%; margin-top:10px">Zrušit</button>
    </div>
  `;
  document.getElementById('cancelBtn').onclick = () => renderMenu();
}

// ==== Odhalení zadání + odpočet 3-2-1 ====
function renderRevealCountdown(data) {
  game = {
    roomId: data.roomId,
    mode: data.mode,
    pattern: data.pattern,
    dailyBonus: data.dailyBonus || null,
    youAre: data.youAre,
    myName: loadNickname(),
    opponentName: data.opponent,
    myElo: data.yourElo,
    opponentElo: data.opponentElo,
    token: data.token,
    finished: false,
    turn: data.turn,
    timeLeft: data.timeLeft.slice(),
    turnTimer: data.turnTimer,
    turnTimeCap: data.turnTimer, // pro procentuální výpočet lišty 
    requiredLetter: data.requiredLetter || null,
    usedWordsCount: 0,
    lastWholeSecond: [999, 999],
    lastHalfStep: [999, 999],
    lastHalfStepTurn: 999,
  };

  const startingName = data.turn === data.youAre ? game.myName : game.opponentName;

  app.innerHTML = `
    <div class="card">
      <div class="vs-row">
        <div class="vs-side">
          <div class="vs-name">${esc(game.myName)}</div>
          <div class="vs-elo">${data.yourElo} ELO</div>
        </div>
        <div class="vs-sep">VS</div>
        <div class="vs-side">
          <div class="vs-name">${esc(data.opponent)}</div>
          <div class="vs-elo">${data.opponentElo} ELO</div>
        </div>
      </div>
      <div class="turn-preview">Začíná: <span>${startingName}</span></div>
      <div class="countdown-label">Zadání kola</div>
      ${patternDisplayBlock(data.pattern, 'reveal')}
      <div class="countdown-num" id="countNum">3</div>
    </div>
  `;
  ensureAudioCtx();
  playGo();

  let n = 3;
  const numEl = document.getElementById('countNum');
  function pulse(text) {
    if (!numEl) return;
    numEl.textContent = text;
    numEl.classList.remove('pulse');
    void numEl.offsetWidth;
    numEl.classList.add('pulse');
  }
  function step() {
    if (n > 0) {
      pulse(String(n));
      playTick();
      n--;
      setTimeout(step, 800);
    } else {
      pulse('START!');
      playGo();
      setTimeout(() => renderGame(), 550);
    }
  }
  setTimeout(step, 550);
}

// ==== Herní obrazovka ====
// Hráč vždy vidí sebe vlevo a soupeře vpravo — bez ohledu na to, jaký index
// (0/1) mu přidělil server. clockMe/clockOpp jsou proto pevné pozice a
// server-idx se na ně mapuje přes slotFor().
const REACTIONS = ['👍', '😂', '🔥', '🤔', '💀', '⏳'];
let lastReactionSentAt = 0;

function slotFor(playerIdx) {
  return playerIdx === game.youAre ? 'Me' : 'Opp';
}

// Společný vstup pro slovo (zápas i denní výzva): pole, Smazat, Odeslat a
// hláška/zpětná vazba pod ním.
function wordInputHtml(placeholder) {
  return `
    <div class="word-input" id="wordInputRow">
      <div class="wi-field">
        <input id="wordInput" placeholder="${placeholder}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        <button type="button" class="wi-clear" id="clearBtn" aria-label="Smazat" hidden>⌫</button>
      </div>
      <button id="sendBtn">Odeslat</button>
    </div>
    <div class="error input-hint" id="gameErr"></div>`;
}

// Tlačítka nesmí vzít poli fokus (jinak se na mobilu zavře klávesnice).
function bindWordInputExtras(wordInput) {
  const keepFocus = (el) => { if (el) el.addEventListener('pointerdown', e => e.preventDefault()); };
  const clearBtn = document.getElementById('clearBtn');
  keepFocus(clearBtn); keepFocus(document.getElementById('sendBtn'));
  const sync = () => { if (clearBtn) clearBtn.hidden = !wordInput.value; };
  wordInput.addEventListener('input', sync);
  if (clearBtn) clearBtn.onclick = () => { wordInput.value = ''; sync(); wordInput.focus(); playClick(); };
  wordInput.addEventListener('input', () => {
    const hint = document.getElementById('gameErr');
    if (hint) hint.textContent = '';
  });
}

// Zpětná vazba u pole: 'ok' = zelené probliknutí, 'bad' = zatřesení + důvod.
let inputHintTimer = null;
function inputFeedback(kind, text) {
  const row = document.getElementById('wordInputRow');
  const hint = document.getElementById('gameErr');
  if (row) {
    row.classList.remove('fb-ok', 'fb-bad');
    void row.offsetWidth;
    row.classList.add(kind === 'ok' ? 'fb-ok' : 'fb-bad');
  }
  if (kind === 'bad' && hint && text) {
    hint.innerHTML = text;
    clearTimeout(inputHintTimer);
    inputHintTimer = setTimeout(() => { if (hint) hint.textContent = ''; }, 3500);
  }
}

function renderGame() {
  const hasTurnTimer = game.mode === 'speed';

  const clocksHtml = `
    <div class="clocks">
      <div class="clock" id="clockMe"><div class="name">${esc(game.myName)}</div><div class="time">${fmtTime(game.timeLeft[game.youAre])}</div></div>
      <div class="clock" id="clockOpp"><div class="name">${esc(game.opponentName)}</div><div class="time">${fmtTime(game.timeLeft[1 - game.youAre])}</div></div>
    </div>
  `;

  const turnTimerHtml = hasTurnTimer ? `
    <div class="turn-timer-wrap">
      <div class="turn-timer-label"><span>Čas na tah</span><span id="turnTimerNum">${(game.turnTimer / 1000).toFixed(1)} s</span></div>
      <div class="turn-timer-bar-bg"><div class="turn-timer-bar" id="turnBar" style="width:100%"></div></div>
    </div>
  ` : '';

  app.innerHTML = `
    <div class="card game-card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      ${patternDisplayBlock(game.pattern)}
      ${dailyBonusChipHtml(game.dailyBonus, 'gameBonusChip')}
      ${clocksHtml}
      ${turnTimerHtml}
      <div class="turn-status" id="turnStatus"></div>
      <div class="last-word" id="lastWordBanner"></div>
      ${wordInputHtml(currentPlaceholder())}
      <div class="used-count" id="usedCount">${currentInstructionText()} · Slov: 0</div>
      <div class="game-footer">
        <div class="reaction-bar" id="reactionBar">
          ${REACTIONS.map(e => `<button class="reaction-btn" data-emoji="${e}">${e}</button>`).join('')}
        </div>
        <button id="giveUpBtn" class="link-btn giveup-link">Vzdát kolo</button>
      </div>
      <div class="feed" id="feed"></div>
    </div>
  `;
  updateClocksUI();
  document.getElementById('soundBtn').onclick = toggleSound;

  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.onclick = () => {
      const now = Date.now();
      if (now - lastReactionSentAt < 1000) return; // stejný cooldown jako server
      lastReactionSentAt = now;
      socket.emit('send_reaction', { roomId: game.roomId, emoji: btn.dataset.emoji });
      showReactionBubble(game.youAre, btn.dataset.emoji);
    };
  });

  const wordInput = document.getElementById('wordInput');
  document.getElementById('sendBtn').onclick = () => sendWord();
  wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendWord(); });
  bindWordInputExtras(wordInput);

  // Když vyjede mobilní klávesnice, doscroluj, ať zůstane vidět "poslední
  // slovo" panel i pole pro psaní — ne jen samotný input úplně dole.
  wordInput.addEventListener('focus', () => {
    setTimeout(() => {
      const banner = document.getElementById('lastWordBanner');
      (banner || wordInput).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 300);
  });

  wordInput.focus();

  document.getElementById('giveUpBtn').onclick = () => {
    if (confirm('Opravdu se chceš vzdát kola?')) {
      socket.emit('give_up', { roomId: game.roomId });
    }
  };

  function sendWord() {
    const word = wordInput.value.trim();
    if (!word) return;
    if (game.turn !== game.youAre) { inputFeedback('bad', 'Teď je na tahu soupeř.'); return; }
    wordInput.value = '';
    socket.emit('submit_word', { roomId: game.roomId, word });
    wordInput.focus(); // klávesnice na mobilu zůstane otevřená
  }
}

function updateClocksUI() {
  if (!game) return;
  const hasTurnTimer = game.mode === 'speed';

  const status = document.getElementById('turnStatus');
  if (status) {
    const mine = game.turn === game.youAre;
    status.classList.toggle('mine', mine);
    status.innerHTML = mine
      ? '<span class="ts-dot"></span> Jsi na tahu — piš!'
      : `Na tahu je ${esc(game.opponentName)}…`;
    const row = document.getElementById('wordInputRow');
    if (row) row.classList.toggle('waiting', !mine);
  }

  const meEl = document.getElementById('clockMe');
  const oppEl = document.getElementById('clockOpp');
  if (meEl) {
    meEl.classList.toggle('active', game.turn === game.youAre);
    meEl.classList.toggle('low', game.timeLeft[game.youAre] < 15000);
    const t = meEl.querySelector('.time');
    if (t) t.textContent = fmtTime(game.timeLeft[game.youAre]);
  }
  if (oppEl) {
    oppEl.classList.toggle('active', game.turn !== game.youAre);
    oppEl.classList.toggle('low', game.timeLeft[1 - game.youAre] < 15000);
    const t = oppEl.querySelector('.time');
    if (t) t.textContent = fmtTime(game.timeLeft[1 - game.youAre]);
  }

  if (hasTurnTimer) {
    const bar = document.getElementById('turnBar');
    const label = document.getElementById('turnTimerNum');
    const cap = game.turnTimeCap || 10000;
    if (bar) {
      const pct = Math.max(0, Math.min(100, (game.turnTimer / cap) * 100));
      bar.style.width = pct + '%';
      bar.classList.toggle('urgent', game.turnTimer < 5000);
    }
    if (label) label.textContent = (Math.max(0, game.turnTimer) / 1000).toFixed(1) + ' s';
  }
}

function flashPenalty(playerIdx) {
  const clockEl = document.getElementById(`clock${slotFor(playerIdx)}`);
  const cardEl = document.querySelector('.card');
  if (clockEl) {
    clockEl.classList.remove('penalty');
    void clockEl.offsetWidth;
    clockEl.classList.add('penalty');
  }
  if (cardEl) {
    cardEl.classList.remove('shake');
    void cardEl.offsetWidth;
    cardEl.classList.add('shake');
  }
}

function showReactionBubble(playerIdx, emoji) {
  const clockEl = document.getElementById(`clock${slotFor(playerIdx)}`);
  if (!clockEl) return;
  const bubble = document.createElement('div');
  bubble.className = 'reaction-bubble';
  bubble.textContent = emoji;
  clockEl.appendChild(bubble);
  setTimeout(() => bubble.remove(), 1400);
}

function showBonusPopup(playerIdx, ms) {
  const clockEl = document.getElementById(`clock${slotFor(playerIdx)}`);
  if (!clockEl) return;
  const el = document.createElement('div');
  el.className = 'bonus-popup';
  el.textContent = `+${(ms / 1000).toFixed(0)}s`;
  clockEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ==== Výsledková obrazovka ====
function renderResult(data) {
  const my = data.results[game.youAre];
  const opp = data.results[1 - game.youAre];
  const iWon = data.winnerIdx === game.youAre;

  playDefeat();
  setTimeout(playVictory, 650);

  const timeoutLabel = game.mode === 'speed'
    ? 'nestihl(a) odpovědět včas.'
    : 'došel hlavní čas.';

  let reasonText;
  if (iWon) {
    if (data.reason === 'timeout' || data.reason === 'turn_timeout') reasonText = `${esc(opp.name)} ${timeoutLabel}`;
    else if (data.reason === 'opponent_left') reasonText = `${esc(opp.name)} odešel(la) ze hry.`;
    else reasonText = `${esc(opp.name)} se vzdal(a).`;
  } else {
    if (data.reason === 'timeout' || data.reason === 'turn_timeout') reasonText = 'Nestihl(a) jsi odpovědět včas.';
    else reasonText = 'Vzdal(a) jsi kolo.';
  }

  const history = data.history || [];
  const historyHtml = history.length ? history.map(h => {
    const name = h.playerIdx === game.youAre ? game.myName : game.opponentName;
    return `<div class="p${h.playerIdx}">${name}: ${h.word}</div>`;
  }).join('') : '<div style="color:var(--muted)">V tomto kole nepadlo žádné slovo.</div>';

  app.innerHTML = `
    <div class="card result">
      <h2 class="${iWon ? 'win' : 'lose'}">${iWon ? 'Vyhrál(a) jsi!' : 'Prohrál(a) jsi'}</h2>
      <div style="color:var(--muted); font-size:13px">${reasonText} <span>(režim: ${MODE_LABEL[game.mode]})</span></div>
      <div class="row" style="margin-top:16px">
        <div>
          <div style="color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase">${esc(my.name)}</div>
          <div class="elo-line ${iWon ? 'win' : 'lose'}">${my.before} → ${my.after} (${my.after >= my.before ? '+' : ''}${my.after - my.before})</div>
        </div>
        <div>
          <div style="color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase">${esc(opp.name)}</div>
          <div class="elo-line ${iWon ? 'lose' : 'win'}">${opp.before} → ${opp.after} (${opp.after >= opp.before ? '+' : ''}${opp.after - opp.before})</div>
        </div>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="hist"><span class="ic">▤</span><span>Historie slov (${history.length})</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-hist"><div class="rules-body feed word-history" style="max-height:220px">${historyHtml}</div></div>
      </div>

      <div id="rematchBox" class="rematch-box"></div>

      <div class="menu-list" style="margin-top:20px">
        <button class="menu-item" id="againBtn"><span class="ic">🔎</span><span>Najít dalšího soupeře</span></button>
        <button class="secondary small" id="menuBtn" style="width:100%">Zpět do menu</button>
      </div>
    </div>
  `;

  document.querySelectorAll('.rules-summary').forEach(btn => {
    btn.onclick = () => {
      const panel = document.getElementById('panel-' + btn.dataset.panel);
      const isOpen = btn.classList.contains('open');
      if (isOpen) {
        panel.style.maxHeight = '0px';
        btn.classList.remove('open');
      } else {
        panel.style.maxHeight = panel.scrollHeight + 'px';
        btn.classList.add('open');
      }
    };
  });

  // Odveta — stav a vykreslení
  rematchState = { phase: 'idle', msg: '', until: 0 };
  if (data.reason === 'opponent_left') {
    rematchState = { phase: 'unavailable', msg: `${opp.name} opustil(a) hru — odveta není možná.`, until: 0 };
  }
  renderRematchBox();

  document.getElementById('againBtn').onclick = () => {
    const n = game.myName;
    const mode = game.mode;
    leaveResult();
    game = null;
    socket.emit('find_match', { nickname: n, mode });
    selectedMode = mode;
    renderSearching(n);
  };
  document.getElementById('menuBtn').onclick = () => { selectedMode = game.mode; leaveResult(); game = null; renderMenu(); };
}

// ==== Odveta ====
let rematchState = { phase: 'idle', msg: '', until: 0 };
let rematchTimer = null;

// Dá serveru vědět, že hráč opustil obrazovku výsledku (odveta pak
// soupeři přestane být nabízena a on se to dozví).
function leaveResult() {
  clearInterval(rematchTimer);
  if (game && game.finished && game.roomId) socket.emit('result_left', { roomId: game.roomId });
}

function renderRematchBox() {
  const box = document.getElementById('rematchBox');
  clearInterval(rematchTimer);
  if (!box || !game) return;
  const st = rematchState;
  const secs = () => Math.max(0, Math.ceil((st.until - Date.now()) / 1000));

  if (st.phase === 'idle') {
    box.innerHTML = '<button class="menu-item" id="rematchBtn"><span class="ic">⚔</span><span>Požádat o odvetu</span></button>';
    document.getElementById('rematchBtn').onclick = () => socket.emit('rematch_request', { roomId: game.roomId });
  } else if (st.phase === 'pending') {
    box.innerHTML = `<div class="rematch-msg">Čekám, jestli soupeř přijme odvetu… <b id="rmSecs">${secs()}</b> s</div>`;
    rematchTimer = setInterval(() => { const e = document.getElementById('rmSecs'); if (e) e.textContent = secs(); }, 250);
  } else if (st.phase === 'offered') {
    box.innerHTML = `
      <div class="rematch-msg"><b>${esc(st.from)}</b> nabízí odvetu! <span id="rmSecs">${secs()}</span> s</div>
      <div class="rematch-actions">
        <button id="rematchAccept">Přijmout</button>
        <button class="secondary" id="rematchDecline">Odmítnout</button>
      </div>`;
    document.getElementById('rematchAccept').onclick = () => socket.emit('rematch_accept', { roomId: game.roomId });
    document.getElementById('rematchDecline').onclick = () => {
      socket.emit('rematch_decline', { roomId: game.roomId });
      rematchState = { phase: 'idle', msg: '', until: 0 };
      renderRematchBox();
    };
    rematchTimer = setInterval(() => { const e = document.getElementById('rmSecs'); if (e) e.textContent = secs(); }, 250);
  } else if (st.phase === 'unavailable') {
    box.innerHTML = `<div class="rematch-msg rematch-off">${esc(st.msg || 'Odveta není možná.')}</div>`;
  } else if (st.phase === 'notice') {
    // krátká zpráva (vypršelo / odmítnuto) a znovu možnost poslat návrh
    box.innerHTML = `<div class="rematch-msg">${esc(st.msg)}</div><button class="menu-item" id="rematchBtn"><span class="ic">⚔</span><span>Požádat o odvetu</span></button>`;
    document.getElementById('rematchBtn').onclick = () => socket.emit('rematch_request', { roomId: game.roomId });
  }
}

function rematchSet(state) {
  if (!game || !game.finished || !document.getElementById('rematchBox')) return;
  rematchState = state;
  renderRematchBox();
}
socket.on('rematch_pending', ({ ttlMs }) => rematchSet({ phase: 'pending', until: Date.now() + ttlMs }));
socket.on('rematch_offered', ({ from, ttlMs }) => { playGo(); rematchSet({ phase: 'offered', from, until: Date.now() + ttlMs }); });
socket.on('rematch_expired', () => rematchSet({ phase: 'notice', msg: 'Návrh na odvetu vypršel.' }));
socket.on('rematch_declined', () => rematchSet({ phase: 'notice', msg: 'Soupeř odvetu odmítl(a).' }));
socket.on('rematch_unavailable', ({ reason }) => rematchSet({ phase: 'unavailable', msg: reason }));

// ==== Socket.io události ze serveru ====
socket.on('waiting_for_opponent', () => { /* obrazovka hledání se už zobrazuje */ });

socket.on('lobby_created', ({ code }) => {
  currentLobbyCode = code;
  const el = document.getElementById('lobbyCodeNum');
  if (el) el.textContent = code;
});

socket.on('lobby_error', ({ message }) => {
  renderPlayMenu(message);
});

socket.on('lobby_expired', () => {
  renderPlayMenu('Kód lobby vypršel, zkus to znovu.');
});

socket.on('match_found', (data) => {
  clearInterval(rematchTimer);
  currentLobbyCode = null;
  renderRevealCountdown(data);
});

// ==== Denní výzva — socket eventy ====
socket.on('daily_started', (data) => {
  renderDailyReveal(data);
});

socket.on('daily_state_update', (data) => {
  if (!dailyState) return;
  dailyState.timeLeft = data.timeLeft;

  const remaining = data.timeLeft;
  if (remaining <= 10000) {
    const halfStep = Math.floor(remaining / 500);
    if (halfStep !== dailyState.lastHalfStep) {
      dailyState.lastHalfStep = halfStep;
      if (halfStep > 0) playTickUrgent();
    }
  } else {
    const wholeSecond = Math.ceil(remaining / 1000);
    if (wholeSecond !== dailyState.lastWholeSecond) {
      dailyState.lastWholeSecond = wholeSecond;
      if (wholeSecond > 0) playTick();
    }
  }

  if (data.lastWord) {
    const feed = document.getElementById('feed');
    const gameErr = document.getElementById('gameErr');
    if (feed) {
      const div = document.createElement('div');
      div.className = 'p0';
      div.textContent = data.lastWord;
      feed.prepend(div);
    }
    playSwoosh();
    if (gameErr) gameErr.textContent = '';
    inputFeedback('ok'); vibrate(15);

    const usedCount = document.getElementById('usedCount');
    if (usedCount) usedCount.textContent = `${patternInstruction(dailyState.pattern)} · Slov: ${data.usedWordsCount}`;

    const lastWordBanner = document.getElementById('lastWordBanner');
    if (lastWordBanner) {
      lastWordBanner.className = 'last-word p0';
      lastWordBanner.textContent = data.lastWord;
      lastWordBanner.classList.remove('pop');
      void lastWordBanner.offsetWidth;
      lastWordBanner.classList.add('pop');
    }

    if (data.dailyBonusHit) showDailyBonusHit('clockMe');
    if (data.bonusMs) {
      const clockEl = document.getElementById('clockMe');
      if (clockEl) {
        const el = document.createElement('div');
        el.className = 'bonus-popup';
        el.textContent = `+${(data.bonusMs / 1000).toFixed(0)}s`;
        clockEl.appendChild(el);
        setTimeout(() => el.remove(), 1000);
      }
    }
  }

  updateDailyClockUI();
});

socket.on('daily_word_rejected', ({ reason, penaltyMs }) => {
  if (!dailyState) return;
  const gameErr = document.getElementById('gameErr');
  if (penaltyMs) {
    playPenalty();
    const clockEl = document.getElementById('clockMe');
    const cardEl = document.querySelector('.card');
    if (clockEl) { clockEl.classList.remove('penalty'); void clockEl.offsetWidth; clockEl.classList.add('penalty'); }
    if (cardEl) { cardEl.classList.remove('shake'); void cardEl.offsetWidth; cardEl.classList.add('shake'); }
    vibrate([60, 40, 120]);
    inputFeedback('bad', `<span class="penalty-note">${reason} (−${penaltyMs / 1000} s)</span>`);
  } else {
    inputFeedback('bad', esc(reason));
  }
});

socket.on('nickname_rejected', ({ message }) => {
  dailyState = null;
  try { localStorage.removeItem('dopisto_nickname'); } catch {}
  renderMenu(message || 'Přezdívka není povolená.');
});

socket.on('rate_limited', () => {
  const err = document.getElementById('err') || document.getElementById('gameErr');
  if (err) err.textContent = 'Příliš rychle — chvilku počkej.';
});

socket.on('daily_over', (data) => {
  saveDailyResult(data);
  dailyState = null;
  renderDailyResult(data, false);
});

socket.on('state_update', (data) => {
  if (!game) return;

  game.turn = data.turn;
  game.timeLeft = data.timeLeft;
  game.turnTimer = data.turnTimer;
  game.usedWordsCount = data.usedWordsCount;

  // Když se tah právě přehodil (nové slovo), aktuální turnTimer je zároveň
  // nový "strop" pro procentuální výpočet lišty.
  const turnJustChanged = !!data.lastWord;
  if (turnJustChanged && (game.mode === 'speed') && data.turnTimer != null) {
    game.turnTimeCap = data.turnTimer;
  }

  const active = data.turn;
  if ((game.mode === 'speed') && data.turnTimer != null) {
    const halfStep = Math.floor(data.turnTimer / 500);
    if (halfStep !== game.lastHalfStepTurn) {
      game.lastHalfStepTurn = halfStep;
      if (halfStep > 0) playTickUrgent();
    }
  } else {
    const remaining = data.timeLeft[active];
    if (remaining <= 10000) {
      const halfStep = Math.floor(remaining / 500);
      if (halfStep !== game.lastHalfStep[active]) {
        game.lastHalfStep[active] = halfStep;
        if (halfStep > 0) playTickUrgent();
      }
    } else {
      const wholeSecond = Math.ceil(remaining / 1000);
      if (wholeSecond !== game.lastWholeSecond[active]) {
        game.lastWholeSecond[active] = wholeSecond;
        if (wholeSecond > 0) playTick();
      }
    }
  }

  const feed = document.getElementById('feed');
  const gameErr = document.getElementById('gameErr');
  if (data.lastWord && feed) {
    const wordOwnerName = data.lastPlayerIdx === game.youAre ? game.myName : game.opponentName;
    const div = document.createElement('div');
    div.className = 'p' + data.lastPlayerIdx;
    div.textContent = `${wordOwnerName}: ${data.lastWord}`;
    feed.prepend(div);
    playSwoosh();
    if (gameErr) gameErr.textContent = '';
    if (data.lastPlayerIdx === game.youAre) { inputFeedback('ok'); vibrate(15); }
    else { vibrate(35); const wi = document.getElementById('wordInput'); if (wi && document.activeElement !== wi) wi.focus(); }

    const usedCount = document.getElementById('usedCount');
    if (usedCount) usedCount.textContent = `${currentInstructionText()} · Slov: ${data.usedWordsCount}`;

    const wordInputEl = document.getElementById('wordInput');

    const turnName = document.getElementById('turnName');
    if (turnName) turnName.textContent = game.turn === game.youAre ? game.myName : game.opponentName;

    const lastWordBanner = document.getElementById('lastWordBanner');
    if (lastWordBanner) {
      lastWordBanner.className = 'last-word p' + data.lastPlayerIdx;
      lastWordBanner.textContent = `${wordOwnerName}: ${data.lastWord}`;
      lastWordBanner.classList.remove('pop');
      void lastWordBanner.offsetWidth;
      lastWordBanner.classList.add('pop');
    }

    if (data.dailyBonusHit) showDailyBonusHit(`clock${slotFor(data.bonusPlayerIdx)}`);
    if (data.bonusMs) {
      showBonusPopup(data.bonusPlayerIdx, data.bonusMs);
    }
  }

  updateClocksUI();
});

socket.on('reaction', ({ playerIdx, emoji }) => {
  if (!game) return;
  // vlastní reakci si už zobrazujeme okamžitě při odeslání, ať nečeká na síť
  if (playerIdx === game.youAre) return;
  showReactionBubble(playerIdx, emoji);
});

socket.on('word_rejected', ({ reason, penaltyMs }) => {
  if (!game) return;
  const gameErr = document.getElementById('gameErr');
  if (penaltyMs) {
    playPenalty();
    flashPenalty(game.youAre);
    vibrate([60, 40, 120]);
    inputFeedback('bad', `<span class="penalty-note">${reason} (−${penaltyMs / 1000} s)</span>`);
  } else {
    inputFeedback('bad', esc(reason));
  }
});

socket.on('game_over', (data) => {
  if (!game) return;
  game.finished = true;
  vibrate([80, 60, 160]);
  renderResult(data);
});

// ==== Reconnect logika ====

// Vlastní odpojení — socket.io se pod kapotou sám pokouší znovu připojit,
// my jen zobrazíme přehlednou hlášku a po obnovení spojení požádáme server
// o návrat do rozehraného kola.
socket.on('disconnect', () => {
  if (game && !game.finished) showReconnectOverlay();
});

socket.on('connect', () => {
  if (game && !game.finished && game.roomId) {
    socket.emit('rejoin_room', { roomId: game.roomId, youAre: game.youAre, token: game.token });
  }
});

socket.on('rejoin_success', (data) => {
  hideReconnectOverlay();
  game.turn = data.turn;
  game.timeLeft = data.timeLeft;
  game.turnTimer = data.turnTimer;
  game.turnTimeCap = data.turnTimer;
  game.usedWordsCount = data.usedWordsCount;
  game.dailyBonus = data.dailyBonus || game.dailyBonus || null;
  game.lastWholeSecond = [999, 999];
  game.lastHalfStep = [999, 999];
  game.lastHalfStepTurn = 999;
  renderGame();
});

socket.on('rejoin_failed', () => {
  hideReconnectOverlay();
  game = null;
  renderMenu('Spojení se hrou se nepodařilo obnovit — kolo mezitím skončilo.');
});

// Soupeř (ne my) ztratil spojení.
socket.on('opponent_disconnected', ({ graceMs }) => {
  showOpponentDisconnectedBanner(graceMs);
});
socket.on('opponent_reconnected', () => {
  hideOpponentDisconnectedBanner();
});

function showReconnectOverlay() {
  let el = document.getElementById('reconnectOverlay');
  if (el) return;
  el = document.createElement('div');
  el.id = 'reconnectOverlay';
  el.className = 'reconnect-overlay';
  el.innerHTML = `<div class="spinner"></div><p>Spojení přerušeno — pokouším se obnovit…</p>`;
  document.body.appendChild(el);
}
function hideReconnectOverlay() {
  const el = document.getElementById('reconnectOverlay');
  if (el) el.remove();
}

let opponentGraceInterval = null;
function showOpponentDisconnectedBanner(graceMs) {
  hideOpponentDisconnectedBanner();
  const cardEl = document.querySelector('.card');
  if (!cardEl) return;
  const banner = document.createElement('div');
  banner.id = 'opponentDisconnectedBanner';
  banner.className = 'disconnect-banner';
  let secondsLeft = Math.ceil(graceMs / 1000);
  banner.textContent = `Soupeř ztratil spojení — čekám na návrat (${secondsLeft} s)…`;
  cardEl.prepend(banner);
  opponentGraceInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) { clearInterval(opponentGraceInterval); return; }
    banner.textContent = `Soupeř ztratil spojení — čekám na návrat (${secondsLeft} s)…`;
  }, 1000);
}
function hideOpponentDisconnectedBanner() {
  if (opponentGraceInterval) { clearInterval(opponentGraceInterval); opponentGraceInterval = null; }
  const banner = document.getElementById('opponentDisconnectedBanner');
  if (banner) banner.remove();
}

renderMenu();
routeFromHash();

// Zvukový klik na jakékoliv tlačítko nebo rozbalovací odkaz.
document.addEventListener('click', (e) => {
  if (e.target.closest('button, summary')) playClick();
}, true);


