/**
 * Sala de jogo: assentos, ciclo de vida da partida e todos os temporizadores
 * (turno dos bots, gatilho automático, intervalo entre rodadas).
 */

import { randomUUID } from 'node:crypto';
import { AVATARS, Game, SUPPORTED_PLAYER_COUNTS } from './game.js';
import { botDisplayName, botThinkDelay, decideAction } from './bot.js';

/** Tempo que o cliente tem para exibir a virada das cartas antes do gatilho. */
const REVEAL_MS = 3800;
/** Prazo para o humano puxar o gatilho antes do disparo automático. */
const TRIGGER_TIMEOUT_MS = 15000;
/** Pausa entre o fim de uma rodada e a distribuição da próxima. */
const NEXT_ROUND_MS = 5200;
/** Prazo para o humano jogar antes do autopilot assumir a vez. */
const TURN_TIMEOUT_MS = 60000;

export class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.maxPlayers = 4;
    this.seats = []; // { id, token, name, avatar, isBot, socketId, connected }
    this.hostId = null;
    this.game = null;
    this.log = [];
    this.timers = new Set();
    this.createdAt = Date.now();
  }

  // ------------------------------------------------------------ temporizadores

  later(fn, ms) {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      try {
        fn();
      } catch (err) {
        console.error(`[sala ${this.code}] erro em tarefa agendada:`, err);
      }
    }, ms);
    this.timers.add(handle);
    return handle;
  }

  clearTimers() {
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
  }

  destroy() {
    this.clearTimers();
  }

  // ------------------------------------------------------------------ assentos

  get humanSeats() {
    return this.seats.filter((s) => !s.isBot);
  }

  isEmpty() {
    return this.humanSeats.every((s) => !s.connected);
  }

  freeAvatar() {
    const taken = new Set(this.seats.map((s) => s.avatar));
    return (AVATARS.find((a) => !taken.has(a.id)) || AVATARS[0]).id;
  }

  uniqueName(name) {
    const base = (name || '').trim().slice(0, 16) || 'Anônimo';
    const taken = new Set(this.seats.map((s) => s.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 50; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${Math.floor(Math.random() * 999)}`;
  }

  addHuman({ name, avatar, socketId }) {
    if (this.game) return { ok: false, error: 'A partida já começou nesta sala.' };
    if (this.seats.length >= this.maxPlayers) return { ok: false, error: 'A mesa está cheia.' };

    const taken = new Set(this.seats.map((s) => s.avatar));
    const seat = {
      id: randomUUID(),
      token: randomUUID(),
      name: this.uniqueName(name),
      avatar: avatar && !taken.has(avatar) ? avatar : this.freeAvatar(),
      isBot: false,
      socketId,
      connected: true,
    };
    this.seats.push(seat);
    if (!this.hostId) this.hostId = seat.id;
    return { ok: true, seat };
  }

  addBot() {
    if (this.game) return { ok: false, error: 'A partida já começou.' };
    if (this.seats.length >= this.maxPlayers) return { ok: false, error: 'A mesa está cheia.' };
    const seat = {
      id: randomUUID(),
      token: null,
      name: botDisplayName(this.seats.map((s) => s.name)),
      avatar: this.freeAvatar(),
      isBot: true,
      socketId: null,
      connected: true,
    };
    this.seats.push(seat);
    return { ok: true, seat };
  }

  removeSeat(seatId) {
    if (this.game) return { ok: false, error: 'Não dá para mexer nos assentos durante a partida.' };
    this.seats = this.seats.filter((s) => s.id !== seatId);
    if (this.hostId === seatId) this.hostId = this.humanSeats[0]?.id ?? null;
    return { ok: true };
  }

  setMaxPlayers(value) {
    if (this.game) return { ok: false, error: 'A partida já começou.' };
    if (!SUPPORTED_PLAYER_COUNTS.includes(value)) {
      return { ok: false, error: 'A mesa aceita apenas 4 ou 6 jogadores.' };
    }
    if (this.seats.length > value) {
      return { ok: false, error: 'Remova jogadores antes de diminuir a mesa.' };
    }
    this.maxPlayers = value;
    return { ok: true };
  }

  seatById(id) {
    return this.seats.find((s) => s.id === id) || null;
  }

  seatBySocket(socketId) {
    return this.seats.find((s) => s.socketId === socketId) || null;
  }

  /** Um assento age sozinho quando é bot ou quando o humano caiu da sala. */
  isAutopilot(seatId) {
    const seat = this.seatById(seatId);
    return !seat || seat.isBot || !seat.connected;
  }

  // -------------------------------------------------------------------- rede

  lobbyState() {
    return {
      code: this.code,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      started: !!this.game,
      seats: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isBot: s.isBot,
        connected: s.connected,
      })),
    };
  }

  broadcastLobby() {
    this.io.to(this.code).emit('room:state', this.lobbyState());
  }

  /** Cada socket recebe o estado público + a própria mão. */
  broadcastGame() {
    if (!this.game) return;
    const publicState = this.game.publicState();
    for (const seat of this.seats) {
      if (!seat.socketId) continue;
      this.io.to(seat.socketId).emit('game:state', {
        ...publicState,
        you: { id: seat.id, ...this.game.privateState(seat.id) },
      });
    }
  }

  pushEvents() {
    if (!this.game) return;
    const events = this.game.drainEvents();
    if (!events.length) return;
    for (const event of events) {
      const line = describe(event, this.game);
      if (line) this.log.push(line);
    }
    if (this.log.length > 120) this.log = this.log.slice(-120);
    this.io.to(this.code).emit('game:events', events);
  }

  sendError(socketId, message) {
    if (socketId) this.io.to(socketId).emit('game:error', { message });
  }

  // ------------------------------------------------------------------ partida

  start(requesterId) {
    if (this.game) return { ok: false, error: 'A partida já começou.' };
    if (requesterId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode começar.' };
    if (this.seats.length !== this.maxPlayers) {
      return { ok: false, error: `A mesa precisa de exatamente ${this.maxPlayers} jogadores.` };
    }

    this.log = [];
    this.game = new Game(
      this.seats.map((s) => ({ id: s.id, name: s.name, avatar: s.avatar, isBot: s.isBot })),
    );
    this.game.start();

    this.broadcastLobby();
    this.pushEvents();
    this.broadcastGame();
    this.scheduleNextStep();
    return { ok: true };
  }

  /** Descarta a partida e devolve todo mundo para o lobby. */
  reset(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode reiniciar.' };
    this.clearTimers();
    this.game = null;
    this.log = [];
    this.broadcastLobby();
    this.io.to(this.code).emit('game:reset');
    return { ok: true };
  }

  handlePlay(seatId, cardIds) {
    if (!this.game) return { ok: false, error: 'Nenhuma partida em andamento.' };
    const result = this.game.playCards(seatId, cardIds);
    if (!result.ok) return result;
    this.afterAction();
    return result;
  }

  handleChallenge(seatId) {
    if (!this.game) return { ok: false, error: 'Nenhuma partida em andamento.' };
    const result = this.game.challenge(seatId);
    if (!result.ok) return result;
    this.afterAction();
    return result;
  }

  handlePull(seatId) {
    if (!this.game) return { ok: false, error: 'Nenhuma partida em andamento.' };
    const result = this.game.pullTrigger(seatId);
    if (!result.ok) return result;
    this.afterAction();
    return result;
  }

  afterAction() {
    this.clearTimers();
    this.pushEvents();
    this.broadcastGame();
    this.scheduleNextStep();
  }

  /**
   * Olha a fase atual e agenda o que precisa acontecer sozinho:
   * jogada de bot, disparo automático ou início da próxima rodada.
   */
  scheduleNextStep() {
    const game = this.game;
    if (!game) return;

    if (game.phase === 'playing') {
      const current = game.players[game.turn];
      if (!current) return;
      if (this.isAutopilot(current.id)) {
        this.later(() => this.runBotTurn(current.id), botThinkDelay());
      } else {
        this.later(() => {
          this.io.to(this.code).emit('game:notice', {
            message: `${current.name} demorou demais — a mesa jogou por ${current.name}.`,
          });
          this.runBotTurn(current.id);
        }, TURN_TIMEOUT_MS);
      }
      return;
    }

    if (game.phase === 'roulette' && game.pendingShot) {
      const loserId = game.pendingShot.playerId;
      const wait = this.isAutopilot(loserId)
        ? REVEAL_MS + 1200 + Math.random() * 800
        : REVEAL_MS + TRIGGER_TIMEOUT_MS;
      this.later(() => {
        if (this.game?.pendingShot?.playerId === loserId) this.handlePull(loserId);
      }, wait);
      return;
    }

    if (game.phase === 'roundEnd') {
      this.later(() => {
        if (this.game?.phase !== 'roundEnd') return;
        this.game.beginNextRound();
        this.pushEvents();
        this.broadcastGame();
        this.scheduleNextStep();
      }, NEXT_ROUND_MS);
    }
  }

  runBotTurn(seatId) {
    const game = this.game;
    if (!game || game.phase !== 'playing') return;
    const player = game.getPlayer(seatId);
    if (!player || game.players[game.turn].id !== seatId) return;

    const action = decideAction(game, player);
    const result =
      action.type === 'challenge' ? this.handleChallenge(seatId) : this.handlePlay(seatId, action.cardIds);

    // Rede de segurança: se a heurística produzir algo inválido, baixa 1 carta.
    if (!result.ok && player.hand.length > 0) {
      this.handlePlay(seatId, [player.hand[0].id]);
    }
  }

  // ------------------------------------------------------------- conexões

  attachSocket(seatId, socketId) {
    const seat = this.seatById(seatId);
    if (!seat) return false;
    seat.socketId = socketId;
    seat.connected = true;
    return true;
  }

  detachSocket(socketId) {
    const seat = this.seatBySocket(socketId);
    if (!seat) return null;
    seat.socketId = null;
    seat.connected = false;

    if (!this.game) {
      // No lobby ninguém fica preso a um assento vazio.
      this.seats = this.seats.filter((s) => s.id !== seat.id);
      if (this.hostId === seat.id) this.hostId = this.humanSeats[0]?.id ?? null;
    } else {
      // Em partida o assento continua e passa para o piloto automático.
      this.io.to(this.code).emit('game:notice', {
        message: `${seat.name} caiu da mesa — a casa joga por ${seat.name} até voltar.`,
      });
      // Se o anfitrião caiu, passa o comando adiante para a mesa não travar.
      if (this.hostId === seat.id) {
        const heir = this.humanSeats.find((s) => s.connected);
        if (heir) {
          this.hostId = heir.id;
          this.io.to(this.code).emit('game:notice', { message: `${heir.name} agora é o anfitrião da mesa.` });
        }
      }
      this.scheduleNextStep();
    }
    return seat;
  }
}

/** Converte um evento do motor em uma linha do painel de histórico. */
function describe(event, game) {
  const plural = (n, one, many) => (n === 1 ? one : many);
  const rank = (r) => ({ A: 'Ás', K: 'Rei', Q: 'Dama', JOKER: 'Coringa' })[r] ?? r;
  const rankPlural = (r) => ({ A: 'Ases', K: 'Reis', Q: 'Damas', JOKER: 'Coringas' })[r] ?? r;

  switch (event.type) {
    case 'round:start':
      return `— Rodada ${event.round} — Tema da Mesa: ${rankPlural(event.tableCard)}.`;
    case 'play': {
      const claim = event.count === 1 ? rank(event.claim) : `${event.count} ${rankPlural(event.claim)}`;
      const name = game.getPlayer(event.playerId)?.name ?? 'Alguém';
      return `${name} baixou ${event.count} ${plural(event.count, 'carta', 'cartas')}: "${claim}".`;
    }
    case 'challenge':
      return `${event.challengerName} gritou MENTIROSO para ${event.accusedName}!`;
    case 'reveal': {
      const cards = event.cards.map((c) => rank(c.rank)).join(', ');
      return event.truthful
        ? `Cartas reveladas: ${cards}. Verdade! ${event.challengerName} pagou o mico.`
        : `Cartas reveladas: ${cards}. Mentira! ${event.accusedName} foi pego.`;
    }
    case 'shot':
      return event.dead
        ? `BANG! ${event.playerName} pegou a bala na câmara ${event.chamber}.`
        : `Clique... ${event.playerName} sobreviveu (câmara ${event.chamber}/${event.chambers}).`;
    case 'round:exhausted':
      return 'Acabaram as cartas sem ninguém desafiar. Rodada anulada.';
    case 'game:over':
      return `Fim de jogo! ${event.winnerName ?? 'Ninguém'} sobreviveu à mesa.`;
    default:
      return null;
  }
}
