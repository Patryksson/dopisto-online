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
  'kunda', 'kundo', 'chcanky', 'chcat', 'hajzl', 'mrdej', 'pojeb', 'vyjeb', 'rozjeb', 'zkurv', 'pizda', 'pyco',
  'faggot', 'fagot', 'retard', 'nigga', 'cumshot', 'porn', 'sperma', 'hakenkreuz', 'siegheil',
];
// Neškodná slova, která by filtr jinak chytil (např. „Picasso", „grape").
const SAFE_WORDS = ['picasso', 'grape', 'drape', 'scrape', 'therapeut', 'dickens', 'mobydick', 'nazim', 'nazir', 'ukrajin'];
// Jména, která by mohla vypadat jako správce hry.
const RESERVED = ['admin', 'administrator', 'moderator', 'dopisto', 'system', 'server', 'support', 'podpora'];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

// Znaky, které vypadají jako latinka (azbuka, řečtina, malé kapitálky…) — převádíme je na latinku,
// aby se jimi nedal obejít filtr ani zákaz jmen jako „admin".
const CONFUSABLES = {
  'а':'a','в':'b','е':'e','к':'k','м':'m','н':'h','о':'o','р':'p','с':'c','т':'t','у':'y','х':'x','і':'i','ј':'j','ѕ':'s','ԁ':'d','ӏ':'l','ү':'y','ғ':'f',
  'α':'a','β':'b','ε':'e','ι':'i','κ':'k','ν':'v','ο':'o','ρ':'p','τ':'t','υ':'u','χ':'x','η':'n','μ':'u','γ':'y','ω':'w',
  'ᴀ':'a','ʙ':'b','ᴄ':'c','ᴅ':'d','ᴇ':'e','ꜰ':'f','ɢ':'g','ʜ':'h','ɪ':'i','ᴊ':'j','ᴋ':'k','ʟ':'l','ᴍ':'m','ɴ':'n','ᴏ':'o','ᴘ':'p','ʀ':'r','ꜱ':'s','ᴛ':'t','ᴜ':'u','ᴠ':'v','ᴡ':'w','ʏ':'y','ᴢ':'z',
  'ǀ':'l','ⅼ':'l','ⅰ':'i','ℓ':'l','ꓖ':'g','ꓰ':'e','ꓚ':'c','ꓑ':'p','ꓢ':'s','ꓔ':'t','ꓳ':'o',
};
function foldConfusables(s) {
  let out = '';
  for (const ch of s.toLowerCase()) out += CONFUSABLES[ch] || ch;
  return out;
}

function normalizeForFilter(s) {
  let t = foldConfusables(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[01345 7@$!]/g, c => LEET[c] || '');
  return t.replace(/[^a-z]/g, '');
}

function collapseRepeats(s) { return s.replace(/(.)\1+/g, '$1'); }

function isProfane(nick) {
  const n = normalizeForFilter(nick);
  if (RESERVED.includes(n)) return true;
  let w = n;
  for (const safe of SAFE_WORDS) w = w.split(safe).join('');
  return [w, collapseRepeats(w)].some(v => BLOCKED_STEMS.some(stem => v.includes(stem)));   // „kuuurva" → „kurva"
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

// ---- Omezení na IP adresu (klouzavé okno) — proti zahlcení z více spojení najednou ----
const ipBuckets = new Map();
function ipAllow(ip, kind, max, windowMs) {
  const k = kind + '|' + ip;
  const now = Date.now();
  const arr = (ipBuckets.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { ipBuckets.set(k, arr); return false; }
  arr.push(now);
  ipBuckets.set(k, arr);
  return true;
}
setInterval(() => {            // úklid starých záznamů
  const now = Date.now();
  for (const [k, arr] of ipBuckets) if (!arr.length || now - arr[arr.length - 1] > 3600000) ipBuckets.delete(k);
}, 600000).unref();

// ---- Rate limiting (po socketu, klouzavé okno) ----
// [max událostí, okno v ms]
const LIMITS = {
  find_match: [6, 10000], create_lobby: [6, 10000], join_lobby: [8, 10000],
  submit_word: [12, 5000], submit_daily_word: [12, 5000],
  submit_weekly_word: [12, 5000], open_weekly: [6, 10000], weekly_me: [6, 10000], get_weekly_leaderboard: [6, 10000],
  start_daily_challenge: [4, 10000], end_daily_challenge: [4, 10000],
  send_reaction: [8, 5000], get_leaderboard: [10, 10000], get_daily_leaderboard: [10, 10000],
  get_daily_bonus: [10, 10000], get_daily_info: [10, 10000], get_daily_history: [6, 10000], get_daily_stats: [6, 10000], get_my_stats: [6, 10000], get_online: [8, 10000], submit_report: [3, 60000], report_player: [4, 60000], rejoin_room: [6, 10000], br_find: [6, 10000], br_create_lobby: [6, 10000], br_join_lobby: [8, 10000], br_start_lobby: [4, 10000], br_submit_word: [12, 5000], br_pass: [4, 5000], br_reverse: [4, 5000], br_leave: [4, 10000], br_rejoin: [6, 10000], br_rematch: [4, 10000], br_rematch_cancel: [6, 10000], give_up: [4, 10000],
  rematch_request: [4, 10000], rematch_accept: [4, 10000], rematch_decline: [4, 10000], result_left: [6, 10000],
};
const DEFAULT_LIMIT = [30, 10000];
const MAX_STRIKES = 8;

// Události, jejichž handler čeká objekt jako první argument.
const NEEDS_OBJECT = new Set([
  'find_match', 'create_lobby', 'join_lobby', 'submit_word', 'give_up', 'send_reaction',
  'get_leaderboard', 'submit_daily_word', 'submit_weekly_word', 'open_weekly', 'weekly_me', 'rejoin_room', 'rematch_request', 'rematch_accept', 'rematch_decline', 'result_left', 'report_player', 'get_daily_stats', 'get_my_stats',
  'br_find', 'br_create_lobby', 'br_join_lobby', 'br_submit_word', 'br_pass', 'br_reverse', 'br_leave', 'br_rejoin', 'br_rematch', 'br_rematch_cancel',
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

// IP klienta. Hlavičku X-Forwarded-For si může poslat kdokoli, proto:
//  - věříme jí jen tehdy, když spojení přišlo z proxy (loopback / soukromá adresa),
//  - bereme záznam, který přidala NAŠE proxy (zprava; počet proxy v TRUST_PROXY_HOPS, výchozí 1),
//    ne první hodnotu zleva, kterou si klient vymyslí.
// TRUST_PROXY=0 vypne důvěru v hlavičku úplně.
const PROXY_HOPS = Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1);
function isPrivateAddr(a) {
  a = String(a || '').replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a);
}
function clientIp(socket) {
  const direct = socket.handshake.address;
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY !== '0' && typeof xff === 'string' && xff && isPrivateAddr(direct)) {
    const parts = xff.split(',').map(x => x.trim()).filter(Boolean);
    const ip = parts[parts.length - PROXY_HOPS];
    if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
  }
  return direct;
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
  clientIp, ipAllow, sanitizeNickname, cleanWord, attachSocketGuard, attachConnectionLimit, securityHeaders, isProfane,
};
