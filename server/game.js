const crypto = require('crypto');
const { isValidWord, generatePattern, matchesPattern, patternInstruction } = require('./dictionary');
const store = require('./store');

const MODES = [2, 'football', 'middle', 'speed'];
const BANK_TIME_BY_MODE = { 2: 90000, middle: 90000, speed: 60000 };
const TURN_TIME_MS = 10000; // "speed" (1 písmeno) — čas na jeden tah
const PENALTY_NOT_IN_DICT_MS = 1000;
const PENALTY_ALREADY_USED_MS = 3000;
const PENALTY_WRONG_PATTERN_MS = 3000;
// Bonus k hlavnímu času za každé správně odeslané slovo (režimy s "bankou"
// času — Slovní fotbal bonus nemá, tam je jen zkracující se čas na tah).
const BONUS_MS_BY_MODE = { 2: 3000, middle: 3000, speed: 1000 };
// Musí přibližně odpovídat délce odhalovací/odpočtové animace na klientu.
const REVEAL_COUNTDOWN_MS = 3500;

// Slovní fotbal — jen čas na tah, žádná banka.
const FOOTBALL_START_TURN_MS = 30000;
const FOOTBALL_DECREMENT_MS = 1000;
// Vlastní bezpečnostní minimum, ať se čas na tah nedostane na 0/záporné
// hodnoty při hodně dlouhém kole (v zadání není explicitně řešeno).
const FOOTBALL_MIN_TURN_MS = 3000;

// Kolik času má hráč na znovupřipojení, než automaticky prohrává.
const RECONNECT_GRACE_MS = 15000;

// Emoji reakce — jen z pevného seznamu, ať nejde poslat libovolný text.
const ALLOWED_REACTIONS = ['👍', '😂', '🔥', '🤔', '💀', '⏳'];
const REACTION_COOLDOWN_MS = 1000;

const waitingQueue = { 2: [], football: [], middle: [], speed: [] };
const lobbies = new Map(); // code -> { socket, nickname, elo, mode, timeout }
const rooms = new Map(); // roomId -> room state

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

  socket.on('find_match', ({ nickname, mode }) => {
    if (!nickname || !MODES.includes(mode)) return;
    socket.data.nickname = String(nickname).slice(0, 20);
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
    if (!nickname || !MODES.includes(mode)) return;
    socket.data.nickname = String(nickname).slice(0, 20);
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
    if (!nickname || !code) return;
    const cleanCode = String(code).trim().toUpperCase();
    const entry = lobbies.get(cleanCode);
    if (!entry) {
      socket.emit('lobby_error', { message: 'Kód nenalezen nebo vypršel.' });
      return;
    }
    if (entry.socket.id === socket.id) {
      socket.emit('lobby_error', { message: 'Nemůžeš se připojit sám k sobě.' });
      return;
    }
    socket.data.nickname = String(nickname).slice(0, 20);
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

    const clean = (word || '').trim().toLowerCase();
    if (!clean) return;

    if (room.mode === 'football') {
      submitFootballWord(io, room, idx, clean);
      return;
    }

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

    const bank = BANK_TIME_BY_MODE[room.mode];
    const before = room.timeLeft[idx];
    room.timeLeft[idx] = Math.min(bank, before + BONUS_MS_BY_MODE[room.mode]);
    const bonusMs = room.timeLeft[idx] - before;

    room.turn = 1 - idx;
    if (room.mode === 'speed') room.turnTimer = TURN_TIME_MS;
    broadcastState(io, room, { lastWord: clean, lastPlayerIdx: idx, bonusMs, bonusPlayerIdx: idx });
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
    if (typeof cb === 'function') cb(store.leaderboard(mode, 100));
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
      requiredLetter: currentRequiredLetter(room),
    });
  });

  socket.on('disconnect', () => {
    removeFromQueues(socket);
    removeLobbyFor(socket);

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

function currentRequiredLetter(room) {
  if (room.mode !== 'football' || room.history.length === 0) return null;
  return room.history[room.history.length - 1].word.slice(-1);
}

function submitFootballWord(io, room, idx, clean) {
  const socket = room.players[idx].socket;
  const requiredLetter = currentRequiredLetter(room);

  if (requiredLetter && !clean.startsWith(requiredLetter)) {
    socket.emit('word_rejected', { reason: `Slovo musí začínat na "${requiredLetter}".` });
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
  room.turn = 1 - idx;
  room.turnTimeMs = Math.max(FOOTBALL_MIN_TURN_MS, room.turnTimeMs - FOOTBALL_DECREMENT_MS);
  room.turnTimer = room.turnTimeMs;

  broadcastState(io, room, {
    lastWord: clean,
    lastPlayerIdx: idx,
    requiredLetter: clean.slice(-1),
  });
}

function startMatch(io, a, b, mode) {
  const roomId = 'room_' + Math.random().toString(36).slice(2, 10);
  const turnStart = Math.random() < 0.5 ? 0 : 1;

  let pattern, timeLeft, turnTimer, turnTimeMs;
  if (mode === 'football') {
    pattern = { type: 'football' };
    timeLeft = [0, 0];
    turnTimeMs = FOOTBALL_START_TURN_MS;
    turnTimer = FOOTBALL_START_TURN_MS;
  } else {
    pattern = generatePattern(mode);
    const bank = BANK_TIME_BY_MODE[mode];
    timeLeft = [bank, bank];
    turnTimer = mode === 'speed' ? TURN_TIME_MS : null;
    turnTimeMs = null;
  }

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
    turnTimeMs,
    finished: false,
    lastTick: null,
    intervalId: null,
    pendingDisconnect: null,
  };
  rooms.set(roomId, room);

  a.socket.join(roomId);
  b.socket.join(roomId);

  const basePayload = {
    roomId, mode, pattern, turn: turnStart, timeLeft: room.timeLeft,
    turnTimer: room.turnTimer, countdownMs: REVEAL_COUNTDOWN_MS, requiredLetter: null,
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

  if (room.mode === 'football') {
    room.turnTimer -= elapsed;
    if (room.turnTimer <= 0) {
      room.turnTimer = 0;
      broadcastState(io, room);
      endRoom(io, room, 1 - active, 'turn_timeout');
      return;
    }
    broadcastState(io, room);
    return;
  }

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
  const hasTurnTimer = room.mode === 'speed' || room.mode === 'football';
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

  if (room.mode === 'football') {
    room.turnTimer = Math.max(0, room.turnTimer - amountMs);
    broadcastState(io, room);
    if (room.turnTimer <= 0) endRoom(io, room, 1 - idx, 'turn_timeout');
    return;
  }

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
}

module.exports = { setupGame, startMatchmakingLoop };
