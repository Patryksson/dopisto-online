const test = require('node:test');
const assert = require('node:assert/strict');
const sec = require('../server/security');
const dict = require('../server/dictionary');
const { computeElo } = require('../server/elo');

test('přezdívka: základní čištění a délka', () => {
  assert.equal(sec.sanitizeNickname('  Honza  ').nick, 'Honza');
  assert.equal(sec.sanitizeNickname('a').ok, false);
  assert.equal(sec.sanitizeNickname('x'.repeat(40)).ok === false || sec.sanitizeNickname('x'.repeat(40)).nick.length <= 20, true);
  assert.equal(sec.sanitizeNickname(123).ok, false);
  assert.equal(sec.sanitizeNickname(null).ok, false);
});

test('přezdívka: HTML znaky a řídicí/obousměrné znaky se odstraní', () => {
  const r = sec.sanitizeNickname('<b>Eva</b>‮"\'');
  assert.ok(r.ok);
  assert.doesNotMatch(r.nick, /[<>&"'`\\‮]/);
});

test('přezdívka: rezervovaná jména a homoglyfy jsou odmítnuty', () => {
  assert.equal(sec.sanitizeNickname('admin').ok, false);
  assert.equal(sec.sanitizeNickname('Admin').ok, false);
  assert.equal(sec.sanitizeNickname('аdmin').ok, false);   // cyrilické „а“
  assert.equal(sec.sanitizeNickname('adm1n').ok, false);   // leet
  assert.equal(sec.sanitizeNickname('Dopišto').ok, false);
});

test('isProfane nehlásí běžná jména', () => {
  for (const n of ['Honza', 'Tereza', 'Pepa88', 'Mistr']) assert.equal(sec.isProfane(n), false, n);
});

test('cleanWord: odstraní nesmysly a zachová diakritiku', () => {
  assert.ok(!sec.cleanWord(42));
  assert.ok(!sec.cleanWord(''));
  const w = sec.cleanWord('Žluťoučký');
  assert.ok(w && w.toLowerCase() === 'žluťoučký');
});

test('clientIp: bez proxy se bere přímá adresa, podvržená XFF z veřejné IP se ignoruje', () => {
  const mk = (addr, xff) => ({ handshake: { address: addr, headers: xff ? { 'x-forwarded-for': xff } : {} } });
  assert.equal(sec.clientIp(mk('8.8.8.8', '1.2.3.4')), '8.8.8.8');
  assert.equal(sec.clientIp(mk('10.0.0.5', '9.9.9.9')), '9.9.9.9');
});

test('clientIp: útočník nemůže přidat vlastní první položku XFF (bere se poslední od proxy)', () => {
  const s = { handshake: { address: '10.0.0.5', headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } } };
  assert.equal(sec.clientIp(s), '7.7.7.7');
});

test('ipAllow: po překročení limitu zamítne, jiná IP a jiný druh nejsou dotčeny', () => {
  const ip = '203.0.113.' + Math.floor(Math.random() * 200);
  for (let i = 0; i < 3; i++) assert.equal(sec.ipAllow(ip, 'unit', 3, 60000), true);
  assert.equal(sec.ipAllow(ip, 'unit', 3, 60000), false);
  assert.equal(sec.ipAllow(ip, 'jine', 3, 60000), true);
  assert.equal(sec.ipAllow('198.51.100.1', 'unit', 3, 60000), true);
});

test('slovník: známá slova ano, nesmysl ne, velikost písmen nevadí', () => {
  assert.equal(dict.isValidWord('dům'), true);
  assert.equal(dict.isValidWord('DŮM'), true);
  assert.equal(dict.isValidWord('qwxzzz'), false);
});

test('slovník: diakritika se nezaměňuje (dum ≠ dům)', () => {
  assert.equal(dict.isValidWord('dum'), false);
});

test('matchesPattern: začátek vs. obsahuje', () => {
  assert.equal(dict.matchesPattern('pes', { type: 'prefix1', value: 'p' }), true);
  assert.equal(dict.matchesPattern('pes', { type: 'prefix2', value: 'pe' }), true);
  assert.equal(dict.matchesPattern('pes', { type: 'prefix2', value: 'es' }), false);
  assert.equal(dict.matchesPattern('pes', { type: 'infix2', value: 'es' }), true);
});

test('dailyPattern: stejný den = stejné zadání, vždy z ověřeného seznamu', () => {
  const d = new Date('2026-03-05T10:00:00Z');
  assert.deepEqual(dict.dailyPattern(d), dict.dailyPattern(new Date('2026-03-05T23:59:00Z')));
  assert.equal(dict.dailyPattern(d).type, 'prefix2');
  assert.ok(dict.customPattern(2, dict.dailyPattern(d).value));
});

test('customPattern: nesmysly odmítne', () => {
  assert.equal(dict.customPattern(2, 'qq'), null);
  assert.equal(dict.customPattern(2, 123), null);
  assert.equal(dict.customPattern(2, ''), null);
});

test('ELO: vítěz získá, poražený ztratí, součet zhruba zachován', () => {
  const w = computeElo(1000, 1000, 1), l = computeElo(1000, 1000, 0);
  assert.ok(w > 1000 && l < 1000);
  assert.equal(w - 1000, 1000 - l);
  // outsider, který vyhraje, dostane víc než favorit
  assert.ok(computeElo(900, 1100, 1) - 900 > computeElo(1100, 900, 1) - 1100);
});
