const { isValidWord, generatePattern, matchesPattern, patternInstruction } = require('./dictionary');
const store = require('./store');

const MODES = [2, 3, 'middle', 'speed'];
const BANK_TIME_BY_MODE = { 2: 90000, 3: 90000, middle: 90000, speed: 60000 };
const TURN_TIME_MS = 10000;
const PENALTY_NOT_IN_DICT_MS = 1000;
const PENALTY_ALREADY_USED_MS = 3000;
const PENALTY_WRONG_PATTERN_MS = 3000;
// Musí přibližně odpovídat délce odhalovací/odpočtové animace na klientu.
const REVEAL_COUNTDOWN_MS = 3500;

const waitingQueue = { 2: [], 3: [], middle: [], speed: [] };
const lobbies = new Map(); // code -> { socket, nickname, mode, timeout }
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

function setupGame(io, socket) {
  socket.data.nickname = null;
  socket.data.lobbyCode = null;

  socket.on('find_match', ({ nickname, mode }) => {
    if (!nickname || !MODES.includes(mode)) return;
    socket.data.nickname = String(nickname).slice(0, 20);
    removeFromQueues(socket);

    const q = waitingQueue[mode];
    if (q.length > 0) {
      const opponent = q.shift();
      startMatch(io, opponent, { socket, nickname: socket.data.nickname }, mode);
    } else {
      q.push({ socket, nickname: socket.data.nickname });
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('cancel_find_match', () => {
    removeFromQueues(socket);
  });

  socket.on('create_lobby', ({ nickname, mode }) => {
    if (!nickname || !MODES.includes(mode)) return;
    socket.data.nickname = String(nickname).slice(0, 20);
    removeLobbyFor(socket);

    const code = generateCode();
    const timeout = setTimeout(() => {
      if (lobbies.has(code)) {
        lobbies.delete(code);
        socket.emit('lobby_expired');
      }
    }, 10 * 60 * 1000);
    lobbies.set(code, { socket, nickname: socket.data.nickname, mode, timeout });
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
    clearTimeout(entry.timeout);
    lobbies.delete(cleanCode);
    startMatch(io, { socket: entry.socket, nickname: entry.nickname }, { socket, nickname: socket.data.nickname }, entry.mode);
  });

  socket.on('submit_word', ({ roomId, word }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const idx = room.players.findIndex(p => p.socket.id === socket.id);
    if (idx === -1 || room.turn !== idx) return;

    const clean = (word || '').trim().toLowerCase();
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
    room.turn = 1 - idx;
    if (room.mode === 'speed') room.turnTimer = TURN_TIME_MS;
    broadcastState(io, room, { lastWord: clean, lastPlayerIdx: idx });
  });

  socket.on('give_up', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const idx = room.players.findIndex(p => p.socket.id === socket.id);
    if (idx === -1) return;
    endRoom(io, room, 1 - idx, 'giveup');
  });

  socket.on('get_leaderboard', ({ mode }, cb) => {
    if (typeof cb === 'function') cb(store.leaderboard(mode));
  });

  socket.on('disconnect', () => {
    removeFromQueues(socket);
    removeLobbyFor(socket);
    for (const room of rooms.values()) {
      if (room.finished) continue;
      const idx = room.players.findIndex(p => p.socket.id === socket.id);
      if (idx !== -1) endRoom(io, room, 1 - idx, 'opponent_left');
    }
  });
}

function startMatch(io, a, b, mode) {
  const roomId = 'room_' + Math.random().toString(36).slice(2, 10);
  const pattern = generatePattern(mode);
  const bankTime = BANK_TIME_BY_MODE[mode];
  const turnStart = Math.random() < 0.5 ? 0 : 1;

  const room = {
    id: roomId,
    mode,
    pattern,
    players: [
      { socket: a.socket, nickname: a.nickname },
      { socket: b.socket, nickname: b.nickname },
    ],
    turn: turnStart,
    usedWords: new Set(),
    timeLeft: [bankTime, bankTime],
    turnTimer: mode === 'speed' ? TURN_TIME_MS : null,
    finished: false,
    lastTick: null,
    intervalId: null,
  };
  rooms.set(roomId, room);

  a.socket.join(roomId);
  b.socket.join(roomId);

  const basePayload = { roomId, mode, pattern, turn: turnStart, timeLeft: room.timeLeft, countdownMs: REVEAL_COUNTDOWN_MS };
  a.socket.emit('match_found', { ...basePayload, opponent: b.nickname, youAre: 0 });
  b.socket.emit('match_found', { ...basePayload, opponent: a.nickname, youAre: 1 });

  setTimeout(() => beginRoom(io, room), REVEAL_COUNTDOWN_MS);
}

function beginRoom(io, room) {
  if (room.finished) return;
  room.lastTick = Date.now();
  room.intervalId = setInterval(() => tickRoom(io, room), 200);
}

function tickRoom(io, room) {
  if (room.finished) return;
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
  io.to(room.id).emit('state_update', {
    turn: room.turn,
    timeLeft: room.timeLeft.map(t => Math.max(0, Math.round(t))),
    turnTimer: room.mode === 'speed' ? Math.max(0, Math.round(room.turnTimer)) : null,
    usedWordsCount: room.usedWords.size,
    ...extra,
  });
}

function applyPenalty(io, room, idx, amountMs, label) {
  room.timeLeft[idx] = Math.max(0, room.timeLeft[idx] - amountMs);
  room.players[idx].socket.emit('word_rejected', { reason: label, penaltyMs: amountMs });
  broadcastState(io, room);
  if (room.timeLeft[idx] <= 0) endRoom(io, room, 1 - idx, 'timeout');
}

function endRoom(io, room, winnerIdx, reason) {
  if (room.finished) return;
  room.finished = true;
  clearInterval(room.intervalId);

  const loserIdx = 1 - winnerIdx;
  const winner = room.players[winnerIdx];
  const loser = room.players[loserIdx];
  const { before, after } = store.recordResult(room.mode, winner.nickname, loser.nickname);

  const results = [null, null];
  results[winnerIdx] = { name: winner.nickname, before: before.winner, after: after.winner };
  results[loserIdx] = { name: loser.nickname, before: before.loser, after: after.loser };

  io.to(room.id).emit('game_over', { reason, winnerIdx, results });

  setTimeout(() => rooms.delete(room.id), 5000);
}

module.exports = { setupGame };
