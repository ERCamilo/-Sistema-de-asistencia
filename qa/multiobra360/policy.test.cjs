const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('./policy.cjs'),manifest=require('./issues.json');
function green(point='R1'){
 const {expected,browserIds}=manifest[point];
 const jest=(count,names)=>({numTotalTests:count,numPassedTests:count,numFailedTests:0,numPendingTests:0,numTodoTests:0,numRuntimeErrorTestSuites:0,testResults:[{assertionResults:Array.from({length:count},(_,i)=>({status:'passed',fullName:names?.[i]}))}]});
 return{point,mode:'--all',environment:{base:'a'.repeat(40)},unit:jest(expected.unit,manifest[point].unitNames),emulator:jest(expected.emulator),browser:{summary:{total:expected.browser,passed:expected.browser,failed:0,infrastructure:0},startupErrors:[],records:browserIds.flatMap(id=>[390,1280].map(width=>({id,width,ok:true,invariantOk:true})))}};
}
for(const point of Object.keys(manifest))test('green complete evidence qualifies '+point,()=>assert.equal(evaluate(manifest,green(point)).eligible,true));
const bad=[
 ['assertion failure',x=>x.unit.testResults[0].assertionResults[0].status='failed'],
 ['skipped test',x=>{x.unit.numPendingTests=1;x.unit.testResults[0].assertionResults[0].status='pending';}],
 ['todo test',x=>{x.unit.numTodoTests=1;x.unit.testResults[0].assertionResults[0].status='todo';}],
 ['empty unit evidence',x=>x.unit=null],
 ['missing scenario',x=>x.browser.records.pop()],
 ['duplicate scenario',x=>x.browser.records[0]={...x.browser.records[1]}],
 ['missing desktop',x=>x.browser.records.forEach(r=>r.width=390)],
 ['browser infrastructure failure',x=>x.browser.summary.infrastructure=1],
 ['missing integrity assertion',x=>delete x.browser.records[0].invariantOk],
 ['changed financial data',x=>x.browser.records[0].invariantOk=false],
 ['missing immutable SHA',x=>x.environment.base='main'],
 ['partial mode',x=>x.mode='--unit']
];
for(const [name,mutate] of bad)test('closure rejected: '+name,()=>{const x=green();mutate(x);assert.equal(evaluate(manifest,x).eligible,false);});
test('R7 requires Firestore emulator evidence',()=>{const x=green('R7');x.emulator=null;assert.equal(evaluate(manifest,x).eligible,false);});
test('untracked point rejected',()=>assert.equal(evaluate(manifest,{point:'R9'}).eligible,false));

test('unrelated name-filtered pending tests do not block this issue',()=>{const x=green('R1');x.unit.numPendingTests=1;x.unit.numTotalTests++;x.unit.testResults[0].assertionResults.push({fullName:'R9 unrelated',status:'pending'});assert.equal(evaluate(manifest,x).eligible,true);});
test('substituting another test for a selected case blocks closure',()=>{const x=green('R1');x.unit.testResults[0].assertionResults[0].fullName='unrelated passing replacement';assert.equal(evaluate(manifest,x).eligible,false);});
