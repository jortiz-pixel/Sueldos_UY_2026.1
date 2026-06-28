import fs from 'fs/promises';
import path from 'path';

/**
 * Abstracción de almacenamiento de archivos.
 * Hoy: volumen local del contenedor. Mañana: S3-compatible cambiando solo la
 * implementación, sin tocar el resto del sistema.
 */
export interface StorageService {
  save(key: string, buffer: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const STORAGE_DIR = process.env.STORAGE_DIR || '/app/storage';

/** Sanitiza un nombre de archivo para usarlo como parte de una clave de storage. */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

class LocalStorageService implements StorageService {
  private resolve(key: string): string {
    // Evita path traversal: la clave nunca debe escapar de STORAGE_DIR.
    const full = path.resolve(STORAGE_DIR, key);
    if (!full.startsWith(path.resolve(STORAGE_DIR) + path.sep)) {
      throw new Error('Clave de almacenamiento inválida');
    }
    return full;
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

export const storageService: StorageService = new LocalStorageService();
