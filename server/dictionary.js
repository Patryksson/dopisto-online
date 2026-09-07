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

module.exports = {
  isValidWord, generatePattern, matchesPattern, patternInstruction,
  acceptableStartLetters, matchesRequiredLetter,
};
