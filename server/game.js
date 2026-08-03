/**
 * Mesa do Mentiroso — motor de regras.
 *
 * Toda a lógica vive aqui e roda somente no servidor: o cliente nunca conhece
 * a mão dos adversários, o conteúdo do monte, a câmara da bala ou qual poção
 * está envenenada, então não há como trapacear inspecionando o navegador.
 */

export const RANKS = { ACE: 'A', KING: 'K', QUEEN: 'Q', JOKER: 'JOKER' };

/** Cartas que podem virar "Tema da Mesa" (o coringa nunca é tema). */
export const TABLE_RANKS = [RANKS.ACE, RANKS.KING, RANKS.QUEEN];

export const RANK_LABEL = {
  A: 'Ás',
  K: 'Rei',
  Q: 'Dama',
  JOKER: 'Coringa',
};

export const RANK_LABEL_PLURAL = {
  A: 'Ases',
  K: 'Reis',
  Q: 'Damas',
  JOKER: 'Coringas',
};

export const HAND_SIZE = 5;
export const CHAMBERS = 6;

/** Os dois modos de punição para quem perde o desafio. */
export const PUNISHMENT = { REVOLVER: 'revolver', POTIONS: 'potions' };
export const POTION_COUNTS = [3, 5];

/** Cores das poções — cada frasco tem identidade própria na mesa. */
export const POTION_COLORS = ['#4fb3d9', '#8f5fd1', '#d95f7a', '#5fd18f', '#e0a03c'];

/** Composição do baralho por número de jogadores. */
export const DECK_COMPOSITION = {
  4: { [RANKS.KING]: 6, [RANKS.QUEEN]: 6, [RANKS.ACE]: 6, [RANKS.JOKER]: 2 }, // 20 cartas
  6: { [RANKS.KING]: 9, [RANKS.QUEEN]: 9, [RANKS.ACE]: 9, [RANKS.JOKER]: 3 }, // 30 cartas
};

export const SUPPORTED_PLAYER_COUNTS = Object.keys(DECK_COMPOSITION).map(Number);

export const AVATARS = [
  { id: 'urso', name: 'Urso' },
  { id: 'touro', name: 'Touro' },
  { id: 'raposa', name: 'Raposa' },
  { id: 'coelho', name: 'Coelho' },
  { id: 'corvo', name: 'Corvo' },
  { id: 'sapo', name: 'Sapo' },
];

let cardSeq = 0;
const nextCardId = () => `c${++cardSeq}`;

function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildDeck(playerCount) {
  const composition = DECK_COMPOSITION[playerCount];
  if (!composition) throw new Error(`Número de jogadores não suportado: ${playerCount}`);
  const deck = [];
  for (const [rank, qty] of Object.entries(composition)) {
    for (let i = 0; i < qty; i++) deck.push({ id: nextCardId(), rank });
  }
  return shuffle(deck);
}

/**
 * Uma jogada é verdadeira quando toda carta baixada é o tema da mesa
 * ou um coringa (que vale como qualquer carta).
 */
export function isTruthfulPlay(cards, tableCard) {
  return cards.every((card) => card.rank === tableCard || card.rank === RANKS.JOKER);
}

/** Normaliza a configuração de punição vinda da sala. */
export function normalizePunishment(config = {}) {
  const mode = config.mode === PUNISHMENT.POTIONS ? PUNISHMENT.POTIONS : PUNISHMENT.REVOLVER;
  const potionCount = POTION_COUNTS.includes(Number(config.potionCount)) ? Number(config.potionCount) : 5;
  return { mode, potionCount };
}

function newRevolver(rng = Math.random) {
  return {
    chambers: CHAMBERS,
    // Posição da bala é secreta: nunca é enviada ao cliente antes do disparo.
    bulletAt: Math.floor(rng() * CHAMBERS),
    pulls: 0,
  };
}

/**
 * Bandeja pessoal de poções. A envenenada tem posição secreta e as bebidas
 * somem da bandeja, então a chance cresce a cada punição — igual ao revólver.
 */
function newTray(count, seatIndex, rng = Math.random) {
  return {
    total: count,
    poisonedAt: Math.floor(rng() * count),
    potions: Array.from({ length: count }, (_, index) => ({
      id: `pot${seatIndex}-${index}`,
      index,
      color: POTION_COLORS[index % POTION_COLORS.length],
      drunk: false,
    })),
  };
}

export class Game {
  /**
   * @param {Array<{id:string,name:string,avatar:string,isBot:boolean}>} seats
   *        Jogadores já na ordem de assento (sentido horário).
   * @param {{rng?:Function, punishment?:{mode:string, potionCount:number}}} options
   */
  constructor(seats, { rng = Math.random, punishment } = {}) {
    if (!SUPPORTED_PLAYER_COUNTS.includes(seats.length)) {
      throw new Error('A mesa aceita apenas 4 ou 6 jogadores.');
    }
    this.rng = rng;
    this.punishment = normalizePunishment(punishment);
    this.playerCount = seats.length;
    this.players = seats.map((seat, index) => ({
      id: seat.id,
      name: seat.name,
      avatar: seat.avatar,
      isBot: !!seat.isBot,
      seat: index,
      hand: [],
      alive: true,
      revolver: this.punishment.mode === PUNISHMENT.REVOLVER ? newRevolver(rng) : null,
      tray: this.punishment.mode === PUNISHMENT.POTIONS ? newTray(this.punishment.potionCount, index, rng) : null,
    }));

    this.phase = 'idle'; // idle | playing | reveal | punishment | roundEnd | gameOver
    this.round = 0;
    this.tableCard = null;
    this.turn = 0;
    this.lastPlay = null; // { playerId, cards:[], count }
    this.pile = []; // cartas na mesa, viradas para baixo (com dono e ordem)
    this.pendingPunishment = null; // { playerId, reason }
    this.lastReveal = null; // resultado do último desafio (para a animação)
    this.winnerId = null;
    /** Fila de eventos consumida pela camada de rede a cada ação. */
    this.events = [];
  }

  // ---------------------------------------------------------------- utilidades

  emit(type, payload = {}) {
    this.events.push({ type, ...payload });
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  getPlayer(playerId) {
    return this.players.find((p) => p.id === playerId) || null;
  }

  playerAt(seat) {
    return this.players[seat];
  }

  alivePlayers() {
    return this.players.filter((p) => p.alive);
  }

  /** Jogadores que ainda podem jogar nesta rodada (vivos e com cartas). */
  activePlayers() {
    return this.players.filter((p) => p.alive && p.hand.length > 0);
  }

  /**
   * Próximo assento no sentido horário que satisfaz o filtro.
   * Retorna -1 quando ninguém qualifica.
   */
  nextSeat(fromSeat, predicate) {
    for (let step = 1; step <= this.playerCount; step++) {
      const seat = (fromSeat + step) % this.playerCount;
      if (predicate(this.players[seat])) return seat;
    }
    return -1;
  }

  // ------------------------------------------------------------------ partida

  start() {
    this.phase = 'playing';
    this.emit('game:start', { playerCount: this.playerCount, punishment: this.punishment });
    this.startRound(0);
  }

  /**
   * Inicia uma rodada: sorteia o Tema da Mesa, embaralha e distribui 5 cartas
   * para cada jogador vivo.
   */
  startRound(startingSeat) {
    this.round += 1;
    this.pile = [];
    this.lastPlay = null;
    this.lastReveal = null;
    this.pendingPunishment = null;

    const alive = this.alivePlayers();
    const deck = buildDeck(this.playerCount);

    for (const player of this.players) player.hand = [];
    for (const player of alive) player.hand = deck.splice(0, HAND_SIZE);

    this.tableCard = TABLE_RANKS[Math.floor(this.rng() * TABLE_RANKS.length)];

    // Garante que a rodada comece com alguém que realmente pode jogar.
    let seat = startingSeat;
    if (!this.players[seat]?.alive) {
      seat = this.nextSeat(startingSeat, (p) => p.alive);
    }
    this.turn = seat;
    this.phase = 'playing';

    this.emit('round:start', {
      round: this.round,
      tableCard: this.tableCard,
      turn: this.turn,
      startingPlayerId: this.players[this.turn].id,
    });
  }

  // -------------------------------------------------------------------- ações

  /**
   * O jogador da vez baixa de 1 a 5 cartas viradas para baixo, afirmando que
   * todas são o Tema da Mesa.
   */
  playCards(playerId, cardIds) {
    const player = this.getPlayer(playerId);
    if (this.phase !== 'playing') return this.fail('A mesa não está aceitando jogadas agora.');
    if (!player) return this.fail('Jogador não encontrado.');
    if (!player.alive) return this.fail('Você já está fora do jogo.');
    if (this.players[this.turn].id !== playerId) return this.fail('Não é a sua vez.');
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > HAND_SIZE) {
      return this.fail('Você precisa jogar de 1 a 5 cartas.');
    }
    if (new Set(cardIds).size !== cardIds.length) return this.fail('Cartas repetidas na jogada.');

    const cards = [];
    for (const cardId of cardIds) {
      const card = player.hand.find((c) => c.id === cardId);
      if (!card) return this.fail('Carta inválida.');
      cards.push(card);
    }

    player.hand = player.hand.filter((c) => !cardIds.includes(c.id));

    const order = this.pile.length;
    this.pile.push(...cards.map((card, i) => ({ ...card, ownerId: playerId, order: order + i })));
    this.lastPlay = { playerId, cards, count: cards.length };

    this.emit('play', {
      playerId,
      playerName: player.name,
      count: cards.length,
      claim: this.tableCard,
      handLeft: player.hand.length,
    });

    return this.advanceAfterPlay();
  }

  /**
   * Passa a vez para o próximo jogador que ainda tem cartas.
   * Se ninguém mais tem cartas, a rodada acaba sem punição e um novo baralho é
   * distribuído (ninguém foi desafiado a tempo).
   */
  advanceAfterPlay() {
    const nextSeat = this.nextSeat(this.turn, (p) => p.alive && p.hand.length > 0);

    if (nextSeat === -1) {
      // Todos ficaram sem cartas: rodada encerrada em paz.
      this.emit('round:exhausted', {});
      const starter = this.nextSeat(this.turn, (p) => p.alive);
      this.phase = 'roundEnd';
      this.nextRoundStart = starter === -1 ? this.turn : starter;
      return { ok: true, roundOver: true };
    }

    this.turn = nextSeat;
    this.emit('turn', { turn: this.turn, playerId: this.players[this.turn].id });
    return { ok: true };
  }

  /**
   * "Mentiroso!" — apenas o jogador da vez (o seguinte a quem baixou cartas)
   * pode contestar, e só existe alvo se houve uma jogada anterior.
   */
  challenge(playerId) {
    const challenger = this.getPlayer(playerId);
    if (this.phase !== 'playing') return this.fail('Não dá para desafiar agora.');
    if (!challenger) return this.fail('Jogador não encontrado.');
    if (!this.lastPlay) return this.fail('Ninguém jogou ainda nesta rodada.');
    if (this.players[this.turn].id !== playerId) return this.fail('Só o próximo jogador pode desafiar.');
    if (this.lastPlay.playerId === playerId) return this.fail('Você não pode desafiar a si mesmo.');

    const accused = this.getPlayer(this.lastPlay.playerId);
    const truthful = isTruthfulPlay(this.lastPlay.cards, this.tableCard);
    const loser = truthful ? challenger : accused;

    this.phase = 'reveal';
    this.lastReveal = {
      challengerId: challenger.id,
      challengerName: challenger.name,
      accusedId: accused.id,
      accusedName: accused.name,
      tableCard: this.tableCard,
      cards: this.lastPlay.cards.map((c) => ({ id: c.id, rank: c.rank })),
      truthful,
      loserId: loser.id,
      loserName: loser.name,
    };

    this.emit('challenge', {
      challengerId: challenger.id,
      challengerName: challenger.name,
      accusedId: accused.id,
      accusedName: accused.name,
    });
    this.emit('reveal', this.lastReveal);

    this.openPunishment(loser, truthful ? 'acusacao-falsa' : 'mentira');
    return { ok: true, reveal: this.lastReveal };
  }

  /** Abre a punição do perdedor, no modo escolhido pela sala. */
  openPunishment(loser, reason) {
    this.phase = 'punishment';
    this.pendingPunishment = { playerId: loser.id, reason };

    const payload = {
      playerId: loser.id,
      playerName: loser.name,
      reason,
      mode: this.punishment.mode,
    };

    if (this.punishment.mode === PUNISHMENT.REVOLVER) {
      payload.chamber = loser.revolver.pulls + 1;
      payload.chambers = loser.revolver.chambers;
    } else {
      // Só as poções ainda cheias são oferecidas; a envenenada segue secreta.
      payload.potions = loser.tray.potions
        .filter((p) => !p.drunk)
        .map((p) => ({ id: p.id, index: p.index, color: p.color }));
      payload.total = loser.tray.total;
    }

    this.emit('punishment:pending', payload);
  }

  /**
   * Executa a punição do perdedor.
   * @param {string} playerId
   * @param {{potionId?: string}} choice — obrigatório no modo das poções.
   */
  sufferPunishment(playerId, { potionId = null } = {}) {
    if (this.phase !== 'punishment' || !this.pendingPunishment) return this.fail('Nenhuma punição pendente.');
    if (this.pendingPunishment.playerId !== playerId) return this.fail('A punição não é sua.');

    const player = this.getPlayer(playerId);
    const result = { playerId, playerName: player.name, mode: this.punishment.mode };
    let fatal;

    if (this.punishment.mode === PUNISHMENT.REVOLVER) {
      const revolver = player.revolver;
      fatal = revolver.pulls === revolver.bulletAt;
      result.chamber = revolver.pulls + 1;
      result.chambers = revolver.chambers;
      revolver.pulls += 1;
      result.remaining = revolver.chambers - revolver.pulls;
    } else {
      const tray = player.tray;
      const potion = tray.potions.find((p) => p.id === potionId && !p.drunk);
      if (!potion) return this.fail('Escolha uma poção que ainda esteja na bandeja.');
      potion.drunk = true;
      fatal = potion.index === tray.poisonedAt;
      result.potionId = potion.id;
      result.potionIndex = potion.index;
      result.potionColor = potion.color;
      result.total = tray.total;
      result.remaining = tray.potions.filter((p) => !p.drunk).length;
      // A posição do veneno só é revelada quando alguém a bebe.
      if (fatal) result.poisonedAt = tray.poisonedAt;
    }

    result.fatal = fatal;
    this.pendingPunishment = null;

    if (fatal) {
      player.alive = false;
      player.hand = [];
    }

    this.emit('punishment:result', result);
    if (fatal) this.emit('eliminated', { playerId, playerName: player.name });

    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.phase = 'gameOver';
      this.winnerId = alive[0]?.id ?? null;
      this.emit('game:over', {
        winnerId: this.winnerId,
        winnerName: alive[0]?.name ?? null,
      });
      return { ok: true, fatal, gameOver: true };
    }

    // Quem sofreu a punição e sobreviveu recomeça; se morreu, passa adiante.
    this.nextRoundStart = player.alive
      ? player.seat
      : this.nextSeat(player.seat, (p) => p.alive);
    this.phase = 'roundEnd';
    this.emit('round:end', { nextStarterId: this.players[this.nextRoundStart].id });

    return { ok: true, fatal, roundOver: true };
  }

  /** Chamado pela camada de rede após a pausa dramática do fim de rodada. */
  beginNextRound() {
    if (this.phase !== 'roundEnd') return this.fail('A rodada ainda não terminou.');
    this.startRound(this.nextRoundStart ?? this.turn);
    return { ok: true };
  }

  fail(message) {
    return { ok: false, error: message };
  }

  // ------------------------------------------------------------------ estados

  /** Estado visível a todos: nunca inclui mãos, monte, bala ou veneno. */
  publicState() {
    return {
      phase: this.phase,
      round: this.round,
      tableCard: this.tableCard,
      turn: this.turn,
      turnPlayerId: this.players[this.turn]?.id ?? null,
      playerCount: this.playerCount,
      punishment: this.punishment,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        seat: p.seat,
        isBot: p.isBot,
        alive: p.alive,
        handCount: p.hand.length,
        // Modo revólver
        pulls: p.revolver?.pulls ?? 0,
        chambers: p.revolver?.chambers ?? CHAMBERS,
        // Modo poções. A posição do veneno só é revelada depois que o jogador
        // morreu — antes disso continua secreta até para ele mesmo.
        potions: p.tray ? p.tray.potions.map((x) => ({ id: x.id, index: x.index, color: x.color, drunk: x.drunk })) : null,
        potionsLeft: p.tray ? p.tray.potions.filter((x) => !x.drunk).length : null,
        potionsTotal: p.tray?.total ?? null,
        poisonedAt: !p.alive && p.tray ? p.tray.poisonedAt : null,
      })),
      pile: this.pile.map((c) => ({ id: c.id, ownerId: c.ownerId, order: c.order })),
      lastPlay: this.lastPlay
        ? {
            playerId: this.lastPlay.playerId,
            count: this.lastPlay.count,
            cardIds: this.lastPlay.cards.map((c) => c.id),
          }
        : null,
      lastReveal: this.lastReveal,
      pendingPunishment: this.pendingPunishment,
      winnerId: this.winnerId,
    };
  }

  /** Parte privada: apenas as cartas do próprio jogador. */
  privateState(playerId) {
    const player = this.getPlayer(playerId);
    return { hand: player ? player.hand.map((c) => ({ id: c.id, rank: c.rank })) : [] };
  }
}
