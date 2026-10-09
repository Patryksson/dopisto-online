// Denní bonus — jeden náhodný bonus na den, stejný pro všechny (UTC).
// Počet výskytů písmen z dané skupiny (včetně dlouhých/háčkovaných variant).
function countLetters(word, letters) {
  let n = 0;
  for (const ch of word) if (letters.includes(ch)) n++;
  return n;
}

const DAILY_BONUS_TYPES = [
  { id: 'len7', label: '7+ písmen', desc: 'Napiš slovo s alespoň 7 písmeny.', check: c => c.word.length >= 7 },
  { id: 'len8', label: '8+ písmen', desc: 'Napiš slovo s alespoň 8 písmeny.', check: c => c.word.length >= 8 },
  { id: 'len9', label: '9+ písmen', desc: 'Napiš slovo s alespoň 9 písmeny.', check: c => c.word.length >= 9 },
  { id: 'len10', label: '10+ písmen', desc: 'Napiš slovo s alespoň 10 písmeny.', check: c => c.word.length >= 10 },
  { id: 'sameLetter', label: 'Zrcadlo', desc: 'Slovo začínající i končící stejným písmenem.', check: c => c.word[0] === c.word[c.word.length - 1] },
  { id: 'twoA', label: 'Dvojité A', desc: 'Slovo obsahující písmeno A (nebo Á) alespoň dvakrát.', check: c => countLetters(c.word, 'aá') >= 2 },
  { id: 'twoE', label: 'Dvojité E', desc: 'Slovo obsahující písmeno E (nebo É, Ě) alespoň dvakrát.', check: c => countLetters(c.word, 'eéě') >= 2 },
  { id: 'twoI', label: 'Dvojité I', desc: 'Slovo obsahující písmeno I (nebo Í) alespoň dvakrát.', check: c => countLetters(c.word, 'ií') >= 2 },
  { id: 'twoO', label: 'Dvojité O', desc: 'Slovo obsahující písmeno O (nebo Ó) alespoň dvakrát.', check: c => countLetters(c.word, 'oó') >= 2 },
  { id: 'twoU', label: 'Dvojité U', desc: 'Slovo obsahující písmeno U (nebo Ú, Ů) alespoň dvakrát.', check: c => countLetters(c.word, 'uúů') >= 2 },
  { id: 'comeback', label: 'Comeback', desc: 'Platné slovo v okamžiku, kdy máš méně času než soupeř.', check: c => c.opponentTimeLeft != null && c.myTimeLeft < c.opponentTimeLeft },
  { id: 'lastSecond', label: 'Last Second', desc: 'Slovo odešli s méně než 5 s na hodinách.', check: c => c.myTimeLeft < 5000 },
];
const DAILY_BONUS_EXTRA_MS = 3000;

function dailyBonusForDate(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
  return DAILY_BONUS_TYPES[(dayOfYear * 13 + 5) % DAILY_BONUS_TYPES.length];
}
function checkDailyBonus(bonus, ctx) { return !!(bonus && bonus.check(ctx)); }
function publicBonus(b) { return b ? { id: b.id, label: b.label, desc: b.desc } : null; }

module.exports = { DAILY_BONUS_TYPES, dailyBonusForDate, checkDailyBonus, publicBonus, DAILY_BONUS_EXTRA_MS };
