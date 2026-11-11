// Plán týdenních výzev: server/data/weekly-plan.csv (52 týdnů × 3 „roky“, upravitelné v Excelu).
// Řádek = týden v rámci 52týdenního bloku, sloupce „Zadání - rok 1/2/3“ = zadání v 1., 2. a 3. bloku;
// po třetím bloku se začíná znovu prvním. Blok 1 začíná v pondělí 16. 11. 2026, týdny před ním
// mají (dříve používané) zadání ze slovníkové rotace v dictionary.js.
//
// Zápis zadání v CSV:  če…        začíná na „če“ (2 nebo 3 písmena)
//                      …ie…       obsahuje „ie“ (kdekoliv)
//                      k…r        začíná na „k“ a končí na „r“
//                      br…, bez „t“           začíná na „br“ a neobsahuje „t“
//                      c…, jen 1 samohláska   začíná na „c“, právě jedna samohláska
//                      dvakrát „o“ (kdekoliv) písmeno „o“ aspoň dvakrát (kdekoliv)
const fs = require('fs');
const path = require('path');
const { weeklyPattern, weekIndexOf } = require('./dictionary');

const PLAN_FILE = path.join(__dirname, 'data', 'weekly-plan.csv');
const PLAN_START = new Date(Date.UTC(2026, 10, 16));          // pondělí, první týden plánu
const PLAN_WEEKS = 52, PLAN_BLOCKS = 3;
const VOWELS = /[aeiouyáéěíóúůý]/g;

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const Q = '["„“”\']?';
// Jedna buňka tabulky -> specifikace zadání (nebo null, když je zápis nesrozumitelný).
function parseSpec(cell) {
  const s = String(cell || '').trim().toLowerCase().replace(/\.\.\./g, '…');
  let m;
  if ((m = s.match(new RegExp(`^dvakrát\\s+${Q}(\\p{L})${Q}`, 'u')))) return { type: 'double', letter: m[1] };
  if ((m = s.match(new RegExp(`^(\\p{L}{1,3})…,\\s*bez\\s+${Q}(\\p{L})${Q}$`, 'u')))) return { type: 'forbid', value: m[1], forbid: m[2] };
  if ((m = s.match(/^(\p{L})…,\s*jen\s*1\s*samohl/u))) return { type: 'onevowel', value: m[1] };
  if ((m = s.match(/^…(\p{L}{2})…$/u))) return { type: 'infix2', value: m[1] };
  if ((m = s.match(/^(\p{L})…(\p{L})$/u))) return { type: 'startend', first: m[1], last: m[2] };
  if ((m = s.match(/^(\p{L}{2,3})…$/u))) return { type: m[1].length === 2 ? 'prefix2' : 'prefix3', value: m[1] };
  return null;
}

function loadPlan(file = PLAN_FILE) {
  let rows;
  try { rows = parseCsv(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn('Plán týdenních výzev nelze načíst:', e.message); return []; }
  const plan = [];
  for (const r of rows.slice(1)) {
    const week = parseInt(r[0], 10);
    if (!week) continue;
    const specs = [4, 5, 6].map(i => parseSpec(r[i]));
    specs.forEach((sp, b) => { if (!sp) console.warn(`Plán týdenních výzev: neplatné zadání v týdnu ${week}, sloupec ${b + 1}: "${r[4 + b]}"`); });
    plan[week - 1] = { week, type: r[3], specs };
  }
  return plan;
}
const PLAN = loadPlan();

// Doplní zadání o texty pro zobrazení (klient je jen vykreslí).
function buildPattern(spec) {
  const up = x => String(x).toUpperCase();
  const dim = { t: '···', k: 'dim' };
  const letters = v => v.split('').map(ch => ({ t: up(ch), k: 'hl' }));
  const p = { ...spec };
  switch (spec.type) {
    case 'prefix2': case 'prefix3':
      Object.assign(p, { label: `${spec.value}…`, short: `${up(spec.value)}···`, sub: null, tiles: [...letters(spec.value), dim],
        hint: `Slovo musí začínat na "${spec.value}".`, placeholder: `Napiš slovo na '${spec.value}'…`, prefill: spec.value }); break;
    case 'infix2':
      Object.assign(p, { label: `…${spec.value}…`, short: `·${up(spec.value)}·`, sub: null, tiles: [dim, ...letters(spec.value), dim],
        hint: `Slovo musí obsahovat "${spec.value}" (kdekoliv).`, placeholder: `Napiš slovo obsahující '${spec.value}'…`, prefill: '' }); break;
    case 'startend':
      Object.assign(p, { label: `${spec.first}…${spec.last}`, short: `${up(spec.first)}···${up(spec.last)}`, sub: 'začátek a konec', tiles: [...letters(spec.first), dim, ...letters(spec.last)],
        hint: `Slovo musí začínat na "${spec.first}" a končit na "${spec.last}".`, placeholder: `Napiš slovo od '${spec.first}' do '${spec.last}'…`, prefill: spec.first }); break;
    case 'forbid':
      Object.assign(p, { label: `${spec.value}…, bez „${spec.forbid}“`, short: `${up(spec.value)}···`, sub: `bez „${up(spec.forbid)}“`, tiles: [...letters(spec.value), dim, { t: up(spec.forbid), k: 'ban' }],
        hint: `Slovo musí začínat na "${spec.value}" a nesmí obsahovat "${spec.forbid}".`, placeholder: `Napiš slovo na '${spec.value}' bez '${spec.forbid}'…`, prefill: spec.value }); break;
    case 'onevowel':
      Object.assign(p, { label: `${spec.value}…, jen 1 samohláska`, short: `${up(spec.value)}···`, sub: 'jen 1 samohláska', tiles: [...letters(spec.value), dim, { t: '1×', k: 'tag' }],
        hint: `Slovo musí začínat na "${spec.value}" a mít právě jednu samohlásku (a, e, i, o, u, y).`, placeholder: `Slovo na '${spec.value}', 1 samohláska…`, prefill: spec.value }); break;
    case 'double':
      Object.assign(p, { label: `dvakrát „${spec.letter}“`, short: `${up(spec.letter)}···${up(spec.letter)}`, sub: 'písmeno aspoň 2×', tiles: [...letters(spec.letter), dim, ...letters(spec.letter)],
        hint: `Slovo musí obsahovat písmeno "${spec.letter}" aspoň dvakrát (kdekoliv).`, placeholder: `Napiš slovo se dvěma '${spec.letter}'…`, prefill: '' }); break;
  }
  return p;
}

function matchesWeekly(word, p) {
  switch (p.type) {
    case 'prefix2': case 'prefix3': return word.startsWith(p.value);
    case 'infix2': return word.includes(p.value);
    case 'startend': return word.length >= 2 && word.startsWith(p.first) && word.endsWith(p.last);
    case 'forbid': return word.startsWith(p.value) && !word.includes(p.forbid);
    case 'onevowel': return word.startsWith(p.value) && (word.match(VOWELS) || []).length === 1;
    case 'double': return word.split(p.letter).length - 1 >= 2;
  }
  return false;
}

// Zadání pro týden, do kterého patří `date`.
function patternForDate(date = new Date()) {
  const k = weekIndexOf(date) - weekIndexOf(PLAN_START);
  if (k >= 0) {
    const row = PLAN[k % PLAN_WEEKS];
    const spec = row && row.specs[Math.floor(k / PLAN_WEEKS) % PLAN_BLOCKS];
    if (spec) return buildPattern(spec);
  }
  return buildPattern(weeklyPattern(date));       // před začátkem plánu (nebo chybný řádek)
}

module.exports = { patternForDate, matchesWeekly, buildPattern, parseSpec, parseCsv, loadPlan, PLAN, PLAN_START, PLAN_WEEKS, PLAN_BLOCKS };
