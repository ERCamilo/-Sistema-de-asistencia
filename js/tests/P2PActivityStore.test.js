import {
  createP2PActivityStore,
  P2P_ACTIVITY_MAX_ENTRIES
} from '../modules/features/p2p/P2PActivityStore.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

describe('P2PActivityStore', () => {
  test('persists, updates and counts pending activity without exposing raw storage', () => {
    const storage = memoryStorage();
    const store = createP2PActivityStore({ storage, storageKey: 'test', now: () => Date.parse('2026-09-11T05:00:00.000Z') });
    store.recordActivity({ id: 'r1', kind: 'roster', status: 'pending', peerName: 'Mini Norte', projectName: 'Obra A', summary: 'Enviando' });
    expect(store.getPendingCount()).toBe(1);
    store.updateActivity('r1', { status: 'success', summary: '5 empleados validados' });
    expect(store.getPendingCount()).toBe(0);
    expect(store.get('r1')).toMatchObject({ peerName: 'Mini Norte', status: 'success' });
    const reloaded = createP2PActivityStore({ storage, storageKey: 'test' });
    expect(reloaded.listRecent({ limit: 5 })).toHaveLength(1);
  });

  test('deduplicates by id and remains bounded', () => {
    const store = createP2PActivityStore({ storage: memoryStorage(), storageKey: 'bounded' });
    store.recordActivity({ id: 'same', kind: 'attendance', status: 'pending', peerName: 'Mini A' });
    store.recordActivity({ id: 'same', kind: 'attendance', status: 'success', peerName: 'Mini A' });
    expect(store.listRecent({ limit: 10 })).toHaveLength(1);
    for (let i = 0; i < P2P_ACTIVITY_MAX_ENTRIES + 8; i += 1) {
      store.recordActivity({ id: `x-${i}`, kind: 'roster', status: 'success', peerName: 'Mini' });
    }
    expect(store.listRecent({ limit: 500 })).toHaveLength(P2P_ACTIVITY_MAX_ENTRIES);
  });
});
