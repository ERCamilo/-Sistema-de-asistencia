const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname,'../..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
const { ExportMenu } = require('../modules/features/export/ExportMenu.js');
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
  for(const asset of ['./js/vendor/qrcode.js','./js/p2p/P2PCore.js','./js/p2p/P2PPairing.js','./js/modules/features/p2p/P2PRosterUI.js']) expect(sw).toContain(asset);
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
