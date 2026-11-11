const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers');
const dict = require('../server/dictionary');
const { weekInfo } = require('../server/weekly');
const plan = require('../server/weekly-plan');

const WORDS = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'words.txt'), 'utf8')
  .split('\n').map(w => w.trim()).filter(w => w.length >= 4);
const forPattern = (p, n) => WORDS.filter(w => plan.matchesWeekly(w, p)).slice(0, n);

const call = (bot, ev, payload) => new Promise(r => bot.socket.emit(ev, payload, r));

test('týden: začíná v pondělí 00:00 UTC, končí o 7 dní později, stejné zadání po celý týden', () => {
  const mon = weekInfo(new Date('2026-11-09T00:00:00Z')), sun = weekInfo(new Date('2026-11-15T23:59:59Z'));
  assert.equal(mon.key, '2026-11-09');
  assert.equal(sun.key, '2026-11-09');
  assert.equal(mon.endsAt - Date.UTC(2026, 10, 9), 7 * 86400000);
  assert.deepEqual(mon.pattern, sun.pattern);
  assert.equal(weekInfo(new Date('2026-11-16T00:00:00Z')).key, '2026-11-16');
  assert.equal(weekInfo(new Date('2026-11-08T23:59:59Z')).key, '2026-11-02');   // neděle patří k předchozímu týdnu
});

test('stará rotace (před začátkem plánu): vždy dvojice s hodně slovy, dva týdny po sobě nezačínají stejným písmenem', () => {
  assert.ok(dict.WEEKLY_POOL.length >= 50);
  let prev = null;
  for (let i = 0; i < 160; i++) {                      // víc než jeden celý cyklus
    const p = dict.weeklyPattern(new Date(Date.UTC(2026, 0, 5 + 7 * i)));
    assert.equal(p.type, 'prefix2');
    assert.ok(dict.WEEKLY_POOL.includes(p.value), p.value);
    if (prev) assert.notEqual(p.value[0], prev[0], `${prev} → ${p.value}`);
    prev = p.value;
  }
});

test('plán: všech 52 týdnů × 3 zadání se načte a každé zadání má dost slov', () => {
  assert.equal(plan.PLAN.filter(Boolean).length, 52);
  for (const row of plan.PLAN) {
    assert.equal(row.specs.length, 3);
    for (const sp of row.specs) {
      assert.ok(sp, `týden ${row.week}: nesrozumitelné zadání`);
      const p = plan.buildPattern(sp);
      const n = WORDS.filter(w => plan.matchesWeekly(w, p)).length;
      assert.ok(n >= 250, `týden ${row.week}: ${p.label} má jen ${n} slov`);
      assert.ok(p.tiles.length && p.hint && p.placeholder && p.short, p.label);
    }
  }
});

test('plán: zadání podle data (blok 1/2/3, opakování po třech blocích, před začátkem plánu stará rotace)', () => {
  const lab = d => plan.patternForDate(new Date(d + 'T12:00:00Z')).label;
  assert.equal(lab('2026-11-11'), weekInfo(new Date('2026-11-11T12:00:00Z')).pattern.label);   // před plánem
  assert.equal(lab('2026-11-16'), '…ie…');           // týden 1, rok 1
  assert.equal(lab('2026-11-22'), '…ie…');           // neděle ještě patří k týdnu 1
  assert.equal(lab('2026-11-23'), 'k…r');            // týden 2
  assert.equal(lab('2026-11-30'), 'br…, bez „t“');   // týden 3
  assert.equal(lab('2027-11-15'), '…bi…');           // týden 1, rok 2
  assert.equal(lab('2028-11-13'), '…ob…');           // týden 1, rok 3
  assert.equal(lab('2029-11-12'), '…ie…');           // znovu od začátku
  assert.equal(lab('2026-12-21'), 'vá…');            // vánoční týden
});

test('plán: pravidla jednotlivých typů zadání', () => {
  const m = (spec, w) => plan.matchesWeekly(w, plan.buildPattern(spec));
  assert.equal(m({ type: 'startend', first: 'k', last: 'r' }, 'kar'), true);
  assert.equal(m({ type: 'startend', first: 'k', last: 'r' }, 'kara'), false);
  assert.equal(m({ type: 'forbid', value: 'br', forbid: 't' }, 'bratr'), false);
  assert.equal(m({ type: 'forbid', value: 'br', forbid: 't' }, 'brada'), true);
  assert.equal(m({ type: 'onevowel', value: 'c', }, 'cuk'), true);
  assert.equal(m({ type: 'onevowel', value: 'c' }, 'cena'), false);
  assert.equal(m({ type: 'onevowel', value: 'c' }, 'crnk'), false);       // bez samohlásky se nepočítá
  assert.equal(m({ type: 'double', letter: 'o' }, 'kolo'), true);
  assert.equal(m({ type: 'double', letter: 'o' }, 'kola'), false);
  assert.equal(m({ type: 'double', letter: 'o' }, 'kolovrat'), true);
  assert.equal(m({ type: 'prefix3', value: 'kol' }, 'kolo'), true);
  assert.equal(m({ type: 'infix2', value: 'ie' }, 'kriet'), true);
});

test('plán: parser zápisů zadání', () => {
  assert.deepEqual(plan.parseSpec('če…'), { type: 'prefix2', value: 'če' });
  assert.deepEqual(plan.parseSpec('bez…'), { type: 'prefix3', value: 'bez' });
  assert.deepEqual(plan.parseSpec('…ie…'), { type: 'infix2', value: 'ie' });
  assert.deepEqual(plan.parseSpec('k…r'), { type: 'startend', first: 'k', last: 'r' });
  assert.deepEqual(plan.parseSpec('br…, bez „t“'), { type: 'forbid', value: 'br', forbid: 't' });
  assert.deepEqual(plan.parseSpec('c…, jen 1 samohláska'), { type: 'onevowel', value: 'c' });
  assert.deepEqual(plan.parseSpec('dvakrát "o" (kdekoliv)'), { type: 'double', letter: 'o' });
  assert.equal(plan.parseSpec('nesmysl'), null);
  assert.deepEqual(plan.parseCsv('A;B\n"x ""y""";z\n'), [['A', 'B'], ['x "y"', 'z']]);
});

let srv;
test.before(async () => { srv = await startServer(); });
test.afterEach(async () => { await srv.closeBots(); });
test.after(async () => { await srv.stop(); });

test('týdenní výzva: otevření vrátí zadání týdne, konec týdne a prázdný seznam', async () => {
  const a = srv.bot(); await a.connected;
  const d = await call(a, 'open_weekly', { nickname: 'Tydenni' });
  assert.equal(d.ok, true);
  assert.deepEqual(d.pattern, weekInfo().pattern);
  assert.equal(d.endsAt, weekInfo().endsAt);
  assert.deepEqual(d.words, []);
  assert.equal(d.count, 0);
});

test('týdenní výzva: slova se sčítají, vrací se napříč spojeními a bez časového limitu', async () => {
  const w = weekInfo();
  const words = forPattern(w.pattern, 4);
  let a = srv.bot(); await a.connected;
  const r1 = await call(a, 'submit_weekly_word', { nickname: 'Vracejici', weekId: w.key, word: words[0] });
  assert.equal(r1.ok, true); assert.equal(r1.count, 1);
  const r2 = await call(a, 'submit_weekly_word', { nickname: 'Vracejici', weekId: w.key, word: words[1].toUpperCase() });
  assert.equal(r2.count, 2);
  a.close(); await sleep(100);
  a = srv.bot(); await a.connected;                          // „přišel jsem znovu“
  const d = await call(a, 'open_weekly', { nickname: 'Vracejici' });
  assert.deepEqual(d.words.sort(), [words[0], words[1]].sort());
  const r3 = await call(a, 'submit_weekly_word', { nickname: 'vracejici', weekId: w.key, word: words[2] });   // velikost písmen v přezdívce nevadí
  assert.equal(r3.count, 3);
});

test('týdenní výzva: duplicita, slovo mimo zadání a mimo slovník se nepočítají', async () => {
  const w = weekInfo();
  const [x] = forPattern(w.pattern, 1);
  const a = srv.bot(); await a.connected;
  const send = word => call(a, 'submit_weekly_word', { nickname: 'Zkousec', weekId: w.key, word });
  assert.equal((await send(x)).ok, true);
  const dup = await send(x);
  assert.deepEqual([dup.ok, dup.kind], [false, 'dup']);
  const wrong = await send('qqqqqq');
  assert.deepEqual([wrong.ok, wrong.kind], [false, 'pattern']);
  const nodict = await send(forPattern(w.pattern, 1)[0] + 'qqqxz');
  assert.deepEqual([nodict.ok, nodict.kind], [false, 'dict']);
  assert.equal((await call(a, 'open_weekly', { nickname: 'Zkousec' })).count, 1);
  assert.equal((await send('')).ok, false);
});

test('týdenní výzva: žebříček a pořadí (stejný počet = stejné místo), hosté mimo pořadí', async () => {
  const w = weekInfo();
  const words = forPattern(w.pattern, 20);
  const put = async (nick, n) => {
    const b = srv.bot(); await b.connected;
    let last;
    for (let i = 0; i < n; i++) last = await call(b, 'submit_weekly_word', { nickname: nick, weekId: w.key, word: words[i] });
    return last;
  };
  await put('Prvni', 5);
  await put('Druhy', 3);
  const tie = await put('Remiza', 3);
  const guest = await put('Host 4821', 9);
  assert.equal(guest.rank, null);
  assert.equal(tie.rank, 2);
  const b = srv.bot(); await b.connected;
  const lb = await new Promise(r => b.socket.emit('get_weekly_leaderboard', r));
  const names = lb.rows.map(r => r.name);
  assert.ok(!names.includes('Host 4821'));
  assert.equal(names[0], 'Prvni');
  assert.deepEqual(lb.rows.find(r => r.name === 'Druhy'), { name: 'Druhy', count: 3 });
  const me = await call(b, 'weekly_me', { nickname: 'Remiza' });
  assert.equal(me.rank, 2); assert.equal(me.count, 3);
});

test('týdenní výzva: zastaralý týden (klient otevřený přes přelom týdne) je odmítnut', async () => {
  const a = srv.bot(); await a.connected;
  const r = await call(a, 'submit_weekly_word', { nickname: 'Pozdni', weekId: '2020-01-06', word: 'drak' });
  assert.equal(r.stale, true);
});

test('týdenní výzva: nepovolená přezdívka a nesmyslné vstupy', async () => {
  const a = srv.bot(); await a.connected;
  assert.equal((await call(a, 'open_weekly', { nickname: 'admin' })).nicknameRejected, true);
  assert.equal((await call(a, 'submit_weekly_word', { nickname: 'аdmin', weekId: weekInfo().key, word: 'drak' })).nicknameRejected, true);
  for (const bad of [{}, { nickname: {} }, { nickname: 'Ok', word: {}, weekId: weekInfo().key }]) {
    const r = await call(a, 'submit_weekly_word', bad);
    assert.equal(r.ok, false);
  }
  a.emit('open_weekly', 'nesmysl'); a.emit('submit_weekly_word', null);
  await sleep(200);
  assert.equal((await call(a, 'weekly_me', { nickname: 'Ok' })).count, 0);          // server žije
});

test('týdenní výzva: slova se uloží do souboru a přežijí restart serveru', async () => {
  const w = weekInfo();
  const [x, y] = forPattern(w.pattern, 2);
  const a = srv.bot(); await a.connected;
  await call(a, 'submit_weekly_word', { nickname: 'Trvaly', weekId: w.key, word: x });
  await call(a, 'submit_weekly_word', { nickname: 'Trvaly', weekId: w.key, word: y });
  await srv.restart();
  const b = srv.bot(); await b.connected;
  const d = await call(b, 'open_weekly', { nickname: 'Trvaly' });
  assert.deepEqual(d.words.sort(), [x, y].sort());
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'weekly.json')));
});

test('týdenní výzva: rychlé zasílání slov odpojí klienta, nikdy neshodí server', async () => {
  const w = weekInfo();
  const a = srv.bot(); await a.connected;
  const gone = new Promise(r => a.socket.on('disconnect', r));
  for (let i = 0; i < 200; i++) a.emit('submit_weekly_word', { nickname: 'Spamer', weekId: w.key, word: 'dra' + i });
  await Promise.race([gone, sleep(4000).then(() => { throw new Error('klient nebyl odpojen'); })]);
  const b = srv.bot(); await b.connected;
  assert.equal((await call(b, 'weekly_me', { nickname: 'Spamer' })).count, 0);
});
