#!/usr/bin/env node
'use strict';
// NFC CORS preflight checker. OPTIONS only: never sends card/employee data or POST.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const MAIN = 'https://sistema-de-asistencia.pages.dev';
const PREVIEW = 'https://test-nfc-web-reader.sistema-de-asistencia.pages.dev';
const UNTRUSTED = 'https://untrusted-nfc-cors.invalid';
const cases = [{origin:MAIN,allowed:true},{origin:PREVIEW,allowed:true},{origin:UNTRUSTED,allowed:false}];
function endpointFromSource(source=fs.readFileSync(path.join(root,'js/modules/features/nfc/NfcCore.js'),'utf8')) {
 const m=/export const NFC_ENDPOINT = '([^']+)';/.exec(source);
 if(!m) throw Error('Production NFC endpoint not found');
 const u=new URL(m[1]);
 if(u.protocol!=='https:'||u.host!=='n8n.erlin.do'||!/^\/webhook\/[a-zA-Z0-9-]+$/.test(u.pathname)||u.search||u.hash||u.username||u.password)
   throw Error('Unexpected endpoint; preflight refused');
 return u.href;
}
async function check({origin,allowed,endpoint=endpointFromSource(),fetchImpl=fetch}) {
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try {
  const r=await fetchImpl(endpoint,{method:'OPTIONS',redirect:'manual',credentials:'omit',signal:ctrl.signal,
   headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  const get=k=>(r.headers?.get(k)||'').trim();
  const acao=get('access-control-allow-origin');
  const methods=get('access-control-allow-methods').toLowerCase().split(/\s*,\s*/);
  const headers=get('access-control-allow-headers').toLowerCase().split(/\s*,\s*/);
  const problems=[];
  if(allowed){
    if(r.status<200||r.status>=300) problems.push('HTTP '+r.status);
    if(acao!==origin) problems.push('wrong Access-Control-Allow-Origin');
    if(!methods.includes('post')) problems.push('POST not allowed');
    if(!headers.includes('content-type')&&!headers.includes('*')) problems.push('content-type not allowed');
  } else if(acao===origin||acao==='*') problems.push('untrusted origin allowed');
  return {origin,expected:allowed?'allow':'deny',status:r.status,acao,ok:problems.length===0,problems,
   warning:allowed&&!get('vary').toLowerCase().split(/\s*,\s*/).includes('origin')?'Check Vary: Origin when caching dynamic responses':null};
 } catch(e){return {origin,expected:allowed?'allow':'deny',status:null,acao:null,ok:false,problems:[String(e.message||e)]};}
 finally{clearTimeout(timer);}
}
async function checkAll({endpoint=endpointFromSource(),fetchImpl=fetch,checks=cases}={}) {
 const results=[];for(const c of checks) results.push(await check({...c,endpoint,fetchImpl}));
 return {ok:results.every(x=>x.ok),results};
}
if(require.main===module){
 if(process.argv[2]!=='--live'){console.log('Run with --live to execute OPTIONS-only preflights');process.exitCode=process.argv.length>2?2:0;}
 else checkAll().then(r=>{
  for(const v of r.results){console.log((v.ok?'PASS':'FAIL')+' '+v.expected+' '+v.origin+' HTTP='+v.status+' ACAO='+(v.acao||'(none)'));
   for(const p of v.problems)console.log(' - '+p);if(v.warning)console.log(' - WARNING '+v.warning);}
  if(!r.ok)process.exitCode=1;
 }).catch(e=>{console.error(e.message);process.exitCode=1});
}
module.exports={MAIN,PREVIEW,UNTRUSTED,cases,endpointFromSource,check,checkAll};
