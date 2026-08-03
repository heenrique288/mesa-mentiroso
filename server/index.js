/**
 * Servidor HTTP + Socket.IO da Mesa do Mentiroso.
 * Serve o cliente estático e roteia as ações de jogo para a sala correspondente.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { AVATARS, SUPPORTED_PLAYER_COUNTS } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Em hospedagem (Render, Railway, Fly) o app fica atrás de um proxy HTTPS.
app.set('trust proxy', 1);

app.use(express.static(path.join(ROOT, 'public')));
// Three.js é servido do node_modules — o jogo roda sem depender de CDN.
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));
app.get('/api/avatars', (_req, res) => res.json({ avatars: AVATARS }));

/** @type {Map<string, Room>} */
const rooms = new Map();

/** Usado pelo health check da hospedagem e por pingadores que evitam o modo ocioso. */
app.get('/healthz', (_req, res) =>
  res.json({ ok: true, salas: rooms.size, uptime: Math.round(process.uptime()) }),
);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos

function newRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function dropRoom(room) {
  room.destroy();
  rooms.delete(room.code);
  console.log(`[sala ${room.code}] encerrada`);
}

/** Limpa salas vazias a cada minuto para não vazar memória. */
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.isEmpty() && Date.now() - room.createdAt > 60_000) dropRoom(room);
  }
}, 60_000).unref();

io.on('connection', (socket) => {
  /** Sala e assento atrelados a esta conexão. */
  let current = { room: null, seatId: null };

  const bind = (room, seat) => {
    current = { room, seatId: seat.id };
    socket.join(room.code);
    room.attachSocket(seat.id, socket.id);
  };

  const fail = (ack, message) => {
    if (typeof ack === 'function') ack({ ok: false, error: message });
    else socket.emit('game:error', { message });
  };

  /** Garante que a ação veio de um jogador realmente sentado na sala. */
  const seated = (ack) => {
    const { room, seatId } = current;
    if (!room || !rooms.has(room.code)) {
      fail(ack, 'Você não está em nenhuma sala.');
      return null;
    }
    if (!room.seatById(seatId)) {
      fail(ack, 'Seu assento não existe mais.');
      return null;
    }
    return { room, seatId };
  };

  socket.on('room:create', ({ name, avatar, maxPlayers } = {}, ack) => {
    const size = SUPPORTED_PLAYER_COUNTS.includes(Number(maxPlayers)) ? Number(maxPlayers) : 4;
    const room = new Room(io, newRoomCode());
    room.maxPlayers = size;
    rooms.set(room.code, room);

    const result = room.addHuman({ name, avatar, socketId: socket.id });
    if (!result.ok) {
      dropRoom(room);
      return fail(ack, result.error);
    }
    bind(room, result.seat);
    console.log(`[sala ${room.code}] criada por ${result.seat.name} (${size} lugares)`);

    ack?.({
      ok: true,
      code: room.code,
      seatId: result.seat.id,
      token: result.seat.token,
      isHost: true,
    });
    room.broadcastLobby();
  });

  socket.on('room:join', ({ code, name, avatar } = {}, ack) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return fail(ack, 'Sala não encontrada. Confira o código.');

    const result = room.addHuman({ name, avatar, socketId: socket.id });
    if (!result.ok) return fail(ack, result.error);

    bind(room, result.seat);
    ack?.({
      ok: true,
      code: room.code,
      seatId: result.seat.id,
      token: result.seat.token,
      isHost: room.hostId === result.seat.id,
    });
    room.broadcastLobby();
  });

  /** Reconexão após refresh ou queda: o assento é recuperado pelo token. */
  socket.on('room:rejoin', ({ code, seatId, token } = {}, ack) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return fail(ack, 'A sala não existe mais.');
    const seat = room.seatById(seatId);
    if (!seat || seat.isBot || seat.token !== token) return fail(ack, 'Não foi possível recuperar seu assento.');

    bind(room, seat);
    ack?.({ ok: true, code: room.code, seatId: seat.id, token: seat.token, isHost: room.hostId === seat.id });
    room.io.to(room.code).emit('game:notice', { message: `${seat.name} voltou para a mesa.` });
    room.broadcastLobby();
    if (room.game) {
      socket.emit('game:log', { lines: room.log.slice(-40) });
      room.broadcastGame();
    }
  });

  socket.on('room:setSize', ({ maxPlayers } = {}, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    if (ctx.room.hostId !== ctx.seatId) return fail(ack, 'Só o anfitrião muda o tamanho da mesa.');
    const result = ctx.room.setMaxPlayers(Number(maxPlayers));
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
    ctx.room.broadcastLobby();
  });

  socket.on('room:addBot', (_payload, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    if (ctx.room.hostId !== ctx.seatId) return fail(ack, 'Só o anfitrião adiciona bots.');
    const result = ctx.room.addBot();
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
    ctx.room.broadcastLobby();
  });

  socket.on('room:removeSeat', ({ seatId } = {}, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const target = ctx.room.seatById(seatId);
    if (!target) return fail(ack, 'Assento não encontrado.');
    // O anfitrião remove qualquer um; os demais só podem sair da própria cadeira.
    if (ctx.room.hostId !== ctx.seatId && seatId !== ctx.seatId) {
      return fail(ack, 'Você não pode remover esse jogador.');
    }
    const result = ctx.room.removeSeat(seatId);
    if (!result.ok) return fail(ack, result.error);
    if (seatId === ctx.seatId) {
      socket.leave(ctx.room.code);
      current = { room: null, seatId: null };
    }
    ack?.({ ok: true });
    ctx.room.broadcastLobby();
  });

  socket.on('game:start', (_payload, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.start(ctx.seatId);
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
  });

  socket.on('game:play', ({ cardIds } = {}, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.handlePlay(ctx.seatId, cardIds);
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
  });

  socket.on('game:challenge', (_payload, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.handleChallenge(ctx.seatId);
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
  });

  socket.on('game:pull', (_payload, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.handlePull(ctx.seatId);
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
  });

  socket.on('game:reset', (_payload, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.reset(ctx.seatId);
    if (!result.ok) return fail(ack, result.error);
    ack?.({ ok: true });
  });

  socket.on('chat:send', ({ text } = {}) => {
    const ctx = seated();
    if (!ctx) return;
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;
    const seat = ctx.room.seatById(ctx.seatId);
    io.to(ctx.room.code).emit('chat:message', { name: seat.name, text: clean, at: Date.now() });
  });

  socket.on('disconnect', () => {
    const room = current.room;
    if (!room || !rooms.has(room.code)) return;
    room.detachSocket(socket.id);
    room.broadcastLobby();
    if (room.seats.length === 0) dropRoom(room);
  });
});

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  console.log('\n  🃏  Mesa do Mentiroso no ar!\n');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const address of localAddresses()) {
    console.log(`  Na sua rede:       http://${address}:${PORT}`);
  }
  console.log('\n  Crie a sala, mande o código para a galera e boa sorte.\n');
});
