/**
 * Controlador do cliente: telas, rede e a coreografia entre os eventos do
 * servidor, as animações 3D e o HUD.
 */

import { World } from './world.js';
import { sfx, setMuted, isMuted } from './audio.js';
import {
  $, addChat, addLog, claimText, escapeHtml, flashBang, hideReveal, hideRoulette,
  RANK_PLURAL, renderAvatarPicker, renderHand, renderLobbySeats, renderPlayers, resolveRoulette,
  showReveal, showRoulette, toast,
} from './ui.js';
import { AVATAR_IDS } from './avatars.js';

const SESSION_KEY = 'mesa-do-mentiroso:sessao';
const PREFS_KEY = 'mesa-do-mentiroso:prefs';

const app = {
  socket: io(),
  world: null,
  seatId: null,
  token: null,
  roomCode: null,
  isHost: false,
  lobby: null,
  state: null,
  selected: new Set(),
  avatar: AVATAR_IDS[0],
  name: '',
  createSize: 4,
  worldSignature: null,
  timers: [],
};

// ------------------------------------------------------------------ util

/** Agenda um passo da coreografia; tudo é cancelado ao trocar de partida. */
function schedule(delay, fn) {
  const handle = setTimeout(() => {
    app.timers = app.timers.filter((t) => t !== handle);
    fn();
  }, delay);
  app.timers.push(handle);
  return handle;
}

function clearSchedule() {
  for (const handle of app.timers) clearTimeout(handle);
  app.timers = [];
}

function showScreen(which) {
  $('#screen-home').classList.toggle('hidden', which !== 'home');
  $('#screen-lobby').classList.toggle('hidden', which !== 'lobby');
  $('#screen-game').classList.toggle('hidden', which !== 'game');
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ name: app.name, avatar: app.avatar }));
}

function saveSession() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ code: app.roomCode, seatId: app.seatId, token: app.token }),
  );
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function myPlayer() {
  return app.state?.players.find((p) => p.id === app.seatId) ?? null;
}

// ------------------------------------------------------------ tela inicial

function initHome() {
  const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  app.name = prefs.name || '';
  app.avatar = AVATAR_IDS.includes(prefs.avatar) ? prefs.avatar : AVATAR_IDS[0];

  const nameInput = $('#input-name');
  nameInput.value = app.name;
  nameInput.addEventListener('input', () => {
    app.name = nameInput.value;
    savePrefs();
  });

  function pickAvatar(id) {
    app.avatar = id;
    savePrefs();
    renderAvatarPicker($('#avatar-picker'), app.avatar, pickAvatar);
  }
  renderAvatarPicker($('#avatar-picker'), app.avatar, pickAvatar);

  for (const button of document.querySelectorAll('#screen-home .size-btn')) {
    button.addEventListener('click', () => {
      app.createSize = Number(button.dataset.size);
      for (const other of document.querySelectorAll('#screen-home .size-btn')) {
        other.classList.toggle('is-active', other === button);
      }
    });
  }

  $('#btn-create').addEventListener('click', () => {
    if (!requireName()) return;
    app.socket.emit(
      'room:create',
      { name: app.name, avatar: app.avatar, maxPlayers: app.createSize },
      onSeated,
    );
  });

  $('#btn-join').addEventListener('click', joinFromInput);
  $('#input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinFromInput();
  });

  function joinFromInput() {
    if (!requireName()) return;
    const code = $('#input-code').value.trim().toUpperCase();
    if (code.length !== 4) return homeError('Digite o código de 4 letras da sala.');
    app.socket.emit('room:join', { code, name: app.name, avatar: app.avatar }, onSeated);
  }

  function requireName() {
    if (!app.name.trim()) {
      homeError('Escolha um nome antes de sentar à mesa.');
      nameInput.focus();
      return false;
    }
    homeError('');
    return true;
  }
}

function homeError(message) {
  $('#home-error').textContent = message;
}

/** Resposta do servidor ao criar/entrar/reconectar em uma sala. */
function onSeated(response) {
  if (!response?.ok) return homeError(response?.error || 'Não foi possível entrar na sala.');
  app.seatId = response.seatId;
  app.token = response.token;
  app.roomCode = response.code;
  app.isHost = response.isHost;
  saveSession();
  sfx.notify();
  homeError('');
}

// ------------------------------------------------------------------ lobby

function initLobby() {
  $('#btn-add-bot').addEventListener('click', () => {
    app.socket.emit('room:addBot', {}, (res) => {
      if (!res?.ok) lobbyError(res?.error);
    });
  });

  $('#btn-start').addEventListener('click', () => {
    app.socket.emit('game:start', {}, (res) => {
      if (!res?.ok) lobbyError(res?.error);
    });
  });

  for (const button of document.querySelectorAll('#lobby-size .size-btn')) {
    button.addEventListener('click', () => {
      app.socket.emit('room:setSize', { maxPlayers: Number(button.dataset.size) }, (res) => {
        if (!res?.ok) lobbyError(res?.error);
      });
    });
  }
}

function lobbyError(message) {
  $('#lobby-error').textContent = message || '';
}

function renderLobby() {
  const lobby = app.lobby;
  if (!lobby) return;

  $('#lobby-code').textContent = lobby.code;
  $('#hud-room').textContent = lobby.code;
  app.isHost = lobby.hostId === app.seatId;

  renderLobbySeats($('#lobby-seats'), lobby, app.seatId, (seatId) => {
    app.socket.emit('room:removeSeat', { seatId }, (res) => {
      if (!res?.ok) lobbyError(res?.error);
    });
  });

  for (const button of document.querySelectorAll('#lobby-size .size-btn')) {
    button.classList.toggle('is-active', Number(button.dataset.size) === lobby.maxPlayers);
    button.disabled = !app.isHost;
  }

  const missing = lobby.maxPlayers - lobby.seats.length;
  $('#btn-add-bot').disabled = !app.isHost || missing <= 0;
  $('#btn-start').disabled = !app.isHost || missing !== 0;
  $('#lobby-hint').textContent = !app.isHost
    ? 'Aguardando o anfitrião começar a partida…'
    : missing > 0
      ? `Faltam ${missing} jogador${missing === 1 ? '' : 'es'}. Convide a galera ou complete com bots.`
      : 'Mesa cheia. Pode virar a primeira carta.';
}

// -------------------------------------------------------------- HUD do jogo

function initGameHud() {
  $('#btn-play').addEventListener('click', () => {
    if (!app.selected.size) return;
    const cardIds = [...app.selected];
    app.socket.emit('game:play', { cardIds }, (res) => {
      if (!res?.ok) return toast(res?.error || 'Jogada recusada.', { error: true });
      app.selected.clear();
      renderGame();
    });
  });

  $('#btn-challenge').addEventListener('click', () => {
    app.socket.emit('game:challenge', {}, (res) => {
      if (!res?.ok) toast(res?.error || 'Não dá para desafiar agora.', { error: true });
    });
  });

  $('#btn-pull').addEventListener('click', () => {
    $('#btn-pull').classList.add('hidden');
    sfx.spin();
    app.socket.emit('game:pull', {}, (res) => {
      if (!res?.ok) toast(res?.error || 'O gatilho não é seu.', { error: true });
    });
  });

  $('#btn-again').addEventListener('click', () => {
    app.socket.emit('game:reset', {}, (res) => {
      if (!res?.ok) toast(res?.error || 'Só o anfitrião pode reiniciar.', { error: true });
    });
  });

  $('#btn-mute').addEventListener('click', () => {
    const on = setMuted(!isMuted());
    $('#btn-mute').textContent = on ? '🔊' : '🔇';
  });

  $('#btn-leave').addEventListener('click', () => {
    if (!confirm('Sair da mesa?')) return;
    clearSession();
    location.reload();
  });

  const chatInput = $('#chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !chatInput.value.trim()) return;
    app.socket.emit('chat:send', { text: chatInput.value });
    chatInput.value = '';
  });
}

/** Redesenha todo o HUD a partir do estado atual. */
function renderGame() {
  const state = app.state;
  if (!state) return;

  const me = myPlayer();
  const myTurn = state.turnPlayerId === app.seatId && state.phase === 'playing' && me?.alive;
  const hand = state.you?.hand ?? [];

  $('#hud-round').textContent = state.round;
  $('#hud-theme-value').textContent = state.tableCard ? RANK_PLURAL[state.tableCard] : '—';

  renderPlayers($('#players-strip'), state, app.seatId);
  renderHand($('#hand'), hand, {
    selected: app.selected,
    tableCard: state.tableCard,
    interactive: myTurn,
  }, toggleCard);

  // Banner de turno — deixa explícito de quem (e de quê) dá para duvidar.
  const banner = $('#turn-banner');
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const accused = state.lastPlay && state.players.find((p) => p.id === state.lastPlay.playerId);
  banner.classList.toggle('is-you', !!myTurn);

  if (state.phase === 'gameOver') {
    banner.textContent = '';
  } else if (myTurn && accused && accused.id !== app.seatId) {
    banner.textContent = `Sua vez — ${accused.name} jurou ter baixado ${claimText(state.lastPlay.count, state.tableCard)}. Acredita?`;
  } else if (myTurn) {
    banner.textContent = 'Sua vez — abra a rodada baixando cartas';
  } else if (state.phase === 'playing' && turnPlayer) {
    banner.textContent = accused
      ? `Vez de ${turnPlayer.name} — decidindo se acredita em ${accused.name}…`
      : `Vez de ${turnPlayer.name}…`;
  } else if (state.phase === 'roundEnd') {
    banner.textContent = 'Embaralhando para a próxima rodada…';
  } else {
    banner.textContent = '';
  }

  // Botões
  const playBtn = $('#btn-play');
  const challengeBtn = $('#btn-challenge');
  const count = app.selected.size;

  playBtn.disabled = !myTurn || count === 0;
  playBtn.textContent = count
    ? `Baixar ${claimText(count, state.tableCard)}`
    : 'Baixar cartas';

  const canChallenge = myTurn && state.lastPlay && state.lastPlay.playerId !== app.seatId;
  challengeBtn.disabled = !canChallenge;
  challengeBtn.title = accused
    ? `Duvidar de ${accused.name} (${claimText(state.lastPlay.count, state.tableCard)})`
    : 'Ninguém jogou ainda';
}

function toggleCard(cardId) {
  if (app.selected.has(cardId)) app.selected.delete(cardId);
  else app.selected.add(cardId);
  sfx.select();
  renderGame();
}

// ----------------------------------------------------------- estado 3D

function syncWorld(state) {
  if (!app.world) app.world = new World($('#scene'));

  const me = state.players.find((p) => p.id === app.seatId);
  const mySeat = me ? me.seat : 0;
  const signature = `${state.players.map((p) => `${p.id}:${p.seat}:${p.avatar}`).join('|')}#${mySeat}`;

  if (app.worldSignature !== signature) {
    app.worldSignature = signature;
    app.world.setup(state.players, mySeat);
  }

  app.world.syncPlayers(state);
  app.world.syncPile(state);
}

// ------------------------------------------------------- eventos do jogo

/**
 * Toca a sequência de eventos com o ritmo certo: o desafio precisa respirar
 * antes de a roleta aparecer.
 */
function playEvents(events) {
  let delay = 0;

  for (const event of events) {
    const at = delay;
    schedule(at, () => handleEvent(event));

    switch (event.type) {
      case 'challenge': delay += 700; break;
      case 'reveal': delay += 3400; break;
      case 'shot': delay += 900; break;
      case 'eliminated': delay += 500; break;
      default: break;
    }
  }
}

function handleEvent(event) {
  const state = app.state;
  const log = $('#log');

  switch (event.type) {
    case 'round:start': {
      app.selected.clear();
      hideReveal();
      hideRoulette();
      addLog(log, `— Rodada ${event.round} — Tema da Mesa: ${RANK_PLURAL[event.tableCard]} —`, 'round');
      sfx.roundStart();
      sfx.deal();
      renderGame();
      break;
    }

    case 'play': {
      addLog(log, `${event.playerName} baixou ${event.count} carta${event.count === 1 ? '' : 's'}: "${claimText(event.count, event.claim)}".`);
      sfx.cardDrop();
      break;
    }

    case 'challenge': {
      addLog(log, `${event.challengerName} gritou MENTIROSO para ${event.accusedName}!`, 'danger');
      sfx.challenge();
      app.world?.shake(0.12);
      break;
    }

    case 'reveal': {
      app.world?.revealCards(event);
      showReveal(event, app.seatId);
      addLog(
        log,
        `Cartas na mesa: ${event.cards.map((c) => ({ A: 'Ás', K: 'Rei', Q: 'Dama', JOKER: 'Coringa' })[c.rank]).join(', ')} — ${event.truthful ? 'era verdade!' : 'era mentira!'}`,
        event.truthful ? 'good' : 'danger',
      );
      break;
    }

    case 'roulette:pending': {
      hideReveal();
      showRoulette({
        name: event.playerName,
        pulls: event.chamber - 1,
        chambers: event.chambers,
        isMe: event.playerId === app.seatId,
        canPull: event.playerId === app.seatId,
      });
      sfx.spin();
      addLog(log, `${event.playerName} pega o revólver…`, 'danger');
      break;
    }

    case 'shot': {
      resolveRoulette({ chamber: event.chamber, dead: event.dead, name: event.playerName });
      if (event.dead) {
        sfx.gunshot();
        flashBang();
        app.world?.shake(0.9);
        app.world?.muzzleFlash();
        addLog(log, `BANG! ${event.playerName} pegou a bala na câmara ${event.chamber}.`, 'danger');
      } else {
        sfx.click();
        app.world?.shake(0.08);
        addLog(log, `Clique… ${event.playerName} sobreviveu (câmara ${event.chamber}/${event.chambers}).`, 'good');
      }
      break;
    }

    case 'eliminated': {
      schedule(1200, () => hideRoulette());
      break;
    }

    case 'round:exhausted': {
      addLog(log, 'As cartas acabaram sem ninguém desafiar. Rodada anulada.', 'system');
      break;
    }

    case 'round:end': {
      schedule(1400, () => hideRoulette());
      break;
    }

    case 'game:over': {
      schedule(1200, () => {
        hideRoulette();
        hideReveal();
        const won = event.winnerId === app.seatId;
        $('#gameover-title').innerHTML = won ? 'Você sobreviveu' : 'Fim de jogo';
        $('#gameover-sub').innerHTML = event.winnerName
          ? won
            ? 'Último de pé na Mesa do Mentiroso. A casa paga a próxima rodada.'
            : `<b>${escapeHtml(event.winnerName)}</b> foi o último de pé.`
          : 'A mesa acabou vazia.';
        $('#btn-again').textContent = app.isHost ? 'Voltar ao lobby' : 'Aguardando o anfitrião…';
        $('#gameover-overlay').classList.remove('hidden');
        if (won) sfx.victory();
        else sfx.defeat();
      });
      addLog(log, `Fim de jogo! ${event.winnerName ?? 'Ninguém'} sobreviveu à mesa.`, 'round');
      break;
    }

    default:
      break;
  }
}

// ------------------------------------------------------------------- rede

function initSocket() {
  const socket = app.socket;

  socket.on('connect', () => {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!saved?.code || !saved.seatId) return;
    socket.emit('room:rejoin', saved, (res) => {
      if (res?.ok) {
        onSeated(res);
      } else {
        clearSession();
        showScreen('home');
      }
    });
  });

  socket.on('disconnect', () => toast('Conexão perdida — tentando voltar…', { error: true, ms: 4000 }));

  socket.on('room:state', (lobby) => {
    app.lobby = lobby;
    app.isHost = lobby.hostId === app.seatId; // pode mudar se o anfitrião cair
    $('#hud-room').textContent = lobby.code;
    if (lobby.started) {
      showScreen('game');
    } else {
      renderLobby();
      showScreen(app.seatId ? 'lobby' : 'home');
    }
    if (!lobby.started) {
      // Uma partida pode ter sido reiniciada: zera a mesa 3D.
      app.worldSignature = null;
    }
  });

  socket.on('game:state', (state) => {
    app.state = state;
    // Descarta seleções de cartas que não estão mais na mão.
    const ids = new Set((state.you?.hand ?? []).map((c) => c.id));
    for (const id of app.selected) if (!ids.has(id)) app.selected.delete(id);

    showScreen('game');
    syncWorld(state);
    renderGame();
  });

  socket.on('game:events', (events) => playEvents(events));

  socket.on('game:log', ({ lines }) => {
    const log = $('#log');
    log.innerHTML = '';
    for (const line of lines) addLog(log, line, 'system');
  });

  socket.on('game:notice', ({ message }) => {
    addLog($('#log'), message, 'system');
    toast(message);
  });

  socket.on('game:error', ({ message }) => toast(message, { error: true }));

  socket.on('game:reset', () => {
    clearSchedule();
    app.state = null;
    app.selected.clear();
    app.worldSignature = null;
    hideReveal();
    hideRoulette();
    $('#gameover-overlay').classList.add('hidden');
    $('#log').innerHTML = '';
    showScreen('lobby');
    renderLobby();
  });

  socket.on('chat:message', ({ name, text }) => addChat($('#chat-messages'), name, text));
}

// ------------------------------------------------------------------ boot

initHome();
initLobby();
initGameHud();
initSocket();
showScreen('home');
