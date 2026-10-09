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
let soundEnabled = localStorage.getItem('word_duel_sound') !== 'off';

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTick() {
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('word_duel_sound', soundEnabled ? 'on' : 'off');
  const btn = document.getElementById('soundBtn');
  if (btn) btn.textContent = soundEnabled ? '♪' : '×';
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
function renderMenu(notice) {
  const nickname = loadNickname();

  app.innerHTML = `
    <div class="page">
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundEnabled ? '♪' : '×'}</button>
      <button type="button" class="bonus-badge" id="menuBonusBadge" hidden></button>
      <div class="bonus-badge-pop" id="menuBonusPop" hidden></div>
      <img class="logo" src="logo.png" alt="Dopišto" />
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>

      <div class="mode-select">
        ${modeSegmentedHtml(selectedMode)}
      </div>

      <div class="nickname-box">
        <svg class="nickname-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"></path></svg>
        <input id="nickname" placeholder="Tvoje přezdívka" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="20" value="${nickname.replace(/"/g, '')}" />
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

      <div class="or-sep"><span class="line"></span><span>nebo hraj sám</span><span class="line"></span></div>

      <div class="menu-list">
        <button class="menu-item" id="dailyBtn"><span class="ic">🔥</span><span>Denní výzva</span></button>
      </div>
      ${streakHtml()}

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
    </div>

    <div class="social-links">
      <a href="#" class="social-link" aria-label="Facebook">FB</a>
      <a href="#" class="social-link" aria-label="Instagram">IG</a>
      <a href="#" class="social-link" aria-label="Discord">DC</a>
    </div>
    <footer class="site-footer">
      <a href="#">Časté dotazy</a>
      <a href="#">Obchodní podmínky</a>
      <a href="#">Ochrana údajů</a>
      <a href="#">Kontakt</a>
      <a href="#">Nahlásit chybu</a>
      <a href="#">Nastavení cookies</a>
    </footer>
    <div class="version-tag">Dopišto · v1.0</div>
    </div>
  `;

  document.getElementById('soundBtn').onclick = toggleSound;
  bindModeSegmented(() => selectedMode, (newMode) => { selectedMode = newMode; });

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

  function getNickname() {
    const n = document.getElementById('nickname').value.trim();
    return n;
  }

  document.getElementById('findBtn').onclick = () => {
    const n = getNickname();
    const err = document.getElementById('err');
    if (!n) { err.textContent = 'Zadej přezdívku.'; return; }
    saveNickname(n);
    ensureAudioCtx();
    socket.emit('find_match', { nickname: n, mode: selectedMode });
    renderSearching(n);
  };

  document.getElementById('createLobbyBtn').onclick = () => {
    const n = getNickname();
    const err = document.getElementById('err');
    if (!n) { err.textContent = 'Zadej přezdívku.'; return; }
    saveNickname(n);
    ensureAudioCtx();
    socket.emit('create_lobby', { nickname: n, mode: selectedMode });
    renderLobbyWaiting();
  };

  document.getElementById('joinLobbyBtn').onclick = () => {
    const n = getNickname();
    const code = getJoinCode();
    const err = document.getElementById('err');
    if (!n) { err.textContent = 'Zadej přezdívku.'; return; }
    if (code.length < 5) { err.textContent = 'Zadej celý kód lobby.'; return; }
    saveNickname(n);
    ensureAudioCtx();
    socket.emit('join_lobby', { nickname: n, code });
    renderJoining();
  };

  setupCodeBoxes();

  document.getElementById('leaderboardLinkBtn').onclick = () => renderLeaderboard(selectedMode);
  socket.emit('get_daily_bonus', (b) => {
    const badge = document.getElementById('menuBonusBadge');
    const pop = document.getElementById('menuBonusPop');
    if (!badge || !pop || !b) return;
    badge.innerHTML = '<span class="dbc-ic">✦</span>';
    badge.setAttribute('aria-label', 'Bonus dne: ' + b.label);
    pop.innerHTML = `<b>Bonus dne: ${b.label} · +3 s</b><br>${b.desc}`;
    badge.hidden = false;
    badge.onclick = () => { pop.hidden = !pop.hidden; };
    document.addEventListener('click', (e) => { if (!badge.contains(e.target)) pop.hidden = true; });
  });
  document.getElementById('dailyBtn').onclick = () => {
    const n = getNickname();
    const err = document.getElementById('err');
    if (!n) { err.textContent = 'Zadej přezdívku.'; return; }
    saveNickname(n);
    ensureAudioCtx();
    startDailyChallenge();
  };
}

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
          ${list.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.elo}</td><td>${p.wins}/${p.losses}</td></tr>`).join('')}
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
      <button class="icon-btn sound-toggle" id="soundBtn">${soundEnabled ? '♪' : '×'}</button>
      ${patternTilesHtml(dailyState.pattern)}
      ${dailyBonusChipHtml(dailyState.dailyBonus, 'gameBonusChip')}
      <div class="used-count" id="usedCount">${patternInstruction(dailyState.pattern)} · Slov: 0</div>
      <div class="clocks">
        <div class="clock active" id="clockMe"><div class="name">${dailyState.myName}</div><div class="time">${fmtTime(dailyState.timeLeft)}</div></div>
      </div>
      <div class="error" id="gameErr"></div>
      <div class="last-word" id="lastWordBanner"></div>
      <div class="word-input">
        <input id="wordInput" placeholder="${patternInputPlaceholder(dailyState.pattern)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        <button id="sendBtn">Odeslat</button>
      </div>
      <button id="endDailyBtn" class="secondary small" style="margin-top:10px">Ukončit pokus</button>
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
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 760;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 600, 760);
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

  ctx.fillStyle = '#8890a6';
  ctx.font = '15px Arial, sans-serif';
  const sample = data.words.slice(0, 14).join(' · ') || '—';
  wrapCanvasText(ctx, sample, 300, 490, 500, 22);

  ctx.fillStyle = '#5a5a5a';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('dopisto.online', 300, 730);

  return canvas;
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
          <div class="vs-name">${game.myName}</div>
          <div class="vs-elo">${data.yourElo} ELO</div>
        </div>
        <div class="vs-sep">VS</div>
        <div class="vs-side">
          <div class="vs-name">${data.opponent}</div>
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

function renderGame() {
  const hasTurnTimer = game.mode === 'speed';

  const clocksHtml = `
    <div class="clocks">
      <div class="clock" id="clockMe"><div class="name">${game.myName}</div><div class="time">${fmtTime(game.timeLeft[game.youAre])}</div></div>
      <div class="clock" id="clockOpp"><div class="name">${game.opponentName}</div><div class="time">${fmtTime(game.timeLeft[1 - game.youAre])}</div></div>
    </div>
  `;

  const turnTimerHtml = hasTurnTimer ? `
    <div class="turn-timer-wrap">
      <div class="turn-timer-label"><span>Čas na tah</span><span id="turnTimerNum">${(game.turnTimer / 1000).toFixed(1)} s</span></div>
      <div class="turn-timer-bar-bg"><div class="turn-timer-bar" id="turnBar" style="width:100%"></div></div>
    </div>
  ` : '';

  app.innerHTML = `
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundEnabled ? '♪' : '×'}</button>
      ${patternDisplayBlock(game.pattern)}
      ${dailyBonusChipHtml(game.dailyBonus, 'gameBonusChip')}
      <div class="used-count" id="usedCount">${currentInstructionText()} · Slov: 0</div>
      ${clocksHtml}
      <div class="error" id="gameErr"></div>
      ${turnTimerHtml}
      <div class="turn-banner">Na tahu: <span id="turnName">${game.turn === game.youAre ? game.myName : game.opponentName}</span></div>
      <div class="last-word" id="lastWordBanner"></div>
      <div class="word-input">
        <input id="wordInput" placeholder="${currentPlaceholder()}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        <button id="sendBtn">Odeslat</button>
      </div>
      <div class="reaction-bar" id="reactionBar">
        ${REACTIONS.map(e => `<button class="reaction-btn" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <button id="giveUpBtn" class="secondary small" style="margin-top:10px">Vzdát kolo</button>
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
    if (game.turn !== game.youAre) return; // nejsi na tahu
    wordInput.value = '';
    socket.emit('submit_word', { roomId: game.roomId, word });
  }
}

function updateClocksUI() {
  if (!game) return;
  const hasTurnTimer = game.mode === 'speed';

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
    if (data.reason === 'timeout' || data.reason === 'turn_timeout') reasonText = `${opp.name} ${timeoutLabel}`;
    else if (data.reason === 'opponent_left') reasonText = `${opp.name} odešel(la) ze hry.`;
    else reasonText = `${opp.name} se vzdal(a).`;
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
          <div style="color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase">${my.name}</div>
          <div class="elo-line ${iWon ? 'win' : 'lose'}">${my.before} → ${my.after} (${my.after >= my.before ? '+' : ''}${my.after - my.before})</div>
        </div>
        <div>
          <div style="color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase">${opp.name}</div>
          <div class="elo-line ${iWon ? 'lose' : 'win'}">${opp.before} → ${opp.after} (${opp.after >= opp.before ? '+' : ''}${opp.after - opp.before})</div>
        </div>
      </div>

      <div class="rules">
        <button type="button" class="rules-summary" data-panel="hist"><span class="ic">▤</span><span>Historie slov (${history.length})</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-hist"><div class="rules-body feed word-history" style="max-height:220px">${historyHtml}</div></div>
      </div>

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

  document.getElementById('againBtn').onclick = () => {
    const n = game.myName;
    const mode = game.mode;
    game = null;
    socket.emit('find_match', { nickname: n, mode });
    selectedMode = mode;
    renderSearching(n);
  };
  document.getElementById('menuBtn').onclick = () => { selectedMode = game.mode; game = null; renderMenu(); };
}

// ==== Socket.io události ze serveru ====
socket.on('waiting_for_opponent', () => { /* obrazovka hledání se už zobrazuje */ });

socket.on('lobby_created', ({ code }) => {
  currentLobbyCode = code;
  const el = document.getElementById('lobbyCodeNum');
  if (el) el.textContent = code;
});

socket.on('lobby_error', ({ message }) => {
  renderMenu(message);
});

socket.on('lobby_expired', () => {
  renderMenu('Kód lobby vypršel, zkus to znovu.');
});

socket.on('match_found', (data) => {
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
    if (gameErr) gameErr.innerHTML = `<span class="penalty-note">${reason} (−${penaltyMs / 1000} s)</span>`;
  } else if (gameErr) {
    gameErr.textContent = reason;
  }
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
    if (gameErr) gameErr.innerHTML = `<span class="penalty-note">${reason} (−${penaltyMs / 1000} s)</span>`;
  } else if (gameErr) {
    gameErr.textContent = reason;
  }
});

socket.on('game_over', (data) => {
  if (!game) return;
  game.finished = true;
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

// Zvukový klik na jakékoliv tlačítko nebo rozbalovací odkaz.
document.addEventListener('click', (e) => {
  if (e.target.closest('button, summary')) playClick();
}, true);


