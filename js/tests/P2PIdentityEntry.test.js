const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const {
  SA_SELF_NAME_MAX_LENGTH,
  normalizeProjectPresentationName,
  resolveSaSelfPresentationName,
  getNewPairingProjectGate,
  ensureSaSelfMatchesProject
} = require('../modules/features/p2p/P2PRosterUI.js');
const { Header } = require('../modules/ui/Header.js');

function readyProjectState(name = 'Obra Central') {
  return {
    enabled: true,
    ready: true,
    activeProjectId: 'PRJ-123',
    activeProject: { id: 'PRJ-123', name, status: 'active' }
  };
}

describe('Block B — project-name self presentation (SA identity)', () => {
  test('uses active project human name, never projectId', () => {
    const state = readyProjectState('Obra Central');
    expect(resolveSaSelfPresentationName(state, { displayName: 'SA - Oficina' })).toBe('Obra Central');
    expect(resolveSaSelfPresentationName(state, { displayName: 'Obra Central' })).toBe('Obra Central');
    // projectId must never leak as presentation
    expect(resolveSaSelfPresentationName(state, { displayName: 'x' })).not.toBe('PRJ-123');
  });

  test('normalizes whitespace/controls and caps at 80 chars', () => {
    expect(SA_SELF_NAME_MAX_LENGTH).toBe(80);
    expect(normalizeProjectPresentationName('  Obra\n  Central\t ')).toBe('Obra Central');
    expect(normalizeProjectPresentationName('a\u0000b')).toBe('a b');
    expect(Array.from(normalizeProjectPresentationName('x'.repeat(200)))).toHaveLength(80);
    expect(normalizeProjectPresentationName('')).toBe('');
  });

  test('falls back to stored self name only when project is not ready', () => {
    expect(resolveSaSelfPresentationName({ ready: false, activeProject: null }, { displayName: 'SA - Oficina' }))
      .toBe('SA - Oficina');
    expect(resolveSaSelfPresentationName({ ready: true, activeProject: { name: '   ' } }, { displayName: 'SA - Oficina' }))
      .toBe('SA - Oficina');
  });
});

describe('Block B — no new pairing without an official project (fail-closed)', () => {
  test('gate blocks when not ready, disabled, or name missing', () => {
    expect(getNewPairingProjectGate({ enabled: false, ready: false, activeProject: null })).not.toBeNull();
    expect(getNewPairingProjectGate({ enabled: true, ready: false, activeProject: null })).not.toBeNull();
    expect(getNewPairingProjectGate({ enabled: true, ready: true, activeProject: null })).not.toBeNull();
    expect(getNewPairingProjectGate({ enabled: true, ready: true, activeProject: { name: '   ' } })).not.toBeNull();
    expect(getNewPairingProjectGate(readyProjectState('Obra Central'))).toBeNull();
  });

  test('gate message is concise and points to project configuration', () => {
    const gate = getNewPairingProjectGate({ ready: false, activeProject: null });
    expect(gate.title).toMatch(/proyecto/i);
    expect(gate.message).toMatch(/nombre del proyecto/i);
    expect(gate.message).toMatch(/Configura el proyecto/i);
  });

  test('ensureSaSelfMatchesProject throws when blocked and renames to project name when allowed', async () => {
    await expect(ensureSaSelfMatchesProject({ getSelf: async () => ({ displayName: 'x' }) }, { ready: false, activeProject: null }))
      .rejects.toThrow(/nombre del proyecto/i);

    const renamed = [];
    const identityStore = {
      async getSelf() { return { deviceId: 'sa-1', appType: 'sa', displayName: this._name || 'SA - Oficina' }; },
      async renameSelf(next) { renamed.push(next); this._name = next; return { displayName: next }; }
    };
    const aligned = await ensureSaSelfMatchesProject(identityStore, readyProjectState('Obra Central'));
    expect(renamed).toEqual(['Obra Central']);
    expect(aligned.displayName).toBe('Obra Central');

    const alreadyAligned = {
      async getSelf() { return { deviceId: 'sa-1', appType: 'sa', displayName: 'Obra Central' }; },
      async renameSelf() { throw new Error('should not rename when already aligned'); }
    };
    await expect(ensureSaSelfMatchesProject(alreadyAligned, readyProjectState('Obra Central')))
      .resolves.toMatchObject({ displayName: 'Obra Central' });
  });

  test('startNewPairing is gated and aligns self before descriptor; blocked UI offers configure action', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain('getNewPairingProjectGate(projectState)');
    expect(ui).toContain('renderPairingBlockedByProject()');
    expect(ui).toContain('ensureSaSelfMatchesProject(identityStore, projectState)');
    expect(ui).toContain('makePairDescriptor(self)');
    expect(ui).toContain('Configura un proyecto para vincular');
    expect(ui).toContain('Nombre del proyecto');
    expect(ui).toContain("window.openProjectSetupModal?.()");
    // Fail-closed copy for the blocked pairing screen keeps a configure entrypoint.
    expect((ui.match(/data-configure-project/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('transfer home no longer exposes an independent SA self-name editor', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).not.toContain('data-rename-self');
    expect(ui).not.toContain('renderSelfNameEditor');
    expect(ui).not.toContain('data-self-name');
    expect(ui).not.toContain('data-save-self-name');
    expect(ui).toContain('resolveSaSelfPresentationName(projectState, self)');
  });

  test('linked Mini names keep remote displayName primary with local alias compatibility', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    const aliases = read('js/modules/features/p2p/P2PPeerAliasStore.js');
    expect(ui).toContain("from './P2PPeerAliasStore.js'");
    expect(ui).toContain('peerName(peer)');
    expect(ui).toContain('Nombre original:');
    expect(ui).toContain('data-rename-peer');
    expect(ui).toContain('data-peer-alias');
    expect(ui).toContain('data-save-alias');
    expect(ui).toContain('data-clear-alias');
    expect(aliases).toContain('resolveName(peer)');
  });
});

describe('Block B item 9 — Transferencias as first-class header action', () => {
  function renderHeader() {
    return Header({ companyName: 'Test', activeTab: 'attendance' });
  }

  test('header exposes Transferencias near account/sync, distinct from Exportar Backup', () => {
    const prevUser = global.window?.currentUser;
    try {
      if (global.window) global.window.currentUser = { displayName: 'Erlin Camilo', email: 'e@x.com' };
      const html = renderHeader();
      expect(html).toContain('data-header-action="open-p2p-transfer"');
      expect(html).toContain('aria-label="Mini no vinculado. Abrir Transferencias"');
      expect(html).toContain('mini-app-icon.svg');
      expect(html).toContain('header-p2p-ring');
      // Export/backup semantics stay intact and distinct.
      expect(html).toContain('data-header-action="export-data"');
      expect(html).toContain('aria-label="Exportar Backup"');
      const transferIdx = html.indexOf('data-header-action="open-p2p-transfer"');
      const exportIdx = html.indexOf('data-header-action="export-data"');
      const pillIdx = html.indexOf('openSyncCenterModal');
      expect(transferIdx).toBeGreaterThan(-1);
      expect(exportIdx).toBeGreaterThan(-1);
      expect(pillIdx).toBeGreaterThan(-1);
      expect(transferIdx).toBeLessThan(pillIdx);
    } finally {
      if (global.window) global.window.currentUser = prevUser;
    }
  });

  test('transfer action uses the real Mini SVG app icon with an accessible 44px target', () => {
    const html = renderHeader();
    const btnStart = html.indexOf('data-header-action="open-p2p-transfer"');
    const btnEnd = html.indexOf('</button>', btnStart);
    const btn = html.slice(html.lastIndexOf('<button', btnStart), btnEnd);
    expect(btn).toContain('mini-app-icon.svg');
    expect(btn).toContain('header-p2p-ring');
    expect(btn).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/u);
    expect(btn).toContain('header-p2p-indicator');
    const css = read('css/header.css');
    expect(css).toContain('.header-p2p-ring');
    expect(css).toMatch(/\.header-p2p-indicator \{[^}]*min-width:\s*48px;[^}]*min-height:\s*48px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
  });

  test('header delegation invokes the existing openP2PRosterTransfer seam', () => {
    const src = read('js/modules/ui/Header.js');
    expect(src).toContain("'open-p2p-transfer': () => window.openP2PRosterTransfer?.()");
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain('export async function openP2PRosterTransfer()');
    expect(ui).toContain('window.openP2PRosterTransfer = openP2PRosterTransfer');
  });
});

describe('Block B — no transport schema or crypto changes', () => {
  test('P2PCore/P2PPairing stay transport-only (no project identity coupling)', () => {
    for (const rel of ['js/p2p/P2PCore.js', 'js/p2p/P2PPairing.js']) {
      const src = read(rel);
      expect(src).not.toContain('getProjectSetupState');
      expect(src).not.toContain('activeProject');
      expect(src).not.toContain('resolveSaSelfPresentationName');
      expect(src).not.toContain('ensureSaSelfMatchesProject');
      expect(src).not.toContain('openProjectSetupModal');
    }
    const core = read('js/p2p/P2PCore.js');
    expect(core).toContain("TRANSFER_PROTOCOL = 'sa-mini-p2p-transfer/v1'");
    expect(core).toContain("CONTROL_PROTOCOL = 'sa-mini-p2p-control/v1'");
    expect(core).toContain("ROSTER_SCHEMA = 'sa-roster/v1'");
    expect(core).toContain('sha256Hex');
    expect(core).toContain('hmacHex');
    expect(core).toContain('pair-hello');
    const pairing = read('js/p2p/P2PPairing.js');
    expect(pairing).toContain('attachPairing');
    expect(pairing).toContain('attachTrusted');
  });

  test('SA roster UI keeps canonical roster scope/producer and validated ACK flow', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain('buildSaMiniRosterPayload');
    expect(ui).toContain("schema: 'sa-roster/v1'");
    expect(ui).toContain('waitForRosterStageAck');
    expect(ui).toContain('const scope = await getEntityScope();');
    expect(ui).toContain('const saProjectId = resolveSaMiniRosterScope(scope);');
    expect(ui).not.toContain("../projects/ProjectSetupService.js");
  });
});
