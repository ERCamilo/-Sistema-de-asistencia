const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const yaml=require('js-yaml');
const workflow=yaml.load(fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/multiobra-issue-acceptance.yml'),'utf8'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function fixture({issue=296,closed=false,checked=true,main='a'.repeat(40),target=main,inputs={},result='success',request='true'}={}){
 const writes=[],outputs={};const ticket={body:checked?Array(5).fill('- [x] criterio comprobado').join('\n'):'- [ ] pendiente',state:closed?'closed':'open'};
 const github={rest:{repos:{get:async()=>({data:{default_branch:'main'}}),getCommit:async({ref})=>({data:{sha:ref==='main'?main:target}})},issues:{get:async()=>({data:ticket}),update:async x=>writes.push({type:'update',...x}),createComment:async x=>writes.push({type:'comment',...x})}}};
 const core={getInput:k=>inputs[k]||'',setOutput:(k,v)=>outputs[k]=v};
 const context={repo:{owner:'owner',repo:'repo'},eventName:closed?'issues':'workflow_dispatch',payload:{issue:{number:issue}},serverUrl:'https://github.com',runId:123};
 const process={env:{ISSUE:String(issue),POINT:'R'+(issue-295),TARGET_SHA:target,TEST_RESULT:result,CLOSE_REQUESTED:request}};
 return{github,core,context,process,writes,outputs};
}
async function run(script,f){await new AsyncFunction('github','core','context','process',script)(f.github,f.core,f.context,f.process);return f;}
const prepare=workflow.jobs.prepare.steps[0].with.script,finish=workflow.jobs.report.steps[0].with.script;

test('workflow is independent of ordinary pushes and PRs',()=>{
 assert.deepEqual(Object.keys(workflow.on).sort(),['issues','workflow_dispatch']);
 assert.deepEqual(workflow.jobs.tests.permissions,{contents:'read'});
 assert.ok(workflow.jobs.tests.steps.filter(s=>s.uses?.startsWith('actions/checkout')).every(s=>s.with['persist-credentials']===false));
 assert.equal(workflow.jobs.tests.steps.some(s=>s['continue-on-error']),false);
});
test('untracked issues never mutate issues or start tests',async()=>{const f=fixture({issue:400,closed:true});await run(prepare,f);assert.equal(f.outputs.allowed,'false');assert.equal(f.writes.length,0);});
test('closure request first reopens the tracked issue before validation',async()=>{const f=fixture({closed:true});await run(prepare,f);assert.equal(f.writes[0].state,'open');assert.equal(f.outputs.close_requested,'true');assert.equal(f.outputs.target_sha,'a'.repeat(40));});
test('manual branch validation resolves immutable target with no issue mutation',async()=>{const f=fixture({target:'b'.repeat(40),inputs:{issue:'296',target_ref:'fix-branch',close_if_passed:'false'}});await run(prepare,f);assert.equal(f.outputs.target_sha,'b'.repeat(40));assert.equal(f.outputs.pack_sha,'a'.repeat(40));assert.equal(f.outputs.close_requested,'false');assert.equal(f.writes.length,0);});
test('all-green evidence, completed criteria and current main allow closure',async()=>{const f=fixture();await run(finish,f);assert.equal(f.writes.at(-1).state,'closed');assert.equal(f.writes.at(-1).state_reason,'completed');});
for(const [name,settings] of [
 ['failed tests',{result:'failure'}],['cancelled tests',{result:'cancelled'}],['skipped test job',{result:'skipped'}],
 ['incomplete checklist',{checked:false}],['different or advanced main',{target:'b'.repeat(40)}],['consultation-only request',{request:'false'}]
])test('cannot close: '+name,async()=>{const f=fixture(settings);await run(finish,f);assert.equal(f.writes.some(w=>w.type==='update'&&w.state==='closed'),false);});
test('failed closure is reopened rather than declared resolved',async()=>{const f=fixture({closed:true,result:'failure'});await run(finish,f);assert.equal(f.writes.at(-1).state,'open');});
test('test job executes trusted pack copied over application checkout',()=>{
 const checkouts=workflow.jobs.tests.steps.filter(s=>s.uses?.startsWith('actions/checkout'));
 assert.equal(checkouts[0].with.ref,workflow.jobs.prepare.outputs.pack_sha.replace('steps.scope','needs.prepare'));
 assert.equal(workflow.jobs.report.steps.some(s=>s.uses?.startsWith('actions/checkout')),false);
});
