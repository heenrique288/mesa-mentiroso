/**
 * Texturas geradas em canvas — o jogo não depende de nenhum arquivo de imagem.
 */

import * as THREE from 'three';

const cache = new Map();

function memo(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const RANK_STYLE = {
  A: { glyph: 'A', word: 'ÁS', color: '#1d1815', accent: '#8d7a5c' },
  K: { glyph: 'K', word: 'REI', color: '#9d2f27', accent: '#c2705f' },
  Q: { glyph: 'Q', word: 'DAMA', color: '#7c3f8f', accent: '#a97ab5' },
  JOKER: { glyph: '★', word: 'CORINGA', color: '#ffd970', accent: '#b9a2e8' },
};

/** Frente da carta com o naipe fictício da casa. */
export function cardFaceTexture(rank) {
  return memo(`face:${rank}`, () => {
    const W = 256;
    const H = 360;
    const { canvas, ctx } = makeCanvas(W, H);
    const style = RANK_STYLE[rank] ?? RANK_STYLE.A;
    const joker = rank === 'JOKER';

    ctx.fillStyle = joker ? '#16101f' : '#f6f0e2';
    roundRect(ctx, 4, 4, W - 8, H - 8, 22);
    ctx.fill();

    ctx.strokeStyle = joker ? '#ffd970' : '#c9bda3';
    ctx.lineWidth = 4;
    roundRect(ctx, 14, 14, W - 28, H - 28, 16);
    ctx.stroke();

    // Glifo central
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${joker ? 116 : 148}px Georgia, serif`;
    ctx.fillText(style.glyph, W / 2, H / 2 - 14);

    ctx.fillStyle = style.accent;
    ctx.font = '700 22px Georgia, serif';
    ctx.letterSpacing = '6px';
    ctx.fillText(style.word, W / 2, H / 2 + 76);

    // Cantos
    ctx.fillStyle = style.color;
    ctx.font = '800 40px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(style.glyph, 30, 28);
    ctx.save();
    ctx.translate(W - 30, H - 28);
    ctx.rotate(Math.PI);
    ctx.fillText(style.glyph, 0, 0);
    ctx.restore();

    return toTexture(canvas);
  });
}

/** Verso: padrão de bar, para as cartas viradas para baixo na mesa. */
export function cardBackTexture() {
  return memo('back', () => {
    const W = 256;
    const H = 360;
    const { canvas, ctx } = makeCanvas(W, H);

    ctx.fillStyle = '#7c1f1a';
    roundRect(ctx, 4, 4, W - 8, H - 8, 22);
    ctx.fill();

    // Losangos entrelaçados
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.30)';
    ctx.lineWidth = 2;
    const step = 26;
    for (let x = -H; x < W + H; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(ctx, 26, 26, W - 52, H - 52, 14);
    ctx.fill();
    ctx.strokeStyle = '#e9b44c';
    ctx.lineWidth = 3;
    roundRect(ctx, 26, 26, W - 52, H - 52, 14);
    ctx.stroke();

    ctx.fillStyle = '#e9b44c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 78px Georgia, serif';
    ctx.fillText('☠', W / 2, H / 2 - 8);
    ctx.font = '700 17px Georgia, serif';
    ctx.letterSpacing = '5px';
    ctx.fillText('MENTIROSO', W / 2, H / 2 + 64);

    return toTexture(canvas);
  });
}

/** Borda lateral fina das cartas. */
export function cardEdgeTexture() {
  return memo('edge', () => {
    const { canvas, ctx } = makeCanvas(8, 8);
    ctx.fillStyle = '#e8e0cd';
    ctx.fillRect(0, 0, 8, 8);
    return toTexture(canvas);
  });
}

/** Madeira procedural para o tampo da mesa. */
export function woodTexture() {
  return memo('wood', () => {
    const S = 512;
    const { canvas, ctx } = makeCanvas(S, S);
    ctx.fillStyle = '#4a2f1d';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const y = Math.random() * S;
      ctx.strokeStyle = `rgba(${20 + Math.random() * 60}, ${10 + Math.random() * 30}, 5, ${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 22, S * 0.7, y + (Math.random() - 0.5) * 22, S, y);
      ctx.stroke();
    }
    const texture = toTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  });
}

/** Feltro do centro da mesa, onde as cartas são baixadas. */
export function feltTexture() {
  return memo('felt', () => {
    const S = 256;
    const { canvas, ctx } = makeCanvas(S, S);
    ctx.fillStyle = '#1d4436';
    ctx.fillRect(0, 0, S, S);
    const image = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 26;
      image.data[i] += noise;
      image.data[i + 1] += noise;
      image.data[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);
    return toTexture(canvas);
  });
}

/**
 * Placa flutuante com nome e status do jogador.
 * Recriada sempre que o estado muda, então não entra no cache.
 */
export function nameplateTexture({ name, subtitle, highlight = false, dead = false }) {
  const W = 512;
  const H = 160;
  const { canvas, ctx } = makeCanvas(W, H);

  ctx.fillStyle = dead ? 'rgba(15,10,8,0.72)' : 'rgba(15, 10, 8, 0.86)';
  roundRect(ctx, 6, 6, W - 12, H - 12, 26);
  ctx.fill();

  ctx.strokeStyle = dead ? 'rgba(140,130,120,0.35)' : highlight ? '#e9b44c' : 'rgba(233,180,76,0.32)';
  ctx.lineWidth = highlight ? 6 : 3;
  roundRect(ctx, 6, 6, W - 12, H - 12, 26);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dead ? '#7b7168' : highlight ? '#f3d38b' : '#f2e8d8';
  ctx.font = '800 52px "Segoe UI", sans-serif';
  ctx.fillText(name, W / 2, 58);

  if (dead) {
    ctx.strokeStyle = '#b3372f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(70, 58);
    ctx.lineTo(W - 70, 58);
    ctx.stroke();
  }

  ctx.fillStyle = dead ? '#b3372f' : '#a2917a';
  ctx.font = '600 34px "Segoe UI", sans-serif';
  ctx.fillText(subtitle, W / 2, 112);

  return toTexture(canvas);
}
