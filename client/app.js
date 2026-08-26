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

// Slovní fotbal nemá pevné zadání (žádná písmena k odhalení) — zvláštní blok.
function patternDisplayBlock(pattern, extraClass) {
  if (pattern.type === 'football') {
    const cls = `letter-tiles${extraClass ? ' ' + extraClass : ''}`;
    return `<div class="${cls}"><div class="letter-tile dim" style="width:auto; padding:0 18px; font-size:18px;">⚽</div></div>`;
  }
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

// Dynamické zadání pro Slovní fotbal — mění se každý tah podle posledního
// odehraného slova.
function currentInstructionText() {
  if (game.mode === 'football') {
    return game.requiredLetter
      ? `Slovo musí začínat na "${game.requiredLetter}".`
      : 'První slovo může být jakékoliv (jen podstatné jméno).';
  }
  return patternInstruction(game.pattern);
}

function currentPlaceholder() {
  if (game.mode === 'football') {
    return game.requiredLetter
      ? `Napiš slovo na '${game.requiredLetter}'…`
      : 'Napiš první slovo (podstatné jméno)…';
  }
  return patternInputPlaceholder(game.pattern);
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

const MODE_LABEL = { speed: '1 písmeno', 2: '2 písmena', football: 'Slovní fotbal', middle: 'Uprostřed' };
const MODE_ICON = { speed: '⚡', 2: 'Aa', football: '⚽', middle: '·A·' };
const MODE_ORDER = ['speed', 2, 'football', 'middle'];
function isBigIcon(m) { return m === 'speed' || m === 'football'; }

// Malý náhled zadání nad segmentovaným přepínačem, á la "[⚡P] [AA] [⚽] [·A·]".
function modePreviewText(m) {
  if (m === 2) return '[AA]';
  if (m === 'speed') return '[⚡P]';
  if (m === 'football') return '[⚽]';
  return '[·A·]';
}

function modeSegmentedHtml(selected) {
  return `
    <div class="mode-preview-row">
      ${MODE_ORDER.map(m => `<span class="${selected === m ? 'active' : ''}">${modePreviewText(m)}</span>`).join('')}
    </div>
    <div class="mode-segmented">
      ${MODE_ORDER.map(m => `<button class="seg-btn ${selected === m ? 'active' : ''}" data-mode="${m}">${MODE_LABEL[m]}</button>`).join('')}
    </div>
  `;
}

function bindModeSegmented(onSelect) {
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.mode;
      const newMode = (m === '2') ? Number(m) : m;
      onSelect(newMode);
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
    <li><b>Slovní fotbal</b> — jeden hráč napíše slovo a druhý musí navázat
      slovem, které začíná posledním písmenem předchozího slova (pouze
      podstatná jména) — hráči se střídají, dokud jednomu z nich nevyprší
      čas — na začátku máš na každý tah 30 sekund — za každé další slovo se
      časový limit tahu zkrátí o 1 sekundu.</li>
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
let game = null; // aktivní kolo (zrcadlo serverového stavu)

// ==== Menu ====
function renderMenu(notice) {
  const nickname = loadNickname();

  app.innerHTML = `
    <div class="page">
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundEnabled ? '♪' : '×'}</button>
      <img class="logo" src="logo.png" alt="Dopišto" />
      <p class="tagline">Dva hráči, dvě písmena, jeden vítěz.</p>
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>

      <div class="mode-select">
        ${modeSegmentedHtml(selectedMode)}
      </div>

      <input id="nickname" placeholder="Tvoje přezdívka" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="20" value="${nickname.replace(/"/g, '')}" style="margin-top:0" />
      <div class="error" id="err">${notice || ''}</div>

      <div class="menu-list">
        <button class="menu-item" id="findBtn"><span class="ic">🔎</span><span>Najít soupeře</span></button>
      </div>

      <div class="or-sep"><span class="line"></span><span>nebo hraj jen s kamarádem</span><span class="line"></span></div>

      <div class="menu-list">
        <button class="menu-item" id="createLobbyBtn"><span class="ic">＋</span><span>Vytvořit lobby</span></button>
      </div>
      <div class="lobby-row">
        <input id="joinCode" placeholder="KÓD" maxlength="5" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" />
        <button id="joinLobbyBtn">Připojit</button>
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
  bindModeSegmented((newMode) => { selectedMode = newMode; renderMenu(); });

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
    const code = document.getElementById('joinCode').value.trim();
    const err = document.getElementById('err');
    if (!n) { err.textContent = 'Zadej přezdívku.'; return; }
    if (!code) { err.textContent = 'Zadej kód lobby.'; return; }
    saveNickname(n);
    ensureAudioCtx();
    socket.emit('join_lobby', { nickname: n, code });
    renderJoining();
  };

  document.getElementById('leaderboardLinkBtn').onclick = () => renderLeaderboard(selectedMode);
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

  bindModeSegmented((newMode) => { selectedMode = newMode; renderLeaderboard(newMode); });
  document.getElementById('backToMenuBtn').onclick = () => renderMenu();

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
  });
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
    turnTimeCap: data.turnTimer, // pro procentuální výpočet lišty (Blitz/Fotbal)
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
  const hasBank = game.mode !== 'football';
  const hasTurnTimer = game.mode === 'speed' || game.mode === 'football';

  const clocksHtml = hasBank ? `
    <div class="clocks">
      <div class="clock" id="clockMe"><div class="name">${game.myName}</div><div class="time">${fmtTime(game.timeLeft[game.youAre])}</div></div>
      <div class="clock" id="clockOpp"><div class="name">${game.opponentName}</div><div class="time">${fmtTime(game.timeLeft[1 - game.youAre])}</div></div>
    </div>
  ` : `
    <div class="clocks">
      <div class="clock" id="clockMe"><div class="name">${game.myName}</div></div>
      <div class="clock" id="clockOpp"><div class="name">${game.opponentName}</div></div>
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
  const hasBank = game.mode !== 'football';
  const hasTurnTimer = game.mode === 'speed' || game.mode === 'football';

  const meEl = document.getElementById('clockMe');
  const oppEl = document.getElementById('clockOpp');
  if (meEl) {
    meEl.classList.toggle('active', game.turn === game.youAre);
    if (hasBank) {
      meEl.classList.toggle('low', game.timeLeft[game.youAre] < 15000);
      const t = meEl.querySelector('.time');
      if (t) t.textContent = fmtTime(game.timeLeft[game.youAre]);
    }
  }
  if (oppEl) {
    oppEl.classList.toggle('active', game.turn !== game.youAre);
    if (hasBank) {
      oppEl.classList.toggle('low', game.timeLeft[1 - game.youAre] < 15000);
      const t = oppEl.querySelector('.time');
      if (t) t.textContent = fmtTime(game.timeLeft[1 - game.youAre]);
    }
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

  const timeoutLabel = game.mode === 'football' || game.mode === 'speed'
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
        <div class="rules-panel" id="panel-hist"><div class="rules-body feed" style="max-height:220px">${historyHtml}</div></div>
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

socket.on('state_update', (data) => {
  if (!game) return;

  game.turn = data.turn;
  game.timeLeft = data.timeLeft;
  game.turnTimer = data.turnTimer;
  game.usedWordsCount = data.usedWordsCount;
  if (game.mode === 'football' && data.requiredLetter !== undefined) {
    game.requiredLetter = data.requiredLetter;
  }

  // Když se tah právě přehodil (nové slovo), aktuální turnTimer je zároveň
  // nový "strop" pro procentuální výpočet lišty (u Fotbalu se strop zmenšuje).
  const turnJustChanged = !!data.lastWord;
  if (turnJustChanged && (game.mode === 'speed' || game.mode === 'football') && data.turnTimer != null) {
    game.turnTimeCap = data.turnTimer;
  }

  const active = data.turn;
  if ((game.mode === 'speed' || game.mode === 'football') && data.turnTimer != null) {
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
    if (wordInputEl && game.mode === 'football') wordInputEl.placeholder = currentPlaceholder();

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
  game.requiredLetter = data.requiredLetter || null;
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


