#!/usr/bin/env node
// One-command runner. Starts only a loopback Firestore emulator, isolated demo
// project and temporary Chromium profiles. Never deploys or uses real credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(__dirname,'results/latest');
fs.mkdirSync(OUT,{recursive:true});
const args=process.argv.slice(2),mode=args.find(a=>['--all','--unit','--emulator','--browser'].includes(a))||'--all';
let emulator,emulatorLog;
const commands=[];
let activeChild,cancelled=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{cancelled=true;activeChild?.kill('SIGTERM');emulator?.kill('SIGTERM');process.exitCode=2;});
async function run(argv,env,log){
 if(cancelled)throw Error('Audit cancelled');
 const child=spawn(argv[0],argv.slice(1),{cwd:ROOT,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 activeChild=child;let expired=false;const timer=setTimeout(()=>{expired=true;child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},4000).unref();},argv.some(x=>x.endsWith('browser.cjs'))?300000:90000);
 const output=fs.createWriteStream(log);child.stdout.on('data',d=>{output.write(d);if(argv.includes('browser.cjs'))process.stdout.write(d);});child.stderr.on('data',d=>output.write(d));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 clearTimeout(timer);activeChild=null;await new Promise(resolve=>output.end(resolve));const finalCode=expired?2:code;commands.push({argv,code:finalCode,log});return finalCode;
}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function startEmulator(){
 if(cancelled)throw Error('Audit cancelled');
 const java=process.env.MULTIOBRA_JAVA||'/tmp/sa-firestore-emulator-jre/jdk-21.0.12.1+1-jre/bin/java';
 const jar=process.env.FIRESTORE_EMULATOR_JAR||path.join(os.homedir(),'.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar');
 if(!fs.existsSync(java)||!fs.existsSync(jar))throw Error('Set MULTIOBRA_JAVA and FIRESTORE_EMULATOR_JAR to Java 21 and a local Firestore emulator JAR');
 const port=await freePort();emulatorLog=fs.createWriteStream(path.join(OUT,'firestore.log'));
 emulator=spawn(java,['-jar',jar,'--host','127.0.0.1','--port',String(port),'--project_id','demo-sa-multiobra-360'],{stdio:['ignore','pipe','pipe']});
 emulator.stdout.pipe(emulatorLog,{end:false});emulator.stderr.pipe(emulatorLog,{end:false});
 const deadline=Date.now()+25000;
 while(Date.now()<deadline){if(emulator.exitCode!==null)throw Error('Firestore emulator exited before startup');try{await new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1',()=>{s.destroy();resolve();});s.on('error',reject);});return port;}catch{await new Promise(r=>setTimeout(r,100));}}
 throw Error('Firestore emulator startup timeout');
}
(async()=>{
 fs.writeFileSync(path.join(OUT,'environment.json'),JSON.stringify({startedAt:new Date().toISOString(),node:process.version,mode,base:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()},null,2));
 if(mode==='--unit'||mode==='--all')await run(['node','node_modules/jest/bin/jest.js','--runInBand','--runTestsByPath','js/tests/MultiobraCatalogAudit.test.js','js/tests/MultiobraContextAudit.test.js','js/tests/MultiobraPayrollCacheAudit.test.js','js/tests/multiobra360/Multiobra360Matrix.test.js','--json','--outputFile='+path.join(OUT,'unit.json')],{},path.join(OUT,'unit.log'));
 if(mode!=='--unit'){
  const port=await startEmulator();
  const sdk=process.env.SA_EMULATOR_NODE_MODULES||'/tmp/sa-firestore-emulator-jre/node_modules';
  if(!fs.existsSync(path.join(sdk,'firebase')))throw Error('SA_EMULATOR_NODE_MODULES must contain the Firebase web SDK');
  const env={FIRESTORE_EMULATOR_HOST:'127.0.0.1:'+port,SA_EMULATOR_NODE_MODULES:sdk,MULTIOBRA_RESULTS:OUT,MULTIOBRA_AUDIT_PROJECT:'demo-sa-multiobra-360-'+process.pid};
  if(mode==='--emulator'||mode==='--all')await run(['node','node_modules/jest/bin/jest.js','-c','jest.emulator.config.cjs','--runInBand','--runTestsByPath','js/tests/emulator/MultiobraCatalogConcurrencyAudit.emulator.test.js','--json','--outputFile='+path.join(OUT,'emulator.json')],env,path.join(OUT,'emulator.log'));
  if(mode==='--browser'||mode==='--all')await run(['node','scripts/multiobra360/browser.cjs'],env,path.join(OUT,'browser.log'));
 }
})().catch(error=>{commands.push({code:2,error:error.stack});console.error(error.message);}).finally(async()=>{
 if(emulator&&emulator.exitCode===null){emulator.kill('SIGTERM');await Promise.race([new Promise(r=>emulator.once('exit',r)),new Promise(r=>setTimeout(()=>{if(emulator.exitCode===null)emulator.kill('SIGKILL');r();},4000))]);}
 emulatorLog?.end();
 const summary={finishedAt:new Date().toISOString(),mode,commands};fs.writeFileSync(path.join(OUT,'run.json'),JSON.stringify(summary,null,2));
 console.log('Results: '+OUT);for(const c of commands)console.log('exit='+c.code+' '+(c.argv?.slice(0,3).join(' ')||c.error));
 require('node:child_process').spawnSync('node',['scripts/multiobra360/report.cjs',OUT],{cwd:ROOT,stdio:'ignore'});
 let infrastructure=0;try{infrastructure=JSON.parse(fs.readFileSync(path.join(OUT,'coverage.json'),'utf8')).totals.infrastructure;}catch{infrastructure=1;}
 process.exitCode=infrastructure||commands.some(c=>c.code===2||c.code==null)?2:commands.some(c=>c.code!==0)?1:0;
});
