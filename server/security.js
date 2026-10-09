// Ochrana proti zneužití: čištění přezdívek, filtr vulgarit, omezení počtu
// požadavků (rate limiting) a limit spojení z jedné IP.

const MAX_NICK = 20;
const MIN_NICK = 2;

// Stopy vulgarit (bez diakritiky, malými písmeny). Záměrně spíš konzervativní,
// ať to nehází falešné poplachy na běžná jména.
const BLOCKED_STEMS = [
  'kurva', 'kurev', 'kurvit', 'pica', 'picus', 'pizd', 'curak', 'kokot', 'debil', 'hovno', 'hovn',
  'jebat', 'jebn', 'jebe', 'jebu', 'zasran', 'posran', 'srac', 'buzer', 'buzna', 'cikan', 'zidak',
  'negr', 'nigg', 'nigr', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'whore', 'slut', 'rape', 'nazi',
  'hitler', 'mrdat', 'mrdka', 'prdel', 'zmrd', 'lamka', 'mocal',
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalizeForFilter(s) {
  let t = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[01345 7@$!]/g, c => LEET[c] || '');
  return t.replace(/[^a-z]/g, '');
}

function isProfane(nick) {
  const n = normalizeForFilter(nick);
  return BLOCKED_STEMS.some(stem => n.includes(stem));
}

// Vrací { ok: true, nick } nebo { ok: false, message }.
function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, message: 'Zadej přezdívku.' };
  let n = raw.normalize('NFKC')
    // řídicí, neviditelné a obousměrné znaky
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    // znaky použitelné pro HTML/skript injekci
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NICK)
    .trim();
  if (n.length < MIN_NICK) return { ok: false, message: `Přezdívka musí mít aspoň ${MIN_NICK} znaky.` };
  if (isProfane(n)) return { ok: false, message: 'Tato přezdívka není povolená.' };
  return { ok: true, nick: n };
}

function cleanWord(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().slice(0, 40);
}

// ---- Rate limiting (po socketu, klouzavé okno) ----
// [max událostí, okno v ms]
const LIMITS = {
  find_match: [6, 10000], create_lobby: [6, 10000], join_lobby: [8, 10000],
  submit_word: [12, 5000], submit_daily_word: [12, 5000],
  start_daily_challenge: [4, 10000], end_daily_challenge: [4, 10000],
  send_reaction: [8, 5000], get_leaderboard: [10, 10000], get_daily_leaderboard: [10, 10000],
  get_daily_bonus: [10, 10000], rejoin_room: [6, 10000], give_up: [4, 10000],
};
const DEFAULT_LIMIT = [30, 10000];
const MAX_STRIKES = 8;

// Události, jejichž handler čeká objekt jako první argument.
const NEEDS_OBJECT = new Set([
  'find_match', 'create_lobby', 'join_lobby', 'submit_word', 'give_up', 'send_reaction',
  'get_leaderboard', 'submit_daily_word', 'rejoin_room',
]);

function attachSocketGuard(socket) {
  const buckets = new Map();
  let strikes = 0;
  socket.use((packet, next) => {
    const [event, arg] = packet;
    if (typeof event !== 'string') return next(new Error('bad event'));
    const [max, windowMs] = LIMITS[event] || DEFAULT_LIMIT;
    const now = Date.now();
    const arr = (buckets.get(event) || []).filter(t => now - t < windowMs);
    arr.push(now);
    buckets.set(event, arr);
    if (arr.length > max) {
      strikes++;
      socket.emit('rate_limited');
      if (strikes >= MAX_STRIKES) socket.disconnect(true);
      return next(new Error('rate limited'));
    }
    if (NEEDS_OBJECT.has(event) && (arg === null || typeof arg !== 'object' || Array.isArray(arg))) {
      return next(new Error('bad payload'));
    }
    next();
  });
  // Chyby z middleware se jen spolknou — klient nic nepotřebuje vědět.
  socket.on('error', () => {});
}

// ---- Limit spojení z jedné IP ----
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 10;
const connCount = new Map();

function clientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY !== '0' && typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return socket.handshake.address;
}

function attachConnectionLimit(io) {
  io.use((socket, next) => {
    const ip = clientIp(socket);
    const n = connCount.get(ip) || 0;
    if (n >= MAX_CONN_PER_IP) return next(new Error('too many connections'));
    connCount.set(ip, n + 1);
    socket.data.ip = ip;
    socket.on('disconnect', () => {
      const c = (connCount.get(ip) || 1) - 1;
      if (c <= 0) connCount.delete(ip); else connCount.set(ip, c);
    });
    next();
  });
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

module.exports = {
  sanitizeNickname, cleanWord, attachSocketGuard, attachConnectionLimit, securityHeaders, isProfane,
};
