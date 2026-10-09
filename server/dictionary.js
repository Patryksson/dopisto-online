const fs = require('fs');
const path = require('path');

// Řazené pole + binární hledání místo Set — výrazně méně paměti (cca 370 MB
// místo 500+ MB) pro necelé 4 miliony tvarů slov, bez znatelného dopadu na
// rychlost (hledání je O(log n), volá se jen jednou na odeslané slovo).
const WORDS = fs.readFileSync(path.join(__dirname, 'data', 'words.txt'), 'utf8')
  .split('\n')
  .map(w => w.trim())
  .filter(Boolean);
WORDS.sort();

const VALID_PREFIXES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_prefixes2.json'), 'utf8'));
const VALID_PREFIXES1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_prefixes1.json'), 'utf8'));
const VALID_INFIX2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_infix2.json'), 'utf8'));

function isValidWord(word) {
  const target = word.toLowerCase();
  let lo = 0, hi = WORDS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (WORDS[mid] === target) return true;
    if (WORDS[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// pattern = { type: 'prefix1' | 'prefix2' | 'infix2', value: 'xx' }
// Režim "football" (Slovní fotbal) žádný pevný pattern nemá — řeší se zvlášť v game.js.
function generatePattern(mode) {
  if (mode === 2) return { type: 'prefix2', value: pick(VALID_PREFIXES) };
  if (mode === 'speed') return { type: 'prefix1', value: pick(VALID_PREFIXES1) };
  if (mode === 'middle') return { type: 'infix2', value: pick(VALID_INFIX2) };
  throw new Error('Neznámý herní režim: ' + mode);
}

function matchesPattern(word, pattern) {
  if (pattern.type === 'prefix1' || pattern.type === 'prefix2') {
    return word.startsWith(pattern.value);
  }
  if (pattern.type === 'infix2') return word.includes(pattern.value);
  return false;
}

function patternInstruction(pattern) {
  if (pattern.type === 'infix2') return `Slovo musí obsahovat "${pattern.value}" (kdekoliv).`;
  return `Slovo musí začínat na "${pattern.value}".`;
}

// Slovní fotbal: dlouhá a krátká varianta samohlásky se počítají jako
// stejné písmeno (slovo končící na "á" lze navázat i slovem na "a", a naopak).
// "y" a "i" se navíc počítají jako stejné písmeno (znějí stejně).
const VOWEL_EQUIV = {
  a: ['á'], á: ['a'],
  e: ['é'], é: ['e'],
  i: ['í', 'y'], í: ['i'],
  o: ['ó'], ó: ['o'],
  u: ['ú', 'ů'], ú: ['u'], ů: ['u'],
  y: ['ý', 'i'], ý: ['y'],
};

function acceptableStartLetters(letter) {
  return [letter, ...(VOWEL_EQUIV[letter] || [])];
}

function matchesRequiredLetter(word, requiredLetter) {
  return acceptableStartLetters(requiredLetter).some(l => word.startsWith(l));
}

// Denní výzva: pro každý den v roce (1-366, počítáno v UTC, ať mají všichni
// na světě stejné zadání bez ohledu na časové pásmo) vrací vždy stejnou
// dvojici písmen z režimu "2 písmena". Stejný den v roce = stejné zadání
// každý rok dokola (žádná závislost na roce samotném).
// Denní výzva: pořadí párů se v každém "cyklu" (délka = počet párů) míchá
// deterministicky, takže všichni mají ve stejný den stejné zadání. Navíc se
// hlídá, aby dva po sobě jdoucí dny (a pokud to jde i dny s mezerou 1)
// nezačínaly stejným písmenem — např. "se" a hned "sa".
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _cycleCache = [];
function dailyCycle(c) {
  if (_cycleCache[c]) return _cycleCache[c];
  const prev = c > 0 ? dailyCycle(c - 1) : [];
  const rnd = mulberry32(1000003 * (c + 1));
  const pool = VALID_PREFIXES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const seq = [];
  const history = prev.slice(-2);
  while (pool.length) {
    const last = (seq.length ? seq : history).slice(-2).concat();
    const ctx = seq.length >= 2 ? seq.slice(-2) : history.concat(seq).slice(-2);
    const l1 = ctx[ctx.length - 1] && ctx[ctx.length - 1][0];
    const l2 = ctx.length > 1 && ctx[0][0];
    let k = pool.findIndex(p => p[0] !== l1 && p[0] !== l2);
    if (k === -1) k = pool.findIndex(p => p[0] !== l1);
    if (k === -1) k = 0;
    seq.push(pool.splice(k, 1)[0]);
  }
  return (_cycleCache[c] = seq);
}
function dailyPattern(date = new Date()) {
  const dayIndex = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const n = VALID_PREFIXES.length;
  const c = Math.floor(dayIndex / n);
  return { type: 'prefix2', value: dailyCycle(c)[dayIndex % n] };
}

module.exports = {
  isValidWord, generatePattern, matchesPattern, patternInstruction,
  acceptableStartLetters, matchesRequiredLetter, dailyPattern,
};
