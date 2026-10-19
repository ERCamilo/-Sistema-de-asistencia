import { eventBus } from '../../core/Events.js';
import { getEntityScope } from '../projects/ProjectContext.js';
import { projectStore } from '../projects/ProjectStore.js';
import { miniEmployeeIntakeStore, currentIntakeOwner } from './MiniEmployeeIntakeStore.js';
import { proposalContract } from './MiniEmployeeIntake.js';

const channels=new Map();
const newId=()=>`personal-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\s\x00-\x1f]/.test(value);

export function attachEmployeeIntakeChannel(channel,peer,{core=globalThis.SaMiniP2P,store=miniEmployeeIntakeStore,resolveScope=getEntityScope,resolveProjectName=async id=>(await projectStore.get(id))?.name||''}={}) {
    if(!peer?.peerId || peer.peerApp!=='mini' || !core) return ()=>{};
    channels.get(peer.peerId)?.detach();
    const entry={channel,peer,core,store,resolveScope,ready:false,flight:null,starting:false,closed:false,detach:null};
    const send=value=>{if(entry.closed||channel.readyState!=='open'||core.isChannelAuthenticated(channel)!==true)throw new Error('La conexión con Mini dejó de estar autenticada.');channel.send(JSON.stringify(value));};
    const complete=(error,value)=>{
        const flight=entry.flight;if(!flight)return;
        clearTimeout(flight.timer);flight.signal?.removeEventListener('abort',flight.abort);
        entry.flight=null;error?flight.reject(error):flight.resolve(value);
    };
    const awaitReady=()=>new Promise((resolve,reject)=>{
        if(entry.ready){resolve();return;}
        const timer=setTimeout(()=>entry.readyWaiter?.finish(new Error('Mini no respondió. Mantén Mini abierto y actualiza ambos clientes para enviar personal.')),2000);
        entry.readyWaiter={finish:error=>{clearTimeout(timer);entry.readyWaiter=null;error?reject(error):resolve();}};
        try{send({schema:'mini-roster-hello/v1'});}catch(error){entry.readyWaiter.finish(error);}
    });
    entry.start=async({scope,offerId='',signal,timeoutMs=180000}={})=>{
        if(entry.flight||entry.starting) throw new Error('Ya hay una solicitud de personal en esta conexión.');
        if(!core.isChannelAuthenticated(channel)) throw new Error('Mini no está listo para enviar personal. Mantén Mini abierto y actualizado.');
        entry.starting=true;
        try {
        await awaitReady();
        const owner=currentIntakeOwner();
        const destination=scope || await resolveScope();
        if(!destination.enabled || !destination.projectId)throw new Error('Selecciona una obra activa en SA antes de recibir personal.');
        const projectName=String(await resolveProjectName(destination.projectId)).slice(0,120);
        if(entry.closed||currentIntakeOwner()!==owner)throw new Error('La conexión o la cuenta cambiaron. Vuelve a solicitar personal.');
        const requestId=newId();
        return await new Promise((resolve,reject)=>{
            const flight={requestId,scope:destination,owner,resolve,reject,signal,receiver:null,timer:null,abort:null};
            flight.abort=()=>complete(new Error('Solicitud de personal cancelada.'));
            if(signal?.aborted){reject(new Error('Solicitud de personal cancelada.'));return;}
            entry.flight=flight;
            signal?.addEventListener('abort',flight.abort,{once:true});
            flight.timer=setTimeout(()=>complete(new Error('Mini no confirmó el envío. Revisa Mini y vuelve a solicitar personal.')),timeoutMs);
            flight.receiver=core.createTransferReceiver({channel,onError:error=>complete(error),onComplete:async transfer=>{
                try {
                    if(transfer.schema!==proposalContract.SCHEMA || transfer.kind!=='roster')throw new Error('Transferencia de personal incompatible.');
                    const payload=proposalContract.validateProposal(JSON.parse(transfer.text));
                    if(payload.requestId!==requestId || payload.saProjectId!==destination.projectId || currentIntakeOwner()!==owner)throw new Error('La propuesta no corresponde a esta solicitud, cuenta u obra.');
                    const received=await store.stage(payload,{peerId:peer.peerId,peerName:peer.displayName||'Mini',scope:destination});
                    if(entry.flight!==flight) return;
                    if(received.status==='discarded') {
                        send({schema:'mini-roster-error/v1',requestId,proposalId:payload.proposalId,discarded:true,message:'Esta propuesta fue descartada en SA. Puedes preparar un nuevo envío.'});
                        complete(null,received);return;
                    }
                    send({schema:'mini-roster-staged/v1',proposalId:payload.proposalId,transferId:transfer.transferId,sha256:transfer.sha256});
                    if(received.result)send(received.result);
                    eventBus.emit('mini-employee-intake:received',{entry:received});
                    complete(null,received);
                }catch(error){
                    try{send({schema:'mini-roster-error/v1',requestId,message:String(error.message||error).slice(0,240)});}catch(_){}
                    complete(error);
                }
            }});
            try{send({schema:'mini-roster-request/v1',requestId,saProjectId:destination.projectId,projectName,offerId});}catch(error){complete(error);}
        });
        } finally {entry.starting=false;}
    };
    const handler=event=>{
        if(core.isChannelAuthenticated(channel)!==true)return;
        let message;
        if(typeof event.data==='string'){try{message=JSON.parse(event.data);}catch(_){return;}}
        if(message?.schema==='mini-roster-ready/v1'){entry.ready=true;entry.readyWaiter?.finish();return;}
        if(message?.schema==='mini-roster-offer/v1' && safeId(message.offerId)) {
            entry.ready=true;
            if(!entry.flight&&!entry.starting) entry.start({offerId:message.offerId}).catch(error=>{
                try{send({schema:'mini-roster-error/v1',offerId:message.offerId,message:String(error.message||error).slice(0,240)});}catch(_){}
                globalThis.showNotification?.(error.message,'warning');
            });
            return;
        }
        const flight=entry.flight;if(!flight)return;
        if(message?.schema==='mini-roster-error/v1'&&message.requestId===flight.requestId){complete(new Error(String(message.message||'Mini rechazó el envío.').slice(0,240)));return;}
        if(message && message.protocol!==core.TRANSFER_PROTOCOL)return;
        if(message?.type==='start' && message.schema!==proposalContract.SCHEMA){complete(new Error('Se esperaba una propuesta de personal de Mini.'));return;}
        flight.receiver(event);
    };
    const close=()=>{entry.closed=true;const error=new Error('La conexión se cerró. Puedes reenviar la propuesta desde Mini.');entry.readyWaiter?.finish(error);complete(error);};
    channel.addEventListener('message',handler);channel.addEventListener('close',close);
    entry.detach=()=>{close();channel.removeEventListener('message',handler);channel.removeEventListener('close',close);if(channels.get(peer.peerId)===entry)channels.delete(peer.peerId);};
    channels.set(peer.peerId,entry);return entry.detach;
}

export async function requestMiniEmployees(peerId,options={}) {
    const channel=channels.get(peerId);if(!channel)throw new Error('Mini no está conectado. Abre Mini y espera a que aparezca en línea.');
    return channel.start(options);
}
export function sendEmployeeIntakeResult(peerId,result) {
    const entry=channels.get(peerId);
    if(!entry || entry.core.isChannelAuthenticated(entry.channel)!==true)return false;
    try{entry.channel.send(JSON.stringify(result));return true;}catch(_){return false;}
}
