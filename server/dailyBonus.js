// Denní bonus — jeden náhodný bonus na den, stejný pro všechny (UTC).
const DAILY_BONUS_TYPES = [
  { id: 'len7', label: '7+ písmen', desc: 'Napiš slovo s alespoň 7 písmeny.', check: c => c.word.length >= 7 },
  { id: 'len8', label: '8+ písmen', desc: 'Napiš slovo s alespoň 8 písmeny.', check: c => c.word.length >= 8 },
  { id: 'len9', label: '9+ písmen', desc: 'Napiš slovo s alespoň 9 písmeny.', check: c => c.word.length >= 9 },
  { id: 'len10', label: '10+ písmen', desc: 'Napiš slovo s alespoň 10 písmeny.', check: c => c.word.length >= 10 },
  { id: 'sameLetter', label: 'Zrcadlo', desc: 'Slovo začínající i končící stejným písmenem.', check: c => c.word[0] === c.word[c.word.length - 1] },
  { id: 'comeback', label: 'Comeback', desc: 'Platné slovo v okamžiku, kdy máš méně času než soupeř.', check: c => c.opponentTimeLeft != null && c.myTimeLeft < c.opponentTimeLeft },
  { id: 'lastSecond', label: 'Last Second', desc: 'Slovo odešli s méně než 5 s na hodinách.', check: c => c.myTimeLeft < 5000 },
];
const DAILY_BONUS_EXTRA_MS = 1000;

function dailyBonusForDate(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
  return DAILY_BONUS_TYPES[(dayOfYear * 13 + 5) % DAILY_BONUS_TYPES.length];
}
function checkDailyBonus(bonus, ctx) { return !!(bonus && bonus.check(ctx)); }
function publicBonus(b) { return b ? { id: b.id, label: b.label, desc: b.desc } : null; }

module.exports = { dailyBonusForDate, checkDailyBonus, publicBonus, DAILY_BONUS_EXTRA_MS };
