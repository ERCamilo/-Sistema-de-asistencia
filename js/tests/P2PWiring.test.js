const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname,'../..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
const { ExportMenu } = require('../modules/features/export/ExportMenu.js');
const { renderQr, sortPeersByRecentActivity } = require('../modules/features/p2p/P2PRosterUI.js');
const { state } = require('../modules/core/AppState.js');
const { setProjectsEnabled } = require('../modules/config/FeatureFlags.js');

function renderExportMenu(projectsEnabled, showShareOptions = true) {
  setProjectsEnabled(projectsEnabled);
  state.showExportMenu = true;
  state.showShareOptions = showShareOptions;
  state.exportMenuData = { filename: 'export.json' };
  return ExportMenu();
}

afterEach(() => {
  state.showExportMenu = false;
  state.showShareOptions = false;
  state.exportMenuData = {};
  setProjectsEnabled(false);
});

test('SA loads P2P classic dependencies before boot-loader and keeps boot-loader adjacent to app module',()=>{
  const html=read('index.html');
  const qr=html.indexOf('js/vendor/qrcode.js');
  const core=html.indexOf('js/p2p/P2PCore.js');
  const pairing=html.indexOf('js/p2p/P2PPairing.js');
  const boot=html.indexOf('js/boot-loader.js');
  const app=html.indexOf('type="module" src="js/app.js"');
  expect(qr).toBeGreaterThan(0); expect(qr).toBeLessThan(core); expect(core).toBeLessThan(pairing); expect(pairing).toBeLessThan(boot); expect(boot).toBeLessThan(app);
  expect(html).toMatch(/<script src="js\/boot-loader\.js"><\/script>\s*<script type="module" src="js\/app\.js"><\/script>/);
});

test('SA P2P roster uses canonical producer, salary opt-in and validated receiver ACK',()=>{
  const ui=read('js/modules/features/p2p/P2PRosterUI.js');
  expect(ui).toContain('buildSaMiniRosterPayload');
  expect(ui).toContain("schema: 'sa-roster/v1'");
  expect(ui).toContain('waitForRosterStageAck');
  expect(ui).toContain("'roster-staged'");
  expect(ui).toContain("'roster-rejected'");
  expect(ui).toContain('data-salary');
  expect(ui).not.toContain('includeSalary: true');
  expect(ui).toContain('const scope = await getEntityScope();');
  expect(ui).toContain('const saProjectId = resolveSaMiniRosterScope(scope);');
});

test('direct transfer is first-level, Projects-independent, and not duplicated in MINI v1',()=>{
  const off = renderExportMenu(false);
  const on = renderExportMenu(true);
  const directAction = 'data-app-fn="openP2PRosterTransfer"';

  for (const menu of [off, on]) {
    expect(menu).toContain('Transferencias directas');
    expect(menu).toContain('QR/código');
    expect(menu).toContain('Mini');
    expect((menu.match(new RegExp(directAction, 'g')) || []).length).toBe(1);
    expect(menu).not.toContain('DIRECTO');
  }

  const firstLevel = document.createElement('div');
  firstLevel.innerHTML = off;
  const directButton = firstLevel.querySelector(`[${directAction}]`);
  expect(directButton).not.toBeNull();
  expect(directButton.parentElement.parentElement.classList.contains('export-menu')).toBe(true);

  expect(off).not.toContain('data-app-fn="shareExportMiniV1"');
  expect(off).not.toContain('data-app-fn="toggleMiniV1Salary"');
  expect(on).toContain('data-app-fn="shareExportMiniV1"');
  expect(on).toContain('data-app-fn="toggleMiniV1Salary"');
});

test('SA exposes direct transfer and service worker precaches P2P runtime',()=>{
  const menu=read('js/modules/features/export/ExportMenu.js');
  const sw=read('sw.js');
  expect(menu).toContain('openP2PRosterTransfer');
  expect(menu).toContain('Transferencias directas');
  expect(menu).toContain('QR/código');
  for(const asset of ['./js/vendor/qrcode.js','./js/p2p/P2PCore.js','./js/p2p/P2PPairing.js','./js/modules/features/p2p/P2PPeerAliasStore.js','./js/modules/features/p2p/P2PRosterUI.js']) expect(sw).toContain(asset);
});


test('peer aliases are local presentation metadata with rename/clear/unlink wiring',()=>{
  const ui=read('js/modules/features/p2p/P2PRosterUI.js');
  const aliases=read('js/modules/features/p2p/P2PPeerAliasStore.js');
  expect(ui).toContain("from './P2PPeerAliasStore.js'");
  expect(ui).toContain('data-rename-peer');
  expect(ui).toContain('data-peer-alias');
  expect(ui).toContain('data-save-alias');
  expect(ui).toContain('data-clear-alias');
  expect(ui).toContain('aliasStore.removeAlias(peerId)');
  expect(ui).toContain('peerName(peer)');
  expect(ui).toContain('Nombre original:');
  expect(ui).toContain('se guarda sólo en este SA');
  expect(aliases).toContain("const DEFAULT_STORAGE_KEY = 'sa_p2p_peer_aliases_v1'");
  expect(aliases).toContain('parsed.entries');
  expect(aliases).toContain('const entries = Array.from(aliases');
  expect(aliases).not.toContain('linkToken');
  expect(aliases).not.toContain('HMAC');
  expect(aliases).not.toContain('Firebase');
});

test('linked peer identity UX uses recent activity ordering and editable self name',()=>{
  const ordered = sortPeersByRecentActivity([
    { peerId: 'old', linkedAt: '2026-09-07T10:00:00Z', lastSeenAt: '2026-09-07T11:00:00Z' },
    { peerId: 'fallback', linkedAt: '2026-09-07T13:00:00Z' },
    { peerId: 'new', linkedAt: '2026-09-07T09:00:00Z', lastSeenAt: '2026-09-07T14:00:00Z' }
  ]);
  expect(ordered.map(peer => peer.peerId)).toEqual(['new', 'fallback', 'old']);

  const ui=read('js/modules/features/p2p/P2PRosterUI.js');
  expect(ui).toContain('Última conexión:');
  expect(ui).toContain('peer.lastSeenAt || peer.linkedAt');
  expect(ui).toContain('data-rename-self');
  expect(ui).toContain('Nombre de este SA');
  expect(ui).toContain('identityStore.renameSelf(nextName)');
  expect(ui).toContain('futuros emparejamientos');
  expect(ui).not.toContain('En línea');
});

test('pairing keeps QR vendor/path plus six-digit code and key wiring',()=>{
  const html=read('index.html');
  const ui=read('js/modules/features/p2p/P2PRosterUI.js');
  expect(html).toContain('js/vendor/qrcode.js');
  expect(ui).toContain('const MINI_PAIR_BASE_URL');
  expect(ui).toContain('window.qrcode');
  expect(ui).toContain('buildPairUrl(descriptor, MINI_PAIR_BASE_URL)');
  expect(ui).toContain('renderQr(pairUrl)');
  expect(ui).toContain('Código de 6 dígitos');
  expect(ui).toContain('descriptor.code.slice(0,3)');
  expect(ui).toContain('descriptor.key');
  expect(ui).toContain('data-new-pair');
  expect(ui).toContain('QR de vinculación');
});

test('pairing QR markup uses a data image with responsive dimensions and useful alt text',()=>{
  const previous = window.qrcode;
  window.qrcode = () => ({
    addData: jest.fn(),
    make: jest.fn(),
    createDataURL: jest.fn(() => 'data:image/gif;base64,AA==')
  });
  try {
    const markup = renderQr('https://miniasist.erlin.do/#pair');
    expect(markup).toContain('src="data:image/gif;base64,AA=="');
    expect(markup).toContain('width="240"');
    expect(markup).toContain('height="240"');
    expect(markup).toContain('alt="Código QR de vinculación SA con Mini"');
    expect(markup).toContain('max-width:100%');
    expect(markup).not.toContain('createSvgTag');
  } finally {
    window.qrcode = previous;
  }
});

test('precache cubre el cierre estatico de dependencias del roster P2P',()=>{
  const sw=read('sw.js');
  const shell=new Set([...sw.matchAll(/['"](\.\/[^'"]+\.js)['"]/g)].map(match=>match[1]));
  const queue=['js/modules/features/p2p/P2PRosterUI.js'];
  const visited=new Set();
  const missing=[];
  while(queue.length){
    const rel=queue.shift();
    if(visited.has(rel)) continue;
    visited.add(rel);
    if(!shell.has('./'+rel)) missing.push(rel);
    const source=read(rel);
    for(const match of source.matchAll(/\bfrom\s+['"]([^'"]+\.js)['"]/g)){
      if(!match[1].startsWith('.')) continue;
      const dep=path.normalize(path.join(path.dirname(rel),match[1])).replaceAll(path.sep,'/');
      if(!visited.has(dep)) queue.push(dep);
    }
  }
  expect(missing).toEqual([]);
});

test('the vendored QR dependency has a documented, verified pin',()=>{
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'js/vendor/qrcode.js'))).digest('hex');
  const notice=read('THIRD_PARTY_NOTICES.md');
  expect(digest).toBe('18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780');
  expect(notice).toContain('js/vendor/qrcode.js');
  expect(notice).toContain('Kazuhiko Arase');
  expect(notice).toContain('MIT License');
  expect(notice).toContain(digest);
});
