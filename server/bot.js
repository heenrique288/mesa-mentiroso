/**
 * Bots para completar a mesa e testar a lógica sozinho.
 *
 * A heurística é simples de propósito: o bot conta quantas cartas do tema ainda
 * poderiam estar em jogo (descontando a própria mão e o que já foi baixado) e
 * fica desconfiado quando o adversário afirma mais do que é plausível.
 */

import { DECK_COMPOSITION, RANKS } from './game.js';

const BOT_NAMES = ['Bartô', 'Vovô Sniper', 'Dona Trapaça', 'Zé Blefe', 'Madame Poker', 'Chico Sorte'];

export function botDisplayName(taken = []) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Quantas cartas "válidas" (tema + coringas) existem no baralho inteiro. */
function validCardTotal(playerCount, tableCard) {
  const composition = DECK_COMPOSITION[playerCount];
  return composition[tableCard] + composition[RANKS.JOKER];
}

/**
 * Decide a jogada do bot.
 * @returns {{type:'play', cardIds:string[]} | {type:'challenge'}}
 */
export function decideAction(game, bot) {
  const { tableCard, lastPlay, playerCount } = game;
  const hand = bot.hand;

  const valid = hand.filter((c) => c.rank === tableCard || c.rank === RANKS.JOKER);
  const junk = hand.filter((c) => c.rank !== tableCard && c.rank !== RANKS.JOKER);

  const canChallenge = !!lastPlay && lastPlay.playerId !== bot.id;

  if (canChallenge) {
    const suspicion = suspicionLevel(game, bot, valid.length, playerCount, tableCard);
    if (Math.random() < suspicion) return { type: 'challenge' };
  }

  // Sem cartas boas e ainda assim precisa jogar: blefa com o mínimo possível.
  if (valid.length === 0) {
    const bluffSize = junk.length > 2 && Math.random() < 0.25 ? 2 : 1;
    return { type: 'play', cardIds: junk.slice(0, bluffSize).map((c) => c.id) };
  }

  // Guarda coringas quando dá — eles valem ouro numa jogada grande mais tarde.
  const ordered = [...valid].sort((a, b) => {
    const score = (card) => (card.rank === RANKS.JOKER ? 1 : 0);
    return score(a) - score(b);
  });

  let count = 1;
  const roll = Math.random();
  if (ordered.length >= 3 && roll < 0.25) count = 3;
  else if (ordered.length >= 2 && roll < 0.6) count = 2;

  const cardIds = ordered.slice(0, count).map((c) => c.id);

  // De vez em quando mistura uma carta lixo numa jogada grande: blefe agressivo
  // que esvazia a mão mais rápido.
  if (junk.length > 0 && cardIds.length < 3 && Math.random() < 0.18) {
    cardIds.push(junk[0].id);
  }

  return { type: 'play', cardIds };
}

/** Probabilidade (0..1) do bot gritar "mentiroso!". */
function suspicionLevel(game, bot, myValidCount, playerCount, tableCard) {
  const claimed = game.lastPlay.count;
  const total = validCardTotal(playerCount, tableCard);

  // Cartas do tema que já foram baixadas por qualquer um (incluindo o acusado).
  const played = game.pile.length;
  const plausible = total - myValidCount;

  let suspicion = 0.08; // ruído: às vezes o bot arrisca só para agitar a mesa

  // Quanto maior a afirmação, mais improvável.
  if (claimed >= 4) suspicion += 0.5;
  else if (claimed === 3) suspicion += 0.3;
  else if (claimed === 2) suspicion += 0.12;

  // Se o bot segura muitas cartas do tema, sobra pouco para os outros.
  if (plausible <= claimed) suspicion += 0.45;
  else if (plausible <= claimed + 1) suspicion += 0.22;

  // No fim da rodada quase tudo já saiu: mentira fica mais provável.
  if (played > total) suspicion += 0.15;

  // Se o acusado zerou a mão, ele pode ter jogado qualquer coisa para escapar.
  const accused = game.getPlayer(game.lastPlay.playerId);
  if (accused && accused.hand.length === 0) suspicion += 0.15;

  return Math.min(0.9, suspicion);
}

/** Atraso "humano" antes de cada ação do bot, em milissegundos. */
export function botThinkDelay() {
  return 1100 + Math.random() * 1600;
}
