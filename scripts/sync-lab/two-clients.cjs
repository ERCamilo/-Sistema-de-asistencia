/** Synthetic integration test. Never opens the app or a real browser profile. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../..');
const origin = 'http://127.0.0.1:9185';
const project = 'demo-sa-sync-lab';
const blocked = [];
const results = [];
const runId = Date.now().toString(36);
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<title>SA isolated sync laboratory</title>'); }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
        let body = fs.readFileSync(file, 'utf8');
        if (pathname === '/js/modules/data/firebase.js') {
            body = body.replace('getFirestore, doc,', 'connectFirestoreEmulator, disableNetwork, enableNetwork, getDocFromServer, getFirestore, doc,')
                .replace('getAuth, GoogleAuthProvider,', 'connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, getAuth, GoogleAuthProvider,')
                .replace("import { firebaseConfig } from '../config/Config.js';", `const firebaseConfig = { apiKey: 'fake-lab-key', projectId: '${project}', authDomain: '${project}.invalid', storageBucket: '${project}.invalid' };`)
                .replace('const auth = getAuth(app);', "connectFirestoreEmulator(db, '127.0.0.1', 9180);\nconst auth = getAuth(app);\nconnectAuthEmulator(auth, 'http://127.0.0.1:9199', {disableWarnings: true});")
                + '\nexport { createUserWithEmailAndPassword, signInWithEmailAndPassword, disableNetwork, enableNetwork, getDocFromServer };\n';
        }
        if (pathname === '/js/modules/services/EmployeeRepository.js') {
            // Test-only scheduling barrier: pause after each client's first read.
            body = body.replace(/const snap = await (getDoc\(ref\)|transaction.get\(ref\));/g,
                '$&\nif (globalThis.labAfterRead) await globalThis.labAfterRead();');
        }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/plain');
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(resolve => server.listen(9185, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    try {
        async function client() {
            const context = await browser.createBrowserContext();
            const page = await context.newPage();
            await page.setRequestInterception(true);
            page.on('request', req => {
                const url = new URL(req.url());
                const local = url.hostname === '127.0.0.1' && ['9180','9185','9199'].includes(url.port);
                const sdk = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/10.8.0/') && req.method() === 'GET';
                if (local || sdk) req.continue(); else { blocked.push(url.origin + url.pathname); req.abort(); }
            });
            await page.goto(origin);
            await page.evaluate(async () => {
                window.f = await import('/js/modules/data/firebase.js');
                if (f.app.options.projectId !== 'demo-sa-sync-lab') throw new Error('Unsafe project');
                window.repo = (await import('/js/modules/services/EmployeeRepository.js')).EmployeeRepository;
                window.cash = (await import('/js/modules/services/PettyCashRepository.js')).PettyCashRepository;
            });
            return page;
        }
        const A = await client(), B = await client(), stranger = await client();
        const credentials = {email:`lab-${runId}@example.invalid`,password:'Synthetic-only-12345'};
        const uid = await A.evaluate(async c => (await f.createUserWithEmailAndPassword(f.auth,c.email,c.password)).user.uid, credentials);
        assert.equal(await B.evaluate(async c => (await f.signInWithEmailAndPassword(f.auth,c.email,c.password)).user.uid, credentials),uid);
        await stranger.evaluate(async c => f.createUserWithEmailAndPassword(f.auth,'other-'+c.email,c.password).then(()=>null),credentials);
        const employee = {id:'employee',name:'Empleado ficticio',projectId:'lab-work',updatedAt:100,loans:[{id:'loan',amount:1000,updatedAt:100,payments:[{id:'p1',amount:100,date:'2026-09-01',updatedAt:100}]}]};
        await A.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),employee);
        const denied = await stranger.evaluate(async uid=>{try {await f.getDocFromServer(f.doc(f.db,'users',uid,'employees','employee'));return false;}catch(e){return e.code==='permission-denied';}},uid);
        assert.equal(denied,true);results.push({case:'other account cannot read employee',pass:true});
        const writeDenied = await stranger.evaluate(async uid=>{try {await f.setDoc(f.doc(f.db,'users',uid,'employees','employee'),{name:'forbidden'},{merge:true});return false;}catch(e){return e.code==='permission-denied';}},uid);
        assert.equal(writeDenied,true);results.push({case:'other account cannot write employee',pass:true});
        await B.evaluate(async()=>{window.oldEmployee=(await repo.loadAll())[0];await f.disableNetwork(f.db);});
        const updated = structuredClone(employee);updated.updatedAt=200;updated.loans[0].updatedAt=200;updated.loans[0].payments.push({id:'p2',amount:100,date:'2026-09-02',updatedAt:200});
        await A.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),updated);
        await B.evaluate(async()=>{await f.enableNetwork(f.db);await repo.saveOne(oldEmployee,{mergeRemote:true});});
        const saved = await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'employees','employee'))).data());
        results.push({case:'stale employee preserves both payments',pass:saved.loans[0].payments.length===2,paid:saved.loans[0].payments.reduce((n,p)=>n+p.amount,0)});
        const movement={id:'movement',projectId:'cash',periodId:'period',amount:200,updatedAt:100};
        await A.evaluate(m=>cash.movements.saveOne(m),movement);
        await B.evaluate(async()=>{window.oldMovement=(await cash.movements.loadAll())[0];await f.disableNetwork(f.db);});
        await A.evaluate(m=>cash.movements.saveOne({...m,amount:300,updatedAt:200}),movement);
        const staleRejected=await B.evaluate(async()=>{await f.enableNetwork(f.db);try {await cash.movements.saveOne(oldMovement);return false;}catch(e){return e.code==='failed-precondition';}});
        results.push({case:'stale cash write reports conflict',pass:staleRejected});
        const finalCash=await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'pettyCash','movement'))).data());
        results.push({case:'stale cash write preserves newer amount',pass:finalCash.amount===300,expected:300,actual:finalCash.amount});
        const retained = await B.evaluate(async()=>{
            const {default:local}=await import('/js/modules/services/IndexedDBService.js');
            const {PettyCashStore}=await import('/js/modules/features/pettycash/PettyCashStore.js');
            await local.init();
            await local.update('pettyCashOutbox',{key:999,op:'save',col:'movements',id:'movement',data:oldMovement,ts:100,status:'pending'});
            await PettyCashStore.flush();
            const entries=await local.getAll('pettyCashOutbox');
            return entries.some(e=>e.id==='movement' && e.data.amount===200 && e.lastError);
        });
        results.push({case:'conflicting local cash change remains in outbox',pass:retained});
        await A.evaluate(async()=>{
            const {setProjectsEnabled}=await import('/js/modules/config/FeatureFlags.js');setProjectsEnabled(true);
            window.service=(await import('/js/modules/services/FirebaseService.js')).default;
            await service.saveDailyAttendance('2026-09-01',{'employee-2026-09-01':{employeeId:'employee',projectId:'lab-work',hoursWorked:10,updatedAt:200}}, {scope:{enabled:true,projectId:'lab-work',defaultProjectId:'lab-work'}});
        });
        await B.evaluate(async()=>{
            const {setProjectsEnabled}=await import('/js/modules/config/FeatureFlags.js');setProjectsEnabled(true);
            const service=(await import('/js/modules/services/FirebaseService.js')).default;
            await service.saveDailyAttendance('2026-09-01',{'employee-2026-09-01':{employeeId:'employee',projectId:'lab-work',hoursWorked:8,updatedAt:100}}, {scope:{enabled:true,projectId:'lab-work',defaultProjectId:'lab-work'}});
        });
        const hours=await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'attendance','2026-09-01'))).data().records['employee-2026-09-01'].hoursWorked);
        results.push({case:'stale attendance preserves 10 hours',pass:hours===10,actual:hours});
        const raceBase={...employee,id:'race-employee',loans:[{id:'race-loan',amount:1000,updatedAt:100,payments:[]}]};
        await A.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),raceBase);
        let arrivals=0, release;
        const barrier=new Promise(resolve=>{release=resolve;});
        let timer;
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Both clients did not reach the read barrier')),15000);});
        for (const page of [A,B]) {
            await page.exposeFunction('labBarrier',async()=>{arrivals++;if(arrivals===2)release();await Promise.race([barrier,deadline]);});
            await page.evaluate(()=>{window.labAfterRead=async()=>{window.labAfterRead=null;await window.labBarrier();};});
        }
        const edits=[200,300].map((amount,index)=>{
            const e=structuredClone(raceBase);e.updatedAt=200+index;e.loans[0].updatedAt=e.updatedAt;
            e.loans[0].payments=[{id:'concurrent-'+index,amount,updatedAt:e.updatedAt}];return e;
        });
        try {await Promise.all([A.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),edits[0]),B.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),edits[1])]);}
        finally {clearTimeout(timer);}
        const raced=await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'employees','race-employee'))).data());
        results.push({case:'simultaneous payments survive on the same employee',pass:raced.loans[0].payments.length===2,expectedPaid:500,actualPaid:raced.loans[0].payments.reduce((n,p)=>n+p.amount,0)});
        await A.evaluate(()=>repo.tombstoneOne('employee',500));
        await B.evaluate(e=>repo.saveOne(e,{mergeRemote:true}),employee);
        const deleted=await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'employees','employee'))).data());
        results.push({case:'stale client cannot resurrect a deleted employee',pass:deleted.deletedAt===500 && deleted.active===false});
        results.push({case:'soft deletion preserves loan payments for recovery',pass:deleted.loans[0].payments.length===2});
        await A.evaluate(e=>repo.saveOne({...e,active:true,updatedAt:600},{mergeRemote:true}),saved);
        const restored=await B.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'employees','employee'))).data());
        results.push({case:'newer recovery clears deletion marker and preserves payments',pass:!Number.isFinite(restored.deletedAt) && restored.active===true && restored.loans[0].payments.length===2});
        let deletionRejected=false;
        try {await B.evaluate(()=>repo.tombstoneOne('employee',500));} catch {deletionRejected=true;}
        const afterOldDelete=await A.evaluate(async()=> (await f.getDocFromServer(f.doc(f.db,'users',f.auth.currentUser.uid,'employees','employee'))).data());
        results.push({case:'stale deletion cannot hide a newer recovered employee',pass:deletionRejected && !Number.isFinite(afterOldDelete.deletedAt) && afterOldDelete.active===true});
        assert.deepEqual(blocked,[]);
        console.log(JSON.stringify({project,synthetic:true,productionRequests:0,results},null,2));
        if (results.some(result=>!result.pass)) process.exitCode=1;
    } finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
