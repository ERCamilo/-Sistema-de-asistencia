import { attachEmployeeIntakeChannel, requestMiniEmployees } from '../modules/features/p2p/MiniEmployeeIntakeBridge.js';
import { proposalContract } from '../modules/features/p2p/MiniEmployeeIntake.js';
const {webcrypto}=require('node:crypto'),{TextEncoder,TextDecoder}=require('node:util');
global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;
Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
const Core=require('../p2p/P2PCore.js');
class Channel {constructor(){this.readyState='open';this.bufferedAmount=0;this.listeners=new Map();this.frames=[];}addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(f);}removeEventListener(t,f){this.listeners.get(t)?.delete(f);}send(data){this.frames.push(data);queueMicrotask(()=>this.peer?.listeners.get('message')?.forEach(f=>f({data})));}close(){this.readyState='closed';this.listeners.get('close')?.forEach(f=>f({}));}}
const tick=()=>new Promise(r=>setTimeout(r,0));
const scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};
let sa,mini,detach;
beforeEach(()=>{sa=new Channel();mini=new Channel();sa.peer=mini;mini.peer=sa;Core.markChannelAuthenticated(sa);Core.markChannelAuthenticated(mini);});
afterEach(()=>detach?.());
test('chunks reales validados se guardan antes de confirmar la recepción',async()=>{
 let persist;const stage=jest.fn(()=>new Promise(r=>persist=r));
 detach=attachEmployeeIntakeChannel(sa,{peerId:'mini-test',peerApp:'mini',displayName:'Mini'},{core:Core,store:{stage},resolveScope:async()=>scope});
 mini.addEventListener('message',async({data})=>{if(typeof data!=='string')return;const r=JSON.parse(data);if(r.schema!=='mini-roster-request/v1')return;
   const payload=proposalContract.createProposal([{id:'local-1',number:'1',name:'Ana',position:'Ayudante',sueldo:'1500'}],{proposalId:'p-1',requestId:r.requestId,saProjectId:r.saProjectId,generatedAt:'2026-10-14T12:00:00.000Z'});
   await Core.sendPayload(mini,{kind:'roster',schema:payload.schema,text:JSON.stringify(payload)});
 });
 mini.send(JSON.stringify({schema:'mini-roster-ready/v1'}));await tick();
 const request=requestMiniEmployees('mini-test',{scope,timeoutMs:2000});
 for(let i=0;i<20&&!persist;i++)await tick();
 expect(stage).toHaveBeenCalledTimes(1);expect(sa.frames.some(f=>typeof f==='string'&&JSON.parse(f).schema==='mini-roster-staged/v1')).toBe(false);
 persist({id:'entry-1',payload:stage.mock.calls[0][0],status:'pending'});
 expect((await request).status).toBe('pending');
 expect(sa.frames.some(f=>typeof f==='string'&&JSON.parse(f).schema==='mini-roster-staged/v1')).toBe(true);
});
test('transferencia sin solicitud no escribe y cierre rechaza la solicitud pendiente',async()=>{
 const stage=jest.fn();detach=attachEmployeeIntakeChannel(sa,{peerId:'mini-test',peerApp:'mini'},{core:Core,store:{stage},resolveScope:async()=>scope});
 await Core.sendPayload(mini,{kind:'roster',schema:'mini-roster-proposal/v1',text:'{}'});await tick();expect(stage).not.toHaveBeenCalled();
 mini.send(JSON.stringify({schema:'mini-roster-ready/v1'}));await tick();const request=requestMiniEmployees('mini-test',{scope,timeoutMs:2000});
 await tick();sa.close();await expect(request).rejects.toThrow(/cerr/);
});
test('dos solicitudes concurrentes no compiten y Mini recibe el nombre de la obra',async()=>{
 let resolveName;
 detach=attachEmployeeIntakeChannel(sa,{peerId:'mini-test',peerApp:'mini'},{core:Core,store:{stage:jest.fn()},resolveScope:async()=>scope,resolveProjectName:()=>new Promise(resolve=>resolveName=resolve)});
 mini.send(JSON.stringify({schema:'mini-roster-ready/v1'}));await tick();
 const first=requestMiniEmployees('mini-test',{timeoutMs:2000});first.catch(()=>{});await tick();
 await expect(requestMiniEmployees('mini-test')).rejects.toThrow(/solicitud/);
 resolveName('Obra Norte');await tick();
 expect(sa.frames.map(f=>typeof f==='string'?JSON.parse(f):{}).find(f=>f.schema==='mini-roster-request/v1').projectName).toBe('Obra Norte');
 sa.close();await expect(first).rejects.toThrow(/cerr/);
});
test('solicitar recupera la capacidad aunque el ready original se haya perdido',async()=>{
 detach=attachEmployeeIntakeChannel(sa,{peerId:'mini-test',peerApp:'mini'},{core:Core,store:{stage:jest.fn()},resolveScope:async()=>scope,resolveProjectName:async()=> 'Obra'});
 mini.addEventListener('message',({data})=>{if(typeof data==='string'&&JSON.parse(data).schema==='mini-roster-hello/v1')mini.send(JSON.stringify({schema:'mini-roster-ready/v1'}));});
 const request=requestMiniEmployees('mini-test',{timeoutMs:2000});request.catch(()=>{});
 await tick();await tick();
 expect(sa.frames.some(f=>typeof f==='string'&&JSON.parse(f).schema==='mini-roster-request/v1')).toBe(true);
 sa.close();await expect(request).rejects.toThrow(/cerr/);
});
