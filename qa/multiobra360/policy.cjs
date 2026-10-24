'use strict';
function evaluate(manifest,{point='all',mode,environment,unit,emulator,browser}){
 const reasons=[],expected=manifest[point]?.expected;
 if(!expected)return{eligible:false,reasons:['unknown point']};
 if(mode!=='--all')reasons.push('closure requires all relevant layers, not a partial run');
 if(!/^[a-f0-9]{40}$/.test(environment?.base||''))reasons.push('missing immutable application commit');
 const checkJest=(name,data,count)=>{
  if(count===0)return;
  const raw=data?.testResults?.flatMap(s=>s.assertionResults||[])||[];
  const names=name==='unit'?manifest[point].unitNames:null;
  const expectedNames=names?new Set(names):null;
  const tests=expectedNames?raw.filter(t=>expectedNames.has(t.fullName)):raw;
  if(!data||tests.length!==count||(expectedNames&&new Set(tests.map(t=>t.fullName)).size!==expectedNames.size))reasons.push(name+': missing/unexpected selected tests');
  // Jest represents name-filtered, unrelated tests as pending. Only the fixed
  // selected names are mandatory; a skipped selected test still blocks closure.
  if(data?.numPassedTests!==count||data?.numFailedTests!==0||(data?.numRuntimeErrorTestSuites||0)!==0||tests.some(t=>t.status!=='passed'))reasons.push(name+': failed, skipped or incomplete selected tests');
 };
 checkJest('unit',unit,expected.unit);checkJest('emulator',emulator,expected.emulator);
 const records=browser?.records||[],ids=manifest[point].browserIds;
 const expectedPairs=new Set(ids.flatMap(id=>[id+'@390',id+'@1280']));
 const actualPairs=new Set(records.map(r=>r.id+'@'+r.width));
 if(!browser||records.length!==expected.browser||actualPairs.size!==expectedPairs.size||[...expectedPairs].some(p=>!actualPairs.has(p)))reasons.push('browser: missing scenarios or mobile/desktop coverage');
 if(browser?.summary?.passed!==expected.browser||browser?.summary?.failed!==0||browser?.summary?.infrastructure!==0||browser?.startupErrors?.length||records.some(r=>r.ok!==true||r.invariantOk!==true))reasons.push('browser: failed, incomplete or integrity not verified');
 return{schemaVersion:1,point,issue:manifest[point].issue||null,applicationSha:environment?.base||null,eligible:reasons.length===0,reasons,expected};
}
module.exports={evaluate};
