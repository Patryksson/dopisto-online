const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { setupGame, startMatchmakingLoop } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

startMatchmakingLoop(io);

io.on('connection', (socket) => {
  setupGame(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dopišto server běží na http://localhost:${PORT}`));
