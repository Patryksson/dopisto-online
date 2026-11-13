// Vánoční výzdoba: od 1. adventní neděle do 6. ledna (včetně). Čistě vizuální vrstva menu.
// Zkouška mimo sezónu: otevři stránku s ?xmas=1 (zapnout) nebo ?xmas=0 (vypnout, platí i příště).
(function () {
  function adventStart(y) {
    const dow = new Date(y, 11, 25).getDay();                 // 0 = neděle
    return new Date(y, 11, 25 - (dow === 0 ? 7 : dow) - 21);  // 1. adventní neděle = 4. neděle před Štědrým dnem
  }
  function inSeason(now) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (t >= adventStart(now.getFullYear())) return true;
    return now.getMonth() === 0 && now.getDate() <= 6;
  }
  let forced = null;
  try {
    const q = new URLSearchParams(location.search).get('xmas');
    if (q === '1' || q === '0') localStorage.setItem('dopisto_xmas', q);
    const f = localStorage.getItem('dopisto_xmas');
    forced = f === '1' ? true : f === '0' ? false : null;
  } catch {}
  const available = () => forced === null ? inSeason(new Date()) : forced;
  function prefs() { try { return JSON.parse(localStorage.getItem('dopisto_sound_prefs') || '{}'); } catch { return {}; } }
  const isOn = () => available() && prefs().xmas !== false;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.xmasSeason = inSeason;
  window.xmasAvailable = available;
  window.XMAS = isOn();
  window.logoSrc = () => isOn() ? 'xmas/logo-hat.webp' : 'logo.png';
  window.xmasGarland = () => available() ? '<div class="xm-garland" aria-hidden="true"><img src="xmas/garland.webp" decoding="async" alt="" draggable="false"></div>' : '';

  // ----- sněžení (jedno malé plátno, jen na hlavní stránce, ~30 snímků/s) -----
  let cv = null, ctx = null, flakes = [], raf = 0, last = 0, W = 0, H = 0;
  function resize() { if (!cv) return; W = cv.width = innerWidth; H = cv.height = innerHeight; }
  function seed() {
    flakes = [];
    const n = Math.round(Math.min(46, Math.max(18, W * H / 26000)));
    for (let i = 0; i < n; i++) flakes.push({ x: Math.random() * W, y: Math.random() * H, r: .8 + Math.random() * 1.7, v: 14 + Math.random() * 26, a: Math.random() * 6.28, s: .4 + Math.random() * .8 });
  }
  function onHome() { return true; }   // sněží na všech obrazovkách
  function frame(t) {
    raf = 0;
    if (!cv || document.hidden || !onHome()) { if (ctx) ctx.clearRect(0, 0, W, H); poll(); return; }
    const dt = Math.min(.1, (t - last) / 1000 || .033);
    if (t - last >= 32) {
      last = t;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (const f of flakes) {
        f.y += f.v * dt; f.a += f.s * dt; f.x += Math.sin(f.a) * 8 * dt;
        if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
        ctx.globalAlpha = .25 + f.r * .28;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
      }
    }
    raf = requestAnimationFrame(frame);
  }
  let pollT = 0;
  function poll() { if (!pollT) pollT = setTimeout(() => { pollT = 0; snow(); }, 700); }
  function snow() {
    const want = isOn() && prefs().snow !== false && !reduced();
    if (!want) { if (cv) { cv.remove(); cv = ctx = null; } if (raf) { cancelAnimationFrame(raf); raf = 0; } return; }
    if (!cv) {
      cv = document.createElement('canvas'); cv.className = 'xm-snow'; cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv); ctx = cv.getContext('2d'); resize(); seed();
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  addEventListener('resize', () => { resize(); seed(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) snow(); });

  // ----- použití / přepnutí motivu (volá se po každém vykreslení menu a po změně v nastavení) -----
  window.xmasApply = function () {
    const on = isOn();
    window.XMAS = on;
    document.documentElement.classList.toggle('xmas', on);
    const logo = document.querySelector('.page.home .logo');
    if (logo) { const s = on ? 'xmas/logo-hat.webp' : 'logo.png'; if (!logo.src.endsWith(s)) { logo.src = s; } }
    const tg = document.querySelector('.page.home .tagline'); if (tg) tg.textContent = on ? 'Vánoční edice' : 'Slovní online duel';
    const bt = document.querySelector('.page.home .bc-title');
    if (bt) bt.innerHTML = on ? '<img class="xm-ico" decoding="async" src="xmas/tree.webp" alt="" width="14" height="16"> Vánoční bonus' : '✦ Denní bonus';
    const sp = document.querySelector('#splash img');
    if (sp && on) { sp.src = 'xmas/d-hat.webp'; sp.removeAttribute('width'); sp.removeAttribute('height'); }
    const pb = document.getElementById('playBtn');
    if (on && pb && !pb.querySelector('.xm-snowcap')) pb.insertAdjacentHTML('afterbegin', '<img class="xm-snowcap" decoding="async" src="xmas/snow.webp" alt="" aria-hidden="true" draggable="false">');
    const card = document.querySelector('.page.home .card');
    if (on && card && !card.querySelector('.xm-drift')) card.insertAdjacentHTML('beforeend', '<div class="xm-drift" aria-hidden="true"><svg viewBox="0 0 400 26" preserveAspectRatio="none"><path d="M0 26V14Q35 3 75 11T150 9T230 12T310 8T400 13V26Z" fill="#cfe6ff"/><path d="M0 26V19Q50 11 110 17T220 16T330 17T400 18V26Z" fill="#fff"/></svg></div>');
    snow();
  };
  if (isOn()) {
    document.documentElement.classList.add('xmas');
    const sp = document.querySelector('#splash img');
    if (sp) { sp.src = 'xmas/d-hat.webp'; sp.removeAttribute('width'); sp.removeAttribute('height'); }
    if (document.body) snow(); else addEventListener('DOMContentLoaded', snow);
  }
})();
