/**
 * P2PBackupTransportTests.test.js
 *
 * Comprehensive tests for F3.P2P-3 Backup Transport v1 contract (F3_P2P_BACKUP_V1.md)
 * and SA-F3-P2P-BACKUP-064 Direction Review Corrections:
 * 1. Same-app exactness: allowSameApp=true means ONLY remote.appType === local.appType.
 *    Default pairing remains strict SA<->Mini.
 * 2. Purpose guard: for same-app records require explicit allowSameApp AND purpose:'backup';
 *    no purpose-only bypass. Trusted same-app auth must also require same app + purpose backup.
 *    Cross-app backup over an existing SA<->Mini link uses normal allowSameApp=false.
 * 3. Staging cap: MAX 3 pending backups TOTAL in the receiving SA, not 3 per sourceApp.
 *    Deduplication by transferId/SHA-256 before capacity check.
 * 4. Canonical restore delegation: P2PBackupBridge.reviewAndRestoreSaBackup MUST NOT duplicate
 *    LegacyMigrator/diagnostics/RestoreUI/applyBackupData. Delegates to window.loadBackupFromFile
 *    using File/Blob; removes staged only from canonical onSuccess. Mini backups remain download-only.
 * 5. UI Receiver wiring: dedicated backup receiver wired in SA UI ("Esperar respaldo" flow)
 *    for freshly paired SA peers and linked backup-capable peers.
 * 6. Isolation: same-app backup peers must NEVER enter roster/attendance listeners or lists.
 * 7. Cross-app download-only: existing linked Mini peers can transfer backups, SA receiving Mini shows download-only.
 * 8. Out-of-scope: generic Archivos/files remains disabled.
 */

require('fake-indexeddb/auto');
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}
if (typeof window.structuredClone !== 'function') {
  window.structuredClone = globalThis.structuredClone;
}
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
const fs = require('fs');
const path = require('path');

const Core = require('../p2p/P2PCore.js');
const Pairing = require('../p2p/P2PPairing.js');
const { listLinkedMiniPeers } = require('../modules/features/p2p/P2PAttendanceBridge.js');
const {
  BACKUP_KIND,
  SA_BACKUP_SCHEMA,
  MINI_BACKUP_SCHEMA,
  MAX_BACKUP_BYTES,
  MAX_STAGED_BACKUPS,
  MAX_STAGED_BACKUPS_TOTAL,
  MAX_STAGED_BACKUPS_PER_APP,
  p2pBackupBridge,
  stageBackup,
  listStagedBackups,
  getStagedBackup,
  removeStagedBackup,
  clearStagedBackups,
  createBackupReceiver,
  waitForBackupStageAck,
  sendBackupOnChannel,
  reviewAndRestoreSaBackup,
  downloadCrossAppBackup
} = require('../modules/features/p2p/P2PBackupBridge.js');

class LinkedChannel {
  constructor() {
    this.readyState = 'open';
    this.bufferedAmount = 0;
    this.listeners = new Set();
    this.peer = null;
    this.closed = false;
  }
  addEventListener(type, fn) {
    if (type === 'message') this.listeners.add(fn);
  }
  removeEventListener(type, fn) {
    if (type === 'message') this.listeners.delete(fn);
  }
  send(data) {
    if (!this.peer || this.peer.listeners.size === 0) return;
    const peer = this.peer;
    queueMicrotask(() => {
      for (const fn of [...peer.listeners]) fn({ data });
    });
  }
  close() {
    this.closed = true;
    this.readyState = 'closed';
  }
}

function linkedPair() {
  const a = new LinkedChannel();
  const b = new LinkedChannel();
  a.peer = b;
  b.peer = a;
  Core.markChannelAuthenticated(a);
  Core.markChannelAuthenticated(b);
  return [a, b];
}

function makeStore(initialPeers = []) {
  const peers = new Map(initialPeers.map(p => [p.peerId, p]));
  return {
    async getSelf() {
      return { deviceId: 'sa-self-1', appType: 'sa', displayName: 'SA - Obra' };
    },
    async listPeers() {
      return Array.from(peers.values());
    },
    async getPeer(id) {
      return peers.get(id) || null;
    },
    async savePeer(peer, { allowSameApp = false } = {}) {
      if (peer.peerApp === 'sa') {
        if (!allowSameApp || peer.purpose !== 'backup') {
          throw new Error('Los registros same-app requieren allowSameApp explícito y propósito de backup.');
        }
      }
      peers.set(peer.peerId, { ...peer });
      return { ...peer };
    },
    async removePeer(id) {
      return peers.delete(id);
    }
  };
}

beforeEach(() => {
  clearStagedBackups();
});

describe('F3.P2P-3: Same-app Pairing Isolation & Fail-Closed Defaults', () => {
  test('default pairing rejects same-app descriptor without allowSameApp opt-in', async () => {
    const expiresAt = Core.pairSessionExpiry();
    const key = Core.randomPairKey();
    const descriptor = await Core.pairDescriptorFromManual('123456', key, expiresAt);
    descriptor.issuerId = 'sa-remote-1';
    descriptor.issuerApp = 'sa';
    descriptor.issuerName = 'SA Remoto';
    const encoded = Core.encodePairDescriptor(descriptor);

    // Fail-closed default: rejects same app (SA receiving SA)
    await expect(Core.decodePairDescriptor(encoded, { allowSameApp: false, receiverApp: 'sa' }))
      .rejects.toThrow(/same-app requiere habilitación explícita/i);

    // Explicit opt-in succeeds
    const decoded = await Core.decodePairDescriptor(encoded, { allowSameApp: true, receiverApp: 'sa' });
    expect(decoded.issuerApp).toBe('sa');
  });

  test('allowSameApp: true means ONLY remote.appType === local.appType and rejects opposite app', async () => {
    const local = { deviceId: 'sa-local', appType: 'sa', displayName: 'SA Local' };

    // When allowSameApp=true, remote MUST be same app ('sa'). Opposite app ('mini') MUST be rejected.
    expect(() => Pairing.validateHello(
      { deviceId: 'mini-remote', appType: 'mini', displayName: 'Mini', nonce: 'abc' },
      local,
      { allowSameApp: true }
    )).toThrow(/same-app sólo permite la misma aplicación/i);

    // Same app succeeds with allowSameApp=true
    const valid = Pairing.validateHello(
      { deviceId: 'sa-remote', appType: 'sa', displayName: 'Otro SA', nonce: 'abc' },
      local,
      { allowSameApp: true }
    );
    expect(valid.appType).toBe('sa');

    // Default allowSameApp=false rejects same app
    expect(() => Pairing.validateHello(
      { deviceId: 'sa-remote', appType: 'sa', displayName: 'Otro SA', nonce: 'abc' },
      local,
      { allowSameApp: false }
    )).toThrow(/no es compatible/i);

    // decodePairDescriptor with allowSameApp=true rejects opposite app
    const expiresAt = Core.pairSessionExpiry();
    const key = Core.randomPairKey();
    const miniDesc = await Core.pairDescriptorFromManual('654321', key, expiresAt);
    miniDesc.issuerApp = 'mini';
    const encodedMini = Core.encodePairDescriptor(miniDesc);

    await expect(Core.decodePairDescriptor(encodedMini, { allowSameApp: true, receiverApp: 'sa' }))
      .rejects.toThrow(/same-app sólo permite la misma aplicación/i);
  });

  test('savePeer requires explicit allowSameApp AND purpose: backup (no purpose-only bypass)', async () => {
    const store = Core.makeIdentityStore('sa', 'SA Local');
    const sameAppPeer = {
      peerId: 'sa-peer-2',
      peerApp: 'sa',
      displayName: 'Otro SA',
      linkToken: Core.randomToken(32)
    };

    // 1. Without allowSameApp and without purpose -> throws
    expect(() => store.savePeer(sameAppPeer, { allowSameApp: false }))
      .toThrow(/same-app requieren allowSameApp explícito/i);

    // 2. Purpose-only bypass attempt (purpose='backup' but allowSameApp=false) -> MUST throw!
    expect(() => store.savePeer({ ...sameAppPeer, purpose: 'backup' }, { allowSameApp: false }))
      .toThrow(/same-app requieren allowSameApp explícito/i);

    // 3. allowSameApp=true but missing purpose='backup' -> MUST throw!
    expect(() => store.savePeer(sameAppPeer, { allowSameApp: true }))
      .toThrow(/same-app requieren allowSameApp explícito/i);

    // 4. Explicit allowSameApp=true AND purpose='backup' -> SUCCEEDS
    const saved = store.savePeer({ ...sameAppPeer, purpose: 'backup' }, { allowSameApp: true });
    expect(saved).toBeDefined();
  });

  test('validateTrustedPeer enforces same app + purpose backup and rejects opposite app when allowSameApp=true', () => {
    const self = { deviceId: 'sa-self', appType: 'sa', displayName: 'SA' };
    const linkToken = Core.randomToken(32);

    // 1. allowSameApp=true with valid same-app backup peer -> succeeds
    const trusted = Pairing.validateTrustedPeer(self, {
      peerId: 'sa-peer', peerApp: 'sa', displayName: 'SA Remoto', linkToken, purpose: 'backup'
    }, { allowSameApp: true });
    expect(trusted.peerId).toBe('sa-peer');

    // 2. allowSameApp=true without purpose: 'backup' -> throws
    expect(() => Pairing.validateTrustedPeer(self, {
      peerId: 'sa-peer', peerApp: 'sa', displayName: 'SA Remoto', linkToken
    }, { allowSameApp: true })).toThrow(/requiere misma app y propósito de backup/i);

    // 3. allowSameApp=true with opposite app (mini) -> throws (must not allow opposite app)
    expect(() => Pairing.validateTrustedPeer(self, {
      peerId: 'mini-peer', peerApp: 'mini', displayName: 'Mini Remoto', linkToken, purpose: 'backup'
    }, { allowSameApp: true })).toThrow(/requiere misma app y propósito de backup/i);

    // 4. Default allowSameApp=false rejects same-app peer
    expect(() => Pairing.validateTrustedPeer(self, {
      peerId: 'sa-peer', peerApp: 'sa', displayName: 'SA Remoto', linkToken, purpose: 'backup'
    }, { allowSameApp: false })).toThrow(/no es compatible/i);

    // 5. Default allowSameApp=false accepts normal Mini peer
    const normalMini = Pairing.validateTrustedPeer(self, {
      peerId: 'mini-peer', peerApp: 'mini', displayName: 'Mini Remoto', linkToken
    }, { allowSameApp: false });
    expect(normalMini.peerApp).toBe('mini');
  });

  test('same-app backup pairing succeeds with allowSameApp: true and tags purpose: backup', async () => {
    const [chA, chB] = linkedPair();
    const selfA = { deviceId: 'sa-a', appType: 'sa', displayName: 'SA A' };
    const selfB = { deviceId: 'sa-b', appType: 'sa', displayName: 'SA B' };
    const storeA = makeStore();
    const storeB = makeStore();
    const descriptor = await Core.makePairDescriptor(selfA);

    let candidateA = null;
    let candidateB = null;
    let linkedA = null;
    let linkedB = null;
    let error = null;

    Pairing.attachPairing(chA, {
      self: selfA,
      descriptor,
      initiator: true,
      store: storeA,
      allowSameApp: true,
      onCandidate: c => { candidateA = c; },
      onLinked: peer => { linkedA = peer; },
      onError: err => { error = err; }
    });

    Pairing.attachPairing(chB, {
      self: selfB,
      descriptor,
      initiator: false,
      store: storeB,
      allowSameApp: true,
      onCandidate: c => { candidateB = c; },
      onLinked: peer => { linkedB = peer; },
      onError: err => { error = err; }
    });

    for (let i = 0; i < 50 && (!candidateA || !candidateB); i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(error).toBeNull();
    expect(candidateA).not.toBeNull();
    expect(candidateB).not.toBeNull();
    expect(candidateA.sas).toBe(candidateB.sas);

    await candidateA.accept();
    await candidateB.accept();

    for (let i = 0; i < 50 && (!linkedA || !linkedB); i++) {
      await new Promise(r => setTimeout(r, 10));
    }

    expect(linkedA).not.toBeNull();
    expect(linkedB).not.toBeNull();
    expect(linkedA.peerApp).toBe('sa');
    expect(linkedA.purpose).toBe('backup');
    expect(linkedB.peerApp).toBe('sa');
    expect(linkedB.purpose).toBe('backup');
  });

  test('same-app peers never enter roster peer lists or attendance listeners', async () => {
    const sameAppPeer = { peerId: 'sa-backup-peer', peerApp: 'sa', displayName: 'SA Remoto', purpose: 'backup' };
    const miniPeer = { peerId: 'mini-peer-1', peerApp: 'mini', displayName: 'Mini Cuadrilla' };
    const mockStore = makeStore([sameAppPeer, miniPeer]);

    // Roster peer filter: only Mini peers
    const allPeers = await mockStore.listPeers();
    const rosterPeers = allPeers.filter(p => p.peerApp === 'mini');
    expect(rosterPeers).toHaveLength(1);
    expect(rosterPeers[0].peerId).toBe('mini-peer-1');
    expect(rosterPeers.some(p => p.peerApp === 'sa')).toBe(false);

    // Attendance peer filter via listLinkedMiniPeers
    const attendancePeers = await listLinkedMiniPeers({ identityStore: mockStore });
    expect(attendancePeers).toHaveLength(1);
    expect(attendancePeers[0].peerId).toBe('mini-peer-1');
    expect(attendancePeers.some(p => p.peer?.peerApp === 'sa')).toBe(false);
  });
});

describe('F3.P2P-3: Valid Backup Round-trip & Framing', () => {
  test('SA ↔ SA backup round-trip preserves exact bytes and SHA-256', async () => {
    const [senderCh, receiverCh] = linkedPair();
    const backupJson = JSON.stringify({
      version: '1.0.0',
      companyName: 'Constructora Central',
      data: {
        settings: { companyName: 'Constructora Central' },
        employees: [{ id: 'EMP-1', name: 'Juan Perez' }]
      }
    }, null, 2);
    const backupBytes = new TextEncoder().encode(backupJson);
    const expectedSha = await Core.sha256Hex(backupBytes);

    let stagedReceived = null;
    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'sa-remote', peerApp: 'sa', displayName: 'SA Remoto' },
      onStaged: (staged) => {
        stagedReceived = staged;
      }
    });

    const { transfer, ack } = await sendBackupOnChannel(senderCh, {
      bytes: backupBytes,
      schema: SA_BACKUP_SCHEMA
    });

    expect(transfer.kind).toBe(BACKUP_KIND);
    expect(transfer.schema).toBe(SA_BACKUP_SCHEMA);
    expect(transfer.sha256).toBe(expectedSha);
    expect(ack.validated).toBe(true);
    expect(ack.sha256).toBe(expectedSha);

    expect(stagedReceived).not.toBeNull();
    expect(Array.from(stagedReceived.bytes)).toEqual(Array.from(backupBytes));
    expect(stagedReceived.sha256).toBe(expectedSha);
    expect(stagedReceived.sourceApp).toBe('sa');
  });

  test('SA ↔ Mini backup round-trip preserves exact bytes and SHA-256', async () => {
    const [senderCh, receiverCh] = linkedPair();
    const miniBackup = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const expectedSha = await Core.sha256Hex(miniBackup);

    let stagedReceived = null;
    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'mini-remote', peerApp: 'mini', displayName: 'Mini Tablet' },
      onStaged: (staged) => {
        stagedReceived = staged;
      }
    });

    const { transfer, ack } = await sendBackupOnChannel(senderCh, {
      bytes: miniBackup,
      schema: MINI_BACKUP_SCHEMA
    });

    expect(transfer.kind).toBe(BACKUP_KIND);
    expect(transfer.schema).toBe(MINI_BACKUP_SCHEMA);
    expect(transfer.sha256).toBe(expectedSha);
    expect(ack.validated).toBe(true);
    expect(stagedReceived).not.toBeNull();
    expect(stagedReceived.bytes).toEqual(miniBackup);
    expect(stagedReceived.sourceApp).toBe('mini');
  });
});

describe('F3.P2P-3: Hard Cap & Transport Integrity Fail-Closed', () => {
  test('>25 MiB backup rejected fail-closed before transfer', async () => {
    const [senderCh] = linkedPair();
    const oversizedBytes = new Uint8Array(MAX_BACKUP_BYTES + 1);

    await expect(sendBackupOnChannel(senderCh, {
      bytes: oversizedBytes,
      schema: SA_BACKUP_SCHEMA
    })).rejects.toThrow(/25 MiB/);
  });

  test('corrupt hash fails closed with zero staged data and channel revocation', async () => {
    const [senderCh, receiverCh] = linkedPair();
    let receiverError = null;
    let stagedReceived = null;

    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'sa-remote', peerApp: 'sa', displayName: 'SA Remoto' },
      onStaged: staged => { stagedReceived = staged; },
      onError: err => { receiverError = err; }
    });

    const data = new Uint8Array([10, 20, 30, 40]);
    const realSha = await Core.sha256Hex(data);
    const fakeSha = '0'.repeat(64);

    // Send invalid start frame with fake sha
    senderCh.send(JSON.stringify({
      protocol: Core.TRANSFER_PROTOCOL,
      type: 'start',
      transferId: 'tx-corrupt-sha',
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: data.byteLength,
      chunkSize: Core.CHUNK_SIZE,
      totalChunks: 1,
      sha256: fakeSha
    }));

    // Send chunk
    const chunk = new Uint8Array(4 + data.byteLength);
    new DataView(chunk.buffer).setUint32(0, 0, false);
    chunk.set(data, 4);
    senderCh.send(chunk);

    // Send end frame
    senderCh.send(JSON.stringify({
      protocol: Core.TRANSFER_PROTOCOL,
      type: 'end',
      transferId: 'tx-corrupt-sha'
    }));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(receiverError).not.toBeNull();
    expect(receiverError.message).toMatch(/SHA-256/i);
    expect(stagedReceived).toBeNull();
    expect(listStagedBackups()).toHaveLength(0);
  });

  test('duplicate chunk throws and revokes receiver cleanly', async () => {
    const [senderCh, receiverCh] = linkedPair();
    let receiverError = null;

    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'sa-remote', peerApp: 'sa', displayName: 'SA Remoto' },
      onError: err => { receiverError = err; }
    });

    const data = new Uint8Array(20000);
    const sha = await Core.sha256Hex(data);

    senderCh.send(JSON.stringify({
      protocol: Core.TRANSFER_PROTOCOL,
      type: 'start',
      transferId: 'tx-dupe-chunk',
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: data.byteLength,
      chunkSize: Core.CHUNK_SIZE,
      totalChunks: 2,
      sha256: sha
    }));

    // Chunk 0 sent twice
    const chunk0 = new Uint8Array(4 + Core.CHUNK_SIZE);
    new DataView(chunk0.buffer).setUint32(0, 0, false);
    senderCh.send(chunk0);
    senderCh.send(chunk0);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(receiverError).not.toBeNull();
    expect(receiverError.message).toMatch(/duplicado|inválido/i);
    expect(listStagedBackups()).toHaveLength(0);
  });
});

describe('F3.P2P-3: Staging Capacity (Total Cap) & Deduplication', () => {
  test('staging cap is MAX 3 pending backups TOTAL in the receiving SA, not 3 per sourceApp', async () => {
    const [senderCh, receiverCh] = linkedPair();
    let rejectedAck = null;

    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'sa-remote', peerApp: 'sa', displayName: 'SA Remoto' },
      onRejected: rej => { rejectedAck = rej; }
    });

    // Stage 2 valid backups from SA and 1 valid backup from Mini = 3 TOTAL
    for (let i = 1; i <= 2; i++) {
      const bytes = new TextEncoder().encode(`backup sa ${i}`);
      const sha = await Core.sha256Hex(bytes);
      stageBackup({
        transferId: `tx-stage-sa-${i}`,
        sha256: sha,
        kind: BACKUP_KIND,
        schema: SA_BACKUP_SCHEMA,
        size: bytes.byteLength,
        bytes,
        sourceApp: 'sa'
      });
    }

    const miniBytes = new TextEncoder().encode('backup mini 1');
    const miniSha = await Core.sha256Hex(miniBytes);
    stageBackup({
      transferId: 'tx-stage-mini-1',
      sha256: miniSha,
      kind: BACKUP_KIND,
      schema: MINI_BACKUP_SCHEMA,
      size: miniBytes.byteLength,
      bytes: miniBytes,
      sourceApp: 'mini'
    });

    // Total staged count is 3
    expect(listStagedBackups()).toHaveLength(3);
    expect(MAX_STAGED_BACKUPS).toBe(3);
    expect(MAX_STAGED_BACKUPS_TOTAL).toBe(3);

    // Attempting to send a 4th backup (even from SA which only has 2) MUST be rejected by TOTAL cap!
    const bytes4 = new TextEncoder().encode('backup sa 3 (4th overall)');
    const transferPromise = sendBackupOnChannel(senderCh, {
      bytes: bytes4,
      schema: SA_BACKUP_SCHEMA
    });

    await expect(transferPromise).rejects.toThrow(/máximo 3 en total/i);
    expect(listStagedBackups()).toHaveLength(3);
  });

  test('deduplicates by transferId and sha256 BEFORE capacity check', async () => {
    const bytesA = new TextEncoder().encode('backup A');
    const bytesB = new TextEncoder().encode('backup B');
    const bytesC = new TextEncoder().encode('backup C');
    const shaA = await Core.sha256Hex(bytesA);
    const shaB = await Core.sha256Hex(bytesB);
    const shaC = await Core.sha256Hex(bytesC);

    // Fill capacity to 3 total
    stageBackup({ transferId: 'tx-1', sha256: shaA, kind: BACKUP_KIND, schema: SA_BACKUP_SCHEMA, size: bytesA.byteLength, bytes: bytesA, sourceApp: 'sa' });
    stageBackup({ transferId: 'tx-2', sha256: shaB, kind: BACKUP_KIND, schema: SA_BACKUP_SCHEMA, size: bytesB.byteLength, bytes: bytesB, sourceApp: 'sa' });
    stageBackup({ transferId: 'tx-3', sha256: shaC, kind: BACKUP_KIND, schema: SA_BACKUP_SCHEMA, size: bytesC.byteLength, bytes: bytesC, sourceApp: 'sa' });
    expect(listStagedBackups()).toHaveLength(3);

    // Repeating backup A (matching sha256 or transferId) MUST succeed via dedup before capacity!
    const dupeBySha = stageBackup({
      transferId: 'tx-new-id',
      sha256: shaA,
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: bytesA.byteLength,
      bytes: bytesA,
      sourceApp: 'sa'
    });
    expect(dupeBySha.isDuplicate).toBe(true);
    expect(dupeBySha.staged.transferId).toBe('tx-1');

    const dupeById = stageBackup({
      transferId: 'tx-2',
      sha256: 'f'.repeat(64),
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: bytesB.byteLength,
      bytes: bytesB,
      sourceApp: 'sa'
    });
    expect(dupeById.isDuplicate).toBe(true);
    expect(dupeById.staged.transferId).toBe('tx-2');

    // Total remains 3
    expect(listStagedBackups()).toHaveLength(3);
  });
});

describe('F3.P2P-3: Canonical SA Restore Delegation', () => {
  test('reviewAndRestoreSaBackup delegates to canonical window.loadBackupFromFile with File/Blob', async () => {
    const mockBackupData = {
      version: '1.0.0',
      companyName: 'Constructora Beta',
      data: {
        settings: { companyName: 'Constructora Beta' },
        employees: [{ id: 'EMP-1', name: 'Pedro Gomez' }]
      }
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(mockBackupData, null, 2));
    const sha256 = await Core.sha256Hex(jsonBytes);

    stageBackup({
      transferId: 'tx-restore-delegation',
      sha256,
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: jsonBytes.byteLength,
      bytes: jsonBytes,
      sourceApp: 'sa',
      peerName: 'SA Remoto'
    });

    let passedFile = null;
    let passedHooks = null;
    window.loadBackupFromFile = jest.fn((file, hooks) => {
      passedFile = file;
      passedHooks = hooks;
      // Simulating modal open without confirm yet
    });

    // Initiate review
    const promise = reviewAndRestoreSaBackup('tx-restore-delegation');

    // Must have delegated to window.loadBackupFromFile with File/Blob
    expect(window.loadBackupFromFile).toHaveBeenCalled();
    expect(passedFile).not.toBeNull();
    expect(typeof passedFile.name === 'string' || typeof passedFile.type === 'string').toBe(true);
    expect(passedHooks).not.toBeNull();

    // Staged backup must NOT be removed before confirmation
    expect(getStagedBackup('tx-restore-delegation')).not.toBeNull();

    // Trigger canonical onSuccess
    passedHooks.onSuccess();
    const result = await promise;
    expect(result.restored).toBe(true);

    // Staged backup is removed ONLY from canonical onSuccess
    expect(getStagedBackup('tx-restore-delegation')).toBeNull();
  });

  test('failed or canceled restore leaves staged backup intact in memory', async () => {
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ data: {} }));
    const sha256 = await Core.sha256Hex(jsonBytes);

    stageBackup({
      transferId: 'tx-restore-canceled',
      sha256,
      kind: BACKUP_KIND,
      schema: SA_BACKUP_SCHEMA,
      size: jsonBytes.byteLength,
      bytes: jsonBytes,
      sourceApp: 'sa'
    });

    let passedHooks = null;
    window.loadBackupFromFile = jest.fn((file, hooks) => {
      passedHooks = hooks;
    });

    const promise = reviewAndRestoreSaBackup('tx-restore-canceled');
    expect(window.loadBackupFromFile).toHaveBeenCalled();

    // Simulating error/cancel
    passedHooks.onError(new Error('Usuario canceló restauración'));
    const result = await promise;
    expect(result.restored).toBe(false);

    // Staged backup remains intact
    expect(getStagedBackup('tx-restore-canceled')).not.toBeNull();
  });

  test('Mini backups remain download-only and must never enter loadBackupFromFile', async () => {
    const miniBytes = new Uint8Array([1, 2, 3, 4]);
    const sha256 = 'a'.repeat(64);

    stageBackup({
      transferId: 'tx-mini-no-restore',
      sha256,
      kind: BACKUP_KIND,
      schema: MINI_BACKUP_SCHEMA,
      size: miniBytes.byteLength,
      bytes: miniBytes,
      sourceApp: 'mini'
    });

    window.loadBackupFromFile = jest.fn();

    // Calling reviewAndRestoreSaBackup on Mini backup MUST throw immediately
    await expect(reviewAndRestoreSaBackup('tx-mini-no-restore'))
      .rejects.toThrow(/Sólo se puede restaurar un respaldo SA nativo proveniente de SA/i);

    // loadBackupFromFile is NEVER invoked
    expect(window.loadBackupFromFile).not.toHaveBeenCalled();
  });
});

describe('F3.P2P-3: Cross-App Negative Guard & UI Receiver Wiring', () => {
  test('SA receiving Mini backup only allows download; never calls loadBackupFromFile', () => {
    const miniBytes = new Uint8Array([42, 43, 44, 45]);
    const sha256 = 'b'.repeat(64);

    stageBackup({
      transferId: 'tx-mini-cross',
      sha256,
      kind: BACKUP_KIND,
      schema: MINI_BACKUP_SCHEMA,
      size: miniBytes.byteLength,
      bytes: miniBytes,
      sourceApp: 'mini',
      peerName: 'Mini Supervisor'
    });

    window.loadBackupFromFile = jest.fn();

    // Downloading returns safe local filename
    const downloadResult = downloadCrossAppBackup('tx-mini-cross');
    expect(downloadResult.filename).toMatch(/^backup-mini-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}\.json$/);
    expect(downloadResult.size).toBe(miniBytes.byteLength);
    expect(window.loadBackupFromFile).not.toHaveBeenCalled();
  });

  test('createBackupReceiver verifies SHA-256 and stages backup with authenticated ACK', async () => {
    const [senderCh, receiverCh] = linkedPair();
    const testBytes = new TextEncoder().encode('verified backup payload');
    const testSha = await Core.sha256Hex(testBytes);

    let stagedResult = null;
    createBackupReceiver({
      channel: receiverCh,
      peer: { peerId: 'sa-peer', peerApp: 'sa', displayName: 'SA Par' },
      onStaged: (staged) => { stagedResult = staged; }
    });

    const { transfer, ack } = await sendBackupOnChannel(senderCh, {
      bytes: testBytes,
      schema: SA_BACKUP_SCHEMA
    });

    expect(ack.validated).toBe(true);
    expect(ack.sha256).toBe(testSha);
    expect(stagedResult).not.toBeNull();
    expect(stagedResult.transferId).toBe(transfer.transferId);
    expect(stagedResult.sha256).toBe(testSha);
  });

  test('generic files and documents transfers remain completely disabled', () => {
    expect(() => {
      Core.validateTransferStart({
        protocol: Core.TRANSFER_PROTOCOL,
        type: 'start',
        transferId: 'tx-generic-file',
        kind: 'files',
        schema: 'files/v1',
        size: 100,
        chunkSize: Core.CHUNK_SIZE,
        totalChunks: 1,
        sha256: 'c'.repeat(64)
      });
    }).toThrow(/Clase de transferencia no admitida/);

    expect(() => {
      Core.validateTransferStart({
        protocol: Core.TRANSFER_PROTOCOL,
        type: 'start',
        transferId: 'tx-generic-doc',
        kind: 'documents',
        schema: 'doc/v1',
        size: 100,
        chunkSize: Core.CHUNK_SIZE,
        totalChunks: 1,
        sha256: 'c'.repeat(64)
      });
    }).toThrow(/Clase de transferencia no admitida/);
  });
});

describe('F3.P2P-3: Reviewer R2 Focused Regressions', () => {
  describe('1. Export characterization compatibility & canonical reuse', () => {
    test('window.exportData source retains canonical native assembly and fits 2500-char budget', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
      const block = src.match(/window\.exportData\s*=\s*async\s*function[\s\S]{0,2500}?\n\};/);
      expect(block).toBeTruthy();
      const text = block[0];
      expect(text).toMatch(/PettyCashStore\.loadLocal/);
      expect(text).toMatch(/sanitizePettyCashForSnapshot/);
      expect(text).toMatch(/settings:\s*state\.settings/);
      expect(text).toMatch(/pettyCash/);
      expect(text).toMatch(/maybeAttachProjectBackup/);
      expect(text).toMatch(/showExportMenu/);
      expect(text).toMatch(/returnData/);
    });

    test('generateNativeSaBackupData delegates to window.exportData({ returnData: true })', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
      expect(src).toMatch(/generateNativeSaBackupData[\s\S]*?window\.exportData\(\{\s*returnData:\s*true\s*\}\)/);
    });
  });

  describe('2. Cancel and nonblocking restore liveness', () => {
    test('reviewAndRestoreSaBackup with nonblocking: true resolves immediately with { opened: true }', async () => {
      const jsonBytes = new TextEncoder().encode(JSON.stringify({ data: {} }));
      const sha256 = await Core.sha256Hex(jsonBytes);
      stageBackup({
        transferId: 'tx-nonblocking-reg',
        sha256,
        kind: BACKUP_KIND,
        schema: SA_BACKUP_SCHEMA,
        size: jsonBytes.byteLength,
        bytes: jsonBytes,
        sourceApp: 'sa'
      });

      let passedHooks = null;
      window.loadBackupFromFile = jest.fn((file, hooks) => {
        passedHooks = hooks;
      });

      const res = await reviewAndRestoreSaBackup('tx-nonblocking-reg', { nonblocking: true });
      expect(res.opened).toBe(true);
      expect(window.loadBackupFromFile).toHaveBeenCalled();
      expect(getStagedBackup('tx-nonblocking-reg')).not.toBeNull();

      // Canonical onSuccess removes staged backup
      passedHooks.onSuccess();
      expect(getStagedBackup('tx-nonblocking-reg')).toBeNull();
    });

    test('reviewAndRestoreSaBackup settles with { restored: false, cancelled: true } when user cancels via Close/Cancel button', async () => {
      const jsonBytes = new TextEncoder().encode(JSON.stringify({ data: {} }));
      const sha256 = await Core.sha256Hex(jsonBytes);
      stageBackup({
        transferId: 'tx-cancel-reg',
        sha256,
        kind: BACKUP_KIND,
        schema: SA_BACKUP_SCHEMA,
        size: jsonBytes.byteLength,
        bytes: jsonBytes,
        sourceApp: 'sa'
      });

      window.loadBackupFromFile = jest.fn((file, hooks) => {
        const modal = document.createElement('div');
        modal.id = 'restore-comparison-modal';
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'restore-modal-cancel-restore-comparison-modal';
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        modal.appendChild(cancelBtn);
        document.body.appendChild(modal);
      });

      const onCancelHook = jest.fn();
      const promise = reviewAndRestoreSaBackup('tx-cancel-reg', { onCancel: onCancelHook });

      const modal = document.getElementById('restore-comparison-modal');
      expect(modal).not.toBeNull();

      // Trigger cancel: modal removed as RestoreUI closeModal does, then click fires
      const cancelBtn = document.getElementById('restore-modal-cancel-restore-comparison-modal');
      modal.remove();
      cancelBtn.click();

      const result = await promise;
      expect(result.restored).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(onCancelHook).toHaveBeenCalled();
      // Staged backup remains intact
      expect(getStagedBackup('tx-cancel-reg')).not.toBeNull();
    });

    test('reviewAndRestoreSaBackup settles with { restored: false, cancelled: true } when Escape is pressed', async () => {
      const jsonBytes = new TextEncoder().encode(JSON.stringify({ data: {} }));
      const sha256 = await Core.sha256Hex(jsonBytes);
      stageBackup({
        transferId: 'tx-escape-reg',
        sha256,
        kind: BACKUP_KIND,
        schema: SA_BACKUP_SCHEMA,
        size: jsonBytes.byteLength,
        bytes: jsonBytes,
        sourceApp: 'sa'
      });

      window.loadBackupFromFile = jest.fn((file, hooks) => {
        const modal = document.createElement('div');
        modal.id = 'restore-comparison-modal';
        document.body.appendChild(modal);
      });

      const promise = reviewAndRestoreSaBackup('tx-escape-reg');
      const modal = document.getElementById('restore-comparison-modal');
      expect(modal).not.toBeNull();

      // Simulate Escape key dismiss
      modal.remove();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      const result = await promise;
      expect(result.restored).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(getStagedBackup('tx-escape-reg')).not.toBeNull();
    });
  });

  describe('3. Stale ACK filtering, exact validation, and cleanup/timeout', () => {
    test('sendBackupOnChannel ignores stale/unrelated ACK and rejection frames and accepts exact matching ACK', async () => {
      const [senderCh, receiverCh] = linkedPair();
      const testBytes = new TextEncoder().encode('stale-ack-filtering-bytes');
      const testSha = await Core.sha256Hex(testBytes);

      // Stale ACK delivered before transfer identity is established
      const staleAck = {
        protocol: Core.CONTROL_PROTOCOL,
        type: 'backup-staged',
        data: {
          transferId: 'tx-stale-old',
          sha256: 'e'.repeat(64),
          kind: BACKUP_KIND,
          schema: SA_BACKUP_SCHEMA,
          validated: true
        }
      };
      receiverCh.send(JSON.stringify(staleAck));

      // Stale rejection frame from another transfer
      const staleReject = {
        protocol: Core.CONTROL_PROTOCOL,
        type: 'backup-rejected',
        data: {
          transferId: 'tx-stale-rejected',
          reason: 'staged cap reached',
          kind: BACKUP_KIND,
          schema: SA_BACKUP_SCHEMA,
          validated: false
        }
      };
      receiverCh.send(JSON.stringify(staleReject));

      // Receiver that validates start and responds with matching ACK
      receiverCh.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'start' && msg.kind === BACKUP_KIND) {
          const matchingAck = {
            protocol: Core.CONTROL_PROTOCOL,
            type: 'backup-staged',
            data: {
              transferId: msg.transferId,
              sha256: testSha,
              kind: BACKUP_KIND,
              schema: SA_BACKUP_SCHEMA,
              validated: true
            }
          };
          receiverCh.send(JSON.stringify(matchingAck));
        }
      });

      const { transfer, ack } = await sendBackupOnChannel(senderCh, {
        bytes: testBytes,
        schema: SA_BACKUP_SCHEMA,
        timeoutMs: 5000
      });

      expect(ack.validated).toBe(true);
      expect(ack.transferId).toBe(transfer.transferId);
      expect(ack.sha256).toBe(testSha);
    });

    test('sendBackupOnChannel cleans up listener and rejects on timeout when no matching ACK arrives', async () => {
      const [senderCh, receiverCh] = linkedPair();
      const testBytes = new TextEncoder().encode('timeout-cleanup-bytes');

      receiverCh.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'start') {
          // Send an ACK with a non-matching transferId
          const nonMatchingAck = {
            protocol: Core.CONTROL_PROTOCOL,
            type: 'backup-staged',
            data: {
              transferId: 'tx-never-matches',
              sha256: '9'.repeat(64),
              kind: BACKUP_KIND,
              schema: SA_BACKUP_SCHEMA,
              validated: true
            }
          };
          receiverCh.send(JSON.stringify(nonMatchingAck));
        }
      });

      const initialListeners = senderCh.listeners.size;

      await expect(sendBackupOnChannel(senderCh, {
        bytes: testBytes,
        schema: SA_BACKUP_SCHEMA,
        timeoutMs: 150
      })).rejects.toThrow(/El receptor no confirmó la recepción del backup a tiempo/);

      // Listeners must be cleaned up
      expect(senderCh.listeners.size).toBe(initialListeners);
    });
  });

  describe('4. Strict identity store same-app behavior', () => {
    test('savePeer under allowSameApp: true requires peer.peerApp === local appType AND purpose: backup', () => {
      const store = Core.makeIdentityStore('sa', 'SA Principal');
      const token = Core.randomToken(32);

      // 1. allowSameApp: true with opposite-app (mini) -> MUST throw!
      expect(() => store.savePeer({
        peerId: 'mini-opp-peer',
        peerApp: 'mini',
        displayName: 'Mini Incompatible',
        linkToken: token,
        purpose: 'backup'
      }, { allowSameApp: true })).toThrow(/los registros same-app requieren allowSameApp explícito y propósito de backup/i);

      // 2. allowSameApp: true with same-app (sa) but missing purpose -> MUST throw!
      expect(() => store.savePeer({
        peerId: 'sa-no-purpose-peer',
        peerApp: 'sa',
        displayName: 'SA Sin Propósito',
        linkToken: token
      }, { allowSameApp: true })).toThrow(/los registros same-app requieren allowSameApp explícito y propósito de backup/i);

      // 3. allowSameApp: true with same-app (sa) and purpose !== 'backup' -> MUST throw!
      expect(() => store.savePeer({
        peerId: 'sa-wrong-purpose-peer',
        peerApp: 'sa',
        displayName: 'SA Roster',
        linkToken: token,
        purpose: 'roster'
      }, { allowSameApp: true })).toThrow(/los registros same-app requieren allowSameApp explícito y propósito de backup/i);

      // 4. allowSameApp: true with same-app (sa) AND purpose === 'backup' -> SUCCEEDS
      const savedSame = store.savePeer({
        peerId: 'sa-valid-backup-peer',
        peerApp: 'sa',
        displayName: 'SA Backup Par',
        linkToken: token,
        purpose: 'backup'
      }, { allowSameApp: true });
      expect(savedSame).toBeDefined();
    });

    test('savePeer under default allowSameApp: false accepts ONLY opposite-app and rejects same-app', () => {
      const store = Core.makeIdentityStore('sa', 'SA Principal');
      const token = Core.randomToken(32);

      // 1. Default (allowSameApp: false) with same-app (even with purpose: backup) -> MUST throw!
      expect(() => store.savePeer({
        peerId: 'sa-same-peer-rejected',
        peerApp: 'sa',
        displayName: 'SA Mismo',
        linkToken: token,
        purpose: 'backup'
      })).toThrow(/los registros same-app requieren allowSameApp explícito y propósito de backup/i);

      // 2. Default (allowSameApp: false) with opposite-app (mini) -> SUCCEEDS
      const savedOpposite = store.savePeer({
        peerId: 'mini-peer-normal',
        peerApp: 'mini',
        displayName: 'Mini Operativo',
        linkToken: token
      });
      expect(savedOpposite).toBeDefined();
    });
  });
});
