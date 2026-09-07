const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');
const { Server } = require('socket.io');
const { setupGame, startMatchmakingLoop } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Gzip/brotli komprese odpovědí — na mobilní síti citelně zrychlí načtení
// app.js/index.html (menší přenos = méně dat, méně baterie na rádiu).
app.use(compression());

app.use(express.static(path.join(__dirname, '..', 'client'), {
  etag: true,
  lastModified: true,
  // Logo se prakticky nemění — ať ho prohlížeč dlouho cachuje. HTML/JS jsou
  // malé soubory, krátká cache + etag revalidace stačí (rychlé, ale pořád
  // aktuální po nasazení nové verze).
  setHeaders(res, filePath) {
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.webp')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 dní
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate'); // 1 hodina
    }
  },
}));

startMatchmakingLoop(io);

io.on('connection', (socket) => {
  setupGame(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dopišto server běží na http://localhost:${PORT}`));
