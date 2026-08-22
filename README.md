# Dopišto — online slovní duel

Online multiplayer verze: každý hráč hraje na svém vlastním počítači/mobilu,
hra je spáruje buď náhodně (matchmaking), nebo přes soukromý kód lobby.
Bez účtů a přihlašování — stačí přezdívka.

---

## 1. Co budeš potřebovat

- **Node.js** verze 18 nebo novější. Stáhneš na https://nodejs.org (stačí
  klikat "Next" v instalátoru).
- Textový/příkazový terminál:
  - **Windows:** PowerShell nebo Příkazový řádek (cmd)
  - **macOS:** Terminál (najdeš přes Spotlight → "Terminal")
  - **Linux:** libovolný terminál

Ověření, že máš Node.js nainstalovaný:
```bash
node -v
```
Mělo by vypsat něco jako `v18.x.x` nebo vyšší.

---

## 2. Spuštění na jednom počítači (lokální test)

1. Rozbal tento zip do libovolné složky.
2. Otevři terminál a přejdi do té složky:
   ```bash
   cd cesta/k/slozce/dopisto-online
   ```
3. Nainstaluj závislosti (jen poprvé):
   ```bash
   npm install
   ```
4. Spusť server:
   ```bash
   npm start
   ```
   V terminálu se objeví:
   ```
   Dopišto server běží na http://localhost:3000
   ```
5. Otevři v prohlížeči **http://localhost:3000** — a pro druhého hráče
   otevři **stejnou adresu v jiném okně/prohlížeči** (nebo v anonymním okně),
   ať máš dvě nezávislé "session".

Server běží, dokud terminál nezavřeš (nebo nestiskneš `Ctrl+C`).

---

## 3. Hraní přes lokální síť (dva různé počítače/mobily doma)

Pokud jsou obě zařízení připojená ke **stejné Wi-Fi**, není potřeba nic
nasazovat na internet.

1. Na počítači, kde běží server (`npm start`), zjisti jeho lokální IP adresu:
   - **Windows:** `ipconfig` → řádek "IPv4 Address" (např. `192.168.1.23`)
   - **macOS:** `ipconfig getifaddr en0`
   - **Linux:** `hostname -I`
2. Na druhém zařízení (mobil, notebook) otevři v prohlížeči:
   ```
   http://192.168.1.23:3000
   ```
   (nahraď IP adresou z kroku 1)
3. Pokud se stránka nenačte, zkontroluj, že firewall na počítači se serverem
   nepovoluje na portu 3000 příchozí spojení jen z lokální sítě (u Windows
   Defender Firewallu stačí při prvním spuštění `npm start` kliknout
   "Povolit přístup").

Tohle stačí, pokud chceš hrát jen doma s někým na stejné Wi-Fi.

---

## 4. Hraní s kýmkoliv přes internet

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

### Možnost B — trvalé nasazení (Render.com, zdarma)

Tohle dá aplikaci stálou adresu, která běží nezávisle na tvém počítači.

1. Založ si účet na https://render.com (jde i přes GitHub).
2. Nahraj tuhle složku na GitHub jako nové repo (přes web GitHubu "Add file →
   Upload files", nebo přes `git`, pokud ho používáš).
3. Na Renderu klikni **New → Web Service** a vyber svoje repo.
4. Nastav:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Klikni **Create Web Service**. Za pár minut dostaneš stálou adresu typu
   `https://dopisto.onrender.com` — tu už můžeš sdílet s kýmkoliv natrvalo.

Poznámka: na free plánu Render server po ~15 minutách neaktivity "usne" a
první další request ho o pár sekund déle probouzí — pro příležitostné hraní
to nevadí.

*(Stejným postupem — `npm install` + `npm start`, port z proměnné `PORT` —
jde nasadit i na Railway.app, Fly.io nebo jakýkoliv jiný Node.js hosting.)*

---

## 5. Jak hra funguje

- **Najít soupeře** — zařadí tě do fronty pro zvolený režim; jakmile se
  najde další čekající hráč, automaticky vás to spojí.
- **Vytvořit lobby** — vygeneruje 5znakový kód, který platí 10 minut. Pošli
  ho kamarádovi, on ho zadá do "Připojit se kódem" a spojí vás to jen mezi
  sebou (nikdo třetí se nepřipojí).
- Po nalezení soupeře se zadání kola odhalí s animací a odpočtem 3-2-1,
  pak hra začíná.
- ELO se počítá zvlášť pro každý herní režim a je vázané na přezdívku
  (žádný účet) — ukládá se na serveru do `server/data/elo.json`.

---

## 6. Struktura projektu

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
    valid_prefixes1.json   – použitelná písmena pro Blitz
    valid_infix2.json      – dvojice použitelné kdekoliv ve slově (Uprostřed)
    elo.json                – vytvoří se automaticky při první odehrané hře
client/
  index.html, app.js, logo.png – frontend (bez frameworku)
```

## 7. Co by šlo dál doladit

- Reconnect po výpadku sítě (teď odpojení uprostřed kola = prohra).
- Perzistentní databáze místo JSON souboru při větším provozu.
- Rate limiting / ochrana proti spamování matchmakingu.
- Skutečné odkazy v patičce (nyní jsou jen vizuální placeholdery).
