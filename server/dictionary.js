const fs = require('fs');
const path = require('path');

const WORDS = new Set(
  fs.readFileSync(path.join(__dirname, 'data', 'words.txt'), 'utf8')
    .split('\n')
    .map(w => w.trim())
    .filter(Boolean)
);

const VALID_PREFIXES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_prefixes2.json'), 'utf8'));
const VALID_PREFIXES3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_prefixes3.json'), 'utf8'));
const VALID_PREFIXES1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_prefixes1.json'), 'utf8'));
const VALID_INFIX2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_infix2.json'), 'utf8'));

function isValidWord(word) {
  return WORDS.has(word.toLowerCase());
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// pattern = { type: 'prefix1' | 'prefix2' | 'prefix3' | 'infix2', value: 'xx' }
function generatePattern(mode) {
  if (mode === 2) return { type: 'prefix2', value: pick(VALID_PREFIXES) };
  if (mode === 3) return { type: 'prefix3', value: pick(VALID_PREFIXES3) };
  if (mode === 'speed') return { type: 'prefix1', value: pick(VALID_PREFIXES1) };
  if (mode === 'middle') return { type: 'infix2', value: pick(VALID_INFIX2) };
  throw new Error('Neznámý herní režim: ' + mode);
}

function matchesPattern(word, pattern) {
  if (pattern.type === 'prefix1' || pattern.type === 'prefix2' || pattern.type === 'prefix3') {
    return word.startsWith(pattern.value);
  }
  if (pattern.type === 'infix2') return word.includes(pattern.value);
  return false;
}

function patternInstruction(pattern) {
  if (pattern.type === 'infix2') return `Slovo musí obsahovat "${pattern.value}" (kdekoliv).`;
  return `Slovo musí začínat na "${pattern.value}".`;
}

module.exports = { isValidWord, generatePattern, matchesPattern, patternInstruction };
