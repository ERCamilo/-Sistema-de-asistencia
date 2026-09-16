/**
 * P2PBackupBridge.js — P2P Backup Transport Bridge for SA (F3.P2P-3)
 *
 * Implements SA half of frozen contract F3_P2P_BACKUP_V1.md:
 * - Kind: "backup", schemas: "sa-backup/v1", "mini-backup/v1"
 * - Same framing keys, 12KiB chunks, SHA-256 integrity, 25MiB max size
 * - Ephemeral in-memory staging (max 3 pending per app, dedupe by transferId/sha256)
 * - Zero mutation to state/IDB/Cloud during transfer or review
 * - SA ↔ SA: review decodes UTF-8/preflight, restore via canonical RestoreUI/applyBackupData upon explicit confirm
 * - SA receiving Mini: download-only, safe local filename, NEVER RestoreUI/applyBackupData
 * - Authenticated ACKs: backup-staged and backup-rejected
 */

export const BACKUP_KIND = 'backup';
export const SA_BACKUP_SCHEMA = 'sa-backup/v1';
export const MINI_BACKUP_SCHEMA = 'mini-backup/v1';
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const MAX_STAGED_BACKUPS_TOTAL = 3;
export const MAX_STAGED_BACKUPS = 3;
export const MAX_STAGED_BACKUPS_PER_APP = 3;

function getCore() {
  if (typeof window !== 'undefined' && window.SaMiniP2P) return window.SaMiniP2P;
  if (typeof globalThis !== 'undefined' && globalThis.SaMiniP2P) return globalThis.SaMiniP2P;
  return null;
}

function getPairing() {
  if (typeof window !== 'undefined' && window.SaMiniP2PPairing) return window.SaMiniP2PPairing;
  if (typeof globalThis !== 'undefined' && globalThis.SaMiniP2PPairing) return globalThis.SaMiniP2PPairing;
  return null;
}

// In-memory ephemeral staging (keyed by transferId)
const stagedBackups = new Map();

export function listStagedBackups(sourceApp = null) {
  const all = Array.from(stagedBackups.values());
  if (sourceApp) return all.filter(item => item.sourceApp === sourceApp);
  return all;
}

export function getStagedBackup(transferId) {
  return stagedBackups.get(String(transferId || '')) || null;
}

export function removeStagedBackup(transferId) {
  return stagedBackups.delete(String(transferId || ''));
}

export function clearStagedBackups() {
  stagedBackups.clear();
}

export function getStagedCount(sourceApp = null) {
  return listStagedBackups(sourceApp).length;
}

export function stageBackup(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Entrada de backup inválida.');
  const transferId = String(entry.transferId || '').trim();
  if (!transferId) throw new Error('ID de transferencia inválido.');
  const sha256 = String(entry.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('SHA-256 inválido.');
  if (entry.kind !== BACKUP_KIND) throw new Error('Clase de transferencia no es backup.');
  if (entry.schema !== SA_BACKUP_SCHEMA && entry.schema !== MINI_BACKUP_SCHEMA) {
    throw new Error('Esquema de backup no compatible.');
  }
  const sourceApp = String(entry.sourceApp || '').trim();
  if (!['sa', 'mini'].includes(sourceApp)) throw new Error('App de origen no válida.');
  if (sourceApp === 'sa' && entry.schema !== SA_BACKUP_SCHEMA) {
    throw new Error('Esquema no compatible con SA.');
  }
  if (sourceApp === 'mini' && entry.schema !== MINI_BACKUP_SCHEMA) {
    throw new Error('Esquema no compatible con Mini.');
  }
  const bytes = entry.bytes instanceof Uint8Array
    ? entry.bytes
    : (ArrayBuffer.isView(entry.bytes)
        ? new Uint8Array(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)
        : (entry.bytes instanceof ArrayBuffer ? new Uint8Array(entry.bytes) : null));
  if (!bytes) throw new Error('Bytes de backup no proporcionados.');
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('El backup excede el límite de 25 MiB.');

  // Deduplication check FIRST
  for (const existing of stagedBackups.values()) {
    if (existing.transferId === transferId || existing.sha256 === sha256) {
      return { staged: existing, isDuplicate: true };
    }
  }

  // Capacity check: MAX 3 TOTAL in the receiving SA
  if (stagedBackups.size >= MAX_STAGED_BACKUPS) {
    throw new Error('Límite de backups pendientes alcanzado (máximo 3 en total).');
  }

  const record = {
    transferId,
    sha256,
    kind: BACKUP_KIND,
    schema: entry.schema,
    size: bytes.byteLength,
    bytes,
    sourceApp,
    peerId: entry.peerId ? String(entry.peerId) : null,
    peerName: entry.peerName ? String(entry.peerName).slice(0, 80) : (sourceApp === 'sa' ? 'SA' : 'Mini'),
    receivedAt: entry.receivedAt || new Date().toISOString()
  };

  stagedBackups.set(transferId, record);
  return { staged: record, isDuplicate: false };
}

export function createBackupReceiver({ channel, peer, onStaged, onRejected, onError, onProgress } = {}) {
  const core = getCore();
  if (!core) throw new Error('SaMiniP2P core no disponible.');

  const receiver = core.createTransferReceiver({
    channel,
    onProgress,
    onError: error => onError?.(error),
    onComplete: async transfer => {
      try {
        if (transfer.kind !== BACKUP_KIND) {
          throw new Error('Transferencia no compatible con backup.');
        }

        const sourceApp = peer?.peerApp;
        if (sourceApp === 'sa' && transfer.schema !== SA_BACKUP_SCHEMA) {
          const reason = 'Esquema de backup no compatible con SA.';
          core.sendControl(channel, 'backup-rejected', {
            transferId: transfer.transferId,
            reason,
            kind: BACKUP_KIND,
            schema: transfer.schema,
            validated: false
          });
          onRejected?.({ transferId: transfer.transferId, reason });
          return;
        }

        if (sourceApp === 'mini' && transfer.schema !== MINI_BACKUP_SCHEMA) {
          const reason = 'Esquema de backup no compatible con Mini.';
          core.sendControl(channel, 'backup-rejected', {
            transferId: transfer.transferId,
            reason,
            kind: BACKUP_KIND,
            schema: transfer.schema,
            validated: false
          });
          onRejected?.({ transferId: transfer.transferId, reason });
          return;
        }

        // Deduplication FIRST
        const existing = Array.from(stagedBackups.values()).find(
          b => b.transferId === transfer.transferId || b.sha256 === transfer.sha256
        );
        if (existing) {
          core.sendControl(channel, 'backup-staged', {
            transferId: transfer.transferId,
            sha256: transfer.sha256,
            kind: BACKUP_KIND,
            schema: transfer.schema,
            validated: true
          });
          onStaged?.(existing, true);
          return;
        }

        // Capacity check: MAX 3 TOTAL in receiving SA
        if (stagedBackups.size >= MAX_STAGED_BACKUPS) {
          const reason = 'Límite de backups pendientes alcanzado (máximo 3 en total).';
          core.sendControl(channel, 'backup-rejected', {
            transferId: transfer.transferId,
            reason,
            kind: BACKUP_KIND,
            schema: transfer.schema,
            validated: false
          });
          onRejected?.({ transferId: transfer.transferId, reason });
          return;
        }

        // Stage in memory
        const { staged } = stageBackup({
          transferId: transfer.transferId,
          sha256: transfer.sha256,
          kind: transfer.kind,
          schema: transfer.schema,
          size: transfer.size,
          bytes: transfer.bytes,
          sourceApp,
          peerId: peer?.peerId,
          peerName: peer?.displayName
        });

        // Authenticated ACK
        core.sendControl(channel, 'backup-staged', {
          transferId: transfer.transferId,
          sha256: transfer.sha256,
          kind: BACKUP_KIND,
          schema: transfer.schema,
          validated: true
        });

        onStaged?.(staged, false);
      } catch (err) {
        onError?.(err);
      }
    }
  });

  if (channel && typeof channel.addEventListener === 'function') {
    channel.addEventListener('message', receiver);
  }
  return receiver;
}

export function waitForBackupStageAck(channel, transfer, timeoutMs = 20000) {
  const core = getCore();
  if (!core) throw new Error('SaMiniP2P core no disponible.');

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener('message', handler);
    };
    const finish = (fn, value) => {
      if (settled) return;
      cleanup();
      fn(value);
    };

    const handler = event => {
      let msg;
      try { msg = core.parseControl(event.data); }
      catch (err) { finish(reject, err); return; }
      if (!msg || !['backup-staged', 'backup-rejected'].includes(msg.type)) return;
      if (String(msg.data?.transferId || '') !== transfer.transferId) return;

      if (msg.type === 'backup-rejected') {
        try {
          const rejection = core.validateBackupRejected(msg.data, transfer);
          finish(reject, new Error(`El receptor rechazó el backup: ${rejection.reason}`));
        } catch (err) { finish(reject, err); }
        return;
      }

      try {
        const ack = core.validateBackupStageAck(msg.data, transfer);
        finish(resolve, ack);
      } catch (err) { finish(reject, err); }
    };

    const timer = setTimeout(() => finish(reject, new Error('El receptor no confirmó la recepción del backup a tiempo.')), timeoutMs);
    channel.addEventListener('message', handler);
  });
}

export async function sendBackupOnChannel(channel, { bytes, schema = SA_BACKUP_SCHEMA, onProgress, timeoutMs = 20000 }) {
  const core = getCore();
  if (!core) throw new Error('SaMiniP2P core no disponible.');
  if (!core.isChannelAuthenticated(channel)) throw new Error('Canal P2P no autenticado.');

  const rawBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (rawBytes.byteLength > MAX_BACKUP_BYTES) throw new Error('El backup excede el límite de 25 MiB.');

  const bufferedFrames = [];
  let knownTransfer = null;
  let settled = false;
  let timer = null;

  let resolveAck, rejectAck;
  const ackPromise = new Promise((resolve, reject) => {
    resolveAck = resolve;
    rejectAck = reject;
  });

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    channel.removeEventListener('message', handleMessage);
  };

  const finishResolve = (val) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveAck(val);
  };

  const finishReject = (err) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectAck(err);
  };

  const processFrame = (msg) => {
    if (!knownTransfer || settled) return false;
    // Stale/unrelated backup frames are ignored/buffered; never cause a false TransferId mismatch
    if (String(msg.data?.transferId || '') !== knownTransfer.transferId) {
      return false;
    }

    if (msg.type === 'backup-rejected') {
      try {
        const rejection = core.validateBackupRejected(msg.data, knownTransfer);
        finishReject(new Error(`El receptor rechazó el backup: ${rejection.reason}`));
      } catch (err) {
        finishReject(err);
      }
      return true;
    }

    if (msg.type === 'backup-staged') {
      try {
        const ack = core.validateBackupStageAck(msg.data, knownTransfer);
        finishResolve(ack);
      } catch (err) {
        finishReject(err);
      }
      return true;
    }

    return false;
  };

  const handleMessage = (event) => {
    if (settled) return;
    let msg;
    try {
      msg = core.parseControl(event.data);
    } catch (_) {
      return;
    }
    if (!msg || !['backup-staged', 'backup-rejected'].includes(msg.type)) return;

    if (knownTransfer) {
      processFrame(msg);
    } else {
      bufferedFrames.push(msg);
    }
  };

  channel.addEventListener('message', handleMessage);

  try {
    const transfer = await core.sendPayload(channel, {
      kind: BACKUP_KIND,
      schema,
      bytes: rawBytes,
      onProgress
    });

    knownTransfer = transfer;

    let handled = false;
    for (const msg of bufferedFrames) {
      if (processFrame(msg)) {
        handled = true;
        break;
      }
    }

    if (!handled && !settled) {
      timer = setTimeout(() => {
        finishReject(new Error('El receptor no confirmó la recepción del backup a tiempo.'));
      }, timeoutMs);
    }

    const ack = await ackPromise;
    return { transfer, ack };
  } finally {
    cleanup();
  }
}

export async function reviewAndRestoreSaBackup(transferId, hooks = {}) {
  const staged = getStagedBackup(transferId);
  if (!staged) throw new Error('Respaldo pendiente no encontrado.');
  if (staged.sourceApp !== 'sa' || staged.schema !== SA_BACKUP_SCHEMA) {
    throw new Error('Sólo se puede restaurar un respaldo SA nativo proveniente de SA.');
  }

  if (typeof window === 'undefined' || typeof window.loadBackupFromFile !== 'function') {
    throw new Error('loadBackupFromFile no disponible en este entorno.');
  }

  const filename = `sa-backup-${staged.sha256.slice(0, 8)}.json`;
  let file;
  if (typeof File === 'function') {
    file = new File([staged.bytes], filename, { type: 'application/json' });
  } else if (typeof Blob === 'function') {
    file = new Blob([staged.bytes], { type: 'application/json' });
    file.name = filename;
  } else {
    throw new Error('Entorno no soporta File/Blob.');
  }

  if (hooks && hooks.nonblocking) {
    const delegatedHooks = {
      onSuccess: () => {
        removeStagedBackup(transferId);
        try { hooks.onSuccess?.(); } catch (_) {}
      },
      onError: (err) => {
        try { hooks.onError?.(err); } catch (_) {}
      },
      onCancel: () => {
        try { hooks.onCancel?.(); } catch (_) {}
      }
    };
    window.loadBackupFromFile(file, delegatedHooks);
    return { opened: true, transferId };
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup = () => {};

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const delegatedHooks = {
      onSuccess: () => {
        removeStagedBackup(transferId);
        try { hooks.onSuccess?.(); } catch (_) {}
        finish({ restored: true });
      },
      onError: (err) => {
        try { hooks.onError?.(err); } catch (_) {}
        finish({ restored: false, error: err });
      },
      onCancel: () => {
        try { hooks.onCancel?.(); } catch (_) {}
        finish({ restored: false, cancelled: true });
      }
    };

    if (typeof document !== 'undefined') {
      const modalId = 'restore-comparison-modal';

      const handleKeydown = (e) => {
        if (e.key === 'Escape') {
          setTimeout(() => {
            if (!settled && !document.getElementById(modalId)) {
              delegatedHooks.onCancel();
            }
          }, 0);
        }
      };

      const handleClick = (e) => {
        const target = e.target;
        if (!target) return;
        if (
          target.closest?.(`#restore-modal-close-${modalId}`) ||
          target.closest?.(`#restore-modal-cancel-${modalId}`) ||
          target.closest?.('.modal-close') ||
          target.closest?.('.btn-cancel')
        ) {
          setTimeout(() => {
            if (!settled && !document.getElementById(modalId)) {
              delegatedHooks.onCancel();
            }
          }, 0);
        }
      };

      let observer = null;
      if (typeof MutationObserver === 'function' && document.body) {
        observer = new MutationObserver(() => {
          if (!settled && !document.getElementById(modalId)) {
            setTimeout(() => {
              if (!settled && !document.getElementById(modalId)) {
                delegatedHooks.onCancel();
              }
            }, 50);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      document.addEventListener('keydown', handleKeydown, true);
      document.addEventListener('click', handleClick, true);

      cleanup = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        document.removeEventListener('click', handleClick, true);
        if (observer) {
          try { observer.disconnect(); } catch (_) {}
        }
      };
    }

    try {
      window.loadBackupFromFile(file, delegatedHooks);
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      try { hooks.onError?.(err); } catch (_) {}
      reject(err);
    }
  });
}

export function downloadCrossAppBackup(transferId) {
  const staged = getStagedBackup(transferId);
  if (!staged) throw new Error('Respaldo no encontrado.');

  // Strict negative guard: NEVER invoke RestoreUI or applyBackupData for Mini backups
  if (staged.sourceApp === 'mini' && staged.schema !== MINI_BACKUP_SCHEMA) {
    throw new Error('Esquema de respaldo inválido.');
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const appPrefix = staged.sourceApp === 'mini' ? 'mini' : 'sa';
  const filename = `backup-${appPrefix}-${dateStr}-${staged.sha256.slice(0, 8)}.json`;

  if (typeof window !== 'undefined' && typeof window.Blob === 'function') {
    const blob = new Blob([staged.bytes], { type: 'application/json' });
    if (typeof document !== 'undefined' && document.createElement && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return { filename, size: staged.size, sha256: staged.sha256 };
}

export const p2pBackupBridge = {
  BACKUP_KIND,
  SA_BACKUP_SCHEMA,
  MINI_BACKUP_SCHEMA,
  MAX_BACKUP_BYTES,
  MAX_STAGED_BACKUPS,
  MAX_STAGED_BACKUPS_TOTAL,
  MAX_STAGED_BACKUPS_PER_APP,
  listStaged: listStagedBackups,
  getStaged: getStagedBackup,
  removeStaged: removeStagedBackup,
  clearStaged: clearStagedBackups,
  getStagedCount,
  stageBackup,
  createBackupReceiver,
  waitForBackupStageAck,
  sendBackupOnChannel,
  reviewAndRestoreSaBackup,
  downloadCrossAppBackup
};

if (typeof window !== 'undefined') {
  window.p2pBackupBridge = p2pBackupBridge;
}
