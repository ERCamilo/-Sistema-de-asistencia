#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const dir=process.argv[2]||path.join(__dirname,'results/latest');
const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{return null;}};
const run=read('run.json'),env=read('environment.json'),unit=read('unit.json'),emulator=read('emulator.json'),browser=read('browser.json');
const lanes={};
const enabled=name=>run?.mode==='--all'||run?.mode==='--'+name;
for(const [name,data] of [['unit',unit],['emulator',emulator]]){
 if(enabled(name)&&data){
  const tests=data.testResults?.flatMap(s=>s.assertionResults)||[];
  const infra=tests.filter(t=>t.status==='failed'&&(t.failureMessages||[]).some(m=>!/expect\(|Expected|toMatch|toBe|toHave/.test(m))).length+(data.numRuntimeErrorTestSuites||0);
  lanes[name]={total:data.numTotalTests,passed:data.numPassedTests,failed:Math.max(0,data.numFailedTests-infra),infrastructure:infra};
 }
}
if(enabled('browser')&&browser)lanes.browser=browser.summary;
const rows=[];
for(let i=1;i<=7;i++){
 const point='R'+i;
 const local=((enabled('unit')?unit?.testResults:[])||[]).flatMap(s=>s.assertionResults||[]).filter(t=>new RegExp('\\b'+point+'\\b').test(t.fullName));
 const ui=((enabled('browser')?browser?.records:[])||[]).filter(t=>t.point===point);
 rows.push({point,local:local.length,localFailed:local.filter(t=>t.status==='failed').length,browser:ui.length,browserFailed:ui.filter(t=>!t.ok).length,emulator:point==='R7'&&enabled('emulator')?emulator?.numTotalTests||0:0});
}
const totals=Object.values(lanes).reduce((a,x)=>({total:a.total+x.total,passed:a.passed+x.passed,failed:a.failed+x.failed,infrastructure:a.infrastructure+(x.infrastructure||0)}),{total:0,passed:0,failed:0,infrastructure:0});
const result={schemaVersion:1,environment:env,mode:run?.mode,lanes,totals,points:rows,limitations:['Browser E2E starts at production components in a dedicated harness, not at index.html boot.','External account identity is synthetic; Firestore SDK, rules and browser IndexedDB are real.','No coverage claim for production OAuth, deployed Firebase rules, service worker, Supabase, photos or real user backups.'],invariantFailures:(browser?.records||[]).filter(r=>r.invariantOk===false)};
fs.writeFileSync(path.join(dir,'coverage.json'),JSON.stringify(result,null,2));
const md=['# Multiobra 360: resultado local','',new Date().toISOString(),'','| Capa | Total | Pasa | Falla | Infraestructura |','| --- | ---: | ---: | ---: | ---: |',...Object.entries(lanes).map(([name,x])=>'| '+name+' | '+x.total+' | '+x.passed+' | '+x.failed+' | '+(x.infrastructure||0)+' |'),'','Totales: '+JSON.stringify(totals),'','## Por punto','',...rows.map(r=>'- '+r.point+': '+r.local+' pruebas locales, '+r.browser+' recorridos de navegador, '+r.emulator+' comprobaciones de emulador.'),'','Los controles generales sin ID no se suman a las filas por punto, pero sí al total.','','## Límites','',...result.limitations.map(x=>'- '+x),'','Los fallos son expectativas del comportamiento correcto. No usar test.failing ni omitirlos para obtener verde.',''];
fs.writeFileSync(path.join(dir,'summary.md'),md.join('\n'));console.log(JSON.stringify(result,null,2));
