/**
 * P2PActivityStore - bounded defensive local P2P activity metadata for SA.
 *
 * SA-only presentation metadata. Records recent roster sends and attendance
 * requests as local activity. Bounded, deduped by stable id, human labels
 * primary, technical ids audit-only. Never touches protocol, crypto,
 * transport bytes, AppState, remote services, network or clipboard.
 */

const DEFAULT_STORAGE_KEY = 'sa_p2p_activity_v1';
const STORE_VERSION = 1;

export const P2P_ACTIVITY_MAX_ENTRIES = 30;
export const P2P_ACTIVITY_MAX_RECENT = 8;
export const P2P_ACTIVITY_PEER_NAME_MAX = 80;
export const P2P_ACTIVITY_PROJECT_NAME_MAX = 80;
export const P2P_ACTIVITY_SUMMARY_MAX = 280;
export const P2P_ACTIVITY_ID_MAX = 128;

export const P2P_ACTIVITY_KINDS = Object.freeze({
  ROSTER: 'roster',
  ATTENDANCE: 'attendance'
});

export const P2P_ACTIVITY_STATUSES = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  ERROR: 'error'
});

const KIND_SET = new Set(Object.values(P2P_ACTIVITY_KINDS));
const STATUS_SET = new Set(Object.values(P2P_ACTIVITY_STATUSES));

function stripControls(text) {
  let out = '';
  const input = String(text);
  for (const ch of input) {
    const code = ch.codePointAt(0);
    if (code <= 31 || code === 127) out += ' ';
    else out += ch;
  }
  return out;
}

function cleanText(value, maxLength) {
  const spaced = stripControls(value == null ? '' : String(value));
  const collapsed = spaced.replace(/[ ]+/g, (m) => (m.length ? ' ' : ' '));
  const normalized = collapsed.replace(/ +/g, ' ').trim();
  return Array.from(normalized).slice(0, maxLength).join('');
}

function hasForbiddenIdChar(id) {
  for (const ch of id) {
    const code = ch.codePointAt(0);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

export function normalizeActivityId(value) {
  const id = String(value == null ? '' : value).trim();
  if (!id || id.length > P2P_ACTIVITY_ID_MAX) return null;
  if (hasForbiddenIdChar(id)) return null;
  return id;
}

export function normalizeActivityKind(value) {
  const kind = String(value == null ? '' : value).trim();
  return KIND_SET.has(kind) ? kind : null;
}

export function normalizeActivityStatus(value) {
  const status = String(value == null ? '' : value).trim();
  return STATUS_SET.has(status) ? status : null;
}

export function normalizeActivityPeerName(value) {
  const name = cleanText(value, P2P_ACTIVITY_PEER_NAME_MAX);
  return name || 'Mini';
}

export function normalizeActivityProjectName(value) {
  return cleanText(value, P2P_ACTIVITY_PROJECT_NAME_MAX);
}

export function normalizeActivitySummary(value) {
  return cleanText(value, P2P_ACTIVITY_SUMMARY_MAX);
}

function normalizeAuditId(value) {
  if (value === null || value === undefined || value === '') return '';
  const id = String(value).trim();
  if (!id || id.length > P2P_ACTIVITY_ID_MAX) return '';
  if (hasForbiddenIdChar(id)) return '';
  return id;
}

function nowIso(nowFn) {
  try {
    const value = typeof nowFn === 'function' ? nowFn() : Date.now();
    const ms = Number(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  } catch (_) {}
  try { return new Date().toISOString(); } catch (_) { return '1970-01-01T00:00:00.000Z'; }
}

function isValidIso(value) {
  if (typeof value !== 'string' || !value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function getActivityKindLabel(kind) {
  if (kind === P2P_ACTIVITY_KINDS.ROSTER) return 'Roster';
  if (kind === P2P_ACTIVITY_KINDS.ATTENDANCE) return 'Asistencia';
  return 'Transferencia';
}

export function getActivityStatusLabel(status) {
  if (status === P2P_ACTIVITY_STATUSES.PENDING) return 'Pendiente';
  if (status === P2P_ACTIVITY_STATUSES.SUCCESS) return 'Completada';
  if (status === P2P_ACTIVITY_STATUSES.PARTIAL) return 'Parcial';
  if (status === P2P_ACTIVITY_STATUSES.ERROR) return 'Error';
  return 'Pendiente';
}

function toPublicEntry(entry) {
  return Object.freeze({ ...entry });
}

export function createP2PActivityStore({
  storage,
  storageKey = DEFAULT_STORAGE_KEY,
  now = null,
  maxEntries = P2P_ACTIVITY_MAX_ENTRIES
} = {}) {
  const cap = Number.isSafeInteger(maxEntries) && maxEntries > 0
    ? Math.min(maxEntries, 200)
    : P2P_ACTIVITY_MAX_ENTRIES;
  let loaded = false;
  let resolvedStorage = false;
  let activeStorage = null;
  const byId = new Map();

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

  function clock() {
    return typeof now === 'function' ? now : null;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = getStorage() && getStorage().getItem ? getStorage().getItem(storageKey) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.entries)) return;
      const slice = parsed.entries.slice(0, cap);
      for (const item of slice) {
        const id = normalizeActivityId(item && item.id);
        const kind = normalizeActivityKind(item && item.kind);
        const status = normalizeActivityStatus(item && item.status);
        if (!id || !kind || !status) continue;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          kind,
          status,
          peerName: normalizeActivityPeerName(item && item.peerName),
          projectName: normalizeActivityProjectName(item && item.projectName),
          summary: normalizeActivitySummary(item && item.summary),
          peerId: normalizeAuditId(item && item.peerId),
          saProjectId: normalizeAuditId(item && item.saProjectId),
          createdAt: isValidIso(item && item.createdAt) ? item.createdAt : nowIso(clock()),
          updatedAt: isValidIso(item && item.updatedAt) ? item.updatedAt : (isValidIso(item && item.createdAt) ? item.createdAt : nowIso(clock()))
        });
      }
    } catch (_) {}
  }

  function persist() {
    try {
      const target = getStorage();
      if (!target) return;
      if (byId.size === 0) {
        if (target.removeItem) target.removeItem(storageKey);
        return;
      }
      const entries = Array.from(byId.values());
      if (target.setItem) target.setItem(storageKey, JSON.stringify({ version: STORE_VERSION, entries }));
    } catch (_) {}
  }

  function sortEntries(values) {
    const list = Array.isArray(values) ? values : Array.from(values);
    return list.slice().sort((a, b) => {
      const tb = Date.parse(b.updatedAt);
      const ta = Date.parse(a.updatedAt);
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      const cb = Date.parse(b.createdAt);
      const ca = Date.parse(a.createdAt);
      if (Number.isFinite(cb) && Number.isFinite(ca) && cb !== ca) return cb - ca;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function enforceBounds() {
    if (byId.size <= cap) return;
    const ordered = sortEntries(Array.from(byId.values()));
    byId.clear();
    const keep = ordered.slice(0, cap);
    for (const entry of keep) byId.set(entry.id, entry);
  }

  function recordActivity(input) {
    const data = input || {};
    const cleanId = normalizeActivityId(data.id);
    if (!cleanId) throw new TypeError('P2P activity id invalido (1-128 chars, sin blancos ni controles).');
    const cleanKind = normalizeActivityKind(data.kind);
    if (!cleanKind) throw new TypeError('P2P activity kind invalido (roster | attendance).');
    const cleanStatus = normalizeActivityStatus(data.status == null ? 'pending' : data.status);
    if (!cleanStatus) throw new TypeError('P2P activity status invalido.');
    load();
    const stamp = nowIso(clock());
    const existing = byId.get(cleanId);
    if (existing) {
      const next = {
        ...existing,
        kind: cleanKind,
        status: cleanStatus,
        peerName: normalizeActivityPeerName(data.peerName || existing.peerName),
        projectName: normalizeActivityProjectName(data.projectName != null ? data.projectName : existing.projectName),
        summary: normalizeActivitySummary(data.summary != null ? data.summary : existing.summary),
        peerId: data.peerId ? normalizeAuditId(data.peerId) : existing.peerId,
        saProjectId: data.saProjectId ? normalizeAuditId(data.saProjectId) : existing.saProjectId,
        updatedAt: stamp
      };
      byId.set(cleanId, next);
      enforceBounds();
      persist();
      return toPublicEntry(next);
    }
    const next = {
      id: cleanId,
      kind: cleanKind,
      status: cleanStatus,
      peerName: normalizeActivityPeerName(data.peerName),
      projectName: normalizeActivityProjectName(data.projectName),
      summary: normalizeActivitySummary(data.summary),
      peerId: normalizeAuditId(data.peerId),
      saProjectId: normalizeAuditId(data.saProjectId),
      createdAt: stamp,
      updatedAt: stamp
    };
    byId.set(cleanId, next);
    enforceBounds();
    persist();
    return toPublicEntry(next);
  }

  function updateActivity(id, patch) {
    const cleanId = normalizeActivityId(id);
    if (!cleanId) return null;
    load();
    const existing = byId.get(cleanId);
    if (!existing) return null;
    const data = patch || {};
    const next = { ...existing };
    if (data.kind !== undefined) {
      const cleanKind = normalizeActivityKind(data.kind);
      if (!cleanKind) throw new TypeError('P2P activity kind invalido.');
      next.kind = cleanKind;
    }
    if (data.status !== undefined) {
      const cleanStatus = normalizeActivityStatus(data.status);
      if (!cleanStatus) throw new TypeError('P2P activity status invalido.');
      next.status = cleanStatus;
    }
    if (data.peerName !== undefined) next.peerName = normalizeActivityPeerName(data.peerName);
    if (data.projectName !== undefined) next.projectName = normalizeActivityProjectName(data.projectName);
    if (data.summary !== undefined) next.summary = normalizeActivitySummary(data.summary);
    if (data.peerId !== undefined) next.peerId = normalizeAuditId(data.peerId);
    if (data.saProjectId !== undefined) next.saProjectId = normalizeAuditId(data.saProjectId);
    next.updatedAt = nowIso(clock());
    byId.set(cleanId, next);
    enforceBounds();
    persist();
    return toPublicEntry(next);
  }

  function get(id) {
    const cleanId = normalizeActivityId(id);
    if (!cleanId) return null;
    load();
    const found = byId.get(cleanId);
    return found ? toPublicEntry(found) : null;
  }

  function listRecent(input) {
    load();
    const limit = input && input.limit !== undefined ? input.limit : P2P_ACTIVITY_MAX_RECENT;
    const count = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, cap) : P2P_ACTIVITY_MAX_RECENT;
    return sortEntries(Array.from(byId.values())).slice(0, count).map(toPublicEntry);
  }

  function getPendingCount() {
    load();
    let total = 0;
    for (const entry of byId.values()) {
      if (entry.status === P2P_ACTIVITY_STATUSES.PENDING) total += 1;
    }
    return total;
  }

  function clear() {
    load();
    byId.clear();
    persist();
  }

  return {
    recordActivity,
    updateActivity,
    get,
    listRecent,
    getPendingCount,
    clear
  };
}

export const p2pActivityStore = createP2PActivityStore();
export default p2pActivityStore;
