/**
 * Efeitos sonoros sintetizados na hora com WebAudio — nenhum arquivo externo.
 */

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(muted) {
  enabled = !muted;
  if (master) master.gain.value = enabled ? 0.5 : 0;
  return enabled;
}

export function isMuted() {
  return !enabled;
}

/** Buffer de ruído branco reaproveitado pelos estalos e pelo tiro. */
function noiseBuffer(seconds) {
  const audio = ensure();
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noise(duration, { gain = 0.4, filter = 'lowpass', freq = 1200, q = 1, decay = 0.9 } = {}) {
  if (!enabled) return;
  const audio = ensure();
  const source = audio.createBufferSource();
  source.buffer = noiseBuffer(duration);

  const biquad = audio.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  biquad.Q.value = q;

  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(gain, audio.currentTime);
  envelope.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration * decay);

  source.connect(biquad).connect(envelope).connect(master);
  source.start();
  source.stop(audio.currentTime + duration);
}

function tone(freq, duration, { type = 'sine', gain = 0.22, slideTo = null } = {}) {
  if (!enabled) return;
  const audio = ensure();
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + duration);

  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(0.0001, audio.currentTime);
  envelope.gain.exponentialRampToValueAtTime(gain, audio.currentTime + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);

  osc.connect(envelope).connect(master);
  osc.start();
  osc.stop(audio.currentTime + duration + 0.02);
}

export const sfx = {
  /** Carta batendo no feltro. */
  cardDrop() {
    noise(0.12, { gain: 0.25, filter: 'bandpass', freq: 2600, q: 0.8 });
  },
  /** Distribuição de cartas no início da rodada. */
  deal() {
    for (let i = 0; i < 5; i++) setTimeout(() => sfx.cardDrop(), i * 85);
  },
  select() {
    tone(720, 0.07, { type: 'triangle', gain: 0.12 });
  },
  /** Grito de "mentiroso": batida grave e tensa. */
  challenge() {
    tone(180, 0.5, { type: 'sawtooth', gain: 0.2, slideTo: 70 });
    noise(0.3, { gain: 0.22, filter: 'lowpass', freq: 500 });
  },
  /** Tambor do revólver girando. */
  spin() {
    let step = 0;
    const timer = setInterval(() => {
      noise(0.045, { gain: 0.18, filter: 'bandpass', freq: 3200, q: 3 });
      if (++step > 9) clearInterval(timer);
    }, 78);
  },
  /** Clique da câmara vazia — o som do alívio. */
  click() {
    noise(0.06, { gain: 0.5, filter: 'bandpass', freq: 2400, q: 6 });
    tone(1400, 0.05, { type: 'square', gain: 0.08 });
  },
  /** Bang. */
  gunshot() {
    noise(0.55, { gain: 0.95, filter: 'lowpass', freq: 900, decay: 0.55 });
    noise(0.18, { gain: 0.6, filter: 'highpass', freq: 2400 });
    tone(90, 0.42, { type: 'sawtooth', gain: 0.35, slideTo: 32 });
  },
  /** Início de rodada. */
  roundStart() {
    tone(392, 0.18, { type: 'triangle', gain: 0.16 });
    setTimeout(() => tone(523, 0.26, { type: 'triangle', gain: 0.16 }), 130);
  },
  victory() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => tone(f, 0.34, { type: 'triangle', gain: 0.2 }), i * 150),
    );
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) =>
      setTimeout(() => tone(f, 0.4, { type: 'sawtooth', gain: 0.16 }), i * 190),
    );
  },
  notify() {
    tone(880, 0.1, { type: 'sine', gain: 0.1 });
  },
};
