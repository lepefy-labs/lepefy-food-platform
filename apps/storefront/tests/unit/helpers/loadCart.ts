// L'import di browserEnv DEVE restare il primo: installa localStorage come
// side effect, di cui zustand/persist ha bisogno nel momento stesso in cui il
// modulo dello store viene valutato (import successivo).
import './browserEnv';
import * as cartStoreModule from '@/stores/cartStore';
import * as cartSyncEngineModule from '@/lib/cart/cartSyncEngine';

// Lo store zustand e il sync engine sono singleton di modulo: si importano una
// sola volta e si azzerano fra un test e l'altro.

const modules = { store: cartStoreModule, engine: cartSyncEngineModule };

export async function loadCart(): Promise<typeof modules> {
  return modules;
}

export async function resetCart(): Promise<void> {
  const { store, engine } = modules;
  // Toglie il proprietario prima del reset: annulla i timer di flush pendenti
  // senza far partire alcuna richiesta verso il test successivo.
  store.useCartStore.setState({ ownerCustomerId: null, pendingMutations: [] });
  await engine.resetCartForLogout();
  store.useCartStore.setState({
    items:                 [],
    syncStatus:            'idle',
    serverVersion:         null,
    lastSyncedAt:          null,
    pendingMutations:      [],
    ownerCustomerId:       null,
    unavailableProductIds: [],
  });
  globalThis.localStorage.clear();
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
