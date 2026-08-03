/**
 * O bar em 3D: mesa redonda, luz baixa, avatares ao redor e as cartas
 * baixadas de verdade sobre o feltro. A câmera fica no assento do jogador
 * local (primeira pessoa) e acompanha o mouse de leve.
 */

import * as THREE from 'three';
import { buildAvatar } from './avatars.js';
import { cardBackTexture, cardEdgeTexture, cardFaceTexture, feltTexture, nameplateTexture, woodTexture } from './textures.js';

const TABLE_RADIUS = 2.1;
const TABLE_TOP = 0.95;
const SEAT_RADIUS = 2.9;
const CARD_W = 0.3;
const CARD_H = 0.42;
const CARD_T = 0.009;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Libera geometrias e materiais de uma subárvore que sai da cena. */
function disposeTree(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const material = node.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) {
      material.map?.dispose(); // placas de nome têm textura própria
      material.dispose();
    }
  });
}

/** Ruído determinístico a partir do id da carta, para o monte ficar sempre igual. */
function hashUnit(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070503);
    this.scene.fog = new THREE.FogExp2(0x070503, 0.075);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 60);
    this.cameraBase = new THREE.Vector3(0, 1.55, SEAT_RADIUS - 0.35);
    this.lookTarget = new THREE.Vector3(0, 0.98, 0);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.lookTarget);

    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    this.shakeAmount = 0;
    this.animations = [];
    this.cards = new Map(); // cardId -> mesh
    this.tray = null; // bandeja de poções ativa, quando houver
    this.drinkTilt = 0; // inclinação da câmera enquanto o jogador local bebe
    this.seats = []; // { playerId, group, plate, marker, angle, position }
    this.clock = new THREE.Clock();
    this.mySeatIndex = 0;
    this.playerCount = 4;

    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);

    this.buildRoom();
    this.attachEvents();
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ------------------------------------------------------------- cenário

  buildRoom() {
    const scene = this.scene;

    scene.add(new THREE.AmbientLight(0x30242a, 0.35));
    scene.add(new THREE.HemisphereLight(0x2a2029, 0x0a0705, 0.55));

    // Luminária pendurada sobre a mesa.
    // Intensidade em candelas (unidades físicas do Three r155+): a mesa recebe
    // ~9 lux, o que dá o contraste de bar sem estourar o tone mapping.
    const lamp = new THREE.PointLight(0xffd9a0, 38, 14, 2);
    lamp.position.set(0, 3.05, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.0018;
    scene.add(lamp);
    this.lamp = lamp;

    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 0.6, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2c2119, side: THREE.DoubleSide, roughness: 0.85 }),
    );
    shade.position.set(0, 3.35, 0);
    scene.add(shade);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0cf }),
    );
    bulb.position.set(0, 3.05, 0);
    scene.add(bulb);

    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x171310 }),
    );
    cord.position.set(0, 4.3, 0);
    scene.add(cord);

    // Luzes de neon nas paredes, para o ambiente não ficar chapado.
    const neonA = new THREE.PointLight(0xff4d3d, 9, 16, 2);
    neonA.position.set(-5, 2.6, -4.5);
    scene.add(neonA);
    const neonB = new THREE.PointLight(0x3d7dff, 7, 16, 2);
    neonB.position.set(5.2, 2.4, -4.2);
    scene.add(neonB);
    this.neons = [neonA, neonB];

    // Chão e paredes do salão.
    const floorTex = woodTexture();
    floorTex.repeat.set(8, 8);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshStandardMaterial({ map: floorTex, color: 0x6b5540, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const walls = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 11, 7, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x241a16, side: THREE.BackSide, roughness: 1 }),
    );
    walls.position.y = 3.4;
    scene.add(walls);

    this.buildTable();
  }

  buildTable() {
    const wood = woodTexture();
    wood.repeat.set(2, 2);

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.14, 56),
      new THREE.MeshStandardMaterial({ map: wood, color: 0x8a6a4a, roughness: 0.68 }),
    );
    top.position.y = TABLE_TOP - 0.07;
    top.castShadow = true;
    top.receiveShadow = true;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_RADIUS, 0.055, 12, 60),
      new THREE.MeshStandardMaterial({ color: 0x241710, roughness: 0.5, metalness: 0.25 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE_TOP - 0.02;

    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_RADIUS * 0.72, TABLE_RADIUS * 0.72, 0.012, 48),
      new THREE.MeshStandardMaterial({ map: feltTexture(), color: 0x3f8f70, roughness: 1 }),
    );
    felt.position.y = TABLE_TOP + 0.003;
    felt.receiveShadow = true;

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.5, 0.88, 20),
      new THREE.MeshStandardMaterial({ color: 0x2b1c13, roughness: 0.8 }),
    );
    pedestal.position.y = 0.44;
    pedestal.castShadow = true;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.9, 0.09, 24),
      new THREE.MeshStandardMaterial({ color: 0x1e140e, roughness: 0.9 }),
    );
    base.position.y = 0.045;

    this.tableGroup.add(top, rim, felt, pedestal, base);
  }

  // -------------------------------------------------------------- assentos

  /** Ângulo do assento relativo: o jogador local sempre fica em frente à câmera. */
  seatAngle(seatIndex) {
    const rel = (seatIndex - this.mySeatIndex + this.playerCount) % this.playerCount;
    return (rel * Math.PI * 2) / this.playerCount;
  }

  seatPosition(seatIndex, radius = SEAT_RADIUS) {
    const a = this.seatAngle(seatIndex);
    return new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius);
  }

  /**
   * (Re)monta a mesa com os jogadores da partida.
   * O avatar do jogador local não é criado — a visão é em primeira pessoa.
   */
  setup(players, mySeatIndex) {
    // Desmonta a mesa anterior por inteiro — senão avatares e marcadores de uma
    // partida reiniciada ficariam pendurados na cena.
    for (const seat of this.seats) {
      this.scene.remove(seat.group, seat.marker);
      disposeTree(seat.group);
      disposeTree(seat.marker);
    }
    this.seats = [];
    this.clearPile();
    this.clearTray();

    this.mySeatIndex = mySeatIndex;
    this.playerCount = players.length;

    for (const player of players) {
      const group = new THREE.Group();
      const angle = this.seatAngle(player.seat);
      const position = this.seatPosition(player.seat);
      group.position.copy(position);
      group.rotation.y = angle + Math.PI; // vira para o centro da mesa

      const isMe = player.seat === mySeatIndex;
      let avatar = null;
      let plate = null;

      if (!isMe) {
        avatar = buildAvatar(player.avatar);
        group.add(avatar);

        plate = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
        plate.scale.set(1.15, 0.36, 1);
        plate.position.set(0, 2.3, 0);
        plate.renderOrder = 10;
        group.add(plate);
      }

      // Marcador na borda da mesa indicando de quem é a vez.
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.23, 24),
        new THREE.MeshBasicMaterial({ color: 0xe9b44c, transparent: true, opacity: 0, side: THREE.DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(Math.sin(angle) * (TABLE_RADIUS - 0.3), TABLE_TOP + 0.012, Math.cos(angle) * (TABLE_RADIUS - 0.3));

      this.scene.add(group, marker);
      this.seats.push({ playerId: player.id, seat: player.seat, group, avatar, plate, marker, angle, position });
    }
  }

  seatOf(playerId) {
    return this.seats.find((s) => s.playerId === playerId) || null;
  }

  /** Atualiza placas, brilho do turno e opacidade dos eliminados. */
  syncPlayers(state) {
    for (const seat of this.seats) {
      const player = state.players.find((p) => p.id === seat.playerId);
      if (!player) continue;

      const isTurn = state.turnPlayerId === player.id && player.alive && state.phase === 'playing';
      seat.isTurn = isTurn;
      seat.marker.material.opacity = isTurn ? 0.85 : 0;

      if (seat.plate) {
        const subtitle = player.alive
          ? `${player.handCount} carta${player.handCount === 1 ? '' : 's'}  ·  câmara ${Math.min(player.pulls + 1, player.chambers)}/${player.chambers}`
          : 'eliminado';
        const key = `${player.name}|${subtitle}|${isTurn}|${player.alive}`;
        if (seat.plateKey !== key) {
          seat.plateKey = key;
          seat.plate.material.map?.dispose();
          seat.plate.material.map = nameplateTexture({
            name: player.name,
            subtitle,
            highlight: isTurn,
            dead: !player.alive,
          });
          seat.plate.material.needsUpdate = true;
        }
      }

      if (seat.avatar && !player.alive && !seat.slumped) {
        seat.slumped = true;
        this.slump(seat);
      }
    }
  }

  /** Quem toma a bala tomba sobre a mesa. */
  slump(seat) {
    const avatar = seat.avatar;
    if (!avatar) return;
    const fromRot = avatar.rotation.x;
    const fromY = avatar.position.y;
    this.animate(900, easeOutCubic, (t) => {
      avatar.rotation.x = fromRot + t * 0.85;
      avatar.position.y = fromY - t * 0.35;
      avatar.position.z = t * 0.28;
    });
  }

  // ---------------------------------------------------------------- cartas

  makeCardMesh() {
    const edge = new THREE.MeshStandardMaterial({ map: cardEdgeTexture(), roughness: 0.75 });
    const back = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.65 });
    const blank = new THREE.MeshStandardMaterial({ color: 0xf6f0e2, roughness: 0.65 });
    // Ordem das faces do Box: +X, -X, +Y, -Y, +Z, -Z.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [edge, edge, blank, back, edge, edge]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.order = 'YXZ';
    return mesh;
  }

  /** Posição de repouso de uma carta no monte, espalhada de forma estável. */
  pileSlot(cardId, order) {
    const r = 0.16 + hashUnit(cardId, 1) * 0.42;
    const a = hashUnit(cardId, 2) * Math.PI * 2;
    return {
      x: Math.cos(a) * r,
      y: TABLE_TOP + 0.014 + order * 0.0075,
      z: Math.sin(a) * r,
      yaw: (hashUnit(cardId, 3) - 0.5) * Math.PI * 1.4,
    };
  }

  /**
   * Sincroniza o monte com o estado do servidor: cartas novas voam do assento
   * de quem jogou até o centro da mesa, viradas para baixo.
   */
  syncPile(state) {
    const seen = new Set();

    for (const entry of state.pile) {
      seen.add(entry.id);
      if (this.cards.has(entry.id)) continue;

      const mesh = this.makeCardMesh();
      const slot = this.pileSlot(entry.id, entry.order);
      const from = this.seatOf(entry.ownerId)?.position ?? new THREE.Vector3(0, 0, SEAT_RADIUS);

      mesh.position.set(from.x * 0.7, TABLE_TOP + 0.5, from.z * 0.7);
      mesh.rotation.set(Math.PI, slot.yaw, 0); // começa virada para baixo
      mesh.userData.slot = slot;
      mesh.userData.faceUp = false;
      this.scene.add(mesh);
      this.cards.set(entry.id, mesh);

      const start = mesh.position.clone();
      const spin = mesh.rotation.y + (Math.random() - 0.5) * 3;
      this.animate(430 + Math.random() * 160, easeOutCubic, (t) => {
        mesh.position.x = start.x + (slot.x - start.x) * t;
        mesh.position.z = start.z + (slot.z - start.z) * t;
        // arco: sobe um pouco antes de pousar
        mesh.position.y = start.y + (slot.y - start.y) * t + Math.sin(t * Math.PI) * 0.22;
        mesh.rotation.y = spin + (slot.yaw - spin) * t;
      });
    }

    // Rodada nova: limpa o que não está mais no monte.
    for (const [id, mesh] of this.cards) {
      if (seen.has(id)) continue;
      this.cards.delete(id);
      this.sweepAway(mesh);
    }
  }

  /** As cartas da rodada anterior deslizam para fora da mesa. */
  sweepAway(mesh) {
    const start = mesh.position.clone();
    const dir = start.clone().setY(0).normalize().multiplyScalar(4.5);
    this.animate(620, easeInOutCubic, (t) => {
      mesh.position.x = start.x + dir.x * t;
      mesh.position.z = start.z + dir.z * t;
      mesh.position.y = start.y - t * 0.9;
      mesh.rotation.z = t * 2.4;
    }, () => this.disposeCard(mesh));
  }

  disposeCard(mesh) {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    // As texturas vêm do cache compartilhado; só os materiais são descartáveis.
    for (const material of mesh.material) material.dispose();
  }

  clearPile() {
    for (const mesh of this.cards.values()) this.disposeCard(mesh);
    this.cards.clear();
  }

  /**
   * Animação do desafio: as cartas acusadas sobem, giram e mostram a face.
   * @param {{cards: Array<{id:string, rank:string}>}} reveal
   */
  revealCards(reveal) {
    reveal.cards.forEach((card, index) => {
      const mesh = this.cards.get(card.id);
      if (!mesh) return;

      // Coloca a face verdadeira antes de virar.
      const faceMat = new THREE.MeshStandardMaterial({ map: cardFaceTexture(card.rank), roughness: 0.6 });
      mesh.material[2].dispose?.();
      mesh.material[2] = faceMat;
      mesh.userData.faceUp = true;

      // Espalha as cartas lado a lado, viradas para a câmera do jogador local.
      const targetX = (index - (reveal.cards.length - 1) / 2) * 0.42;
      const targetZ = 0.55;
      const start = mesh.position.clone();
      const startYaw = mesh.rotation.y;

      setTimeout(() => {
        this.animate(760, easeInOutCubic, (t) => {
          mesh.position.x = start.x + (targetX - start.x) * t;
          mesh.position.z = start.z + (targetZ - start.z) * t;
          mesh.position.y = start.y + Math.sin(t * Math.PI) * 0.3 + t * 0.16;
          mesh.rotation.x = Math.PI * (1 - t); // desvira
          mesh.rotation.y = startYaw * (1 - t);
        });
      }, index * 130);
    });
  }

  // --------------------------------------------------------------- poções

  /** Frasco 3D: vidro, líquido brilhante e rolha. */
  makePotionMesh(color) {
    const group = new THREE.Group();
    const tint = new THREE.Color(color);

    // Vidro por transparência simples em vez de `transmission`: o resultado é
    // previsível em qualquer GPU e não custa um passe de renderização extra.
    const glass = new THREE.MeshStandardMaterial({
      color: 0xcfe2ea,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 16), glass);
    body.scale.set(1, 1.15, 1);
    body.position.y = 0.078;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.07, 14), glass);
    neck.position.y = 0.175;

    const cork = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.027, 0.035, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a6236, roughness: 0.9 }),
    );
    cork.position.y = 0.222;

    // O líquido é o que dá cor e leitura à distância. O brilho vem do próprio
    // material (emissive) — sem luzes extras, que forçariam o Three a
    // recompilar shaders toda vez que uma bandeja aparece ou some.
    const liquid = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 18, 14),
      new THREE.MeshStandardMaterial({
        color: tint,
        emissive: tint,
        emissiveIntensity: 1.1,
        roughness: 0.35,
      }),
    );
    liquid.scale.set(1, 0.92, 1);
    liquid.position.y = 0.07;

    group.add(body, neck, cork, liquid);
    group.userData.liquid = liquid;
    group.castShadow = true;
    return group;
  }

  /**
   * Põe a bandeja de poções sobre a mesa, na frente de quem vai beber.
   * @param {string} playerId
   * @param {Array<{id:string,color:string}>} potions
   */
  showTray(playerId, potions) {
    this.clearTray();
    const seat = this.seatOf(playerId);
    if (!seat) return;

    const angle = seat.angle;
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const center = forward.clone().multiplyScalar(0.95);

    this.tray = { playerId, angle, meshes: new Map() };

    potions.forEach((potion, index) => {
      const spread = (index - (potions.length - 1) / 2) * 0.26;
      const mesh = this.makePotionMesh(potion.color);
      const target = center.clone().add(side.clone().multiplyScalar(spread));

      mesh.position.set(target.x, TABLE_TOP + 0.9, target.z);
      mesh.userData.home = new THREE.Vector3(target.x, TABLE_TOP + 0.01, target.z);
      this.scene.add(mesh);
      this.tray.meshes.set(potion.id, mesh);

      // Caem na mesa uma a uma, como se alguém as estivesse servindo.
      const from = mesh.position.clone();
      const home = mesh.userData.home;
      setTimeout(() => {
        this.animate(420, easeOutCubic, (t) => {
          mesh.position.y = from.y + (home.y - from.y) * t;
        });
      }, index * 110);
    });
  }

  /**
   * O escolhido levanta o frasco até a boca do personagem (ou até a câmera,
   * se for o jogador local) e bebe. O suspense fica por conta de quem chama.
   */
  drinkPotion(potionId) {
    const tray = this.tray;
    if (!tray) return;
    const mesh = tray.meshes.get(potionId);
    if (!mesh) return;

    const seat = this.seatOf(tray.playerId);
    const isLocal = seat && !seat.avatar;

    // Boca do personagem, ou logo abaixo da câmera na visão em primeira pessoa.
    const mouth = isLocal
      ? new THREE.Vector3(this.cameraBase.x, this.cameraBase.y - 0.18, this.cameraBase.z - 0.45)
      : seat.position.clone().setY(1.62).lerp(new THREE.Vector3(0, 1.62, 0), 0.12);

    const start = mesh.position.clone();
    const head = seat?.avatar?.userData.head;

    this.animate(900, easeInOutCubic, (t) => {
      mesh.position.lerpVectors(start, mouth, t);
      mesh.position.y += Math.sin(t * Math.PI) * 0.25;
      mesh.rotation.x = -t * 1.9; // vira o frasco na boca
      if (head) head.rotation.x = -t * 0.5; // cabeça inclina para trás
      if (isLocal) this.drinkTilt = t * 0.32;
    }, () => {
      // Esvazia o líquido durante o gole.
      const liquid = mesh.userData.liquid;
      this.animate(650, easeInOutCubic, (t) => {
        liquid.scale.y = Math.max(0.001, 0.92 * (1 - t));
        liquid.position.y = 0.07 - t * 0.04;
        liquid.material.emissiveIntensity = 1.1 * (1 - t);
      });
    });

    tray.drinking = { mesh, seat, isLocal, head };
  }

  /** Depois do suspense: baixa o frasco e devolve a cabeça ao lugar. */
  finishDrink(fatal) {
    const drinking = this.tray?.drinking;
    if (!drinking) return;
    const { mesh, seat, isLocal, head } = drinking;

    const start = mesh.position.clone();
    const startRot = mesh.rotation.x;
    const home = mesh.userData.home;
    const headRot = head ? head.rotation.x : 0;
    const tilt = this.drinkTilt || 0;

    this.animate(fatal ? 420 : 620, easeOutCubic, (t) => {
      mesh.position.lerpVectors(start, home, t);
      mesh.rotation.x = startRot * (1 - t);
      if (head) head.rotation.x = headRot * (1 - t);
      if (isLocal) this.drinkTilt = tilt * (1 - t);
    }, () => {
      if (isLocal) this.drinkTilt = 0;
      if (fatal) {
        // O frasco escapa da mão e rola pela mesa.
        const away = home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9));
        this.animate(700, easeOutCubic, (t) => {
          mesh.position.lerpVectors(home, away, t);
          mesh.rotation.z = t * 3.4;
        });
      }
    });
  }

  clearTray() {
    if (!this.tray) return;
    for (const mesh of this.tray.meshes.values()) {
      const home = mesh.userData.home;
      this.animate(450, easeInOutCubic, (t) => {
        mesh.position.y = home.y + t * 0.7;
        mesh.scale.setScalar(Math.max(0.001, 1 - t));
      }, () => {
        this.scene.remove(mesh);
        disposeTree(mesh);
      });
    }
    this.tray = null;
    this.drinkTilt = 0;
  }

  // ------------------------------------------------------------ animações

  animate(duration, ease, onUpdate, onComplete) {
    this.animations.push({ elapsed: 0, duration, ease, onUpdate, onComplete });
  }

  shake(amount = 0.35) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  /** Clarão da luminária no momento do tiro. */
  muzzleFlash() {
    const base = this.lamp.intensity;
    this.animate(700, (t) => t, (t) => {
      this.lamp.intensity = base + (1 - t) * 120;
    }, () => {
      this.lamp.intensity = base;
    });
  }

  // ------------------------------------------------------------ loop/eventos

  attachEvents() {
    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', (event) => {
      const nx = (event.clientX / innerWidth) * 2 - 1;
      const ny = (event.clientY / innerHeight) * 2 - 1;
      this.look.tx = nx * 0.34;
      this.look.ty = -ny * 0.16;
    });
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    // Animações em andamento
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.elapsed += dt * 1000;
      const raw = Math.min(anim.elapsed / anim.duration, 1);
      anim.onUpdate(anim.ease(raw), raw);
      if (raw >= 1) {
        anim.onComplete?.();
        this.animations.splice(i, 1);
      }
    }

    // Respiração dos avatares e destaque de quem está na vez
    for (const seat of this.seats) {
      if (seat.avatar && !seat.slumped) {
        const phase = time * 1.6 + seat.angle * 3;
        seat.avatar.position.y = Math.sin(phase) * 0.012;
        const head = seat.avatar.userData.head;
        if (head) head.rotation.y = Math.sin(phase * 0.4) * 0.12;
      }
      if (seat.isTurn) {
        seat.marker.material.opacity = 0.55 + Math.sin(time * 4.2) * 0.3;
        seat.marker.scale.setScalar(1 + Math.sin(time * 4.2) * 0.07);
      }
    }

    // Neon piscando de leve
    this.neons[0].intensity = 8 + Math.sin(time * 2.3) * 1.6;
    this.neons[1].intensity = 6.5 + Math.sin(time * 1.7 + 2) * 1.2;

    // Câmera: mouse-look suave + tremor
    this.look.x += (this.look.tx - this.look.x) * Math.min(dt * 5, 1);
    this.look.y += (this.look.ty - this.look.y) * Math.min(dt * 5, 1);

    this.camera.position.copy(this.cameraBase);
    if (this.shakeAmount > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.pow(0.02, dt);
    }

    const target = this.lookTarget.clone();
    target.x += this.look.x * 2.2;
    target.y += this.look.y * 2.2;
    // Ao beber, o olhar do jogador local sobe junto com o frasco.
    target.y += this.drinkTilt * 5.5;
    this.camera.lookAt(target);

    this.renderer.render(this.scene, this.camera);
  }
}
