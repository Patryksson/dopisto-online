// Servírování klientských souborů: minifikace (pokud je k dispozici esbuild), obsahové hashe
// ve verzích (dlouhá cache bez ručního přepisování ?v=) a service worker pro rychlé opakované načtení.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'client');
const HASHED = ['styles.css', 'fx.js', 'app.js', 'desktop.js', 'br.js'];

let esbuild = null;
if (!process.env.NO_MINIFY) { try { esbuild = require('esbuild'); } catch { /* bez minifikace */ } }

function build() {
  const files = {};
  for (const name of HASHED) {
    let src = fs.readFileSync(path.join(DIR, name), 'utf8');
    if (esbuild) {
      try {
        src = esbuild.transformSync(src, { minify: true, loader: name.endsWith('.css') ? 'css' : 'js', target: 'es2019', legalComments: 'none' }).code;
      } catch (e) { console.error('minify selhalo pro', name, '-', e.message); }
    }
    const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 10);
    files[name] = { body: src, hash, type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' };
  }
  let html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  for (const name of HASHED) {
    html = html.replace(new RegExp(`((?:src|href)=")${name.replace('.', '\\.')}(?:\\?v=[^"]*)?(")`, 'g'), `$1${name}?v=${files[name].hash}$2`);
  }
  // br.js se načítá až při vstupu do Royale; verzi bere app.js z <meta name="lazy-br">
  html = html.replace(/(name="lazy-br" content=")br\.js(?:\?v=[^"]*)?(")/, `$1br.js?v=${files['br.js'].hash}$2`);
  const version = crypto.createHash('sha1').update(HASHED.map(n => files[n].hash).join('') + html).digest('hex').slice(0, 10);
  const shell = ['/', '/socket.io/socket.io.js', ...HASHED.map(n => `/${n}?v=${files[n].hash}`), '/site-config.js', '/logo.png', '/manifest.webmanifest', '/favicon-32.png', '/icon-192.png'];
  const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8')
    .replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell));
  return { files, html, sw, version };
}

function mount(app) {
  const built = build();
  const send = (res, body, type, cache) => { res.setHeader('Content-Type', type); res.setHeader('Cache-Control', cache); res.send(body); };
  // Absolutní adresy pro náhled odkazu (og:image musí být plná URL). PUBLIC_URL má přednost.
  const origin = (req) => {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return '';
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  };
  app.get(['/', '/index.html'], (req, res) => send(res, built.html.replace(/__ORIGIN__/g, origin(req)), 'text/html; charset=utf-8', 'no-cache'));
  app.get('/sw.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); send(res, built.sw, 'application/javascript; charset=utf-8', 'no-cache'); });
  for (const name of HASHED) {
    app.get('/' + name, (req, res) => {
      const f = built.files[name];
      // s ?v=<hash> je soubor neměnný → rok v cache; bez verze vždy ověřit
      send(res, f.body, f.type, req.query.v === f.hash ? 'public, max-age=31536000, immutable' : 'no-cache');
    });
  }
  console.log(`Klientské soubory: ${esbuild ? 'minifikované' : 'bez minifikace'}, verze ${built.version}`);
}

module.exports = { mount };
