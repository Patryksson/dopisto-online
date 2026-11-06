// Battle Royale — režim pro 2 až 5 hráčů (ideálně 5) v kruhu.
// Hráči se střídají po směru (nebo proti směru), každý má 2 životy a na tah
// omezený čas, který se s každým kolem zkracuje. Kdo nestihne odpovědět, přijde
// o život a zadání se změní (po krátkém odpočtu). Poslední přeživší vyhrává.
//
// Modul je samostatný: v game.js se jen zavolá setupBR(io, socket) a
// startBRLoop(io). Žádné ELO se tady nepočítá.

const crypto = require('crypto');
const { generatePattern, matchesPattern, isValidWord } = require('./dictionary');
const { sanitizeNickname, cleanWord } = require('./security');
const { dailyBonusForDate, checkDailyBonus, publicBonus } = require('./dailyBonus');

const BR_MAX = 5;                 // počet hráčů v kruhu
const BR_MIN_LOBBY_START = 2;     // soukromé lobby: host může spustit už od 2 hráčů
const BR_MIN_PUBLIC_START = 3;    // veřejná fronta: po čekání se spustí i se 3–4 hráči
const BR_FILL_WAIT_MS = 45000;    // jak dlouho fronta čeká na plných 5 hráčů

const START_LIVES = 2;
const MAX_LIVES = 3;              // 2 životy + 1 bonusové srdce
const METER_GOAL = 3;             // tolik splněných denních bonusů naplní metr = bonusové srdce

const BASE_TURN_MS = 15000;       // čas na tah v 1. kole
const ROUND_STEP_MS = 1000;       // každé kolo o tolik méně (po změně zadání se začíná znovu od 15 s)
const MIN_TURN_MS = 5000;         // pod tuto hranici se nejde (jinak by to nešlo stihnout)

const REVEAL_MS = 3500;           // odpočet před úplným začátkem (stejně jako u ostatních režimů)
const BREAK_MS = 5000;            // odpočet po změně zadání
const DISCONNECT_GRACE_MS = 20000;// po tolika ms bez spojení hráč vypadává

// Tresty jako v ostatních režimech — tady se ale odečítají z času na aktuální tah.
const PENALTY_NOT_IN_DICT_MS = 1000;
const PENALTY_ALREADY_USED_MS = 3000;
const PENALTY_WRONG_PATTERN_MS = 3000;

// Barva hráče — každý v kruhu má jinou, náhodně přidělenou před zápasem.
const COLORS = ['blue', 'green', 'yellow', 'purple', 'orange'];

const PATTERN_MODES = [2, 'middle', 'speed']; // zadání se losuje ze všech tří režimů

const queue = [];                 // veřejná fronta { socket, nickname, joinedAt }
const lobbies = new Map();        // code -> { code, host, members:[{socket,nickname}], timeout }
const rooms = new Map();          // roomId -> room

function roundTimeMs(round) {
  return Math.max(MIN_TURN_MS, BASE_TURN_MS - (round - 1) * ROUND_STEP_MS);
}

function pickPattern(prevValue) {
  let p;
  for (let i = 0; i < 8; i++) {
    p = generatePattern(PATTERN_MODES[Math.floor(Math.random() * PATTERN_MODES.length)]);
    if (p.value !== prevValue) break;
  }
  return p;
}

// Denní bonus má v tomto režimu upravené popisy tam, kde se v duelu mluví o hodinách.
function bonusInfo(b) {
  const o = publicBonus(b);
  if (!o) return o;
  if (b.id === 'comeback') o.desc = 'Platné slovo ve chvíli, kdy máš méně životů než některý jiný hráč.';
  if (b.id === 'lastSecond') o.desc = 'Pošli platné slovo, když ti na odpověď zbývá méně než 5 sekund.';
  return o;
}

// ---- pomocné funkce kruhu ----
const aliveCount = (room) => room.players.filter(p => p.alive).length;

function nextAlive(room, from, dir) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + dir * i) % n) + n) % n;
    if (room.players[idx].alive) return idx;
  }
  return -1;
}

function seatOf(room, socket) {
  return room.players.findIndex(p => !p.left && p.socket && p.socket.id === socket.id);
}

function publicState(room) {
  const now = Date.now();
  return {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    dir: room.dir,
    turn: room.turn,
    nextTurn: room.nextTurn,
    pattern: room.pattern,
    turnMs: room.turnMs,
    turnLeft: room.phase === 'turn' ? Math.max(0, room.turnEndsAt - now) : 0,
    breakLeft: room.phase === 'break' || room.phase === 'reveal' ? Math.max(0, room.breakEndsAt - now) : 0,
    usedCount: room.usedWords.size,
    meterGoal: METER_GOAL,
    maxLives: MAX_LIVES,
    bonus: bonusInfo(room.dailyBonus),
    players: room.players.map((p, i) => ({
      seat: i, name: p.nickname, lives: p.lives, alive: p.alive, meter: p.meter,
      color: p.color, pass: p.pass, reverse: p.reverse, connected: p.connected && !p.left, left: p.left, place: p.place,
    })),
  };
}

function emitState(io, room, event) {
  io.to(room.id).emit('br_state', { ...publicState(room), event: event || null });
}

// ---- průběh hry ----
function startTurn(io, room, idx) {
  room.turn = idx;
  room.turnMs = roundTimeMs(room.round);
  room.turnEndsAt = Date.now() + room.turnMs;
  room.phase = 'turn';
}

// Jeden "krok" (slovo / pass / změna směru / vypršení). Po tolika krocích, kolik
// je živých hráčů, začíná nové kolo — čas na tah se zkrátí.
function countStep(room) {
  room.steps++;
  if (room.steps >= aliveCount(room)) { room.round++; room.steps = 0; }
}

function advance(io, room, fromIdx, event) {
  countStep(room);
  const next = nextAlive(room, fromIdx, room.dir);
  startTurn(io, room, next);
  emitState(io, room, event);
}

// Naplněný metr = bonusové srdce (max. MAX_LIVES). Při plných srdcích metr počká.
function grantHeartIfReady(p) {
  let granted = false;
  while (p.meter >= METER_GOAL && p.lives < MAX_LIVES) { p.lives++; p.meter -= METER_GOAL; granted = true; }
  return granted;
}

function changePattern(room) {
  room.pattern = pickPattern(room.pattern && room.pattern.value);
}

function eliminate(io, room, idx) {
  const p = room.players[idx];
  if (!p.alive) return;
  p.place = aliveCount(room); // pořadí = kolik hráčů bylo ještě ve hře
  p.alive = false;
  p.lives = 0;
  if (p.socket && p.connected && !p.left) p.socket.emit('br_eliminated', { place: p.place });
}

function handleTimeout(io, room) {
  const idx = room.turn;
  const p = room.players[idx];
  p.lives--;
  const saved = grantHeartIfReady(p);
  let eliminated = false;
  if (p.lives <= 0) { eliminate(io, room, idx); eliminated = true; }

  if (aliveCount(room) <= 1) { endGame(io, room, { type: 'timeout', seat: idx, eliminated, saved }); return; }

  changePattern(room);
  // Nové zadání = čas na tah se vrací na výchozích 15 s a zase se každé kolo zkracuje.
  room.round = 1;
  room.steps = 0;
  room.nextTurn = nextAlive(room, idx, room.dir);
  room.phase = 'break';
  room.breakEndsAt = Date.now() + BREAK_MS;
  emitState(io, room, { type: 'timeout', seat: idx, eliminated, saved });
}

// Hráč odešel nebo se odpojil na moc dlouho — vypadává jako při ztrátě všech životů.
function forfeit(io, room, idx) {
  const p = room.players[idx];
  if (p.left && !p.alive) return;
  const wasTurn = p.alive && room.phase === 'turn' && room.turn === idx;
  const wasNext = p.alive && (room.phase === 'break' || room.phase === 'reveal') && room.nextTurn === idx;
  eliminate(io, room, idx);
  if (aliveCount(room) <= 1) { endGame(io, room, { type: 'left', seat: idx }); return; }
  if (wasTurn) {
    countStep(room);
    startTurn(io, room, nextAlive(room, idx, room.dir));
  } else if (wasNext) {
    room.nextTurn = nextAlive(room, idx, room.dir);
  }
  emitState(io, room, { type: 'left', seat: idx });
}

function endGame(io, room, event) {
  if (room.finished) return;
  room.finished = true;
  room.phase = 'over';
  clearInterval(room.intervalId);
  const winner = room.players.find(p => p.alive);
  if (winner) winner.place = 1;
  const ranking = room.players
    .map((p, i) => ({ seat: i, name: p.nickname, place: p.place || 99, words: p.words }))
    .sort((a, b) => a.place - b.place);
  io.to(room.id).emit('br_over', {
    roomId: room.id,
    winnerSeat: winner ? room.players.indexOf(winner) : null,
    ranking,
    history: room.history,
    event: event || null,
  });
  for (const p of room.players) if (p.socket && p.socket.data.brRoom === room.id) p.socket.data.brRoom = null;
  setTimeout(() => rooms.delete(room.id), 2 * 60 * 1000);
}

function tickRoom(io, room) {
  if (room.finished) return;
  const now = Date.now();

  // Odpojení hráči: po uplynutí odpočtu vypadávají.
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.alive && !p.connected && !p.left && now - p.disconnectedAt > DISCONNECT_GRACE_MS) {
      forfeit(io, room, i);
      if (room.finished) return;
    }
  }

  // Všichni odešli → zrušit místnost.
  if (room.players.every(p => p.left || !p.connected)) {
    if (!room.emptySince) room.emptySince = now;
    if (now - room.emptySince > DISCONNECT_GRACE_MS) {
      room.finished = true; clearInterval(room.intervalId); rooms.delete(room.id);
      return;
    }
  } else room.emptySince = null;

  if (room.phase === 'turn') {
    if (now >= room.turnEndsAt) { handleTimeout(io, room); return; }
    io.to(room.id).emit('br_tick', { phase: 'turn', turn: room.turn, turnLeft: Math.max(0, room.turnEndsAt - now), turnMs: room.turnMs });
  } else if (room.phase === 'break' || room.phase === 'reveal') {
    if (now >= room.breakEndsAt) {
      startTurn(io, room, room.nextTurn);
      emitState(io, room, { type: 'turn' });
    } else {
      io.to(room.id).emit('br_tick', { phase: room.phase, breakLeft: Math.max(0, room.breakEndsAt - now) });
    }
  }
}

function startRoom(io, entries) {
  const id = 'br_' + Math.random().toString(36).slice(2, 10);
  const shuffled = entries.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const colors = COLORS.slice();
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  // Stejné přezdívky v jednom kruhu se rozliší.
  const seen = new Map();
  const players = shuffled.map((e, idx) => {
    const base = e.nickname;
    const k = base.toLowerCase();
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return {
      socket: e.socket, nickname: n > 1 ? `${base} (${n})` : base,
      token: crypto.randomBytes(8).toString('hex'),
      color: colors[idx], lives: START_LIVES, alive: true, connected: true, left: false, disconnectedAt: 0,
      meter: 0, pass: true, reverse: true, words: 0, place: null,
    };
  });

  const room = {
    id, players, dir: 1, round: 1, steps: 0, turn: 0, nextTurn: Math.floor(Math.random() * players.length),
    pattern: pickPattern(null), usedWords: new Set(), history: [],
    phase: 'reveal', breakEndsAt: Date.now() + REVEAL_MS, turnEndsAt: 0, turnMs: roundTimeMs(1),
    dailyBonus: dailyBonusForDate(), finished: false, intervalId: null, emptySince: null,
  };
  rooms.set(id, room);

  players.forEach((p, i) => {
    p.socket.join(id);
    p.socket.data.brRoom = id;
    p.socket.emit('br_found', {
      roomId: id, youAre: i, token: p.token, revealMs: REVEAL_MS,
      players: players.map((q, s) => ({ seat: s, name: q.nickname })),
      state: publicState(room),
    });
  });
  room.intervalId = setInterval(() => tickRoom(io, room), 200);
}

// ---- fronta a lobby ----
function removeFromQueue(socket) {
  const i = queue.findIndex(q => q.socket.id === socket.id);
  if (i !== -1) queue.splice(i, 1);
}

function emitQueue() {
  for (const q of queue) q.socket.emit('br_queue', { count: queue.length, max: BR_MAX });
}

function tryStartQueue(io, force) {
  while (queue.length >= BR_MAX) startRoom(io, queue.splice(0, BR_MAX));
  if (queue.length >= BR_MIN_PUBLIC_START && Date.now() - queue[0].joinedAt >= BR_FILL_WAIT_MS) {
    startRoom(io, queue.splice(0, BR_MAX));
  }
  emitQueue();
}

function lobbyPayload(l, forSocket) {
  return { code: l.code, players: l.members.map(m => m.nickname), isHost: l.host.id === forSocket.id, max: BR_MAX, min: BR_MIN_LOBBY_START };
}
function emitLobby(l) {
  for (const m of l.members) m.socket.emit('br_lobby', lobbyPayload(l, m.socket));
}

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (lobbies.has(code));
  return code;
}

function leaveLobby(socket, notify = true) {
  const code = socket.data.brLobby;
  if (!code) return;
  socket.data.brLobby = null;
  const l = lobbies.get(code);
  if (!l) return;
  if (l.host.id === socket.id) {
    clearTimeout(l.timeout);
    lobbies.delete(code);
    for (const m of l.members) {
      if (m.socket.id === socket.id) continue;
      m.socket.data.brLobby = null;
      if (notify) m.socket.emit('br_lobby_closed', { message: 'Hostitel zrušil lobby.' });
    }
  } else {
    l.members = l.members.filter(m => m.socket.id !== socket.id);
    emitLobby(l);
  }
}

function startBRLoop(io) {
  setInterval(() => tryStartQueue(io), 1000);
}

function setupBR(io, socket) {
  socket.data.brRoom = null;
  socket.data.brLobby = null;

  function nick(raw) {
    const r = sanitizeNickname(raw);
    if (!r.ok) { socket.emit('nickname_rejected', { message: r.message }); return null; }
    return r.nick;
  }
  // Hráč, který už je ve hře / frontě / lobby, se nejdřív odhlásí z předchozího.
  function clearBrState() { removeFromQueue(socket); leaveLobby(socket); }

  socket.on('br_find', ({ nickname }) => {
    const n = nick(nickname); if (!n) return;
    if (socket.data.brRoom) { const r = rooms.get(socket.data.brRoom); if (r && !r.finished) return; }
    socket.data.nickname = n;
    clearBrState();
    queue.push({ socket, nickname: n, joinedAt: Date.now() });
    tryStartQueue(io);
    emitQueue();
  });

  socket.on('br_cancel', () => { removeFromQueue(socket); emitQueue(); });

  socket.on('br_create_lobby', ({ nickname }) => {
    const n = nick(nickname); if (!n) return;
    socket.data.nickname = n;
    clearBrState();
    const code = genCode();
    const l = { code, host: socket, members: [{ socket, nickname: n }], timeout: null };
    l.timeout = setTimeout(() => {
      if (!lobbies.has(code)) return;
      lobbies.delete(code);
      for (const m of l.members) { m.socket.data.brLobby = null; m.socket.emit('br_lobby_closed', { message: 'Lobby vypršelo.' }); }
    }, 15 * 60 * 1000);
    lobbies.set(code, l);
    socket.data.brLobby = code;
    emitLobby(l);
  });

  socket.on('br_join_lobby', ({ nickname, code }) => {
    const n = nick(nickname); if (!n) return;
    const c = String(code || '').trim().toUpperCase().slice(0, 10);
    const l = lobbies.get(c);
    if (!l) { socket.emit('br_error', { message: 'Kód nenalezen nebo vypršel.' }); return; }
    if (l.members.some(m => m.socket.id === socket.id)) return;
    if (l.members.length >= BR_MAX) { socket.emit('br_error', { message: 'Lobby je plné.' }); return; }
    socket.data.nickname = n;
    clearBrState();
    l.members.push({ socket, nickname: n });
    socket.data.brLobby = c;
    if (l.members.length >= BR_MAX) { startLobby(l); return; }
    emitLobby(l);
  });

  function startLobby(l) {
    clearTimeout(l.timeout);
    lobbies.delete(l.code);
    for (const m of l.members) m.socket.data.brLobby = null;
    startRoom(io, l.members.map(m => ({ socket: m.socket, nickname: m.nickname })));
  }

  socket.on('br_start_lobby', () => {
    const l = lobbies.get(socket.data.brLobby);
    if (!l || l.host.id !== socket.id) return;
    if (l.members.length < BR_MIN_LOBBY_START) { socket.emit('br_error', { message: `Na spuštění potřebuješ aspoň ${BR_MIN_LOBBY_START} hráče.` }); return; }
    startLobby(l);
  });

  socket.on('br_leave_lobby', () => leaveLobby(socket, true));

  // ---- tahy ----
  function activeTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.finished || room.phase !== 'turn') return {};
    const idx = seatOf(room, socket);
    if (idx === -1 || idx !== room.turn) return {};
    return { room, idx, p: room.players[idx] };
  }

  function penalize(room, idx, ms, label) {
    room.players[idx].socket.emit('br_rejected', { reason: label, penaltyMs: ms });
    room.turnEndsAt -= ms;
    if (Date.now() >= room.turnEndsAt) handleTimeout(io, room);
    else io.to(room.id).emit('br_tick', { phase: 'turn', turn: room.turn, turnLeft: Math.max(0, room.turnEndsAt - Date.now()), turnMs: room.turnMs });
  }

  socket.on('br_submit_word', ({ roomId, word }) => {
    const { room, idx, p } = activeTurn(roomId);
    if (!room) return;
    const clean = cleanWord(word);
    if (!clean) return;

    if (!matchesPattern(clean, room.pattern)) {
      if (room.pattern.type === 'infix2') penalize(room, idx, PENALTY_WRONG_PATTERN_MS, 'Slovo neobsahuje daná písmena!');
      else socket.emit('br_rejected', { reason: `Slovo musí začínat na "${room.pattern.value}".` });
      return;
    }
    if (room.usedWords.has(clean)) { penalize(room, idx, PENALTY_ALREADY_USED_MS, 'Slovo už bylo použito!'); return; }
    if (!isValidWord(clean)) { penalize(room, idx, PENALTY_NOT_IN_DICT_MS, 'Slovo není ve slovníku!'); return; }

    room.usedWords.add(clean);
    room.history.push({ word: clean, seat: idx, round: room.round });
    p.words++;

    // Denní bonus: místo času plní metr pod jménem.
    const remaining = Math.max(0, room.turnEndsAt - Date.now());
    const comeback = room.dailyBonus && room.dailyBonus.id === 'comeback';
    const othersMax = Math.max(0, ...room.players.filter((q, i) => q.alive && i !== idx).map(q => q.lives));
    const hit = checkDailyBonus(room.dailyBonus, {
      word: clean,
      myTimeLeft: comeback ? p.lives : remaining,
      opponentTimeLeft: comeback ? othersMax : null,
    });
    let heart = false;
    if (hit) { p.meter = Math.min(METER_GOAL, p.meter + 1); heart = grantHeartIfReady(p); }

    advance(io, room, idx, { type: 'word', seat: idx, word: clean, bonusHit: !!hit, heart });
  });

  socket.on('br_pass', ({ roomId }) => {
    const { room, idx, p } = activeTurn(roomId);
    if (!room || !p.pass) return;
    p.pass = false;
    advance(io, room, idx, { type: 'pass', seat: idx });
  });

  socket.on('br_reverse', ({ roomId }) => {
    const { room, idx, p } = activeTurn(roomId);
    if (!room || !p.reverse) return;
    p.reverse = false;
    room.dir = -room.dir;
    advance(io, room, idx, { type: 'reverse', seat: idx });
  });

  socket.on('br_leave', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const idx = seatOf(room, socket);
    if (idx === -1) return;
    const p = room.players[idx];
    if (!room.finished) forfeit(io, room, idx);
    p.left = true;
    socket.leave(room.id);
    if (socket.data.brRoom === room.id) socket.data.brRoom = null;
    if (!room.finished) emitState(io, room, null);
  });

  socket.on('br_rejoin', ({ roomId, seat, token }) => {
    const room = rooms.get(roomId);
    if (!room || room.finished) { socket.emit('br_rejoin_failed'); return; }
    const p = room.players[seat];
    if (!p || p.token !== token || p.left) { socket.emit('br_rejoin_failed'); return; }
    p.socket = socket;
    p.connected = true;
    p.disconnectedAt = 0;
    socket.join(room.id);
    socket.data.brRoom = room.id;
    socket.emit('br_rejoined', {
      roomId: room.id, youAre: seat,
      players: room.players.map((q, s) => ({ seat: s, name: q.nickname })),
      state: publicState(room),
    });
    emitState(io, room, null);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    emitQueue();
    leaveLobby(socket, true);
    for (const room of rooms.values()) {
      if (room.finished) continue;
      const idx = room.players.findIndex(p => p.socket && p.socket.id === socket.id && !p.left);
      if (idx === -1) continue;
      const p = room.players[idx];
      p.connected = false;
      p.disconnectedAt = Date.now();
      if (!p.alive) p.left = true; // pozorovatel se vracet nemusí
      emitState(io, room, null);
    }
  });
}

module.exports = { setupBR, startBRLoop };
