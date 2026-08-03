/**
 * Contas, login e placar de vitórias.
 *
 * Senhas nunca são guardadas em texto: usamos scrypt com sal aleatório por
 * usuário. Isso significa que a recuperação de senha manda um link para
 * **definir uma nova** senha — nem o servidor consegue ler a antiga.
 */

import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LEN = 64;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error) => ({ ok: false, error });

export class Auth {
  /** @param {import('./store.js').JsonStore} store */
  constructor(store) {
    this.store = store;
  }

  get users() {
    return this.store.data.users;
  }

  // ------------------------------------------------------------- utilidades

  findByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    return this.users.find((u) => u.usernameLower === key) || null;
  }

  findByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    return this.users.find((u) => u.emailLower === key) || null;
  }

  findById(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  async hash(password, salt = randomBytes(16).toString('hex')) {
    const derived = await scryptAsync(password, salt, KEY_LEN);
    return { salt, hash: derived.toString('hex') };
  }

  async verifyPassword(user, password) {
    const { hash } = await this.hash(password, user.salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(user.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Token de sessão assinado — evita guardar tabela de sessões. */
  issueToken(user) {
    const expires = Date.now() + SESSION_TTL_MS;
    const payload = `${user.id}.${expires}`;
    const signature = createHmac('sha256', this.store.data.secret).update(payload).digest('hex');
    return `${payload}.${signature}`;
  }

  verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [id, expires, signature] = parts;

    const expected = createHmac('sha256', this.store.data.secret).update(`${id}.${expires}`).digest('hex');
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Number(expires) < Date.now()) return null;

    return this.findById(id);
  }

  /** Formato seguro para mandar ao cliente. */
  publicUser(user) {
    return { id: user.id, username: user.username, email: user.email, wins: user.wins ?? 0 };
  }

  // ----------------------------------------------------------------- contas

  async register({ username, email, password, confirm }) {
    const name = String(username || '').trim();
    const mail = String(email || '').trim();

    if (!USERNAME_RE.test(name)) {
      return fail('O nome de usuário precisa ter de 3 a 16 caracteres (letras, números, . _ -).');
    }
    if (!EMAIL_RE.test(mail)) return fail('Informe um email válido.');
    if (String(password || '').length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return fail('As senhas não conferem.');
    if (this.findByUsername(name)) return fail('Esse nome de usuário já está em uso.');
    if (this.findByEmail(mail)) return fail('Já existe uma conta com esse email.');

    const { salt, hash } = await this.hash(password);
    const user = {
      id: randomUUID(),
      username: name,
      usernameLower: name.toLowerCase(),
      email: mail,
      emailLower: mail.toLowerCase(),
      salt,
      hash,
      wins: 0,
      games: 0,
      createdAt: new Date().toISOString(),
    };

    this.users.push(user);
    await this.store.save();
    return ok({ user: this.publicUser(user), token: this.issueToken(user) });
  }

  async login({ username, password }) {
    // Aceita entrar pelo nome de usuário ou pelo email, o que for mais cômodo.
    const user = this.findByUsername(username) || this.findByEmail(username);
    if (!user) return fail('Usuário ou senha incorretos.');
    if (!(await this.verifyPassword(user, String(password || '')))) {
      return fail('Usuário ou senha incorretos.');
    }
    return ok({ user: this.publicUser(user), token: this.issueToken(user) });
  }

  // ------------------------------------------------------ recuperação de senha

  /**
   * Cria um token de redefinição. Devolve sempre ok para não revelar quais
   * emails estão cadastrados; o link só existe quando a conta existe mesmo.
   */
  async createResetToken(email) {
    const user = this.findByEmail(email);
    if (!user) return { user: null, token: null };

    const token = randomBytes(24).toString('hex');
    this.store.data.resets = this.store.data.resets.filter(
      (r) => r.userId !== user.id && r.expiresAt > Date.now(),
    );
    this.store.data.resets.push({ token, userId: user.id, expiresAt: Date.now() + RESET_TTL_MS });
    await this.store.save();
    return { user, token };
  }

  /** Consulta o token sem consumi-lo — a tela mostra o nome de usuário antes. */
  peekReset(token) {
    const entry = this.store.data.resets.find((r) => r.token === token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    const user = this.findById(entry.userId);
    return user ? { username: user.username, email: user.email } : null;
  }

  async resetPassword(token, password, confirm) {
    const entry = this.store.data.resets.find((r) => r.token === token);
    if (!entry || entry.expiresAt < Date.now()) {
      return fail('Este link expirou ou já foi usado. Peça outro.');
    }
    if (String(password || '').length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return fail('As senhas não conferem.');

    const user = this.findById(entry.userId);
    if (!user) return fail('Conta não encontrada.');

    const { salt, hash } = await this.hash(password);
    user.salt = salt;
    user.hash = hash;
    this.store.data.resets = this.store.data.resets.filter((r) => r.token !== token);
    await this.store.save();

    return ok({ username: user.username });
  }

  // ----------------------------------------------------------------- placar

  /** Registra a vitória do jogador na tabela dos maiores vencedores. */
  async recordWin(userId) {
    const user = this.findById(userId);
    if (!user) return null;
    user.wins = (user.wins ?? 0) + 1;
    await this.store.save();
    return this.publicUser(user);
  }

  async recordGame(userIds) {
    let touched = false;
    for (const id of new Set(userIds)) {
      const user = this.findById(id);
      if (!user) continue;
      user.games = (user.games ?? 0) + 1;
      touched = true;
    }
    if (touched) await this.store.save();
  }

  /** Os 10 maiores vencedores, do maior para o menor. */
  leaderboard(limit = 10) {
    return this.users
      .filter((u) => (u.wins ?? 0) > 0)
      .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (a.games ?? 0) - (b.games ?? 0))
      .slice(0, limit)
      .map((u, i) => ({
        rank: i + 1,
        username: u.username,
        wins: u.wins ?? 0,
        games: u.games ?? 0,
      }));
  }
}
