const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname,'../..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');

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
});

test('SA exposes DIRECTO in export menu and service worker precaches P2P runtime',()=>{
  const menu=read('js/modules/features/export/ExportMenu.js');
  const sw=read('sw.js');
  expect(menu).toContain('openP2PRosterTransfer');
  expect(menu).toContain('DIRECTO');
  for(const asset of ['./js/vendor/qrcode.js','./js/p2p/P2PCore.js','./js/p2p/P2PPairing.js','./js/modules/features/p2p/P2PRosterUI.js']) expect(sw).toContain(asset);
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
