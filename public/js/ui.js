/**
 * Camada de DOM: mão do jogador, painéis laterais e sobreposições dramáticas.
 * Funções puras de renderização — quem decide o que mostrar é o main.js.
 */

import { AVATAR_INFO } from './avatars.js';

export const RANK_LABEL = { A: 'Ás', K: 'Rei', Q: 'Dama', JOKER: 'Coringa' };
export const RANK_PLURAL = { A: 'Ases', K: 'Reis', Q: 'Damas', JOKER: 'Coringas' };
const RANK_GLYPH = { A: 'A', K: 'K', Q: 'Q', JOKER: '★' };

export const $ = (selector) => document.querySelector(selector);

export function claimText(count, rank) {
  return count === 1 ? `1 ${RANK_LABEL[rank]}` : `${count} ${RANK_PLURAL[rank]}`;
}

/** Elemento visual de uma carta. */
export function cardElement(rank, { theme = null, faded = false } = {}) {
  const el = document.createElement('div');
  el.className = `card rank-${rank}`;
  if (theme && (rank === theme || rank === 'JOKER')) el.classList.add('is-theme');
  if (faded) el.classList.add('disabled');
  el.innerHTML = `
    <span class="corner tl">${RANK_GLYPH[rank]}</span>
    <span class="rank">${RANK_GLYPH[rank]}</span>
    <span class="pip">${RANK_LABEL[rank]}</span>
    <span class="corner br">${RANK_GLYPH[rank]}</span>`;
  return el;
}

// ------------------------------------------------------------ tela inicial

export function renderAvatarPicker(container, selectedId, onSelect) {
  container.innerHTML = '';
  for (const [id, info] of Object.entries(AVATAR_INFO)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `avatar-option${id === selectedId ? ' is-active' : ''}`;
    button.dataset.avatar = id;
    button.innerHTML = `<span class="glyph">${info.glyph}</span>${info.name}`;
    button.addEventListener('click', () => onSelect(id));
    container.appendChild(button);
  }
}

// ------------------------------------------------------------------- lobby

export function renderLobbySeats(list, lobby, mySeatId, onRemove) {
  list.innerHTML = '';
  for (const seat of lobby.seats) {
    const info = AVATAR_INFO[seat.avatar] ?? AVATAR_INFO.urso;
    const li = document.createElement('li');
    const isHost = seat.id === lobby.hostId;
    const canRemove = lobby.hostId === mySeatId && seat.id !== mySeatId;

    li.innerHTML = `
      <span class="glyph">${info.glyph}</span>
      <span class="who">${escapeHtml(seat.name)}${seat.id === mySeatId ? ' (você)' : ''}</span>
      ${isHost ? '<span class="tag host">anfitrião</span>' : ''}
      ${seat.isBot ? '<span class="tag">bot</span>' : ''}
      ${!seat.connected ? '<span class="tag">caiu</span>' : ''}`;

    if (canRemove) {
      const kick = document.createElement('button');
      kick.className = 'kick';
      kick.textContent = '✕';
      kick.title = 'Remover';
      kick.addEventListener('click', () => onRemove(seat.id));
      li.appendChild(kick);
    }
    list.appendChild(li);
  }

  for (let i = lobby.seats.length; i < lobby.maxPlayers; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = '<span class="glyph">🪑</span><span class="who">Cadeira vazia…</span>';
    list.appendChild(li);
  }
}

// ------------------------------------------------------------- HUD da mesa

/**
 * Desenha a mão do jogador. Cartas do tema (e coringas) ganham borda verde
 * como lembrete visual de que aquela jogada seria verdadeira.
 */
export function renderHand(container, hand, { selected, tableCard, interactive }, onToggle) {
  container.innerHTML = '';
  if (!hand.length) {
    const empty = document.createElement('div');
    empty.className = 'hand-empty';
    empty.textContent = 'Sua mão está vazia — você está fora desta rodada.';
    container.appendChild(empty);
    return;
  }

  for (const card of hand) {
    const el = cardElement(card.rank, { theme: tableCard });
    if (selected.has(card.id)) el.classList.add('selected');
    if (!interactive) el.classList.add('disabled');
    el.addEventListener('click', () => onToggle(card.id));
    container.appendChild(el);
  }
}

export function renderPlayers(container, state, mySeatId) {
  container.innerHTML = '';
  for (const player of state.players) {
    const info = AVATAR_INFO[player.avatar] ?? AVATAR_INFO.urso;
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    if (player.id === state.turnPlayerId && state.phase === 'playing') chip.classList.add('is-turn');
    if (player.id === mySeatId) chip.classList.add('is-you');
    if (!player.alive) chip.classList.add('is-dead');

    const dots = Array.from({ length: player.chambers }, (_, i) => {
      if (!player.alive && i === player.pulls - 1) return '<span class="chamber-dot fatal"></span>';
      return `<span class="chamber-dot${i < player.pulls ? ' spent' : ''}"></span>`;
    }).join('');

    chip.innerHTML = `
      <span class="glyph">${info.glyph}</span>
      <div class="info">
        <div class="name">${escapeHtml(player.name)}${player.isBot ? ' 🤖' : ''}</div>
        <div class="meta">${player.alive ? `${player.handCount} carta${player.handCount === 1 ? '' : 's'}` : 'eliminado'}</div>
        <div class="chambers">${dots}</div>
      </div>`;
    container.appendChild(chip);
  }
}

export function addLog(logEl, text, kind = '') {
  const line = document.createElement('div');
  line.className = `log-line ${kind}`.trim();
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.childElementCount > 140) logEl.removeChild(logEl.firstChild);
}

export function addChat(chatEl, name, text) {
  const line = document.createElement('div');
  line.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
  chatEl.appendChild(line);
  chatEl.scrollTop = chatEl.scrollHeight;
  while (chatEl.childElementCount > 60) chatEl.removeChild(chatEl.firstChild);
}

let toastTimer = null;
export function toast(message, { error = false, ms = 2600 } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// -------------------------------------------------------- sobreposições

/** Mostra as cartas do desafio viradas para cima e o veredito. */
export function showReveal(reveal, mySeatId) {
  const overlay = $('#reveal-overlay');
  const title = overlay.querySelector('.reveal-title');
  const cards = overlay.querySelector('.reveal-cards');
  const verdict = overlay.querySelector('.reveal-verdict');

  title.innerHTML = `<b>${escapeHtml(reveal.challengerName)}</b> gritou MENTIROSO para <b>${escapeHtml(reveal.accusedName)}</b>`;

  cards.innerHTML = '';
  reveal.cards.forEach((card, i) => {
    const el = cardElement(card.rank, { theme: reveal.tableCard });
    const isLie = card.rank !== reveal.tableCard && card.rank !== 'JOKER';
    if (isLie) el.classList.add('bad');
    el.style.animationDelay = `${i * 0.12}s`;
    cards.appendChild(el);
  });

  const loserIsMe = reveal.loserId === mySeatId;
  verdict.className = `reveal-verdict ${reveal.truthful ? 'truth' : 'lie'}`;
  verdict.innerHTML = reveal.truthful
    ? `Eram mesmo ${RANK_PLURAL[reveal.tableCard]}. <b>${escapeHtml(reveal.challengerName)}</b> acusou à toa${loserIsMe ? ' — e o revólver é seu' : ''}.`
    : `Tinha carta fora do tema! <b>${escapeHtml(reveal.accusedName)}</b> mentiu${loserIsMe ? ' — e é você quem paga' : ''}.`;

  overlay.classList.remove('hidden');
}

export function hideReveal() {
  $('#reveal-overlay').classList.add('hidden');
}

/** Tela da roleta russa, com o tambor do revólver do perdedor. */
export function showRoulette({ name, pulls, chambers, isMe, canPull }) {
  const overlay = $('#roulette-overlay');
  const who = overlay.querySelector('.roulette-who');
  const sub = overlay.querySelector('.roulette-sub');
  const cylinder = overlay.querySelector('.cylinder');
  const inner = overlay.querySelector('.cylinder-inner');
  const pull = $('#btn-pull');

  who.textContent = isMe ? 'É a sua vez de rezar' : `${name} vai puxar o gatilho`;
  sub.textContent = `Câmara ${Math.min(pulls + 1, chambers)} de ${chambers} · ${chambers - pulls} tentativa${chambers - pulls === 1 ? '' : 's'} restante${chambers - pulls === 1 ? '' : 's'}`;

  inner.innerHTML = '';
  const radius = 52;
  for (let i = 0; i < chambers; i++) {
    const angle = (i / chambers) * Math.PI * 2 - Math.PI / 2;
    const hole = document.createElement('div');
    hole.className = 'chamber-hole';
    if (i < pulls) hole.classList.add('spent');
    if (i === pulls) hole.classList.add('current');
    hole.style.left = `${50 + (Math.cos(angle) * radius) / 1.68}%`;
    hole.style.top = `${50 + (Math.sin(angle) * radius) / 1.68}%`;
    inner.appendChild(hole);
  }

  cylinder.classList.remove('spinning');
  void cylinder.offsetWidth; // reinicia a animação de giro
  cylinder.classList.add('spinning');

  pull.classList.toggle('hidden', !canPull);
  overlay.classList.remove('hidden');
}

/** Marca o resultado do disparo no tambor já visível. */
export function resolveRoulette({ chamber, dead, name }) {
  const overlay = $('#roulette-overlay');
  if (overlay.classList.contains('hidden')) return;
  const holes = overlay.querySelectorAll('.chamber-hole');
  const hole = holes[chamber - 1];
  if (hole) {
    hole.classList.remove('current');
    hole.classList.add(dead ? 'live' : 'spent');
  }
  overlay.querySelector('.roulette-sub').textContent = dead
    ? `BANG. ${name} não levanta mais dessa cadeira.`
    : `Clique. ${name} respira fundo e continua no jogo.`;
  $('#btn-pull').classList.add('hidden');
}

export function hideRoulette() {
  $('#roulette-overlay').classList.add('hidden');
}

export function flashBang() {
  const flash = $('#flash');
  flash.classList.remove('bang');
  void flash.offsetWidth;
  flash.classList.add('bang');
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
