// Týdenní výzva — sólo, bez časového limitu. Celý týden (pondělí 00:00 – neděle 24:00 UTC)
// platí jedno zadání (dvojice písmen s tisíci slov); hráč se vrací, kdy chce, a slova se mu
// sčítají. Vyhrává, kdo jich za týden najde nejvíc. Zadání na každý týden určuje plán v
// weekly-plan.js (server/data/weekly-plan.csv). Server drží slova (store.js), klient jen zobrazuje.
const { isValidWord, weekIndexOf } = require('./dictionary');
const { patternForDate, matchesWeekly } = require('./weekly-plan');
const store = require('./store');
const { sanitizeNickname, cleanWord, ipAllow } = require('./security');

const DAY = 86400000;
// Pro testy a náhled: WEEKLY_NOW=2027-03-08 posune „dnešek“ (v ostrém provozu se nenastavuje).
const now = () => (process.env.WEEKLY_NOW ? new Date(process.env.WEEKLY_NOW) : new Date());
// Člověk napíše nanejvýš pár desítek slov za minutu; víc z jedné IP za hodinu je skript.
const WORDS_PER_IP_HOUR = 1200;

function weekInfo(date = now()) {
  const wi = weekIndexOf(date);
  const start = (wi * 7 - 3) * DAY;
  return { key: new Date(start).toISOString().slice(0, 10), startsAt: start, endsAt: start + 7 * DAY, pattern: patternForDate(date) };
}

function prevWeek(date = now()) {
  const w = weekInfo(new Date(date.getTime() - 7 * DAY));
  const top = store.weeklyTop(w.key);
  return top && top.name ? { name: top.name, count: top.count, players: top.players, pattern: top.pattern || w.pattern.label } : null;
}

function setupWeekly(socket) {
  const nickOf = (payload) => sanitizeNickname(payload && payload.nickname);

  // Lehká informace pro kartu v menu (zadání týdne, konec týdne, tvůj počet a pořadí).
  socket.on('weekly_me', (payload, cb) => {
    if (typeof cb !== 'function') return;
    const w = weekInfo();
    const r = nickOf(payload);
    const me = r.ok ? store.weeklyMe(w.key, r.nick) : { count: 0, rank: null, total: 0, leaderCount: 0 };
    cb({ weekId: w.key, endsAt: w.endsAt, pattern: w.pattern, count: me.count, rank: me.rank, total: me.total });
  });

  // Otevření výzvy: zadání + všechna dosavadní slova hráče.
  socket.on('open_weekly', (payload, cb) => {
    if (typeof cb !== 'function') return;
    const r = nickOf(payload);
    if (!r.ok) { cb({ ok: false, nicknameRejected: true, message: r.message }); return; }
    const w = weekInfo();
    const me = store.weeklyMe(w.key, r.nick);
    cb({ ok: true, weekId: w.key, endsAt: w.endsAt, pattern: w.pattern, words: me.words, count: me.count, rank: me.rank, total: me.total, leaderCount: me.leaderCount, prev: prevWeek() });
  });

  socket.on('submit_weekly_word', (payload, cb) => {
    if (typeof cb !== 'function') return;
    const r = nickOf(payload);
    if (!r.ok) { cb({ ok: false, nicknameRejected: true, message: r.message }); return; }
    const w = weekInfo();
    if (payload.weekId !== w.key) { cb({ ok: false, stale: true }); return; }   // mezitím začal nový týden
    const clean = cleanWord(payload.word);
    if (!clean) { cb({ ok: false, kind: 'empty', reason: 'Napiš slovo.' }); return; }
    if (!ipAllow(socket.data.ip || socket.handshake.address, 'weekly', WORDS_PER_IP_HOUR, 3600000)) {
      cb({ ok: false, kind: 'rate', reason: 'Zadáváš slova moc rychle, zkus to za chvíli.' }); return;
    }
    if (!matchesWeekly(clean, w.pattern)) { cb({ ok: false, kind: 'pattern', reason: w.pattern.hint }); return; }
    if (!isValidWord(clean)) { cb({ ok: false, kind: 'dict', reason: 'Slovo není ve slovníku.' }); return; }
    if (!store.weeklyAdd(w.key, r.nick, clean, w.pattern.label)) { cb({ ok: false, kind: 'dup', reason: 'Tohle slovo už máš.' }); return; }
    const me = store.weeklyMe(w.key, r.nick);
    cb({ ok: true, word: clean, count: me.count, rank: me.rank, total: me.total, leaderCount: me.leaderCount });
  });

  socket.on('get_weekly_leaderboard', (cb) => {
    if (typeof cb !== 'function') return;
    const w = weekInfo();
    cb({ weekId: w.key, endsAt: w.endsAt, rows: store.weeklyLeaderboard(w.key, 20) });
  });
}

module.exports = { setupWeekly, weekInfo };
