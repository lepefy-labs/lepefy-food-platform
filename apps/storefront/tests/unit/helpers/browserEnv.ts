// Polyfill minimali dell'ambiente browser per i test in Node.
//
// L'installazione avviene come SIDE EFFECT dell'import: zustand/persist legge
// `localStorage` al momento della creazione del middleware, quindi deve essere
// già presente prima che il modulo dello store venga importato. Per questo
// helpers/cartModules.ts importa questo file per primo.

class MemoryStorage {
  private data = new Map<string, string>();

  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, String(value)); }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
}

export function installBrowserEnv(): Storage {
  const storage = new MemoryStorage() as unknown as Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true,
  });
  setOnline(true);
  return storage;
}

/** Controlla `navigator.onLine`, letto dal sync engine per il modo offline. */
export function setOnline(online: boolean): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...(globalThis.navigator ?? {}), onLine: online },
    configurable: true,
    writable: true,
  });
}

export function getLocalStorage(): Storage {
  return globalThis.localStorage;
}

installBrowserEnv();
