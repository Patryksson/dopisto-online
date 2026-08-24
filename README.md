# Dopišto — online slovní duel

Online multiplayer verze: každý hráč hraje na svém vlastním počítači/mobilu,
hra je spáruje buď náhodně (matchmaking), nebo přes soukromý kód lobby.
Bez účtů a přihlašování — stačí přezdívka.

---

## 1. Důležité: server běží jen na jednom počítači

Jen **jeden** z počítačů potřebuje mít nainstalovaný Node.js a spuštěný
server (`npm start`). Druhý hráč (i na mobilu) nic instalovat nemusí —
stačí mu otevřít prohlížeč a zadat adresu.

---

## 2. Instalace Node.js (jen na počítači, kde poběží server)

### Windows
1. Jdi na **nodejs.org**
2. Klikni na zelené tlačítko **"LTS"** — stáhne se `.msi` soubor
3. Dvojklikem ho spusť
4. Klikej **Next → Next → Next → Install → Finish** (nic neměň)

### macOS
1. Jdi na **nodejs.org**
2. Klikni na **"LTS"** — stáhne se `.pkg` soubor
3. Dvojklikem spusť, klikej **Continue → Continue → Agree → Install**
4. Zadej heslo do macu, když o něj požádá

Ověření, že instalace proběhla (volitelné) — otevři terminál a napiš:
```bash
node -v
```
Mělo by vypsat něco jako `v18.x.x` nebo vyšší.

---

## 3. Rozbalení a spuštění serveru

### Rozbalení
- **Windows:** pravý klik na zip → **"Extrahovat vše..."** → **Extrahovat**
- **macOS:** dvojklik na zip — rozbalí se automaticky vedle sebe

Vznikne složka `dopisto-online`.

### Spuštění — Windows
1. Otevři tu složku v Průzkumníku
2. Podrž **Shift** a klikni **pravým tlačítkem** kdekoliv v prázdném místě
   uvnitř složky
3. Vyber **"Otevřít okno PowerShellu zde"** (na Windows 11 jen **"Otevřít
   v terminálu"**)
4. Napiš a stiskni Enter:
   ```bash
   npm install
   ```
   (chvíli stahuje, 10–30 vteřin)
5. Napiš a stiskni Enter:
   ```bash
   npm start
   ```
6. Měl bys vidět `Dopišto server běží na http://localhost:3000`
7. **Pokud vyskočí okno Windows Defender Firewallu**, zaškrtni obě možnosti
   (soukromé i veřejné sítě) a klikni **Povolit přístup** — bez toho se
   k tobě druhý počítač nepřipojí.

### Spuštění — macOS
1. Stiskni **Cmd + mezerník**, napiš `Terminal`, Enter
2. Napiš `cd ` (s mezerou na konci), pak **přetáhni** složku `dopisto-online`
   myší přímo do okna terminálu — cesta se doplní sama. Stiskni Enter
3. Napiš a Enter:
   ```bash
   npm install
   ```
4. Napiš a Enter:
   ```bash
   npm start
   ```
5. Uvidíš `Dopišto server běží na http://localhost:3000`
6. Pokud se zeptá na povolení příchozích spojení, klikni **Povolit / Allow**

**Okno terminálu nech otevřené a nezavírej ho** — jeho zavřením (nebo
`Ctrl+C`) se server pro oba hráče vypne.

### Otevření hry na tomto počítači
Otevři prohlížeč a do adresního řádku napiš:
```
localhost:3000
```

---

## 4. Hraní přes lokální síť (dva různé počítače/mobily doma)

Pokud jsou obě zařízení připojená ke **stejné Wi-Fi**, není potřeba nic
nasazovat na internet.

### Zjištění IP adresy počítače se serverem

**Windows:**
1. Otevři **nové** okno PowerShellu/cmd (server nech běžet v tom starém!)
2. Napiš `ipconfig` a Enter
3. Najdi sekci "Bezdrátové připojení k síti LAN" (Wi-Fi) a řádek
   **IPv4 adresa**, např. `192.168.1.23`

**macOS:**
1. **Nastavení systému → Wi-Fi → "Podrobnosti"** u připojené sítě
2. Uvidíš IP adresu, např. `192.168.1.23`
   *(nebo v terminálu: `ipconfig getifaddr en0`)*

**Linux:** `hostname -I`

### Připojení z druhého zařízení
1. Na druhém počítači/mobilu (musí být na **stejné** Wi-Fi) otevři prohlížeč
2. Do adresního řádku napiš IP adresu i s portem:
   ```
   192.168.1.23:3000
   ```
   (nahraď svou skutečnou IP adresou z kroku výše)
3. Naskočí stejná obrazovka Dopišto — zadejte si přezdívky a spárujte se
   přes matchmaking, nebo ať jeden založí lobby a druhý zadá kód

Pozor na veřejné Wi-Fi sítě (kavárny, hotely) — ty často zařízení mezi
sebou izolují a tohle nebude fungovat. Doma to funguje bez problémů.

---

## 5. Hraní s kýmkoliv přes internet


Aby se k tobě mohl připojit kamarád odjinud, musí být server dostupný na
veřejné internetové adrese. Dvě možnosti — rychlá dočasná (ngrok) a trvalá
(nasazení na hosting).

### Možnost A — ngrok (nejrychlejší, na pár hodin/dní)

Ngrok vytvoří dočasný veřejný odkaz na tvůj lokálně běžící server. Ideální
pro "zahrát si teď s kamarádem", ne pro trvalý provoz.

1. Spusť server lokálně (`npm start`), ať běží na `localhost:3000`.
2. Stáhni ngrok: https://ngrok.com/download (zdarma s registrací).
3. V dalším terminálu spusť:
   ```bash
   ngrok http 3000
   ```
4. Ngrok vypíše veřejnou adresu, např.:
   ```
   Forwarding   https://a1b2-c3d4.ngrok-free.app -> http://localhost:3000
   ```
5. Tuhle adresu (`https://a1b2-c3d4.ngrok-free.app`) pošli kamarádovi —
   funguje odkudkoliv na světě, dokud běží tvůj server i ngrok.

Adresa se při každém spuštění ngroku mění (na free plánu), takže ji musíš
poslat znovu při dalším hraní.

### Možnost B — trvalé nasazení na web (Render.com, zdarma)

Tohle dá aplikaci stálou adresu (např. `dopisto.onrender.com`), která běží
nezávisle na tvém počítači — nemusíš mít nic zapnuté, funguje to pořád.
Postup je přes **GitHub** (úložiště kódu) + **Render.com** (hosting).

#### 1. Založ si účet na GitHubu

1. Jdi na **github.com** → **Sign up**
2. Zadej e-mail, heslo, uživatelské jméno, projdi ověření
3. Potvrď e-mail (přijde odkaz do schránky)

#### 2. Vytvoř nové úložiště (repository)

1. Klikni **"+"** vpravo nahoře → **"New repository"**
2. Do **Repository name** napiš třeba `dopisto-online`
3. Nech zaškrtnuté **Public**
4. Nic dalšího nezaškrtávej (žádný README/.gitignore/licence — nahrajeme
   vlastní soubory)
5. Klikni zeleně **"Create repository"**

#### 3. Nahraj soubory hry

1. Na stránce nového repozitáře klikni na odkaz **"uploading an existing
   file"**
2. Otevři na počítači rozbalenou složku `dopisto-online` a přetáhni do
   prohlížeče: složku `server`, složku `client`, `package.json`,
   `package-lock.json`, `README.md`, `.gitignore`
   - ⚠️ **Nepřetahuj `node_modules`**, pokud existuje — Render si závislosti
     nainstaluje sám, ta složka je zbytečně velká
3. Počkej, až nahrávání doběhne
4. Sjeď dolů, nech výchozí commit zprávu, klikni zeleně **"Commit changes"**

#### 4. Založ si účet na Render.com

1. Jdi na **render.com** → **"Get Started"**
2. Vyber **"Sign up with GitHub"** (nejjednodušší, rovnou propojí účty)
3. Klikni **"Authorize Render"**

#### 5. Vytvoř webovou službu

1. V Render dashboardu klikni **"New +"** → **"Web Service"**
2. Najdi `dopisto-online` a klikni **"Connect"** (pokud repo nevidíš, klikni
   "Configure account" a v GitHubu Renderu povol k němu přístup)
3. Vyplň:
   - **Name:** `dopisto` (stane se součástí adresy)
   - **Region:** nejbližší k tobě (např. Frankfurt)
   - **Branch:** `main`
   - **Root Directory:** nech prázdné
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. Klikni dole **"Create Web Service"**

#### 6. Počkej na nasazení

Render bude stahovat a instalovat balíčky (živý log na obrazovce). Za cca
1–3 minuty se objeví zelená tečka **"Live"** a nad logem tvoje adresa, např.
`https://dopisto.onrender.com`.

#### 7. Vyzkoušej a sdílej

Otevři tu adresu v prohlížeči — naskočí Dopišto stejně jako lokálně. Teď ji
můžeš poslat komukoliv, odkudkoliv — otevřou si ji a rovnou hrají, nic
instalovat nemusí.

**Poznámky:**
- Na free plánu server po ~15 minutách bez návštěvy "usne" — první další
  otevření trvá o 20–50 vteřin déle (probouzení), pak běží normálně.
- Free plán nemá trvalý disk mezi nasazeními, takže `server/data/elo.json`
  (žebříček) se při každém dalším nahrání nové verze kódu vynuluje. Pro
  příležitostné hraní to nevadí.
- Při další úpravě kódu stačí soubory znovu nahrát na GitHub stejným
  postupem (Add file → Upload files) — Render se pak sám znovu nasadí.

*(Stejným principem — `npm install` + `npm start`, port z proměnné `PORT` —
jde nasadit i na Railway.app, Fly.io nebo jiný Node.js hosting.)*

---

## 6. Jak hra funguje

- **Najít soupeře** — zařadí tě do fronty pro zvolený režim. Páruje podle
  ELO: nejdřív hledá soupeře s podobným hodnocením (rozdíl do ~100 bodů),
  a čím déle nikdo podobný nepřijde, tím víc se tolerance rozšiřuje — takže
  i o samotě ve frontě se nakonec spáruješ s kýmkoliv dalším čekajícím.
- Před startem kola vidíš **ELO obou hráčů** vedle sebe ("Ty vs soupeř").
- **Vytvořit lobby** — vygeneruje 5znakový kód, který platí 10 minut. Pošli
  ho kamarádovi, on ho zadá do "Připojit se kódem" a spojí vás to jen mezi
  sebou (nikdo třetí se nepřipojí).
- Po nalezení soupeře se zadání kola odhalí s animací a odpočtem 3-2-1,
  pak hra začíná.
- **Výpadek spojení není hned prohra** — když někomu spadne wifi nebo
  zavře kartu, má 15 sekund na návrat (obě hodiny se na tu dobu zastaví,
  aby o čas nikdo nepřišel). Stihne-li se vrátit, hra pokračuje přesně tam,
  kde skončila. Nestihne-li, prohrává on.
- ELO se počítá zvlášť pro každý herní režim a je vázané na přezdívku
  (žádný účet) — ukládá se na serveru do `server/data/elo.json`.
- Během hry můžeš soupeři poslat rychlou **emoji reakci** (👍😂🔥🤔💀⏳) —
  vyskočí mu animovaně nad hodinami. Max. jedna za vteřinu, ať to nejde
  zaspamovat.
- Na výsledkové obrazovce je sbalitelná **historie slov** celého kola —
  kdo co napsal a v jakém pořadí.
- Za každé **správně** odeslané slovo dostaneš **bonus k hlavnímu času**
  (+3 s, v režimu 1 písmeno +1 s) — nejde ale přesáhnout startovní hodnotu.
- **Žebříček** je samostatná stránka dostupná z hlavního menu, s vlastním
  přepínačem režimu.

---

## 7. Struktura projektu

```
server/
  index.js       – Express + Socket.io server
  game.js        – matchmaking, lobby, kola, časomíra, tresty
  dictionary.js  – validace slov a generování zadání
  elo.js         – výpočet ELO
  store.js       – ukládání ELO/žebříčku (JSON soubor, bez účtů)
  data/
    words.txt              – český slovník (~250 000 slov)
    valid_prefixes2/3.json – použitelné dvojice/trojice písmen
    valid_prefixes1.json   – použitelná písmena pro režim 1 písmeno
    valid_infix2.json      – dvojice použitelné kdekoliv ve slově (Uprostřed)
    elo.json                – vytvoří se automaticky při první odehrané hře
client/
  index.html, app.js, logo.png – frontend (bez frameworku)
```

## 8. Co by šlo dál doladit

- Reconnect po výpadku sítě (teď odpojení uprostřed kola = prohra).
- Perzistentní databáze místo JSON souboru při větším provozu.
- Rate limiting / ochrana proti spamování matchmakingu.
- Skutečné odkazy v patičce (nyní jsou jen vizuální placeholdery).
