/**
 * Servidor HTTP + Socket.IO da Mesa do Mentiroso.
 * Serve o cliente estático, cuida das contas/placar e roteia as ações de jogo
 * para a sala correspondente.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { AVATARS, POTION_COUNTS, PUNISHMENT, SUPPORTED_PLAYER_COUNTS } from './game.js';
import { JsonStore } from './store.js';
import { Auth } from './auth.js';
import { mailerIsLive, sendResetEmail } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

const store = new JsonStore(path.join(DATA_DIR, 'mesa.json'));
await store.load();
const auth = new Auth(store);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Em hospedagem (Render, Railway, Fly) o app fica atrás de um proxy HTTPS.
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

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

// ---------------------------------------------------------------- contas

/**
 * Limite simples contra força bruta. O balde é por (rota + IP): assim o
 * limite apertado do "esqueci a senha" não é consumido por logins normais,
 * e vários amigos atrás do mesmo Wi-Fi não derrubam uns aos outros.
 */
const attempts = new Map();
function rateLimited(req, bucket, max, windowMs = 60_000) {
  const key = `${bucket}:${req.ip || 'desconhecido'}`;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now > entry.resetAt) attempts.delete(key);
}, 60_000).unref();

const bearer = (req) => String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');

app.post('/api/auth/register', async (req, res) => {
  if (rateLimited(req, 'register', 20)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Espere um minuto.' });
  }
  const result = await auth.register(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/auth/login', async (req, res) => {
  if (rateLimited(req, 'login', 20)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Espere um minuto.' });
  }
  const result = await auth.login(req.body || {});
  res.status(result.ok ? 200 : 401).json(result);
});

app.get('/api/auth/me', (req, res) => {
  const user = auth.verifyToken(bearer(req));
  if (!user) return res.status(401).json({ ok: false, error: 'Sessão expirada.' });
  res.json({ ok: true, user: auth.publicUser(user) });
});

app.post('/api/auth/forgot', async (req, res) => {
  if (rateLimited(req, 'forgot', 8)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Espere um minuto.' });
  }

  const { user, token } = await auth.createResetToken(req.body?.email);
  // Resposta idêntica exista ou não a conta, para não vazar quem é cadastrado.
  const response = { ok: true, message: 'Se existir uma conta com esse email, o link de recuperação foi enviado.' };

  if (user && token) {
    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/redefinir.html?token=${token}`;
    const { sent } = await sendResetEmail({ to: user.email, username: user.username, link });
    // Sem SMTP configurado o link vem na resposta para você não ficar travado.
    if (!sent) response.devLink = link;
  }

  res.json(response);
});

app.get('/api/auth/reset/:token', (req, res) => {
  const info = auth.peekReset(req.params.token);
  if (!info) return res.status(404).json({ ok: false, error: 'Link inválido ou expirado.' });
  res.json({ ok: true, ...info });
});

app.post('/api/auth/reset', async (req, res) => {
  const { token, password, confirm } = req.body || {};
  const result = await auth.resetPassword(token, password, confirm);
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/leaderboard', (_req, res) => {
  res.json({ ok: true, leaderboard: auth.leaderboard(10), smtp: mailerIsLive() });
});

// ------------------------------------------------------------------ salas

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

/** Registra a vitória e avisa a mesa se a partida valeu ponto no placar. */
function handleGameOver(event, room) {
  const winnerSeat = room.seatById(event.winnerId);
  const counts = room.countsForLeaderboard();
  const humanIds = room.seats.filter((s) => !s.isBot && s.userId).map((s) => s.userId);

  const finish = async () => {
    if (counts) await auth.recordGame(humanIds);
    const scored = counts && winnerSeat?.userId ? await auth.recordWin(winnerSeat.userId) : null;
    io.to(room.code).emit('leaderboard:update', {
      leaderboard: auth.leaderboard(10),
      scored: !!scored,
      reason: counts ? null : 'A partida não valeu ponto: o placar só conta mesas com dois ou mais humanos.',
      wins: scored?.wins ?? null,
    });
  };

  finish().catch((err) => console.error('[placar] falha ao registrar:', err));
}

io.on('connection', (socket) => {
  /** Sala, assento e conta atrelados a esta conexão. */
  let current = { room: null, seatId: null };
  let account = null;

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

  socket.on('auth:identify', ({ token } = {}, ack) => {
    account = auth.verifyToken(token);
    ack?.(account ? { ok: true, user: auth.publicUser(account) } : { ok: false, error: 'Sessão expirada.' });
  });

  socket.on('room:create', ({ name, avatar, maxPlayers, punishment } = {}, ack) => {
    const size = SUPPORTED_PLAYER_COUNTS.includes(Number(maxPlayers)) ? Number(maxPlayers) : 4;
    const room = new Room(io, newRoomCode());
    room.maxPlayers = size;
    room.setPunishment(punishment || { mode: PUNISHMENT.REVOLVER });
    room.onGameOver = handleGameOver;
    rooms.set(room.code, room);

    const result = room.addHuman({
      name: account?.username || name,
      avatar,
      socketId: socket.id,
      userId: account?.id ?? null,
    });
    if (!result.ok) {
      dropRoom(room);
      return fail(ack, result.error);
    }
    bind(room, result.seat);
    console.log(`[sala ${room.code}] criada por ${result.seat.name} (${size} lugares, ${room.punishment.mode})`);

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

    const result = room.addHuman({
      name: account?.username || name,
      avatar,
      socketId: socket.id,
      userId: account?.id ?? null,
    });
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

  socket.on('room:setPunishment', ({ mode, potionCount } = {}, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    if (ctx.room.hostId !== ctx.seatId) return fail(ack, 'Só o anfitrião muda o modo de jogo.');
    if (potionCount !== undefined && !POTION_COUNTS.includes(Number(potionCount))) {
      return fail(ack, 'A bandeja aceita apenas 3 ou 5 poções.');
    }
    const result = ctx.room.setPunishment({ mode, potionCount });
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

  /** Puxar o gatilho (revólver) ou beber a poção escolhida. */
  socket.on('game:punish', ({ potionId } = {}, ack) => {
    const ctx = seated(ack);
    if (!ctx) return;
    const result = ctx.room.handlePunish(ctx.seatId, { potionId });
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
  console.log(`\n  Contas e placar em: ${store.file}`);
  console.log('  Crie a sala, mande o código para a galera e boa sorte.\n');
});
