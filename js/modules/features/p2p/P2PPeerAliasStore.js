const DEFAULT_STORAGE_KEY = 'sa_p2p_peer_aliases_v1';
const STORE_VERSION = 1;
const MAX_ENTRIES = 128;
export const PEER_ALIAS_MAX_LENGTH = 64;

export function normalizePeerAlias(value) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, PEER_ALIAS_MAX_LENGTH).join('');
}

export function normalizePeerAliasPeerId(value) {
  const peerId = String(value ?? '').trim();
  if (!peerId || peerId.length > 128 || /[\s\u0000-\u001f\u007f]/.test(peerId)) return null;
  return peerId;
}

function normalizeRemoteName(value) {
  return Array.from(String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, 80).join('');
}

export function createPeerAliasStore({ storage, storageKey = DEFAULT_STORAGE_KEY } = {}) {
  let loaded = false;
  let resolvedStorage = false;
  let activeStorage = null;
  const aliases = new Map();

  function getStorage() {
    if (resolvedStorage) return activeStorage;
    resolvedStorage = true;
    if (storage !== undefined) {
      activeStorage = storage;
      return activeStorage;
    }
    try { activeStorage = globalThis.localStorage || null; }
    catch (_) { activeStorage = null; }
    return activeStorage;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = getStorage()?.getItem?.(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.entries)) return;
      for (const entry of parsed.entries.slice(0, MAX_ENTRIES)) {
        const peerId = normalizePeerAliasPeerId(entry?.peerId);
        const alias = normalizePeerAlias(entry?.alias);
        if (peerId && alias) aliases.set(peerId, alias);
      }
    } catch (_) {}
  }

  function persist() {
    try {
      const target = getStorage();
      if (!target) return;
      if (aliases.size === 0) {
        target.removeItem?.(storageKey);
        return;
      }
      const entries = Array.from(aliases, ([peerId, alias]) => ({ peerId, alias }));
      target.setItem?.(storageKey, JSON.stringify({ version: STORE_VERSION, entries }));
    } catch (_) {}
  }

  function getAlias(peerIdValue) {
    const peerId = normalizePeerAliasPeerId(peerIdValue);
    if (!peerId) return '';
    load();
    return aliases.get(peerId) || '';
  }

  function setAlias(peerIdValue, value) {
    const peerId = normalizePeerAliasPeerId(peerIdValue);
    if (!peerId) throw new Error('Identidad P2P inválida para renombrar.');
    load();
    const alias = normalizePeerAlias(value);
    if (alias) aliases.set(peerId, alias);
    else aliases.delete(peerId);
    persist();
    return alias;
  }

  function removeAlias(peerIdValue) {
    const peerId = normalizePeerAliasPeerId(peerIdValue);
    if (!peerId) return false;
    load();
    const removed = aliases.delete(peerId);
    if (removed) persist();
    return removed;
  }

  function resolveName(peer) {
    const alias = getAlias(peer?.peerId);
    if (alias) return alias;
    const original = normalizeRemoteName(peer?.displayName);
    if (original) return original;
    if (peer?.peerApp === 'mini') return 'Mini';
    if (peer?.peerApp === 'sa') return 'SA';
    return 'Dispositivo';
  }

  return { getAlias, setAlias, removeAlias, resolveName };
}

export const p2pPeerAliasStore = createPeerAliasStore();
export default p2pPeerAliasStore;
