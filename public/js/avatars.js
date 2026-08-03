/**
 * Avatares dos frequentadores do bar, montados só com formas primitivas.
 * Cada personagem é um Group virado para +Z (o mundo gira o grupo depois).
 */

import * as THREE from 'three';

export const AVATAR_INFO = {
  urso: { name: 'Urso', glyph: '🐻', fur: 0x7a5230, accent: 0xc2a077, cloth: 0x4b3a5c },
  touro: { name: 'Touro', glyph: '🐂', fur: 0x4a4550, accent: 0xd8d2c4, cloth: 0x6d2a24 },
  raposa: { name: 'Raposa', glyph: '🦊', fur: 0xc9662a, accent: 0xf2e3d0, cloth: 0x25506b },
  coelho: { name: 'Coelho', glyph: '🐰', fur: 0xdcd4c6, accent: 0xf6c9cf, cloth: 0x3c6b48 },
  corvo: { name: 'Corvo', glyph: '🐦‍⬛', fur: 0x25242e, accent: 0xe8a63c, cloth: 0x5a1f2a },
  sapo: { name: 'Sapo', glyph: '🐸', fur: 0x5f8f3e, accent: 0xd4e08a, cloth: 0x8a6a2c },
};

export const AVATAR_IDS = Object.keys(AVATAR_INFO);

const mat = (color, { rough = 0.72, metal = 0.02 } = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function mesh(geometry, material, [x, y, z] = [0, 0, 0], rotation = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(...rotation);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Olho branco com pupila, olhando para frente (+Z). */
function eye(x, y, z, scale = 1) {
  const group = new THREE.Group();
  const white = mesh(new THREE.SphereGeometry(0.058 * scale, 16, 12), mat(0xf7f3e8, { rough: 0.3 }));
  const pupil = mesh(new THREE.SphereGeometry(0.03 * scale, 12, 10), mat(0x0d0b0a, { rough: 0.2 }), [0, 0, 0.036 * scale]);
  group.add(white, pupil);
  group.position.set(x, y, z);
  return group;
}

/** Torso, braços apoiados na mesa e cabeça-base compartilhados por todos. */
function buildBody(info) {
  const group = new THREE.Group();
  const fur = mat(info.fur);
  const cloth = mat(info.cloth, { rough: 0.9 });

  const torso = mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.86, 20), cloth, [0, 0.95, 0]);
  const collar = mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.12, 20), fur, [0, 1.4, 0]);
  const lapel = mesh(new THREE.BoxGeometry(0.34, 0.4, 0.06), mat(info.accent, { rough: 0.85 }), [0, 1.18, 0.3]);

  // Braços descansando sobre a mesa, levemente abertos.
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.42, 6, 12);
  const armL = mesh(armGeo, cloth, [-0.42, 1.0, 0.22], [Math.PI * 0.42, 0, -0.35]);
  const armR = mesh(armGeo, cloth, [0.42, 1.0, 0.22], [Math.PI * 0.42, 0, 0.35]);

  const pawGeo = new THREE.SphereGeometry(0.115, 14, 12);
  const pawL = mesh(pawGeo, fur, [-0.5, 0.99, 0.5]);
  const pawR = mesh(pawGeo, fur, [0.5, 0.99, 0.5]);

  group.add(torso, collar, lapel, armL, armR, pawL, pawR);
  return group;
}

/** Cabeças específicas: é onde cada personagem ganha identidade. */
const HEADS = {
  urso(info) {
    const head = new THREE.Group();
    const fur = mat(info.fur);
    head.add(mesh(new THREE.SphereGeometry(0.29, 24, 18), fur));
    head.add(mesh(new THREE.SphereGeometry(0.1, 14, 12), fur, [-0.21, 0.19, -0.02]));
    head.add(mesh(new THREE.SphereGeometry(0.1, 14, 12), fur, [0.21, 0.19, -0.02]));
    head.add(mesh(new THREE.SphereGeometry(0.145, 18, 14), mat(info.accent), [0, -0.07, 0.24]));
    head.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), mat(0x1a1412), [0, -0.03, 0.36]));
    head.add(eye(-0.115, 0.07, 0.25), eye(0.115, 0.07, 0.25));
    return head;
  },

  touro(info) {
    const head = new THREE.Group();
    const fur = mat(info.fur);
    head.add(mesh(new THREE.SphereGeometry(0.3, 24, 18), fur));
    head.add(mesh(new THREE.SphereGeometry(0.17, 18, 14), mat(info.accent), [0, -0.11, 0.25]));
    head.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x241d1c), [-0.06, -0.11, 0.39]));
    head.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x241d1c), [0.06, -0.11, 0.39]));
    // Chifres curvos
    const horn = new THREE.ConeGeometry(0.062, 0.34, 12);
    const bone = mat(info.accent, { rough: 0.45 });
    head.add(mesh(horn, bone, [-0.28, 0.2, 0], [0, 0, 1.05]));
    head.add(mesh(horn, bone, [0.28, 0.2, 0], [0, 0, -1.05]));
    // Argola no focinho
    head.add(mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20), mat(0xd8b45a, { rough: 0.25, metal: 0.85 }), [0, -0.2, 0.3], [Math.PI / 2.4, 0, 0]));
    head.add(eye(-0.13, 0.06, 0.25), eye(0.13, 0.06, 0.25));
    return head;
  },

  raposa(info) {
    const head = new THREE.Group();
    const fur = mat(info.fur);
    const cream = mat(info.accent);
    head.add(mesh(new THREE.SphereGeometry(0.27, 24, 18), fur));
    // Focinho comprido
    head.add(mesh(new THREE.ConeGeometry(0.15, 0.34, 16), fur, [0, -0.05, 0.26], [Math.PI / 2, 0, 0]));
    head.add(mesh(new THREE.SphereGeometry(0.042, 12, 10), mat(0x1a1412), [0, -0.05, 0.42]));
    head.add(mesh(new THREE.SphereGeometry(0.11, 14, 12), cream, [0, -0.12, 0.24]));
    // Orelhas pontudas
    const ear = new THREE.ConeGeometry(0.085, 0.26, 10);
    head.add(mesh(ear, fur, [-0.19, 0.26, -0.02], [0, 0, 0.3]));
    head.add(mesh(ear, fur, [0.19, 0.26, -0.02], [0, 0, -0.3]));
    head.add(eye(-0.12, 0.06, 0.21), eye(0.12, 0.06, 0.21));
    return head;
  },

  coelho(info) {
    const head = new THREE.Group();
    const fur = mat(info.fur);
    head.add(mesh(new THREE.SphereGeometry(0.27, 24, 18), fur));
    head.add(mesh(new THREE.SphereGeometry(0.12, 16, 12), fur, [0, -0.09, 0.22]));
    head.add(mesh(new THREE.SphereGeometry(0.038, 12, 10), mat(info.accent), [0, -0.05, 0.32]));
    // Orelhas longas
    const earGeo = new THREE.CapsuleGeometry(0.062, 0.34, 6, 12);
    const earL = mesh(earGeo, fur, [-0.13, 0.45, -0.03], [0, 0, 0.2]);
    const earR = mesh(earGeo, fur, [0.13, 0.45, -0.03], [0, 0, -0.2]);
    const innerGeo = new THREE.CapsuleGeometry(0.034, 0.26, 6, 10);
    head.add(earL, earR);
    head.add(mesh(innerGeo, mat(info.accent), [-0.14, 0.46, 0.03], [0, 0, 0.2]));
    head.add(mesh(innerGeo, mat(info.accent), [0.14, 0.46, 0.03], [0, 0, -0.2]));
    head.add(eye(-0.12, 0.07, 0.21), eye(0.12, 0.07, 0.21));
    return head;
  },

  corvo(info) {
    const head = new THREE.Group();
    const feather = mat(info.fur, { rough: 0.45, metal: 0.2 });
    head.add(mesh(new THREE.SphereGeometry(0.26, 24, 18), feather));
    // Bico
    head.add(mesh(new THREE.ConeGeometry(0.09, 0.32, 12), mat(info.accent, { rough: 0.4 }), [0, -0.04, 0.28], [Math.PI / 2, 0, 0]));
    // Penacho
    const tuft = new THREE.ConeGeometry(0.05, 0.2, 8);
    head.add(mesh(tuft, feather, [-0.09, 0.27, -0.05], [-0.4, 0, 0.35]));
    head.add(mesh(tuft, feather, [0.02, 0.3, -0.06], [-0.5, 0, 0]));
    head.add(mesh(tuft, feather, [0.12, 0.26, -0.05], [-0.4, 0, -0.4]));
    head.add(eye(-0.13, 0.06, 0.2, 1.1), eye(0.13, 0.06, 0.2, 1.1));
    return head;
  },

  sapo(info) {
    const head = new THREE.Group();
    const skin = mat(info.fur, { rough: 0.55 });
    const wide = mesh(new THREE.SphereGeometry(0.3, 24, 18), skin);
    wide.scale.set(1.15, 0.82, 1);
    head.add(wide);
    // Olhos esbugalhados no topo
    const domeL = mesh(new THREE.SphereGeometry(0.11, 16, 12), skin, [-0.17, 0.19, 0.05]);
    const domeR = mesh(new THREE.SphereGeometry(0.11, 16, 12), skin, [0.17, 0.19, 0.05]);
    head.add(domeL, domeR);
    head.add(eye(-0.17, 0.22, 0.13, 1.35), eye(0.17, 0.22, 0.13, 1.35));
    // Boca larga
    const mouth = mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24, Math.PI), mat(0x2f4a1f), [0, -0.06, 0.22], [0, 0, Math.PI]);
    head.add(mouth);
    head.add(mesh(new THREE.SphereGeometry(0.055, 12, 10), mat(info.accent), [-0.1, 0.02, 0.27]));
    head.add(mesh(new THREE.SphereGeometry(0.055, 12, 10), mat(info.accent), [0.1, 0.02, 0.27]));
    return head;
  },
};

/**
 * Monta o avatar completo.
 * @returns {THREE.Group} com userData.head para animações de cabeça.
 */
export function buildAvatar(avatarId) {
  const info = AVATAR_INFO[avatarId] ?? AVATAR_INFO.urso;
  const group = new THREE.Group();

  const body = buildBody(info);
  const head = HEADS[avatarId] ? HEADS[avatarId](info) : HEADS.urso(info);
  head.position.set(0, 1.68, 0);

  group.add(body, head);
  group.userData.head = head;
  group.userData.body = body;
  group.userData.info = info;
  return group;
}
