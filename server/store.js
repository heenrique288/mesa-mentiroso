/**
 * Persistência simples em arquivo JSON.
 *
 * Para um jogo entre amigos isso basta e não exige banco nenhum. As escritas
 * são serializadas e atômicas (grava num temporário e renomeia), então uma
 * queda no meio da gravação não corrompe o arquivo.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = { secret: null, users: [], resets: [] };

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    this.writing = null;
    this.dirty = false;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...structuredClone(EMPTY), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[store] não consegui ler ${this.file}, começando do zero:`, err.message);
      }
      this.data = structuredClone(EMPTY);
    }

    // Segredo usado para assinar os tokens de sessão; nasce com o arquivo.
    if (!this.data.secret) {
      this.data.secret = randomBytes(32).toString('hex');
      await this.save();
    }
    return this.data;
  }

  /**
   * Grava o estado atual. Chamadas concorrentes são enfileiradas para que
   * duas escritas nunca disputem o mesmo arquivo.
   */
  save() {
    this.dirty = true;
    if (this.writing) return this.writing;

    this.writing = (async () => {
      while (this.dirty) {
        this.dirty = false;
        const snapshot = JSON.stringify(this.data, null, 2);
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
          await fs.mkdir(path.dirname(this.file), { recursive: true });
          await fs.writeFile(tmp, snapshot, 'utf8');
          await fs.rename(tmp, this.file);
        } catch (err) {
          console.error('[store] falha ao gravar:', err.message);
          await fs.rm(tmp, { force: true }).catch(() => {});
          break;
        }
      }
      this.writing = null;
    })();

    return this.writing;
  }
}
