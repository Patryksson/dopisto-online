const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers');
const dict = require('../server/dictionary');

const WORDS = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'words.txt'), 'utf8')
  .split('\n').map(w => w.trim()).filter(Boolean);

let srv;
test.before(async () => { srv = await startServer(); });
test.afterEach(async () => { await srv.closeBots(); });
test.after(async () => { await srv.stop(); });

test('denní výzva: zadání odpovídá dnešnímu dni a slova se počítají', async () => {
  const pat = dict.dailyPattern().value;
  const words = WORDS.filter(w => w.startsWith(pat) && w.length >= 4).slice(0, 3);
  assert.ok(words.length >= 2, 'pro dnešní zadání existují slova');
  const a = srv.bot(); await a.connected;
  a.emit('start_daily_challenge', { nickname: 'Denni' });
  const st = await a.wait('daily_started');
  assert.equal(st.pattern.value, pat);
  assert.ok(st.timeLeft > 0);
  await sleep(st.countdownMs + 300);
  a.emit('submit_daily_word', { word: words[0] });
  await a.wait('daily_state_update', s => s.usedWordsCount === 1);
  // duplicita nezvýší počet
  a.emit('submit_daily_word', { word: words[0] });
  await a.wait('daily_word_rejected', null, 3000).catch(() => {});
  // špatný začátek
  a.emit('submit_daily_word', { word: 'xylofon' });
  assert.match((await a.wait('daily_word_rejected', r => /začínat/.test(r.reason))).reason, /začínat/);
  a.emit('submit_daily_word', { word: words[1] });
  await a.wait('daily_state_update', s => s.usedWordsCount === 2);
  a.emit('end_daily_challenge');
  const over = await a.wait('daily_over');
  assert.equal(over.wordCount, 2);
  assert.equal(over.words.length, 2);
});

test('denní výzva: do žebříčku se zapíše nejlepší pokus, horší ho nepřepíše', async () => {
  const pat = dict.dailyPattern().value;
  const words = WORDS.filter(w => w.startsWith(pat) && w.length >= 4).slice(0, 3);
  const play = async (n) => {
    const a = srv.bot(); await a.connected;
    a.emit('start_daily_challenge', { nickname: 'Rekordman' });
    const st = await a.wait('daily_started');
    await sleep(st.countdownMs + 300);
    for (let i = 0; i < n; i++) {
      a.emit('submit_daily_word', { word: words[i] });
      await a.wait('daily_state_update', s => s.usedWordsCount === i + 1);
    }
    a.emit('end_daily_challenge');
    await a.wait('daily_over');
    return a;
  };
  await play(3);
  await play(1);
  const b = srv.bot(); await b.connected;
  const board = await new Promise(r => b.socket.emit('get_daily_leaderboard', r));
  const list = Array.isArray(board) ? board : (board.entries || board.list || board.top || []);
  const me = list.find(e => (e.name || e.nickname) === 'Rekordman');
  assert.ok(me, 'hráč je v žebříčku: ' + JSON.stringify(board).slice(0, 200));
  assert.equal(me.wordCount ?? me.words ?? me.count, 3);
});

test('denní výzva: špatná přezdívka nezačne hru', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('start_daily_challenge', { nickname: 'admin' });
  await a.wait('nickname_rejected');
  assert.equal(a.count('daily_started'), 0);
});

test('denní výzva: get_daily_info neprozradí zadání', async () => {
  const a = srv.bot(); await a.connected;
  const info = await new Promise(r => a.socket.emit('get_daily_info', r));
  assert.ok(!JSON.stringify(info || {}).includes('"pattern"'));
});
