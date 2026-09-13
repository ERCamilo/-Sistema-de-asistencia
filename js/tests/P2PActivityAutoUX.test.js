import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('P2P activity center + automatic trusted transfer', () => {
  test('SA header shows Mini app icon with circular state ring and numeric review badge', () => {
    const header = read('js/modules/ui/Header.js');
    const css = read('css/header.css');
    expect(header).toContain('mini-app-icon.svg');
    expect(header).toContain('data-p2p-state="unlinked"');
    expect(header).toContain('data-p2p-header-badge');
    expect(css).toContain('.header-p2p-ring');
    expect(css).toContain('[data-p2p-state="connected"]');
    expect(css).toContain('.header-p2p-notification-badge');
    expect(css).toMatch(/\.header-p2p-app-icon[^}]*border-radius:\s*50%/);
    expect(css).toMatch(/\.header-p2p-app-icon[^}]*clip-path:\s*circle\(50%\)/);
  });

  test('trusted roster send starts once after authentication without requiring Mini wait screen', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain('let autoSendStarted = false');
    expect(ui).toContain('if (autoSendStarted) return');
    expect(ui).toContain('onAuthenticated: () => { scheduleSaP2PHeaderRefresh(); triggerAutoSend(channel); }');
    expect(ui).not.toContain('En Mini abre Transferencias');
    expect(ui).not.toContain('data-trusted-send');
  });

  test('activity metadata remains local but passive logs do not occupy the connection home', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    const activity = read('js/modules/features/p2p/P2PActivityStore.js');
    const home = ui.slice(ui.indexOf('async function renderHome()'), ui.indexOf('async function renderPeerAliasEditor'));
    expect(home).not.toContain('buildActivitySectionMarkup');
    expect(home).not.toContain('wireActivityDetails');
    expect(ui).toContain('p2pActivityStore');
    expect(activity).not.toMatch(/Firebase|fetch\(|XMLHttpRequest|WebSocket|RTCPeerConnection/);
    expect(activity).toContain('localStorage');
    expect(ui).toContain('Mini todavía debe revisarlo y confirmar la importación.');
  });
});
