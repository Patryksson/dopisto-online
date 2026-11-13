// Málo používané části (právní stránky/FAQ a obrázek pro sdílení výsledku). Stahuje se až při potřebě – viz loadExtra() v app.js.
function infoPageContent(key) {
  switch (key) {
    case 'faq':
      return { title: 'Časté dotazy', body: FAQ_ITEMS.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('') };
    case 'kontakt':
      return { title: 'Kontakt', body: `
        <p>Máš dotaz, nápad nebo problém? Ozvi se nám.</p>
        <h2>Provozovatel</h2><p>${siteOperator()}${SITE.address ? '<br>' + esc(SITE.address) : ''}</p>
        <h2>E-mail</h2><p>${siteEmail()}</p>
        <h2>Chyby a nápady</h2><p>Nejrychlejší je <a href="#nahlasit">formulář pro nahlášení chyby</a>.</p>` };
    case 'podminky':
      return { title: 'Obchodní podmínky', body: `
        <p>Tyto podmínky upravují používání webové hry ${esc(SITE.name || 'Dopišto')} (dále „hra“). Provozovatel: ${siteOperator()}.</p>
        <h2>1. Používání hry</h2>
        <p>Hra je poskytována zdarma, bez registrace. Používáním hry souhlasíš s těmito podmínkami. Hra je určena pro zábavu a nezaručuje nepřetržitou dostupnost.</p>
        <h2>2. Pravidla chování</h2>
        <ul><li>Nepoužívej urážlivé, vulgární nebo klamavé přezdívky.</li>
        <li>Nepokoušej se narušit chod hry (automatizované požadavky, zneužití chyb, obcházení omezení).</li>
        <li>Nevydávej se za jiného hráče.</li></ul>
        <p>Provozovatel může přezdívku odmítnout či odstranit z žebříčku a omezit přístup při porušení pravidel.</p>
        <h2>3. Žebříček a výsledky</h2>
        <p>ELO a výsledky jsou orientační a mohou být upraveny či resetovány (např. při chybě nebo při změně pravidel).</p>
        <h2>4. Odpovědnost</h2>
        <p>Hra je poskytována „tak, jak je“. Provozovatel neodpovídá za škody způsobené výpadkem nebo chybou hry v rozsahu, v jakém to dovoluje zákon.</p>
        <h2>5. Změny podmínek</h2>
        <p>Podmínky se mohou měnit. Aktuální znění je vždy na této stránce.</p>
        <p style="color:var(--muted);font-size:12px">Poslední úprava: říjen 2026. Tento text je obecná šablona — před veřejným spuštěním ho nech zkontrolovat.</p>` };
    case 'ochrana-udaju':
      return { title: 'Ochrana údajů', body: `
        <p>Správcem osobních údajů je ${siteOperator()}. Kontakt: ${siteEmail()}.</p>
        <h2>Jaké údaje zpracováváme</h2>
        <ul>
          <li><b>Přezdívka</b> — zadáváš ji sám/sama. Zobrazuje se soupeři a v žebříčku.</li>
          <li><b>Výsledky her</b> — ELO, počet výher a proher, výsledky Denní výzvy (nejlepší výsledek dne podle přezdívky, uchovává se několik dní).</li>
          <li><b>IP adresa</b> — používá se pouze dočasně v paměti serveru k ochraně proti zneužití (omezení počtu spojení). Neukládá se do databáze.</li>
          <li><b>Hlášení chyb</b> — text, který sám odešleš přes formulář, a volitelný kontakt.</li>
        </ul>
        <h2>Co ukládáme ve tvém prohlížeči</h2>
        <p>Přezdívku, nastavení zvuku, sérii Denní výzvy a dnešní výsledek. Hra nepoužívá sledovací cookies ani analytiku třetích stran.</p>
        <h2>Účel a doba uložení</h2>
        <p>Údaje slouží k provozu hry (hledání soupeřů, žebříček). Přezdívka a ELO se uchovávají, dokud hra běží nebo dokud nepožádáš o smazání.</p>
        <h2>Tvá práva</h2>
        <p>Můžeš požádat o přístup k údajům, jejich opravu nebo smazání a podat stížnost u Úřadu pro ochranu osobních údajů (uoou.cz). Napiš na ${siteEmail()}.</p>
        <p style="color:var(--muted);font-size:12px">Poslední úprava: říjen 2026. Tento text je obecná šablona — před veřejným spuštěním ho nech zkontrolovat.</p>` };
    case 'cookies':
      return { title: 'Nastavení cookies', body: `
        <p>Hra nepoužívá cookies pro sledování ani reklamu. K fungování používá pouze <b>úložiště v prohlížeči</b> (localStorage):</p>
        <ul><li>přezdívka,</li><li>nastavení zvuku a vibrací,</li><li>série a dnešní výsledek Denní výzvy.</li></ul>
        <p>Toto úložiště je nezbytné pro fungování hry, proto se k němu neptáme na souhlas.</p>
        <div class="menu-list" style="margin-top:16px"><button class="secondary small" id="clearDataBtn" style="width:100%">Smazat data z tohoto zařízení</button></div>
        <div class="info-ok" id="clearDataMsg"></div>` };
    case 'nahlasit':
      return { title: 'Nahlásit chybu', body: `
        <p>Něco nefunguje, chybí ti slovo ve slovníku nebo chceš nahlásit hráče? Napiš nám.</p>
        <div class="info-form">
          <label for="repType">O co jde</label>
          <select id="repType">
            <option value="bug">Chyba ve hře</option>
            <option value="word">Chybí / je špatně slovo ve slovníku</option>
            <option value="player">Nahlásit hráče</option>
            <option value="idea">Nápad na vylepšení</option>
          </select>
          <label for="repText">Popis</label>
          <textarea id="repText" maxlength="1000" placeholder="Popiš, co se stalo, nebo napiš slovo / přezdívku hráče…"></textarea>
          <label for="repContact">Kontakt (nepovinné)</label>
          <input id="repContact" maxlength="80" placeholder="E-mail, pokud chceš odpověď" />
          <div class="menu-list" style="margin-top:16px"><button class="menu-item" id="repSend"><span>Odeslat</span></button></div>
          <div class="error" id="repErr"></div>
          <div class="info-ok" id="repOk"></div>
        </div>` };
    default:
      return null;
  }
}

function renderInfoPage(key) {
  const page = infoPageContent(key);
  if (!page) { renderMenu(); return; }
  clearInterval(menuTimer);
  app.innerHTML = `
    <div class="page">
    <div class="card info-card">
      <button class="icon-btn sound-toggle" id="soundBtn">${soundIconHtml()}</button>
      <button type="button" class="back-link" id="infoBackBtn">‹ Zpět</button>
      <h1>${page.title}</h1>
      <div class="divider"><span class="line"></span><span class="diamond">◇</span><span class="line"></span></div>
      <div class="info-body">${page.body}</div>
    </div>
    </div>`;
  document.getElementById('soundBtn').onclick = toggleSound;
  document.getElementById('infoBackBtn').onclick = () => { location.hash = ''; renderMenu(); };
  window.scrollTo(0, 0);

  if (key === 'cookies') {
    document.getElementById('clearDataBtn').onclick = () => {
      if (!confirm('Smazat přezdívku, nastavení a uložené výsledky z tohoto zařízení?')) return;
      try { localStorage.clear(); } catch {}
      document.getElementById('clearDataMsg').textContent = 'Hotovo — data z tohoto zařízení byla smazána.';
    };
  }
  if (key === 'nahlasit') {
    document.getElementById('repSend').onclick = () => {
      const text = document.getElementById('repText').value.trim();
      const err = document.getElementById('repErr');
      const ok = document.getElementById('repOk');
      err.textContent = ''; ok.textContent = '';
      if (text.length < 5) { err.textContent = 'Napiš prosím aspoň pár slov.'; return; }
      socket.emit('submit_report', {
        type: document.getElementById('repType').value,
        text,
        contact: document.getElementById('repContact').value.trim(),
        nickname: loadNickname(),
      }, (res) => {
        if (res && res.ok) { ok.textContent = 'Díky! Hlášení bylo odesláno.'; document.getElementById('repText').value = ''; }
        else err.textContent = (res && res.message) || 'Odeslání se nepovedlo, zkus to později.';
      });
    };
  }
}


function generateDailyShareImage(data) {
  if (readDailyHide()) return generateDailyShareImageHidden(data);
  const MAX_WORDS = 90;          // víc slov se na obrázek nevejde rozumně
  const WORD_FONT = '15px Arial, sans-serif';
  const LINE_H = 24;
  const words = (data.words || []).slice(0, MAX_WORDS);
  const extra = Math.max(0, (data.words || []).length - words.length);

  // Nejdřív změř, kolik řádků slova zaberou, ať má obrázek správnou výšku.
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = WORD_FONT;
  const lines = layoutWordLines(probe, words.map(w => w.toUpperCase()), 480);
  if (extra) lines.push(`+ ${extra} dalších`);
  const wordsTop = 520;
  const height = Math.max(760, wordsTop + (lines.length || 1) * LINE_H + 90);

  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 600, height);
  ctx.fillStyle = '#ff3131';
  ctx.fillRect(0, 0, 600, 12);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 42px Arial, sans-serif';
  ctx.fillText('DOPIŠTO', 300, 100);

  ctx.fillStyle = '#ff3131';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('DENNÍ VÝZVA', 300, 132);

  ctx.fillStyle = '#8890a6';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('cs-CZ'), 300, 160);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px Arial, sans-serif';
  ctx.fillText(data.pattern.value.toUpperCase() + '···', 300, 230);

  ctx.fillStyle = '#ff3131';
  ctx.font = '700 130px Arial, sans-serif';
  ctx.fillText(String(data.wordCount), 300, 390);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText('SLOV ZA 180 SEKUND', 300, 430);

  // oddělovací čára + nadpis seznamu slov
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(60, 458, 480, 1);
  ctx.fillStyle = '#ff3131';
  ctx.font = '700 13px Arial, sans-serif';
  ctx.fillText('MÁ SLOVA', 300, 488);

  ctx.fillStyle = '#c9ccd6';
  ctx.font = WORD_FONT;
  if (!lines.length) ctx.fillText('—', 300, wordsTop);
  lines.forEach((line, i) => ctx.fillText(line, 300, wordsTop + i * LINE_H));

  ctx.fillStyle = '#5a5a5a';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText((window.SITE && window.SITE.domain) || location.host || 'Dopišto', 300, height - 30);

  return canvas;
}

// Zmenšená verze: jen počet slov, bez zadání a bez seznamu slov (nikomu nic neprozradí).
function generateDailyShareImageHidden(data) {
  const H = 664;
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 600, H);
  ctx.fillStyle = '#ff3131'; ctx.fillRect(0, 0, 600, 12);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = '700 42px Arial, sans-serif'; ctx.fillText('DOPIŠTO', 300, 100);
  ctx.fillStyle = '#ff3131'; ctx.font = '700 20px Arial, sans-serif'; ctx.fillText('DENNÍ VÝZVA', 300, 132);
  ctx.fillStyle = '#8890a6'; ctx.font = '16px Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('cs-CZ'), 300, 160);
  ctx.fillStyle = '#ff3131'; ctx.font = '700 150px Arial, sans-serif'; ctx.fillText(String(data.wordCount), 300, 310);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 22px Arial, sans-serif'; ctx.fillText('SLOV ZA 180 SEKUND', 300, 352);

  // Sloupcový profil: kolik slov mělo 3, 4, 5, 6, 7 a 8+ písmen (žádná písmena slov se neukazují).
  const { counts, longest } = wordLengthProfile(data.words);
  const max = Math.max(...counts, 1);
  const labels = ['3', '4', '5', '6', '7', '8+'];
  const bw = 52, gap = 16, total = labels.length * bw + (labels.length - 1) * gap;
  const x0 = (600 - total) / 2, base = 540, maxH = 120;
  counts.forEach((c, i) => {
    const h = c ? Math.max(8, Math.round((c / max) * maxH)) : 3;
    const x = x0 + i * (bw + gap);
    const g = ctx.createLinearGradient(0, base - h, 0, base);
    g.addColorStop(0, '#ff5a3c'); g.addColorStop(1, '#c4352e');
    ctx.fillStyle = c ? g : '#2a2d37';
    ctx.fillRect(x, base - h, bw, h);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 15px Arial, sans-serif'; ctx.fillText(String(c), x + bw / 2, base - h - 8);
    ctx.fillStyle = '#8890a6'; ctx.font = '14px Arial, sans-serif'; ctx.fillText(labels[i], x + bw / 2, base + 20);
  });
  ctx.fillStyle = '#8890a6'; ctx.font = '12px Arial, sans-serif'; ctx.fillText('počet slov podle délky', 300, base + 40);
  const n = currentStreak();
  ctx.fillStyle = '#c9ccd6'; ctx.font = '700 16px Arial, sans-serif';
  ctx.fillText(`Nejdelší slovo: ${longest} písmen${n > 1 ? ` · 🔥 ${n} dní v řadě` : ''}`, 300, base + 68);
  ctx.fillStyle = '#5a5a5a'; ctx.font = '13px Arial, sans-serif';
  ctx.fillText((window.SITE && window.SITE.domain) || location.host || 'Dopišto', 300, H - 18);
  return canvas;
}

// Rozdělí slova do řádků (oddělených „ · “) tak, aby se vešly do maxWidth.
function layoutWordLines(ctx, words, maxWidth) {
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} · ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}


window.extraReady = true;
