const crypto = require('crypto');
const { isValidWord, generatePattern, matchesPattern, patternInstruction, acceptableStartLetters, matchesRequiredLetter, dailyPattern } = require('./dictionary');
const store = require('./store');
const { sanitizeNickname, cleanWord, attachSocketGuard } = require('./security');
const { dailyBonusForDate, checkDailyBonus, publicBonus, DAILY_BONUS_EXTRA_MS } = require('./dailyBonus');

const MODES = [2, 'middle', 'speed'];
const BANK_TIME_BY_MODE = { 2: 90000, middle: 90000, speed: 60000 };
const TURN_TIME_MS = 10000; // čas na jeden tah — režim "speed"
const PENALTY_NOT_IN_DICT_MS = 1000;
const PENALTY_ALREADY_USED_MS = 3000;
const PENALTY_WRONG_PATTERN_MS = 3000;
// Bonus k hlavnímu času za každé správně odeslané slovo.
const BONUS_MS_BY_MODE = { 2: 3000, middle: 3000, speed: 1000 };
// Musí přibližně odpovídat délce odhalovací/odpočtové animace na klientu.
const REVEAL_COUNTDOWN_MS = 3500;

// Denní výzva — sólo, bez soupeře. Stejný bonus jako režim "2 písmena".
const DAILY_TIME_MS = 180000;
const DAILY_BONUS_MS = 3000;
const dailySessions = new Map(); // socket.id -> session

// Kolik času má hráč na znovupřipojení, než automaticky prohrává.
const RECONNECT_GRACE_MS = 15000;

// Emoji reakce — jen z pevného seznamu, ať nejde poslat libovolný text.
const ALLOWED_REACTIONS = ['👍', '😂', '🔥', '🤔', '💀', '⏳'];
const REACTION_COOLDOWN_MS = 1000;

const waitingQueue = { 2: [], middle: [], speed: [] };
const lobbies = new Map(); // code -> { socket, nickname, elo, mode, timeout }
const rooms = new Map(); // roomId -> room state

// ==== Odveta ====
// Po konci zápasu se na 10 minut drží záznam o dvojici hráčů. Odveta jde
// poslat, jen dokud jsou OBA hráči na výsledkové obrazovce (nevrátili se do
// menu a neodpojili se). Soupeř má REMATCH_TTL_MS na přijetí, jinak návrh vyprší.
const REMATCH_TTL_MS = 12000;
const rematches = new Map(); // původní roomId -> { mode, players, left, pending, cleanup }

function rematchPresent(r, idx) {
  return !r.left[idx] && r.players[idx].socket.connected;
}
function rematchClearPending(r) {
  if (r.pending) { clearTimeout(r.pending.timeout); r.pending = null; }
}
function rematchPlayerLeft(r, id, idx) {
  if (r.left[idx]) return;
  r.left[idx] = true;
  const hadPending = !!r.pending;
  rematchClearPending(r);
  const other = r.players[1 - idx];
  if (rematchPresent(r, 1 - idx)) {
    other.socket.emit('rematch_unavailable', {
      reason: `${r.players[idx].nickname} opustil(a) obrazovku výsledku — odveta už není možná.`,
      hadPending,
    });
  }
  if (r.left[0] && r.left[1]) { clearTimeout(r.cleanup); rematches.delete(id); }
}

function removeFromQueues(socket) {
  for (const mode of MODES) {
    const q = waitingQueue[mode];
    const idx = q.findIndex(w => w.socket.id === socket.id);
    if (idx !== -1) q.splice(idx, 1);
  }
}

function removeLobbyFor(socket) {
  if (socket.data.lobbyCode) {
    const entry = lobbies.get(socket.data.lobbyCode);
    if (entry && entry.socket.id === socket.id) {
      clearTimeout(entry.timeout);
      lobbies.delete(socket.data.lobbyCode);
    }
    socket.data.lobbyCode = null;
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bez matoucích znaků (0/O, 1/I)
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (lobbies.has(code));
  return code;
}

// ==== ELO matchmaking fronta ====
function tryMatchQueue(io, mode) {
  const q = waitingQueue[mode];
  const now = Date.now();
  for (let i = 0; i < q.length; i++) {
    for (let j = i + 1; j < q.length; j++) {
      const a = q[i], b = q[j];
      const waited = now - Math.min(a.joinedAt, b.joinedAt);
      const tolerance = Math.min(1000, 100 + 15 * (waited / 1000));
      if (Math.abs(a.elo - b.elo) <= tolerance) {
        q.splice(j, 1);
        q.splice(i, 1);
        startMatch(io, a, b, mode);
        return true;
      }
    }
  }
  return false;
}

function startMatchmakingLoop(io) {
  setInterval(() => {
    for (const mode of MODES) {
      while (tryMatchQueue(io, mode)) { /* pokracuj */ }
    }
  }, 1000);
}

function setupGame(io, socket) {
  socket.data.nickname = null;
  socket.data.lobbyCode = null;
  attachSocketGuard(socket);

  // Vyčistí přezdívku; při zamítnutí pošle klientovi důvod a vrátí null.
  function acceptNickname(raw) {
    const r = sanitizeNickname(raw);
    if (!r.ok) { socket.emit('nickname_rejected', { message: r.message }); return null; }
    return r.nick;
  }

  socket.on('find_match', ({ nickname, mode }) => {
    if (!MODES.includes(mode)) return;
    const nick = acceptNickname(nickname);
    if (!nick) return;
    socket.data.nickname = nick;
    removeFromQueues(socket);

    const elo = store.getProfile(mode, socket.data.nickname).elo;
    waitingQueue[mode].push({ socket, nickname: socket.data.nickname, elo, joinedAt: Date.now() });
    socket.emit('waiting_for_opponent');
    tryMatchQueue(io, mode);
  });

  socket.on('cancel_find_match', () => {
    removeFromQueues(socket);
  });

  socket.on('create_lobby', ({ nickname, mode }) => {
    if (!MODES.includes(mode)) return;
    const nick = acceptNickname(nickname);
    if (!nick) return;
    socket.data.nickname = nick;
    removeLobbyFor(socket);

    const elo = store.getProfile(mode, socket.data.nickname).elo;
    const code = generateCode();
    const timeout = setTimeout(() => {
      if (lobbies.has(code)) {
        lobbies.delete(code);
        socket.emit('lobby_expired');
      }
    }, 10 * 60 * 1000);
    lobbies.set(code, { socket, nickname: socket.data.nickname, elo, mode, timeout });
    socket.data.lobbyCode = code;
    socket.emit('lobby_created', { code });
  });

  socket.on('cancel_lobby', () => removeLobbyFor(socket));

  socket.on('join_lobby', ({ nickname, code }) => {
    if (!code) return;
    const nick = acceptNickname(nickname);
    if (!nick) return;
    const cleanCode = String(code).trim().toUpperCase().slice(0, 10);
    const entry = lobbies.get(cleanCode);
    if (!entry) {
      socket.emit('lobby_error', { message: 'Kód nenalezen nebo vypršel.' });
      return;
    }
    if (entry.socket.id === socket.id) {
      socket.emit('lobby_error', { message: 'Nemůžeš se připojit sám k sobě.' });
      return;
    }
    socket.data.nickname = nick;
    const joinerElo = store.getProfile(entry.mode, socket.data.nickname).elo;
    clearTimeout(entry.timeout);
    lobbies.delete(cleanCode);
    startMatch(
      io,
      { socket: entry.socket, nickname: entry.nickname, elo: entry.elo },
      { socket, nickname: socket.data.nickname, elo: joinerElo },
      entry.mode
    );
  });

  socket.on('submit_word', ({ roomId, word }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const idx = room.players.findIndex(p => p.socket.id === socket.id);
    if (idx === -1 || room.turn !== idx) return;

    const clean = cleanWord(word);
    if (!clean) return;

    if (!matchesPattern(clean, room.pattern)) {
      if (room.pattern.type === 'infix2') {
        applyPenalty(io, room, idx, PENALTY_WRONG_PATTERN_MS, 'Slovo neobsahuje daná písmena!');
      } else {
        socket.emit('word_rejected', { reason: patternInstruction(room.pattern) });
      }
      return;
    }

    if (room.usedWords.has(clean)) {
      applyPenalty(io, room, idx, PENALTY_ALREADY_USED_MS, 'Slovo už bylo použito!');
      return;
    }
    if (!isValidWord(clean)) {
      applyPenalty(io, room, idx, PENALTY_NOT_IN_DICT_MS, 'Slovo není ve slovníku!');
      return;
    }

    room.usedWords.add(clean);
    room.history.push({ word: clean, playerIdx: idx });

    // Bonus k hlavnímu času za správně odeslané slovo — nesmí přesáhnout
    // startovní hodnotu banky daného režimu.
    const bank = BANK_TIME_BY_MODE[room.mode];
    const before = room.timeLeft[idx];
    const dailyBonusHit = checkDailyBonus(room.dailyBonus, { word: clean, myTimeLeft: before, opponentTimeLeft: room.timeLeft[1 - idx] });
    // Běžný bonus se ořezává na startovní banku, bonus dne ji smí přesáhnout.
    room.timeLeft[idx] = Math.max(before, Math.min(bank, before + BONUS_MS_BY_MODE[room.mode])) + (dailyBonusHit ? DAILY_BONUS_EXTRA_MS : 0);
    const bonusMs = room.timeLeft[idx] - before;

    room.turn = 1 - idx;
    if (room.mode === 'speed') room.turnTimer = TURN_TIME_MS;

    const extra = { lastWord: clean, lastPlayerIdx: idx, bonusMs, bonusPlayerIdx: idx, dailyBonusHit };
    broadcastState(io, room, extra);
  });

  socket.on('give_up', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const idx = room.players.findIndex(p => p.socket.id === socket.id);
    if (idx === -1) return;
    endRoom(io, room, 1 - idx, 'giveup');
  });

  socket.on('send_reaction', ({ roomId, emoji }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    if (!ALLOWED_REACTIONS.includes(emoji)) return;
    const idx = room.players.findIndex(p => p.socket.id === socket.id);
    if (idx === -1) return;

    const now = Date.now();
    if (now - room.players[idx].lastReactionAt < REACTION_COOLDOWN_MS) return;
    room.players[idx].lastReactionAt = now;

    io.to(room.id).emit('reaction', { playerIdx: idx, emoji });
  });

  socket.on('get_leaderboard', ({ mode }, cb) => {
    if (!MODES.includes(mode)) return;
    if (typeof cb === 'function') cb(store.leaderboard(mode, 100));
  });

  // ==== Denní výzva — sólo, bez soupeře, jednou denně stejné zadání pro
  // úplně všechny (viz dailyPattern v dictionary.js). ====
  socket.on('get_daily_leaderboard', (cb) => { if (typeof cb === 'function') cb(store.dailyLeaderboard(20)); });
  // Hlášení chyb, chybějících slov, nápadů a nahlášení hráčů.
  socket.on('submit_report', (payload, cb) => {
    const reply = (res) => { if (typeof cb === 'function') cb(res); };
    if (!payload || typeof payload !== 'object') return reply({ ok: false });
    const types = ['bug', 'word', 'player', 'idea'];
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 1000) : '';
    if (text.length < 5) return reply({ ok: false, message: 'Napiš prosím aspoň pár slov.' });
    const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
    try {
      store.addReport({
        type: types.includes(payload.type) ? payload.type : 'bug',
        text: text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''),
        contact: clean(payload.contact, 80),
        nickname: clean(payload.nickname, 20),
      });
      reply({ ok: true });
    } catch (e) {
      console.error('report error', e);
      reply({ ok: false, message: 'Hlášení se nepodařilo uložit.' });
    }
  });

  socket.on('get_daily_info', (cb) => {
    if (typeof cb === 'function') cb({ bonus: publicBonus(dailyBonusForDate()), pattern: dailyPattern() });
  });
  socket.on('get_daily_bonus', (cb) => { if (typeof cb === 'function') cb(publicBonus(dailyBonusForDate())); });

  socket.on('start_daily_challenge', (payload) => {
    const r = sanitizeNickname(payload && payload.nickname);
    if (!r.ok) { socket.emit('nickname_rejected', { message: r.message }); return; }
    socket.data.dailyNick = r.nick;
    const existing = dailySessions.get(socket.id);
    if (existing) {
      clearInterval(existing.intervalId);
      dailySessions.delete(socket.id);
    }

    const pattern = dailyPattern();
    const session = {
      pattern,
      dailyBonus: dailyBonusForDate(),
      timeLeft: DAILY_TIME_MS,
      usedWords: new Set(),
      history: [],
      finished: false,
      lastTick: null,
      intervalId: null,
    };
    dailySessions.set(socket.id, session);

    socket.emit('daily_started', { pattern, dailyBonus: publicBonus(session.dailyBonus), timeLeft: session.timeLeft, countdownMs: REVEAL_COUNTDOWN_MS });

    setTimeout(() => {
      const s = dailySessions.get(socket.id);
      if (!s || s.finished) return;
      s.lastTick = Date.now();
      s.intervalId = setInterval(() => tickDaily(socket), 200);
    }, REVEAL_COUNTDOWN_MS);
  });

  socket.on('end_daily_challenge', () => {
    const session = dailySessions.get(socket.id);
    if (!session || session.finished) return;
    finishDaily(socket, session);
  });

  socket.on('submit_daily_word', ({ word }) => {
    const session = dailySessions.get(socket.id);
    if (!session || session.finished) return;

    const clean = cleanWord(word);
    if (!clean) return;

    if (!matchesPattern(clean, session.pattern)) {
      socket.emit('daily_word_rejected', { reason: patternInstruction(session.pattern) });
      return;
    }
    if (session.usedWords.has(clean)) {
      applyDailyPenalty(socket, session, PENALTY_ALREADY_USED_MS, 'Slovo už bylo použito!');
      return;
    }
    if (!isValidWord(clean)) {
      applyDailyPenalty(socket, session, PENALTY_NOT_IN_DICT_MS, 'Slovo není ve slovníku!');
      return;
    }

    session.usedWords.add(clean);
    session.history.push(clean);

    const before = session.timeLeft;
    const dailyBonusHit = checkDailyBonus(session.dailyBonus, { word: clean, myTimeLeft: before, opponentTimeLeft: null });
    session.timeLeft = Math.max(before, Math.min(DAILY_TIME_MS, before + DAILY_BONUS_MS)) + (dailyBonusHit ? DAILY_BONUS_EXTRA_MS : 0);
    const bonusMs = session.timeLeft - before;

    socket.emit('daily_state_update', {
      timeLeft: Math.round(session.timeLeft),
      usedWordsCount: session.usedWords.size,
      lastWord: clean,
      bonusMs,
      dailyBonusHit,
    });
  });

  socket.on('rejoin_room', ({ roomId, youAre, token }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) {
      socket.emit('rejoin_failed');
      return;
    }
    const slot = room.players[youAre];
    if (!slot || slot.token !== token) {
      socket.emit('rejoin_failed');
      return;
    }

    slot.socket = socket;
    slot.connected = true;
    socket.join(roomId);

    if (room.pendingDisconnect && room.pendingDisconnect.idx === youAre) {
      clearTimeout(room.pendingDisconnect.timeout);
      room.pendingDisconnect = null;
      const opponent = room.players[1 - youAre];
      if (opponent.connected) opponent.socket.emit('opponent_reconnected');
      resumeTicking(io, room);
    }

    socket.emit('rejoin_success', {
      mode: room.mode,
      pattern: room.pattern,
      opponent: room.players[1 - youAre].nickname,
      turn: room.turn,
      timeLeft: room.timeLeft,
      turnTimer: room.turnTimer,
      usedWordsCount: room.usedWords.size,
      dailyBonus: publicBonus(room.dailyBonus),
    });
  });

  // ---- Odveta ----
  function findRematch(roomId) {
    const r = typeof roomId === 'string' ? rematches.get(roomId) : null;
    if (!r) return {};
    const idx = r.players.findIndex(p => p.socket.id === socket.id);
    return idx === -1 ? {} : { r, idx };
  }

  socket.on('rematch_request', ({ roomId }) => {
    const { r, idx } = findRematch(roomId);
    if (!r) { socket.emit('rematch_unavailable', { reason: 'Odveta už není možná.' }); return; }
    if (r.left[idx]) return;
    if (!rematchPresent(r, 1 - idx)) {
      socket.emit('rematch_unavailable', { reason: `${r.players[1 - idx].nickname} už opustil(a) obrazovku výsledku — odveta není možná.` });
      return;
    }
    if (r.pending) return;
    r.pending = {
      from: idx,
      timeout: setTimeout(() => {
        r.pending = null;
        for (let i = 0; i < 2; i++) if (rematchPresent(r, i)) r.players[i].socket.emit('rematch_expired');
      }, REMATCH_TTL_MS),
    };
    socket.emit('rematch_pending', { ttlMs: REMATCH_TTL_MS });
    r.players[1 - idx].socket.emit('rematch_offered', { from: r.players[idx].nickname, ttlMs: REMATCH_TTL_MS });
  });

  socket.on('rematch_accept', ({ roomId }) => {
    const { r, idx } = findRematch(roomId);
    if (!r || !r.pending || r.pending.from === idx) return;
    const from = r.pending.from;
    if (!rematchPresent(r, from) || !rematchPresent(r, idx)) return;
    rematchClearPending(r);
    clearTimeout(r.cleanup);
    rematches.delete(roomId);
    const a = r.players[from], b = r.players[idx];
    removeFromQueues(a.socket); removeFromQueues(b.socket);
    startMatch(
      io,
      { socket: a.socket, nickname: a.nickname, elo: store.getProfile(r.mode, a.nickname).elo },
      { socket: b.socket, nickname: b.nickname, elo: store.getProfile(r.mode, b.nickname).elo },
      r.mode
    );
  });

  socket.on('rematch_decline', ({ roomId }) => {
    const { r, idx } = findRematch(roomId);
    if (!r || !r.pending || r.pending.from === idx) return;
    const from = r.pending.from;
    rematchClearPending(r);
    if (rematchPresent(r, from)) r.players[from].socket.emit('rematch_declined');
  });

  socket.on('result_left', ({ roomId }) => {
    const { r, idx } = findRematch(roomId);
    if (r) rematchPlayerLeft(r, roomId, idx);
  });

  socket.on('disconnect', () => {
    for (const [id, r] of rematches) {
      const idx = r.players.findIndex(p => p.socket.id === socket.id);
      if (idx !== -1) rematchPlayerLeft(r, id, idx);
    }
    removeFromQueues(socket);
    removeLobbyFor(socket);

    const daily = dailySessions.get(socket.id);
    if (daily) {
      clearInterval(daily.intervalId);
      dailySessions.delete(socket.id);
    }

    for (const room of rooms.values()) {
      if (room.finished) continue;
      const idx = room.players.findIndex(p => p.socket.id === socket.id);
      if (idx === -1) continue;

      const player = room.players[idx];
      player.connected = false;

      if (room.pendingDisconnect && room.pendingDisconnect.idx === 1 - idx) {
        clearTimeout(room.pendingDisconnect.timeout);
        room.pendingDisconnect = null;
        room.finished = true;
        clearInterval(room.intervalId);
        rooms.delete(room.id);
        continue;
      }

      clearInterval(room.intervalId);
      const opponent = room.players[1 - idx];
      if (opponent.connected) {
        opponent.socket.emit('opponent_disconnected', { graceMs: RECONNECT_GRACE_MS });
      }

      const timeout = setTimeout(() => {
        endRoom(io, room, 1 - idx, 'opponent_left');
      }, RECONNECT_GRACE_MS);
      room.pendingDisconnect = { idx, timeout };
    }
  });
}

function tickDaily(socket) {
  const session = dailySessions.get(socket.id);
  if (!session || session.finished) return;
  const now = Date.now();
  const elapsed = now - session.lastTick;
  session.lastTick = now;
  session.timeLeft -= elapsed;

  if (session.timeLeft <= 0) {
    session.timeLeft = 0;
    finishDaily(socket, session);
    return;
  }
  socket.emit('daily_state_update', { timeLeft: Math.round(session.timeLeft), usedWordsCount: session.usedWords.size });
}

function applyDailyPenalty(socket, session, amountMs, label) {
  socket.emit('daily_word_rejected', { reason: label, penaltyMs: amountMs });
  session.timeLeft = Math.max(0, session.timeLeft - amountMs);
  socket.emit('daily_state_update', { timeLeft: Math.round(session.timeLeft), usedWordsCount: session.usedWords.size });
  if (session.timeLeft <= 0) finishDaily(socket, session);
}

function finishDaily(socket, session) {
  session.finished = true;
  clearInterval(session.intervalId);
  if (socket.data.dailyNick) store.recordDaily(socket.data.dailyNick, session.usedWords.size);
  socket.emit('daily_over', { wordCount: session.usedWords.size, words: session.history, pattern: session.pattern });
  dailySessions.delete(socket.id);
}

function startMatch(io, a, b, mode) {
  const roomId = 'room_' + Math.random().toString(36).slice(2, 10);
  const turnStart = Math.random() < 0.5 ? 0 : 1;

  const pattern = generatePattern(mode);
  const bank = BANK_TIME_BY_MODE[mode];
  const timeLeft = [bank, bank];
  const turnTimer = mode === 'speed' ? TURN_TIME_MS : null;

  const room = {
    id: roomId,
    mode,
    pattern,
    players: [
      { socket: a.socket, nickname: a.nickname, elo: a.elo, connected: true, token: crypto.randomBytes(8).toString('hex'), lastReactionAt: 0 },
      { socket: b.socket, nickname: b.nickname, elo: b.elo, connected: true, token: crypto.randomBytes(8).toString('hex'), lastReactionAt: 0 },
    ],
    turn: turnStart,
    usedWords: new Set(),
    history: [],
    timeLeft,
    turnTimer,
    finished: false,
    lastTick: null,
    intervalId: null,
    pendingDisconnect: null,
    dailyBonus: dailyBonusForDate(),
  };
  rooms.set(roomId, room);

  a.socket.join(roomId);
  b.socket.join(roomId);

  const basePayload = {
    roomId, mode, pattern, turn: turnStart, timeLeft: room.timeLeft,
    turnTimer: room.turnTimer, countdownMs: REVEAL_COUNTDOWN_MS, requiredLetter: null,
    dailyBonus: publicBonus(room.dailyBonus),
  };
  a.socket.emit('match_found', {
    ...basePayload, opponent: b.nickname, youAre: 0,
    yourElo: a.elo, opponentElo: b.elo, token: room.players[0].token,
  });
  b.socket.emit('match_found', {
    ...basePayload, opponent: a.nickname, youAre: 1,
    yourElo: b.elo, opponentElo: a.elo, token: room.players[1].token,
  });

  setTimeout(() => beginRoom(io, room), REVEAL_COUNTDOWN_MS);
}

function beginRoom(io, room) {
  if (room.finished || room.pendingDisconnect) return;
  resumeTicking(io, room);
}

function resumeTicking(io, room) {
  clearInterval(room.intervalId);
  room.lastTick = Date.now();
  room.intervalId = setInterval(() => tickRoom(io, room), 200);
}

function tickRoom(io, room) {
  if (room.finished || room.pendingDisconnect) return;
  const now = Date.now();
  const elapsed = now - room.lastTick;
  room.lastTick = now;

  const active = room.turn;
  room.timeLeft[active] -= elapsed;

  if (room.mode === 'speed') {
    room.turnTimer -= elapsed;
    if (room.turnTimer <= 0) {
      room.turnTimer = 0;
      broadcastState(io, room);
      endRoom(io, room, 1 - active, 'turn_timeout');
      return;
    }
  }

  if (room.timeLeft[active] <= 0) {
    room.timeLeft[active] = 0;
    broadcastState(io, room);
    endRoom(io, room, 1 - active, 'timeout');
    return;
  }

  broadcastState(io, room);
}

function broadcastState(io, room, extra = {}) {
  const hasTurnTimer = room.mode === 'speed';
  io.to(room.id).emit('state_update', {
    turn: room.turn,
    timeLeft: room.timeLeft.map(t => Math.max(0, Math.round(t))),
    turnTimer: hasTurnTimer ? Math.max(0, Math.round(room.turnTimer)) : null,
    usedWordsCount: room.usedWords.size,
    ...extra,
  });
}

function applyPenalty(io, room, idx, amountMs, label) {
  room.players[idx].socket.emit('word_rejected', { reason: label, penaltyMs: amountMs });
  room.timeLeft[idx] = Math.max(0, room.timeLeft[idx] - amountMs);
  broadcastState(io, room);
  if (room.timeLeft[idx] <= 0) endRoom(io, room, 1 - idx, 'timeout');
}

function endRoom(io, room, winnerIdx, reason) {
  if (room.finished) return;
  room.finished = true;
  clearInterval(room.intervalId);
  if (room.pendingDisconnect) {
    clearTimeout(room.pendingDisconnect.timeout);
    room.pendingDisconnect = null;
  }

  const loserIdx = 1 - winnerIdx;
  const winner = room.players[winnerIdx];
  const loser = room.players[loserIdx];
  const { before, after } = store.recordResult(room.mode, winner.nickname, loser.nickname);

  const results = [null, null];
  results[winnerIdx] = { name: winner.nickname, before: before.winner, after: after.winner };
  results[loserIdx] = { name: loser.nickname, before: before.loser, after: after.loser };

  io.to(room.id).emit('game_over', { reason, winnerIdx, results, history: room.history });

  setTimeout(() => rooms.delete(room.id), 5000);

  const cleanup = setTimeout(() => rematches.delete(room.id), 10 * 60 * 1000);
  rematches.set(room.id, {
    mode: room.mode,
    players: room.players.map(p => ({ socket: p.socket, nickname: p.nickname })),
    left: [false, false],
    pending: null,
    cleanup,
  });
}

module.exports = { setupGame, startMatchmakingLoop };
