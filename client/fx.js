// Vizuální efekty: prasknutí srdcí, konfety, záblesk. Čisté DOM + CSS animace.
// Respektují nastavení systému "omezit pohyb" (prefers-reduced-motion).

function fxReduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function fxLayer() {
  let l = document.getElementById('fxLayer');
  if (!l) { l = document.createElement('div'); l.id = 'fxLayer'; document.body.appendChild(l); }
  return l;
}

// Srdce "prasknou" a rozletí se z místa elementu el. big = silnější efekt (vypadnutí).
function fxHeartBurst(el, big) {
  if (!el || fxReduced()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const layer = fxLayer();
  const n = big ? 18 : 11;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    const broken = i === 0;
    s.className = 'fx-heart' + (broken ? ' broken' : '');
    s.textContent = broken ? '💔' : (big && i % 5 === 0 ? '💀' : '❤');
    const ang = Math.random() * Math.PI * 2;
    const dist = (broken ? 30 : 50) + Math.random() * (big ? 120 : 80);
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist - 30 + 'px');
    s.style.setProperty('--rot', (Math.random() * 280 - 140) + 'deg');
    s.style.fontSize = (broken ? 30 : 12 + Math.random() * 12) + 'px';
    s.style.animationDelay = (broken ? 0 : Math.random() * 120) + 'ms';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}

// Záblesk přes celou obrazovku v dané barvě (rgb "r,g,b").
function fxFlash(rgb) {
  if (fxReduced()) return;
  const f = document.createElement('div');
  f.className = 'fx-flash';
  f.style.background = `radial-gradient(circle at 50% 40%, rgba(${rgb || '255,255,255'}, .55), transparent 65%)`;
  fxLayer().appendChild(f);
  setTimeout(() => f.remove(), 800);
}

// Konfety + zlatá záře při výhře.
function fxConfetti(palette, power) {
  if (fxReduced()) return;
  const k = power || 1;
  const layer = fxLayer();
  if (k >= 1) {
    const glow = document.createElement('div');
    glow.className = 'fx-glow';
    layer.appendChild(glow);
    setTimeout(() => glow.remove(), 2600);
  }
  const colors = palette || ['#ff3b30', '#ffc93c', '#34d399', '#3b82f6', '#a855f7', '#fb923c', '#ffffff'];
  const n = Math.round(80 * k);
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'fx-conf';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.width = 6 + Math.random() * 6 + 'px';
    c.style.height = 8 + Math.random() * 10 + 'px';
    c.style.setProperty('--sway', (Math.random() * 120 - 60) + 'px');
    c.style.setProperty('--spin', (360 + Math.random() * 720) + 'deg');
    c.style.animationDuration = 3 + Math.random() * 2.4 + 's';
    c.style.animationDelay = Math.random() * 0.9 + 's';
    layer.appendChild(c);
    setTimeout(() => c.remove(), 7000);
  }
}

// Napětí: poslední sekundy tahu — červená vinětace a chvění času. Sama zhasne, když ji nikdo neobnovuje.
let fxDangerAt = 0;
function fxDanger(on) {
  const b = document.body;
  if (on) { fxDangerAt = Date.now(); b.classList.add('danger'); } else b.classList.remove('danger');
}
setInterval(() => {
  if (document.body.classList.contains('danger') && Date.now() - fxDangerAt > 700) document.body.classList.remove('danger');
}, 300);

// Vyřazený hráč se rozpadne na úlomky v jeho barvě.
function fxShatter(el, rgb) {
  if (!el || fxReduced()) return;
  const r = el.getBoundingClientRect();
  const layer = fxLayer();
  const cols = rgb ? [`rgb(${rgb})`, `rgba(${rgb},.7)`, '#ffffff'] : ['#ff3b30', '#ffffff'];
  for (let i = 0; i < 22; i++) {
    const s = document.createElement('i');
    s.className = 'fx-shard';
    const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.background = cols[i % cols.length];
    s.style.width = 5 + Math.random() * 9 + 'px';
    s.style.height = 5 + Math.random() * 9 + 'px';
    s.style.setProperty('--dx', (x - (r.left + r.width / 2)) * (1.2 + Math.random()) + 'px');
    s.style.setProperty('--dy', 60 + Math.random() * 110 + 'px');
    s.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
    s.style.animationDelay = Math.random() * 80 + 'ms';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}
