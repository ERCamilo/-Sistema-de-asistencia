const fs=require('fs'),path=require('path'),vm=require('vm');
const {Request,Response}=vm.runInThisContext('({Request,Response})');
const SCOPE='https://app.test/',VERSION='2.0.0';
function fixture({failure=null}={}) {
 const values=new Map(),listeners={},messages=[];
 let clients=[{id:'old-tab',url:SCOPE}];
 const key=value=>new URL(typeof value==='string'?value:value.url,SCOPE).href;
 const storage={
  async open(name){
   if(!values.has(name))values.set(name,new Map());const rows=values.get(name);
   return {
    match:async(req,opts={})=>{const url=key(req);const found=[...rows].find(([k])=>opts.ignoreSearch?new URL(k).pathname===new URL(url).pathname:k===url);return found?.[1].clone();},
    put:async(req,response)=>{if(failure==='disk'&&name.includes('-prepared-'))throw Error('synthetic disk full');rows.set(key(req),response.clone());},
    keys:async()=>[...rows.keys()].map(url=>new Request(url)),
    delete:async req=>rows.delete(key(req)),
    add:async req=>{const response=await network(req);if(!response.ok)throw Error('bad');rows.set(key(req),response);}
   };
  },
  keys:async()=>[...values.keys()],delete:jest.fn(async name=>values.delete(name)),
  async match(req){for(const name of values.keys()){const result=await(await storage.open(name)).match(req);if(result)return result;}}
 };
 async function network(req,init={}){
  if(init.signal?.aborted)throw Error('aborted');
  const url=new URL(key(req)),file=url.pathname;
  if(['network','late-network'].includes(failure)&&file.endsWith('/app.js'))return new Response('unavailable',{status:503});
  const body=file.endsWith('/app-release.json')?JSON.stringify({version:failure==='version'?'1.0.0':VERSION}):'fresh:'+file;
  const type=failure==='html'&&file.endsWith('/app.js')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json';
  const response=new Response(body,{headers:{'Content-Type':type}});
  if(failure==='late-network') {
   const clone=response.clone.bind(response);
   response.clone=()=>{
    const copy=clone(),read=copy.arrayBuffer.bind(copy);
    copy.arrayBuffer=async()=>{await new Promise(resolve=>setTimeout(resolve,25));return read();};
    return copy;
   };
  }
  return response;
 }
 const self={
  registration:{scope:SCOPE},location:new URL(SCOPE+'sw.js'),skipWaiting:jest.fn(async()=>{}),
  clients:{claim:async()=>{},matchAll:async()=>clients},addEventListener:(type,fn)=>listeners[type]=fn
 };
 const sandbox={self,caches:storage,fetch:network,URL,Request:class extends Request { constructor(input,init){super(typeof input==='string'?new URL(input,SCOPE):input,init);} },Response,AbortController,setTimeout,clearTimeout,console,
  importScripts(){self.SW_PRECACHE_MANIFEST=['./js/app.js','./app-release.json'];}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../sw.js'),'utf8'),sandbox);
 async function message(data,source='new-tab'){
  const replies=[],work=[];
  listeners.message({data,ports:[{postMessage:value=>{replies.push(value);messages.push(value);}}],source:{id:source},waitUntil:promise=>work.push(promise)});
  await Promise.all(work);return replies.at(-1);
 }
 return {storage,values,self,sandbox,message,messages,clients:list=>{clients=list;},
  async install(){const work=[];listeners.install({waitUntil:p=>work.push(p)});await Promise.all(work);}
 };
}
async function seed(f){
 const cache=await f.storage.open('asistencia-vOLD');
 await cache.put(SCOPE+'js/app.js',new Response('old-ui'));
 await cache.put(SCOPE+'photos/profile.jpg',new Response('profile'));
 const receipts=await f.storage.open('user-media-test');await receipts.put(SCOPE+'receipt.jpg',new Response('receipt'));
}
test('preparation keeps the active UI and media intact and does not activate',async()=>{
 const f=fixture();await seed(f);
 const ready=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'one',force:true});
 expect(ready.ok).toBe(true);
 expect(await(await(await f.storage.open('asistencia-vOLD')).match(SCOPE+'js/app.js')).text()).toBe('old-ui');
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
 expect(f.messages.some(message=>message.type==='progress')).toBe(true);
});
test.each(['network','disk','version','html'])('a %s failure retains the working shell and removes only the incomplete candidate',async failure=>{
 const f=fixture({failure});await seed(f);
 const ready=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'one',force:true});
 expect(ready.ok).toBe(false);
 expect(await(await(await f.storage.open('asistencia-vOLD')).match(SCOPE+'js/app.js')).text()).toBe('old-ui');
 expect([...f.values.keys()].some(name=>name.includes('-prepared-'))).toBe(false);
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
 expect(await(await(await f.storage.open('user-media-test')).match(SCOPE+'receipt.jpg')).text()).toBe('receipt');
});
test('activation uses the verified snapshot, pins another tab, then selectively cleans old UI while retaining photos',async()=>{
 const f=fixture();await seed(f);
 const ready=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'one',force:true});
 await f.message({type:'ACTIVATE_APP_UPDATE',version:VERSION,cacheName:ready.cacheName,previousCacheName:'asistencia-vOLD'});
 expect(f.self.skipWaiting).toHaveBeenCalledTimes(1);
 const old=await f.sandbox.getSelectedShellResponse({url:SCOPE+'js/app.js',mode:'cors'},{clientId:'old-tab'});
 const fresh=await f.sandbox.getSelectedShellResponse({url:SCOPE+'js/app.js',mode:'cors'},{clientId:'new-tab'});
 expect(await old.text()).toBe('old-ui');expect(await fresh.text()).toBe('fresh:/js/app.js');
 f.clients([{id:'old-tab',url:SCOPE},{id:'new-tab',url:SCOPE}]);
 await f.message({type:'CONFIRM_APP_UPDATE',version:VERSION});
 expect(await(await f.storage.open('asistencia-vOLD')).match(SCOPE+'js/app.js')).toBeDefined();
 f.clients([{id:'new-tab',url:SCOPE}]);await f.message({type:'CONFIRM_APP_UPDATE',version:VERSION});
 expect(await(await f.storage.open('asistencia-vOLD')).match(SCOPE+'js/app.js')).toBeUndefined();
 expect(await(await(await f.storage.open('asistencia-vOLD')).match(SCOPE+'photos/profile.jpg')).text()).toBe('profile');
 expect(await(await(await f.storage.open('user-media-test')).match(SCOPE+'receipt.jpg')).text()).toBe('receipt');
});
test('a different or incomplete prepared version cannot be activated',async()=>{
 const f=fixture();await seed(f);
 const ready=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'one',force:true});
 const result=await f.message({type:'ACTIVATE_APP_UPDATE',version:'3.0.0',cacheName:ready.cacheName});
 expect(result.ok).toBe(false);expect(f.self.skipWaiting).not.toHaveBeenCalled();
});
test('an installed complete worker reuses its download instead of refreshing the whole shell again',async()=>{
 const f=fixture();await f.install();
 const cacheName=/const CACHE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.resolve(__dirname,'../../sw.js'),'utf8'))[1];
 const reused=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'reuse',reuseInstalled:true});
 expect(reused.cacheName).toBe('asistencia-v'+cacheName);
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
});

test('an incomplete critical install is rejected without activating a partial application',async()=>{
 const f=fixture({failure:'network'});
 await expect(f.install()).rejects.toThrow('Missing application file');
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
});

test('an HTML fallback cannot be installed as a JavaScript application file',async()=>{
 const f=fixture({failure:'html'});
 await expect(f.install()).rejects.toThrow('Missing application file');
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
});

test('an in-flight body cannot emit progress after preparation has already failed',async()=>{
 const f=fixture({failure:'late-network'});await seed(f);
 const result=await f.message({type:'PREPARE_APP_UPDATE',version:VERSION,token:'late',force:true});
 expect(result.ok).toBe(false);
 await new Promise(resolve=>setTimeout(resolve,60));
 expect(f.messages.at(-1)).toMatchObject({ok:false});
 expect([...f.values.keys()].some(name=>name.includes('-prepared-'))).toBe(false);
 expect(f.self.skipWaiting).not.toHaveBeenCalled();
});
