/**
 * Controlador do cliente: contas, telas, rede e a coreografia entre os eventos
 * do servidor, as animações 3D e o HUD.
 */

import { World } from './world.js';
import { sfx, setMuted, isMuted } from './audio.js';
import { announceDrink, announceLiar, announcePlay, primeVoice, setVoiceEnabled, voiceAvailable } from './voice.js';
import {
  $, addChat, addLog, claimText, escapeHtml, flashBang, hideCallOut, hidePotions, hideReveal, hideRoulette,
  markPotionChosen, RANK_PLURAL, renderAvatarPicker, renderHand, renderLeaderboard, renderLobbySeats,
  renderPlayers, resolvePotion, resolveRoulette, showCallOut, showPotions, showReveal, showRoulette, toast,
} from './ui.js';
import { AVATAR_IDS } from './avatars.js';

const SESSION_KEY = 'mesa-do-mentiroso:sessao';
const PREFS_KEY = 'mesa-do-mentiroso:prefs';
const TOKEN_KEY = 'mesa-do-mentiroso:token';

/** Ritmo da punição por poção: gole, suspense e veredito. */
const DRINK_MS = 950;
const SUSPENSE_MS = 2400;

const app = {
  socket: io(),
  world: null,
  user: null, // conta logada (null = convidado)
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
  createMode: 'revolver',
  createPotions: 5,
  worldSignature: null,
  voiceOn: true,
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
  for (const name of ['auth', 'home', 'lobby', 'game']) {
    $(`#screen-${name}`).classList.toggle('hidden', which !== name);
  }
}

const savePrefs = () =>
  localStorage.setItem(PREFS_KEY, JSON.stringify({ name: app.name, avatar: app.avatar }));

const saveSession = () =>
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ code: app.roomCode, seatId: app.seatId, token: app.token }),
  );

const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

const myPlayer = () => app.state?.players.find((p) => p.id === app.seatId) ?? null;

const isPotionsMode = () => app.state?.punishment?.mode === 'potions';

/** Chamada JSON com o token da conta, quando houver. */
async function api(path, { method = 'GET', body = null } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return await res.json();
  } catch {
    return { ok: false, error: 'Não consegui falar com o servidor.' };
  }
}

// ================================================================== CONTAS

function initAuth() {
  const panels = { login: $('#panel-login'), register: $('#panel-register'), forgot: $('#panel-forgot') };

  function openPanel(which) {
    for (const [name, panel] of Object.entries(panels)) panel.classList.toggle('hidden', name !== which);
    for (const tab of document.querySelectorAll('#auth-tabs .tab')) {
      tab.classList.toggle('is-active', tab.dataset.panel === which);
    }
    authError('');
    $('#forgot-devlink').classList.add('hidden');
  }

  for (const el of document.querySelectorAll('[data-panel]')) {
    el.addEventListener('click', () => openPanel(el.dataset.panel));
  }

  panels.login.addEventListener('submit', async (event) => {
    event.preventDefault();
    primeVoice();
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('#login-user').value, password: $('#login-pass').value },
    });
    if (!result.ok) return authError(result.error);
    signIn(result.user, result.token);
  });

  panels.register.addEventListener('submit', async (event) => {
    event.preventDefault();
    primeVoice();
    const result = await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: $('#reg-user').value,
        email: $('#reg-email').value,
        password: $('#reg-pass').value,
        confirm: $('#reg-pass2').value,
      },
    });
    if (!result.ok) return authError(result.error);
    signIn(result.user, result.token);
  });

  panels.forgot.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/auth/forgot', { method: 'POST', body: { email: $('#forgot-email').value } });
    authError('');
    toast(result.message || 'Pedido enviado.', { ms: 6000 });

    // Sem SMTP configurado o servidor devolve o link para você não travar.
    const box = $('#forgot-devlink');
    if (result.devLink) {
      box.innerHTML = `<b>O servidor está sem email configurado.</b>
        Use este link para redefinir sua senha:
        <a href="${escapeHtml(result.devLink)}">${escapeHtml(result.devLink)}</a>`;
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  });

  $('#btn-guest').addEventListener('click', () => {
    primeVoice();
    app.user = null;
    localStorage.removeItem(TOKEN_KEY);
    enterHome();
  });

  $('#btn-logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    app.user = null;
    app.socket.emit('auth:identify', { token: null });
    showScreen('auth');
  });
}

const authError = (message) => void ($('#auth-error').textContent = message || '');

function signIn(user, token) {
  app.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  app.socket.emit('auth:identify', { token });
  enterHome();
}

function enterHome() {
  const guest = !app.user;
  $('#account-name').textContent = app.user ? `👤 ${app.user.username}` : 'Convidado';
  $('#btn-logout').textContent = guest ? 'entrar' : 'sair';
  $('#guest-name-field').classList.toggle('hidden', !guest);
  if (!guest) app.name = app.user.username;

  refreshLeaderboard();
  showScreen('home');
}

async function refreshLeaderboard() {
  const result = await api('/api/leaderboard');
  if (result.ok) renderLeaderboard($('#leaderboard'), result.leaderboard, app.user?.username);
}

/** Retoma a sessão salva, se o token ainda valer. */
async function restoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return showScreen('auth');

  const result = await api('/api/auth/me');
  if (!result.ok) {
    localStorage.removeItem(TOKEN_KEY);
    return showScreen('auth');
  }
  app.user = result.user;
  app.socket.emit('auth:identify', { token });
  enterHome();
}

// ============================================================ TELA INICIAL

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

  // Tamanho da mesa
  for (const button of document.querySelectorAll('#home-size .size-btn')) {
    button.addEventListener('click', () => {
      app.createSize = Number(button.dataset.size);
      for (const other of document.querySelectorAll('#home-size .size-btn')) {
        other.classList.toggle('is-active', other === button);
      }
    });
  }

  // Modo de punição
  for (const button of document.querySelectorAll('#home-mode .mode-btn')) {
    button.addEventListener('click', () => {
      app.createMode = button.dataset.mode;
      for (const other of document.querySelectorAll('#home-mode .mode-btn')) {
        other.classList.toggle('is-active', other === button);
      }
      $('#home-potion-setting').classList.toggle('hidden', app.createMode !== 'potions');
    });
  }

  // Quantidade de poções
  for (const button of document.querySelectorAll('#home-potions .size-btn')) {
    button.addEventListener('click', () => {
      app.createPotions = Number(button.dataset.potions);
      for (const other of document.querySelectorAll('#home-potions .size-btn')) {
        other.classList.toggle('is-active', other === button);
      }
    });
  }

  $('#btn-create').addEventListener('click', () => {
    if (!requireName()) return;
    primeVoice();
    app.socket.emit(
      'room:create',
      {
        name: app.name,
        avatar: app.avatar,
        maxPlayers: app.createSize,
        punishment: { mode: app.createMode, potionCount: app.createPotions },
      },
      onSeated,
    );
  });

  $('#btn-join').addEventListener('click', joinFromInput);
  $('#input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinFromInput();
  });

  function joinFromInput() {
    if (!requireName()) return;
    primeVoice();
    const code = $('#input-code').value.trim().toUpperCase();
    if (code.length !== 4) return homeError('Digite o código de 4 letras da sala.');
    app.socket.emit('room:join', { code, name: app.name, avatar: app.avatar }, onSeated);
  }

  function requireName() {
    if (app.user) return true; // o nome vem da conta
    if (!app.name.trim()) {
      homeError('Escolha um nome antes de sentar à mesa.');
      nameInput.focus();
      return false;
    }
    homeError('');
    return true;
  }
}

const homeError = (message) => void ($('#home-error').textContent = message || '');

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

// ================================================================== LOBBY

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

  for (const button of document.querySelectorAll('#lobby-mode .mode-btn')) {
    button.addEventListener('click', () => {
      app.socket.emit(
        'room:setPunishment',
        { mode: button.dataset.mode, potionCount: app.lobby?.punishment?.potionCount ?? 5 },
        (res) => {
          if (!res?.ok) lobbyError(res?.error);
        },
      );
    });
  }

  for (const button of document.querySelectorAll('#lobby-potions .size-btn')) {
    button.addEventListener('click', () => {
      app.socket.emit(
        'room:setPunishment',
        { mode: 'potions', potionCount: Number(button.dataset.potions) },
        (res) => {
          if (!res?.ok) lobbyError(res?.error);
        },
      );
    });
  }
}

const lobbyError = (message) => void ($('#lobby-error').textContent = message || '');

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

  const mode = lobby.punishment?.mode ?? 'revolver';
  for (const button of document.querySelectorAll('#lobby-mode .mode-btn')) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
    button.disabled = !app.isHost;
  }
  $('#lobby-potion-setting').classList.toggle('hidden', mode !== 'potions');
  for (const button of document.querySelectorAll('#lobby-potions .size-btn')) {
    button.classList.toggle('is-active', Number(button.dataset.potions) === lobby.punishment?.potionCount);
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

// ============================================================ HUD DO JOGO

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
    app.socket.emit('game:punish', {}, (res) => {
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

  $('#btn-voice').addEventListener('click', () => {
    app.voiceOn = !app.voiceOn;
    setVoiceEnabled(app.voiceOn);
    $('#btn-voice').textContent = app.voiceOn ? '🗣️' : '🤐';
    $('#btn-voice').title = app.voiceOn ? 'Desligar a voz da mesa' : 'Ligar a voz da mesa';
  });
  if (!voiceAvailable()) {
    $('#btn-voice').disabled = true;
    $('#btn-voice').title = 'Este navegador não tem síntese de voz.';
  }

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

  const potions = isPotionsMode();
  const modePill = $('#hud-mode');
  modePill.textContent = potions ? `🧪 ${state.punishment.potionCount}` : '🔫 6';
  modePill.title = potions
    ? `Modo poções — bandeja de ${state.punishment.potionCount}, uma envenenada`
    : 'Modo revólver — 6 câmaras, 1 bala';

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
  playBtn.textContent = count ? `Baixar ${claimText(count, state.tableCard)}` : 'Baixar cartas';

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

// ============================================================== ESTADO 3D

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

// ====================================================== EVENTOS DO JOGO

/**
 * Toca a sequência de eventos com o ritmo certo: o desafio precisa respirar
 * antes da punição, e a poção precisa do suspense antes do veredito.
 */
function playEvents(events) {
  let delay = 0;

  for (const event of events) {
    schedule(delay, () => handleEvent(event));

    switch (event.type) {
      case 'challenge': delay += 700; break;
      case 'reveal': delay += 3400; break;
      case 'punishment:result':
        // No modo poções o resultado só aparece depois do gole e do suspense.
        delay += event.mode === 'potions' ? DRINK_MS + SUSPENSE_MS + 700 : 900;
        break;
      case 'eliminated': delay += 500; break;
      default: break;
    }
  }
}

function handleEvent(event) {
  const log = $('#log');

  switch (event.type) {
    case 'round:start': {
      app.selected.clear();
      hideReveal();
      hideRoulette();
      hidePotions();
      hideCallOut();
      app.world?.clearTray();
      addLog(log, `— Rodada ${event.round} — Tema da Mesa: ${RANK_PLURAL[event.tableCard]} —`, 'round');
      sfx.roundStart();
      sfx.deal();
      renderGame();
      break;
    }

    case 'play': {
      // Anúncio grande no centro + voz: a contagem tem que ser inconfundível.
      showCallOut(event.playerName, event.count, event.claim);
      announcePlay(event.count, event.claim);
      addLog(log, `${event.playerName} baixou ${event.count} carta${event.count === 1 ? '' : 's'}: "${claimText(event.count, event.claim)}".`);
      sfx.cardDrop();
      break;
    }

    case 'challenge': {
      hideCallOut();
      announceLiar();
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

    case 'punishment:pending': {
      hideReveal();
      const isMe = event.playerId === app.seatId;

      if (event.mode === 'potions') {
        app.world?.showTray(event.playerId, event.potions);
        showPotions(
          { name: event.playerName, potions: event.potions, total: event.total, isMe, canPick: isMe },
          (potionId) => {
            app.socket.emit('game:punish', { potionId }, (res) => {
              if (!res?.ok) toast(res?.error || 'Não deu para beber essa.', { error: true });
            });
          },
        );
        addLog(log, `${event.playerName} encara a bandeja de poções…`, 'danger');
      } else {
        showRoulette({
          name: event.playerName,
          pulls: event.chamber - 1,
          chambers: event.chambers,
          isMe,
          canPull: isMe,
        });
        sfx.spin();
        addLog(log, `${event.playerName} pega o revólver…`, 'danger');
      }
      break;
    }

    case 'punishment:result': {
      const isMe = event.playerId === app.seatId;

      if (event.mode === 'potions') {
        // 1) Escolha feita: o gole começa e a mesa prende a respiração.
        markPotionChosen(event.potionId, event.playerName, isMe);
        app.world?.drinkPotion(event.potionId);
        announceDrink();
        sfx.select();

        // 2) Suspense, e só então o veredito.
        schedule(DRINK_MS + SUSPENSE_MS, () => {
          resolvePotion({
            potionId: event.potionId,
            fatal: event.fatal,
            name: event.playerName,
            remaining: event.remaining,
            isMe,
          });
          app.world?.finishDrink(event.fatal);

          if (event.fatal) {
            sfx.gunshot();
            flashBang();
            app.world?.shake(0.7);
            addLog(log, `GLUP… ${event.playerName} bebeu a poção envenenada.`, 'danger');
          } else {
            sfx.click();
            addLog(log, `${event.playerName} bebeu e continua de pé (${event.remaining} restante${event.remaining === 1 ? '' : 's'}).`, 'good');
          }
        });
      } else {
        resolveRoulette({ chamber: event.chamber, dead: event.fatal, name: event.playerName });
        if (event.fatal) {
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
      }
      break;
    }

    case 'eliminated': {
      schedule(1200, () => {
        hideRoulette();
        hidePotions();
      });
      break;
    }

    case 'round:exhausted': {
      addLog(log, 'As cartas acabaram sem ninguém desafiar. Rodada anulada.', 'system');
      break;
    }

    case 'round:end': {
      schedule(1400, () => {
        hideRoulette();
        hidePotions();
        app.world?.clearTray();
      });
      break;
    }

    case 'game:over': {
      schedule(1200, () => {
        hideRoulette();
        hidePotions();
        hideReveal();
        app.world?.clearTray();

        const won = event.winnerId === app.seatId;
        $('#gameover-title').textContent = won ? 'Você sobreviveu' : 'Fim de jogo';
        $('#gameover-sub').innerHTML = event.winnerName
          ? won
            ? 'Último de pé na Mesa do Mentiroso. A casa paga a próxima rodada.'
            : `<b>${escapeHtml(event.winnerName)}</b> foi o último de pé.`
          : 'A mesa acabou vazia.';
        $('#btn-again').textContent = app.isHost ? 'Voltar ao lobby' : 'Aguardando o anfitrião…';
        $('#gameover-score').classList.add('hidden');
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

// ==================================================================== REDE

function initSocket() {
  const socket = app.socket;

  socket.on('connect', () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) socket.emit('auth:identify', { token });

    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!saved?.code || !saved.seatId) return;
    socket.emit('room:rejoin', saved, (res) => {
      if (res?.ok) {
        onSeated(res);
      } else {
        clearSession();
        if (app.user || localStorage.getItem(TOKEN_KEY)) enterHome();
        else showScreen('auth');
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
      app.worldSignature = null; // partida reiniciada: a mesa 3D é remontada
      renderLobby();
      showScreen(app.seatId ? 'lobby' : 'home');
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

  socket.on('leaderboard:update', ({ leaderboard, scored, reason, wins }) => {
    renderLeaderboard($('#leaderboard'), leaderboard, app.user?.username);
    if (app.user) refreshLeaderboard();

    const note = $('#gameover-score');
    const won = app.state?.winnerId === app.seatId;
    if (reason) {
      note.textContent = reason;
      note.classList.remove('hidden');
    } else if (scored && won) {
      note.innerHTML = `Vitória registrada no placar — você já tem <b>${wins}</b>.`;
      note.classList.remove('hidden');
    } else if (won && !app.user) {
      note.textContent = 'Você jogou como convidado, então esta vitória não entrou no placar.';
      note.classList.remove('hidden');
    }
  });

  socket.on('game:reset', () => {
    clearSchedule();
    app.state = null;
    app.selected.clear();
    app.worldSignature = null;
    hideReveal();
    hideRoulette();
    hidePotions();
    hideCallOut();
    app.world?.clearTray();
    $('#gameover-overlay').classList.add('hidden');
    $('#log').innerHTML = '';
    showScreen('lobby');
    renderLobby();
  });

  socket.on('chat:message', ({ name, text }) => addChat($('#chat-messages'), name, text));
}

// ==================================================================== BOOT

initAuth();
initHome();
initLobby();
initGameHud();
initSocket();
restoreSession();
