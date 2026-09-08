import {
  PEER_ALIAS_MAX_LENGTH,
  normalizePeerAlias,
  normalizePeerAliasPeerId,
  createPeerAliasStore
} from '../modules/features/p2p/P2PPeerAliasStore.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    dump: key => map.get(key)
  };
}

describe('P2PPeerAliasStore — metadata local de presentación', () => {
  test('normaliza espacios/controles y limita a 64 caracteres Unicode', () => {
    expect(PEER_ALIAS_MAX_LENGTH).toBe(64);
    expect(normalizePeerAlias('  Mini\n de\t Juan  ')).toBe('Mini de Juan');
    expect(Array.from(normalizePeerAlias('😀'.repeat(70)))).toHaveLength(64);
  });

  test('valida peerId sin usarlo como clave de objeto', () => {
    expect(normalizePeerAliasPeerId('peer-1')).toBe('peer-1');
    expect(normalizePeerAliasPeerId(' peer-1 ')).toBe('peer-1');
    expect(normalizePeerAliasPeerId('peer 1')).toBeNull();
    expect(normalizePeerAliasPeerId('')).toBeNull();
  });

  test('guarda una lista versionada, soporta __proto__ y limpia alias vacío', () => {
    const storage = memoryStorage();
    const store = createPeerAliasStore({ storage, storageKey: 't' });
    expect(store.setAlias('__proto__', '  Tablet almacén  ')).toBe('Tablet almacén');
    expect(store.getAlias('__proto__')).toBe('Tablet almacén');
    const parsed = JSON.parse(storage.dump('t'));
    expect(parsed).toEqual({ version: 1, entries: [{ peerId: '__proto__', alias: 'Tablet almacén' }] });
    expect(({}).alias).toBeUndefined();
    expect(store.setAlias('__proto__', '   ')).toBe('');
    expect(store.getAlias('__proto__')).toBe('');
    expect(storage.dump('t')).toBeUndefined();
  });

  test('resuelve alias → nombre remoto → tipo de app', () => {
    const store = createPeerAliasStore({ storage: memoryStorage(), storageKey: 't' });
    const peer = { peerId: 'p1', peerApp: 'mini', displayName: 'Mini - Dispositivo' };
    expect(store.resolveName(peer)).toBe('Mini - Dispositivo');
    store.setAlias('p1', 'Mini de Juan');
    expect(store.resolveName(peer)).toBe('Mini de Juan');
    store.removeAlias('p1');
    expect(store.resolveName({ peerId: 'p1', peerApp: 'mini', displayName: '' })).toBe('Mini');
  });

  test('storage corrupto se ignora y storage bloqueado conserva fallback en memoria', () => {
    const corrupt = memoryStorage({ t: '{bad json' });
    const a = createPeerAliasStore({ storage: corrupt, storageKey: 't' });
    expect(a.getAlias('p1')).toBe('');
    expect(a.setAlias('p1', 'Oficina')).toBe('Oficina');
    expect(a.getAlias('p1')).toBe('Oficina');

    const blocked = {
      getItem() { throw new DOMException('blocked'); },
      setItem() { throw new DOMException('blocked'); },
      removeItem() { throw new DOMException('blocked'); }
    };
    const b = createPeerAliasStore({ storage: blocked, storageKey: 't' });
    expect(b.setAlias('p2', 'Mini obra')).toBe('Mini obra');
    expect(b.getAlias('p2')).toBe('Mini obra');
  });

  test('una identidad inválida nunca se persiste', () => {
    const store = createPeerAliasStore({ storage: memoryStorage(), storageKey: 't' });
    expect(() => store.setAlias('peer con espacio', 'X')).toThrow(/Identidad P2P inválida/);
    expect(store.removeAlias('peer con espacio')).toBe(false);
    expect(store.getAlias('peer con espacio')).toBe('');
  });
});
