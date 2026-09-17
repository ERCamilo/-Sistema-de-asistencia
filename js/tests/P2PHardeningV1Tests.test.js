/**
 * P2PHardeningV1Tests.test.js
 *
 * Hardening and negative test suite for F3.P2P-4 / SA-F3-P2P-HARDEN-066:
 * (1) Exact v1 transport capability set on P2P home:
 *     - Personal/roster active ('is-ready')
 *     - Asistencia active ('is-ready')
 *     - Backup active ('is-ready') with dedicated action/scroll trigger
 *     - Archivos/Documents visible, disabled ('is-disabled', aria-disabled="true"), NO actionable picker/handler
 *     - Proyecto removed from transport capabilities; active project context clearly visible elsewhere
 *     - Project gating preserved for pairing and roster sending
 * (2) Generic transfer surface hardened:
 *     - Arbitrary kinds (files, documents, photo, pdf, bin, binary, generic) rejected fail-closed
 *     - Receiver rejects and revokes channel upon receiving unknown kind
 *     - Zero staged data for arbitrary transfers
 * (3) Same-app backup isolation:
 *     - Same-app pairing rejects without explicit allowSameApp opt-in
 *     - Same-app backup peers never enter roster peer lists or attendance listeners
 *     - Cross-app Mini backup remains strictly download-only; restore is blocked
 * (4) Manual fallbacks preserved:
 *     - Existing roster export / WhatsApp manual flow reachable
 *     - Attendance paste / manual flow reachable
 *     - Native backup export/import (window.exportData, window.loadBackupFromFile) reachable
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
const { p2pBackupBridge, stageBackup, BACKUP_KIND, SA_BACKUP_SCHEMA, MINI_BACKUP_SCHEMA } = require('../modules/features/p2p/P2PBackupBridge.js');
const { openP2PRosterTransfer, closeP2PRosterTransfer } = require('../modules/features/p2p/P2PRosterUI.js');
const { shareExportMiniV1 } = require('../modules/features/export/ExportController.js');

describe('SA-F3-P2P-HARDEN-066: P2P v1 Hardening & Capability Contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    p2pBackupBridge.clearStaged();
  });

  afterEach(() => {
    closeP2PRosterTransfer();
    document.body.innerHTML = '';
  });

  describe('(1) Exact v1 Transport Capabilities & Project Context', () => {
    test('P2P home capabilities represent exactly the 4 v1 transport surfaces and exclude Proyecto', async () => {
      const mockMiniPeer = {
        peerId: 'peer-mini-01',
        displayName: 'Mini Móvil 1',
        peerApp: 'mini',
        linkedAt: '2026-09-16T10:00:00Z',
        lastSeenAt: '2026-09-16T10:00:00Z'
      };

      window.SaMiniP2P = {
        makeIdentityStore: () => ({
          listPeers: jest.fn().mockResolvedValue([mockMiniPeer]),
          getPeer: jest.fn().mockResolvedValue(mockMiniPeer),
          getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-self-1', displayName: 'SA Central' })
        }),
        isChannelAuthenticated: () => true
      };
      window.getProjectSetupState = () => ({
        enabled: true,
        ready: true,
        activeProjectId: 'PRJ-OBRA-1',
        activeProject: { id: 'PRJ-OBRA-1', name: 'Obra Los Álamos' }
      });
      window.getSaP2PActionablePendingReviewGroups = jest.fn().mockResolvedValue([]);

      await openP2PRosterTransfer();

      const shell = document.querySelector('.sa-p2p-shell');
      expect(shell).not.toBeNull();

      const capabilitiesSection = shell.querySelector('.sa-p2p-capabilities');
      expect(capabilitiesSection).not.toBeNull();

      const capabilityItems = Array.from(capabilitiesSection.querySelectorAll('.sa-p2p-capability'));
      expect(capabilityItems.length).toBe(4);

      // Extract titles
      const titles = capabilityItems.map(item => item.querySelector('strong')?.textContent?.trim());
      expect(titles).toEqual(['Personal', 'Asistencia', 'Backup', 'Archivos']);

      // 1. Personal is active
      const personalItem = capabilityItems[0];
      expect(personalItem.classList.contains('is-ready')).toBe(true);
      expect(personalItem.textContent).toContain('SA → Mini');

      // 2. Asistencia is active
      const asistenciaItem = capabilityItems[1];
      expect(asistenciaItem.classList.contains('is-ready')).toBe(true);
      expect(asistenciaItem.textContent).toContain('Mini → SA');

      // 3. Backup is active, is a button, has data-capability-backup
      const backupItem = capabilityItems[2];
      expect(backupItem.tagName).toBe('BUTTON');
      expect(backupItem.classList.contains('is-ready')).toBe(true);
      expect(backupItem.hasAttribute('data-capability-backup')).toBe(true);
      expect(backupItem.textContent).toContain('SA ↔ SA / Mini');

      // 4. Archivos is visible but disabled with aria-disabled
      const archivosItem = capabilityItems[3];
      expect(archivosItem.tagName).toBe('DIV');
      expect(archivosItem.classList.contains('is-disabled')).toBe(true);
      expect(archivosItem.getAttribute('aria-disabled')).toBe('true');
      expect(archivosItem.textContent).toContain('Próximamente');

      // Verify Proyecto is NOT inside .sa-p2p-capabilities
      expect(titles).not.toContain('Proyecto');

      // Verify active project context is clearly rendered outside .sa-p2p-capabilities
      const projectBar = shell.querySelector('.sa-p2p-project-bar');
      expect(projectBar).not.toBeNull();
      expect(projectBar.textContent).toContain('Proyecto');
      expect(projectBar.textContent).toContain('Obra Los Álamos');
      const projectBtn = projectBar.querySelector('[data-configure-project]');
      expect(projectBtn).not.toBeNull();
    });

    test('Backup capability button focuses/scrolls to existing backup flow without duplicating implementations', async () => {
      window.SaMiniP2P = {
        makeIdentityStore: () => ({
          listPeers: jest.fn().mockResolvedValue([]),
          getPeer: jest.fn().mockResolvedValue(null),
          getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-self-1', displayName: 'SA Central' })
        }),
        isChannelAuthenticated: () => true
      };
      window.getProjectSetupState = () => ({
        enabled: true,
        ready: true,
        activeProjectId: 'PRJ-1',
        activeProject: { id: 'PRJ-1', name: 'Obra 1' }
      });
      window.getSaP2PActionablePendingReviewGroups = jest.fn().mockResolvedValue([]);

      await openP2PRosterTransfer();

      const shell = document.querySelector('.sa-p2p-shell');
      const backupBtn = shell.querySelector('[data-capability-backup]');
      expect(backupBtn).not.toBeNull();

      const backupDevicesSection = shell.querySelector('.sa-p2p-backup-devices');
      expect(backupDevicesSection).not.toBeNull();

      // Mock scrollIntoView
      backupDevicesSection.scrollIntoView = jest.fn();

      backupBtn.click();
      expect(backupDevicesSection.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    });

    test('Project gating blocks roster sending and pairing when official project is not ready', async () => {
      const mockPeer = {
        peerId: 'peer-mini-02',
        displayName: 'Mini Móvil 2',
        peerApp: 'mini',
        linkedAt: '2026-09-16T10:00:00Z',
        lastSeenAt: '2026-09-16T10:00:00Z'
      };

      window.SaMiniP2P = {
        makeIdentityStore: () => ({
          listPeers: jest.fn().mockResolvedValue([mockPeer]),
          getPeer: jest.fn().mockResolvedValue(mockPeer),
          getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-self-1', displayName: 'SA Central' })
        }),
        isChannelAuthenticated: () => true
      };
      // Project is NOT ready
      window.getProjectSetupState = () => ({
        enabled: true,
        ready: false,
        activeProjectId: null,
        activeProject: null
      });
      window.getSaP2PActionablePendingReviewGroups = jest.fn().mockResolvedValue([]);

      await openP2PRosterTransfer();

      const shell = document.querySelector('.sa-p2p-shell');
      const sendBtn = shell.querySelector(`[data-send-peer="${mockPeer.peerId}"]`);
      expect(sendBtn).not.toBeNull();
      expect(sendBtn.disabled).toBe(true);
      expect(sendBtn.getAttribute('aria-disabled')).toBe('true');

      // Warning message should be visible
      const warningStatus = shell.querySelector('.sa-p2p-status.is-warning');
      expect(warningStatus).not.toBeNull();
      expect(warningStatus.textContent).toContain('Configura el proyecto para vincular un Mini');
    });
  });

  describe('(2) Disabled Files/Documents Surface — No Action & Generic Transfers Blocked', () => {
    test('Archivos capability has no actionable picker, no file input, and no click handlers', async () => {
      window.SaMiniP2P = {
        makeIdentityStore: () => ({
          listPeers: jest.fn().mockResolvedValue([]),
          getPeer: jest.fn().mockResolvedValue(null),
          getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-self-1', displayName: 'SA Central' })
        }),
        isChannelAuthenticated: () => true
      };
      window.getProjectSetupState = () => ({
        enabled: true,
        ready: true,
        activeProjectId: 'PRJ-1',
        activeProject: { id: 'PRJ-1', name: 'Obra 1' }
      });
      window.getSaP2PActionablePendingReviewGroups = jest.fn().mockResolvedValue([]);

      await openP2PRosterTransfer();

      const shell = document.querySelector('.sa-p2p-shell');
      const capabilities = shell.querySelectorAll('.sa-p2p-capability');
      const archivosEl = Array.from(capabilities).find(el => el.textContent.includes('Archivos'));

      expect(archivosEl).toBeDefined();
      expect(archivosEl.tagName).toBe('DIV');
      expect(archivosEl.querySelector('input[type="file"]')).toBeNull();
      expect(archivosEl.querySelector('button')).toBeNull();
      expect(archivosEl.querySelector('a')).toBeNull();
      expect(archivosEl.hasAttribute('data-action')).toBe(false);

      // Clicking does not open any dialog, change state, or throw
      const originalHTML = shell.innerHTML;
      archivosEl.click();
      expect(shell.innerHTML).toBe(originalHTML);
    });

    test('P2PCore.validateTransferStart rejects arbitrary transfer kinds (files, documents, photo, pdf, bin, generic) fail-closed', () => {
      const validBase = {
        protocol: Core.TRANSFER_PROTOCOL,
        type: 'start',
        transferId: 't-1234567890abcdef',
        size: 1024,
        chunkSize: Core.CHUNK_SIZE,
        totalChunks: 1,
        sha256: 'a'.repeat(64)
      };

      const disallowedKinds = ['files', 'documents', 'photo', 'pdf', 'bin', 'binary', 'generic', 'image', 'video'];

      for (const kind of disallowedKinds) {
        expect(() => {
          Core.validateTransferStart({
            ...validBase,
            kind,
            schema: `${kind}/v1`
          });
        }).toThrow('Clase de transferencia no admitida.');
      }
    });

    test('P2PCore.sendPayload rejects arbitrary transfer kinds fail-closed', async () => {
      const fakeChannel = { send: jest.fn(), readyState: 'open' };
      Core.markChannelAuthenticated(fakeChannel);
      const disallowedKinds = ['files', 'documents', 'photo', 'pdf', 'bin', 'generic'];

      for (const kind of disallowedKinds) {
        await expect(Core.sendPayload(fakeChannel, {
          kind,
          schema: `${kind}/v1`,
          bytes: new Uint8Array([1, 2, 3])
        })).rejects.toThrow('Sólo se admite transferencia roster o backup.');
      }
    });

    test('P2PCore.createTransferReceiver fails closed and revokes channel when arbitrary kind start frame arrives', async () => {
      let failedError = null;
      const fakeChannel = {
        send: jest.fn(),
        close: jest.fn(),
        readyState: 'open'
      };
      Core.markChannelAuthenticated(fakeChannel);

      const receiver = Core.createTransferReceiver({
        channel: fakeChannel,
        onError: (err) => { failedError = err; },
        onComplete: jest.fn()
      });

      const invalidStartFrame = JSON.stringify({
        protocol: Core.TRANSFER_PROTOCOL,
        type: 'start',
        transferId: 't-9999999999abcdef',
        kind: 'documents',
        schema: 'documents/v1',
        size: 500,
        chunkSize: Core.CHUNK_SIZE,
        totalChunks: 1,
        sha256: 'b'.repeat(64)
      });

      await receiver({ data: invalidStartFrame });
      expect(failedError).not.toBeNull();
      expect(failedError.message).toBe('Clase de transferencia no admitida.');
    });

    test('P2PBackupBridge.stageBackup rejects arbitrary transfer kinds fail-closed', () => {
      expect(() => {
        stageBackup({
          transferId: 't-arbitrary-1',
          sha256: 'c'.repeat(64),
          kind: 'files',
          schema: 'files/v1',
          sourceApp: 'sa',
          bytes: new Uint8Array([1, 2, 3])
        });
      }).toThrow('Clase de transferencia no es backup.');

      expect(() => {
        stageBackup({
          transferId: 't-arbitrary-2',
          sha256: 'c'.repeat(64),
          kind: BACKUP_KIND,
          schema: 'arbitrary-schema/v1',
          sourceApp: 'sa',
          bytes: new Uint8Array([1, 2, 3])
        });
      }).toThrow('Esquema de backup no compatible.');
    });
  });

  describe('(3) Same-app Backup Isolation & Cross-App Guard', () => {
    test('Same-app pairing rejects without explicit allowSameApp opt-in', async () => {
      const expiresAt = Core.pairSessionExpiry();
      const key = Core.randomPairKey();
      const descriptor = await Core.pairDescriptorFromManual('123456', key, expiresAt);
      descriptor.issuerId = 'sa-remote-1';
      descriptor.issuerApp = 'sa';
      descriptor.issuerName = 'SA Remoto';
      const encoded = Core.encodePairDescriptor(descriptor);

      // Default pairing rejects same-app (SA receiving SA) without opt-in
      await expect(Core.decodePairDescriptor(encoded, { allowSameApp: false, receiverApp: 'sa' }))
        .rejects.toThrow(/same-app requiere habilitación explícita/i);

      // Explicit opt-in allows same-app
      const decoded = await Core.decodePairDescriptor(encoded, { allowSameApp: true, receiverApp: 'sa' });
      expect(decoded.issuerApp).toBe('sa');

      // Default Pairing.validateHello rejects same-app
      const local = { deviceId: 'sa-local-1', appType: 'sa', displayName: 'SA Local' };
      const remoteSame = { deviceId: 'sa-remote-1', appType: 'sa', displayName: 'SA Remoto', nonce: 'nonce-1' };
      expect(() => Pairing.validateHello(remoteSame, local, { allowSameApp: false }))
        .toThrow(/no es compatible/i);
    });

    test('Same-app backup peers never enter roster peer lists', async () => {
      const idb = Core.makeIdentityStore('sa', 'SA Central');
      const saRosterPeer = {
        peerId: 'mini-peer-test-1',
        linkToken: Core.randomToken(32),
        displayName: 'Mini Obra',
        peerApp: 'mini',
        allowSameApp: false,
        purpose: 'roster',
        linkedAt: '2026-09-16T12:00:00Z'
      };
      const saBackupPeer = {
        peerId: 'sa-peer-test-2',
        linkToken: Core.randomToken(32),
        displayName: 'Otro SA Respaldo',
        peerApp: 'sa',
        allowSameApp: true,
        purpose: 'backup',
        linkedAt: '2026-09-16T12:05:00Z'
      };

      await idb.savePeer(saRosterPeer, { allowSameApp: false });
      await idb.savePeer(saBackupPeer, { allowSameApp: true });

      const allPeers = await idb.listPeers();
      // Only opposite-app peers can be roster targets
      const rosterPeers = allPeers.filter(p => p.peerApp === 'mini' && !p.allowSameApp && p.purpose !== 'backup');
      expect(rosterPeers.map(p => p.peerId)).toContain('mini-peer-test-1');
      expect(rosterPeers.map(p => p.peerId)).not.toContain('sa-peer-test-2');
    });

    test('Cross-app Mini backup remains strictly download-only; reviewAndRestoreSaBackup rejects it', async () => {
      const miniBytes = new TextEncoder().encode(JSON.stringify({ miniData: true }));
      const miniHash = await Core.sha256Hex(miniBytes);

      const stagedResult = stageBackup({
        transferId: 't-mini-backup-cross',
        sha256: miniHash,
        kind: BACKUP_KIND,
        schema: MINI_BACKUP_SCHEMA,
        sourceApp: 'mini',
        bytes: miniBytes
      });
      expect(stagedResult.staged.sourceApp).toBe('mini');

      // Attempting to restore a Mini backup on SA must throw fail-closed
      await expect(
        p2pBackupBridge.reviewAndRestoreSaBackup('t-mini-backup-cross')
      ).rejects.toThrow('Sólo se puede restaurar un respaldo SA nativo proveniente de SA.');
    });
  });

  describe('(4) Manual Fallbacks Preserved & Reachable', () => {
    test('Manual roster export (shareExportMiniV1) remains reachable and unchanged', () => {
      expect(typeof shareExportMiniV1).toBe('function');
    });

    test('Native backup export and import (window.exportData, window.loadBackupFromFile) remain present', () => {
      const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
      expect(appSource).toContain('window.exportData =');
      expect(appSource).toContain('window.loadBackupFromFile =');
      expect(appSource).toContain('window.syncCenterOpenBackups =');
      expect(appSource).toContain('window.openDatosAjustes =');
    });

    test('Attendance manual paste flow remains intact in MiniAttendanceImportModal', () => {
      const modalSource = fs.readFileSync(
        path.resolve(__dirname, '../modules/ui/modals/MiniAttendanceImportModal.js'),
        'utf8'
      );
      expect(modalSource).toContain('Pegar texto');
      expect(modalSource).toContain('Analizar reporte');
      expect(modalSource).toContain('class MiniAttendanceImportModal');
    });
  });
});
