/**
 * Voz da mesa — usa a síntese de fala do próprio navegador (Web Speech API),
 * então não precisa de nenhum arquivo de áudio.
 *
 * As falas são em inglês, como no jogo original: "Two Kings", "Liar!".
 * Onde a API não existir (ou não houver voz instalada), tudo vira silêncio
 * sem quebrar nada.
 */

const NUMBER_WORD = ['zero', 'One', 'Two', 'Three', 'Four', 'Five'];

const RANK_WORD = {
  A: ['Ace', 'Aces'],
  K: ['King', 'Kings'],
  Q: ['Queen', 'Queens'],
  JOKER: ['Joker', 'Jokers'],
};

const supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

let enabled = true;
let preferred = null;

/**
 * A lista de vozes chega de forma assíncrona no Chrome; escolhemos uma em
 * inglês e damos preferência às femininas mais limpas quando existirem.
 */
function pickVoice() {
  if (!supported) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : voices;

  const nice = pool.find((v) => /google us english|samantha|zira|aria|jenny/i.test(v.name));
  return nice || pool.find((v) => /en-US/i.test(v.lang)) || pool[0];
}

if (supported) {
  preferred = pickVoice();
  speechSynthesis.addEventListener('voiceschanged', () => {
    preferred = pickVoice();
  });
}

export function setVoiceEnabled(on) {
  enabled = !!on;
  if (!enabled && supported) speechSynthesis.cancel();
}

export function voiceAvailable() {
  return supported;
}

/**
 * @param {string} text
 * @param {{rate?:number, pitch?:number, volume?:number, interrupt?:boolean}} options
 */
export function speak(text, { rate = 1, pitch = 1, volume = 1, interrupt = false } = {}) {
  if (!supported || !enabled || !text) return;
  try {
    // Falas antigas na fila atrapalham o ritmo da mesa.
    if (interrupt || speechSynthesis.speaking) speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (preferred) {
      utterance.voice = preferred;
      utterance.lang = preferred.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    speechSynthesis.speak(utterance);
  } catch {
    // Navegador sem voz instalada: seguir em silêncio.
  }
}

/** "One King", "Two Kings"… anunciando o que o jogador afirmou ter baixado. */
export function announcePlay(count, rank) {
  const number = NUMBER_WORD[count] ?? String(count);
  const words = RANK_WORD[rank] ?? RANK_WORD.K;
  const noun = count === 1 ? words[0] : words[1];
  speak(`${number} ${noun}`, { rate: 0.98, pitch: 0.95, interrupt: true });
}

/** O grito do desafio. */
export function announceLiar() {
  speak('Liar!', { rate: 1.05, pitch: 0.85, interrupt: true });
}

/** Chamado quando o perdedor vai beber — dá o clima do suspense. */
export function announceDrink() {
  speak('Drink.', { rate: 0.9, pitch: 0.8, interrupt: true });
}

/**
 * O Chrome só libera a fala depois de um gesto do usuário. Chamamos isso no
 * primeiro clique para "destravar" a voz antes da primeira jogada.
 */
export function primeVoice() {
  if (!supported) return;
  try {
    const warmup = new SpeechSynthesisUtterance('');
    warmup.volume = 0;
    speechSynthesis.speak(warmup);
  } catch {
    /* ignorado */
  }
}
