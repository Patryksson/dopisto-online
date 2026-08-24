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

function patternInstruction(pattern) {
  if (pattern.type === 'infix2') return `Slovo musí obsahovat "${pattern.value}" (kdekoliv).`;
  return `Slovo musí začínat na "${pattern.value}".`;
}

function patternInputPlaceholder(pattern) {
  if (pattern.type === 'infix2') return `Napiš slovo obsahující '${pattern.value}'…`;
  return `Napiš slovo na '${pattern.value}'…`;
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

const MODE_LABEL = { 2: '2 písmena', speed: 'Blitz', 3: '3 písmena', middle: 'Uprostřed' };
const MODE_ICON = { 2: 'Aa', speed: '⚡', 3: 'Abc', middle: '·A·' };
const MODE_ORDER = [2, 'speed', 3, 'middle'];

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

function playClick() {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 700;
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

// ==== Texty pravidel ====
const HOW_IT_WORKS_HTML = `
  Zadej přezdívku, vyber režim a klikni na „Najít soupeře" — spáruje tě to s
  někým dalším online, nebo si s kamarádem založ soukromou hru přes kód.
  Na začátku dostanete zadání — jedno nebo dvě písmena, na která (nebo se
  kterými kdekoliv uvnitř) musí slovo sedět. Střídáte se v psaní platných
  slov, dokud jednomu z vás nedojde čas.
`;

const RULES_HTML = `
  <b>Režimy:</b>
  <ul style="margin:6px 0; padding-left:18px">
    <li><b>2 písmena</b> — slovo musí <b>začínat</b> danou dvojicí (90 s na hráče).</li>
    <li><b>Blitz</b> — jen 1 písmeno na začátku. Kromě 60 s hlavního času
      má každý hráč na <b>každý jednotlivý tah jen 10 sekund</b> — nestihneš-li
      odpovědět včas, prohráváš okamžitě, i kdyby ti ještě zbýval hlavní čas.</li>
    <li><b>3 písmena</b> — slovo musí <b>začínat</b> danou trojicí (90 s na hráče).</li>
    <li><b>Uprostřed</b> — daná dvojice písmen se ve slově může nacházet
      <b>kdekoliv</b> — na začátku, uprostřed i na konci (90 s na hráče).</li>
  </ul>
  Každý režim má <b>vlastní, oddělený žebříček ELO</b>.<br><br>
  <b>Čas:</b> hlavní čas ubíhá jako u šachových hodin — jen tomu, kdo je na
  tahu. Dojde-li hráči čas, prohrává.<br><br>
  <b>Tresty:</b>
  <ul style="margin:6px 0; padding-left:18px">
    <li>Slovo, které <b>není ve slovníku</b> → −1 s</li>
    <li>Slovo, které <b>už bylo v tomto kole použito</b> → −3 s</li>
    <li>V režimu <b>Uprostřed</b>: slovo, které <b>neobsahuje dané dvojpísmí</b> → −3 s</li>
  </ul>
  Trest se odečítá z hlavního času hráče na tahu, tah zůstává na něm dál.<br><br>
  <b>Vzdání kola:</b> hráč na tahu může kolo kdykoliv vzdát.<br><br>
  <b>ELO:</b> po kole se hodnocení obou hráčů přepočítá standardním ELO
  vzorcem (K=32). Bez účtů — ELO se páruje jen s přezdívkou v tomto prohlížeči.
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
        ${MODE_ORDER.map(m => `
          <button class="menu-item ${selectedMode === m ? 'active' : ''}" data-mode="${m}">
            <span class="ic${m === 'speed' ? ' ic-lg' : ''}">${MODE_ICON[m]}</span><span>${MODE_LABEL[m]}</span>
          </button>`).join('')}
      </div>

      <input id="nickname" placeholder="Tvoje přezdívka" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="20" value="${nickname.replace(/"/g, '')}" />
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
        <button type="button" class="rules-summary" data-panel="p3"><span class="ic">★</span><span>Žebříček — ${MODE_LABEL[selectedMode]}</span><span class="chevron">›</span></button>
        <div class="rules-panel" id="panel-p3"><div class="rules-body" id="leaderboardBody">Načítám…</div></div>
      </div>

      <div class="footer-tag">Dopišto · v1.0</div>
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
    </div>
  `;

  document.getElementById('soundBtn').onclick = toggleSound;
  document.querySelectorAll('.mode-select button').forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.mode;
      selectedMode = (m === '2' || m === '3') ? Number(m) : m;
      renderMenu();
    };
  });

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

  socket.emit('get_leaderboard', { mode: selectedMode }, (list) => {
    const body = document.getElementById('leaderboardBody');
    if (!body) return; // uživatel mezitím přešel jinam
    body.innerHTML = list && list.length ? `
      <table style="width:100%; border-collapse:collapse; margin-top:6px">
        <thead><tr><th style="text-align:left">#</th><th style="text-align:left">Hráč</th><th style="text-align:left">ELO</th><th style="text-align:left">V/P</th></tr></thead>
        <tbody>
          ${list.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.elo}</td><td>${p.wins}/${p.losses}</td></tr>`).join('')}
        </tbody>
      </table>` : 'Zatím nikdo v tomto režimu nehrál.';
    const panelBtn = document.querySelector('.rules-summary[data-panel="p3"]');
    const panel = document.getElementById('panel-p3');
    if (panelBtn && panelBtn.classList.contains('open')) panel.style.maxHeight = panel.scrollHeight + 'px';
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
    turnTimer: data.mode === 'speed' ? 10000 : null,
    usedWordsCount: 0,
    lastWholeSecond: [999, 999],
    lastHalfStep: [999, 999],
    lastHalfStepTurn: 999,
  };

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
      <div class="countdown-label">Zadání kola</div>
      ${patternTilesHtml(data.pattern, 'reveal')}
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
const REACTIONS = ['👍', '😂', '🔥', '🤔', '💀', '⏳'];
let lastReactionSentAt = 0;

function renderGame() {
  const names = [null, null];
  names[game.youAre] = game.myName;
  names[1 - game.youAre] = game.opponentName;
  game.names = names;

  const turnTimerHtml = game.mode === 'speed' ? `
    <div class="turn-timer-wrap">
      <div class="turn-timer-label"><span>Čas na tah</span><span id="turnTimerNum">${(game.turnTimer / 1000).toFixed(1)} s</span></div>
      <div class="turn-timer-bar-bg"><div class="turn-timer-bar" id="turnBar" style="width:100%"></div></div>
    </div>
  ` : '';

  app.innerHTML = `
    <div class="card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundEnabled ? '♪' : '×'}</button>
      ${patternTilesHtml(game.pattern)}
      <div class="used-count" id="usedCount">${patternInstruction(game.pattern)} · Použitá slova: 0</div>
      <div class="clocks">
        <div class="clock" id="clock0"><div class="name">${names[0]}</div><div class="time">${fmtTime(game.timeLeft[0])}</div></div>
        <div class="clock" id="clock1"><div class="name">${names[1]}</div><div class="time">${fmtTime(game.timeLeft[1])}</div></div>
      </div>
      <div class="error" id="gameErr"></div>
      ${turnTimerHtml}
      <div class="turn-banner">Na tahu: <span id="turnName">${names[game.turn]}</span></div>
      <div class="word-input">
        <input id="wordInput" placeholder="${patternInputPlaceholder(game.pattern)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
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
  for (let i = 0; i < 2; i++) {
    const el = document.getElementById(`clock${i}`);
    if (!el) continue;
    el.classList.toggle('active', game.turn === i);
    el.classList.toggle('low', game.timeLeft[i] < 15000);
    el.querySelector('.time').textContent = fmtTime(game.timeLeft[i]);
  }
  if (game.mode === 'speed') {
    const bar = document.getElementById('turnBar');
    const label = document.getElementById('turnTimerNum');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (game.turnTimer / 10000) * 100));
      bar.style.width = pct + '%';
      bar.classList.toggle('urgent', game.turnTimer < 5000);
    }
    if (label) label.textContent = (Math.max(0, game.turnTimer) / 1000).toFixed(1) + ' s';
  }
}

function flashPenalty(playerIdx) {
  const clockEl = document.getElementById(`clock${playerIdx}`);
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
  const clockEl = document.getElementById(`clock${playerIdx}`);
  if (!clockEl) return;
  const bubble = document.createElement('div');
  bubble.className = 'reaction-bubble';
  bubble.textContent = emoji;
  clockEl.appendChild(bubble);
  setTimeout(() => bubble.remove(), 1400);
}

// ==== Výsledková obrazovka ====
function renderResult(data) {
  const my = data.results[game.youAre];
  const opp = data.results[1 - game.youAre];
  const iWon = data.winnerIdx === game.youAre;

  playDefeat();
  setTimeout(playVictory, 650);

  let reasonText;
  if (iWon) {
    if (data.reason === 'timeout') reasonText = `${opp.name} došel hlavní čas.`;
    else if (data.reason === 'turn_timeout') reasonText = `${opp.name} nestihl(a) odpovědět do 10 s.`;
    else if (data.reason === 'opponent_left') reasonText = `${opp.name} odešel(la) ze hry.`;
    else reasonText = `${opp.name} se vzdal(a).`;
  } else {
    if (data.reason === 'timeout') reasonText = 'Došel ti hlavní čas.';
    else if (data.reason === 'turn_timeout') reasonText = 'Nestihl(a) jsi odpovědět do 10 s.';
    else reasonText = 'Vzdal(a) jsi kolo.';
  }

  const history = data.history || [];
  const historyHtml = history.length ? history.map(h => {
    const name = game.names[h.playerIdx];
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
  if (!game || data.roomId && data.roomId !== game.roomId) { /* ignorováno mimo hru */ }
  if (!game) return;

  game.turn = data.turn;
  game.timeLeft = data.timeLeft;
  game.turnTimer = data.turnTimer;
  game.usedWordsCount = data.usedWordsCount;

  const active = data.turn;
  if (game.mode === 'speed' && data.turnTimer != null) {
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
    const div = document.createElement('div');
    div.className = 'p' + data.lastPlayerIdx;
    div.textContent = `${game.names[data.lastPlayerIdx]}: ${data.lastWord}`;
    feed.prepend(div);
    playSwoosh();
    if (gameErr) gameErr.textContent = '';
    const usedCount = document.getElementById('usedCount');
    if (usedCount) usedCount.textContent = `${patternInstruction(game.pattern)} · Použitá slova: ${data.usedWordsCount}`;
    const turnName = document.getElementById('turnName');
    if (turnName) turnName.textContent = game.names[game.turn];
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
  game.usedWordsCount = data.usedWordsCount;
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
