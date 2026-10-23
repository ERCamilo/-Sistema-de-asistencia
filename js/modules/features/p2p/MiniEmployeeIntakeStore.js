import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { assertProjectWritable, requireWritableProject } from '../projects/ProjectWriteGuard.js';
import indexedDBService from '../../services/IndexedDBService.js';
import { state, stateManager } from '../../core/AppState.js';
import { eventBus } from '../../core/Events.js';
import { getLocalOwnerUid } from '../../services/LocalDataOwner.js';
import { saveApplicationData, isLocalDataWipeInProgress } from '../../services/PersistenceService.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { peekEntityScope } from '../projects/ProjectContext.js';
import { resolveRepeatedEmployees } from './MiniEmployeeIntakeRepeated.js';
import { recordIntakeActivity } from './MiniEmployeeIntakeActivity.js';
import { p2pActivityStore } from './P2PActivityStore.js';
import { buildEmployeeIntakePlan, intakeReviewVersion, proposalContract } from './MiniEmployeeIntake.js';

export function currentIntakeOwner() { const local=getLocalOwnerUid(), signedIn=globalThis.currentUser?.uid; if(local&&signedIn&&local!==signedIn)throw new Error('La cuenta no corresponde a los datos de este dispositivo.'); return String(signedIn || local || 'local-device'); }
const keyFor = owner => `miniEmployeeIntake:${JSON.stringify(owner)}`;
const entryId = (peerId,p) => JSON.stringify([peerId,p.saProjectId,p.proposalId]);
const linkId = (peerId,project,miniId) => JSON.stringify([peerId,project,miniId]);
const merge = (stored,current) => {
    const map=new Map(stored.map(e=>[e.id,e]));
    current.forEach(e=>{if(!map.has(e.id)||Number(e.updatedAt||0)>=Number(map.get(e.id).updatedAt||0))map.set(e.id,e);});
    return [...map.values()];
};
const publish = plan => stateManager.setState({ employees:merge(state.employees,plan.employees), positions:merge(state.positions,plan.positions) });

export class MiniEmployeeIntakeStore {
    constructor({dbService=indexedDBService,readState=()=>state,readOwner=currentIntakeOwner,readScope=peekEntityScope,readHours,publish:emit=publish,onCommitted=()=>saveApplicationData({immediate:true}),createId,activityStore=p2pActivityStore}={}) {
        this.readHours=readHours || (()=>Number(getActivePayrollSettings(readState())?.regularHoursPerDay)||8);
        Object.assign(this,{dbService,readState,readOwner,readScope,publish:emit,onCommitted,createId,activityStore});
    }
    assertContext(owner,projectId) {
        if(this.readOwner()!==owner || isLocalDataWipeInProgress() || this.dbService._isDatasetEpochStale?.()) throw new Error('La cuenta o los datos cambiaron. Vuelve a abrir la revisión.');
        const scope=this.readScope();
        if(!scope.enabled || scope.projectId!==projectId) throw new Error('La obra cambió. Vuelve a revisar el personal.');
    }
    async readLedger() {
        await this.dbService.init();
        return await this.dbService.get('settings',keyFor(this.readOwner())) || {key:keyFor(this.readOwner()),items:[],links:{}};
    }
    async list() { return (await this.readLedger()).items || []; }
    // `local` marks a proposal SA built from attendance rows: Mini never saw its proposalId.
    async stage(raw,{peerId,peerName='',scope,local=false}) {
        const payload=proposalContract.validateProposal(raw), owner=this.readOwner();
        if(!peerId || peerId.length>128 || !scope.enabled || scope.projectId!==payload.saProjectId) throw new Error('Mini u obra de destino inválidos.');
        await requireWritableProject(payload.saProjectId, { store: { get: id => this.dbService.get('projects', id) } });
        await this.dbService.init(); this.assertContext(owner,payload.saProjectId);
        const id=entryId(peerId,payload), serialized=JSON.stringify({...payload,requestId:undefined});
        let created=false;
        const staged=await this.transaction(['settings'],(tx,resolve,abort)=>{
            const settings=tx.objectStore('settings'), request=settings.get(keyFor(owner));
            request.onsuccess=()=>{try{
                this.assertContext(owner,payload.saProjectId);
                const ledger=request.result || {key:keyFor(owner),items:[],links:{}};
                const previous=ledger.items.find(e=>e.id===id);
                if(previous) {if(JSON.stringify({...previous.payload,requestId:undefined})!==serialized) throw new Error('La propuesta repetida tiene otro contenido.');resolve(previous);return;}
                // A new proposal from pasted text/attendance replaces the pending one of the same origin.
                const superseded=e=>local&&e.local&&e.status==='pending'&&e.peerId===peerId&&e.payload.saProjectId===payload.saProjectId;
                const kept=ledger.items.filter(e=>!superseded(e));
                if(kept.filter(e=>e.status==='pending').length>=12) throw new Error('La bandeja de personal está llena. Revisa las propuestas pendientes antes de recibir más.');
                const entry={id,peerId,peerName,payload,status:'pending',receivedAt:Date.now(),mappings:[],...(local?{local:true}:{})};
                ledger.items=[...kept.filter(e=>e.status==='pending'),...kept.filter(e=>e.status!=='pending').slice(-60),entry];
                settings.put(ledger);created=true;resolve(entry);
            }catch(error){abort(error);}};
        });
        if(created)recordIntakeActivity(staged,{activityStore:this.activityStore});
        return staged;
    }
    async accept(id,decisions,{scope,hoursPerDay,version}) {
        await requireWritableProject(scope.projectId, { store: { get: id => this.dbService.get('projects', id) } });
        const owner=this.readOwner();await this.dbService.init();this.assertContext(owner,scope.projectId);
        let applied=null, settled=null, repeated=[];
        const checkProject = isProjectsEnabled();
        const output=await this.transaction(['settings','employees','positions', ...(checkProject ? ['projects'] : [])],(tx,resolve,abort)=>{
            const requests=[tx.objectStore('settings').get(keyFor(owner)),tx.objectStore('employees').getAll(),tx.objectStore('positions').getAll(), ...(checkProject ? [tx.objectStore('projects').get(scope.projectId)] : [])];let remaining=requests.length;
            requests.forEach(request=>{request.onsuccess=()=>{if(--remaining)return;try{
                this.assertContext(owner,scope.projectId);
                if (checkProject) {
                    const project = requests[3].result;
                    if (!project) throw new Error('La obra ya no está disponible.');
                    assertProjectWritable(scope.projectId, { project, enabled: true });
                }
                const ledger=requests[0].result, entry=ledger?.items.find(e=>e.id===id);
                if(!entry || entry.payload.saProjectId!==scope.projectId) throw new Error('Propuesta de otra cuenta u obra, o ya no disponible.');
                if(entry.status==='discarded')throw new Error('Esta propuesta fue descartada. Prepara un nuevo envío desde Mini.');
                if(entry.status==='resolved') {resolve({result:entry.result,replayed:true});return;}
                if(this.readHours()!==hoursPerDay)throw new Error('Las horas de la jornada cambiaron. Actualiza la revisión.');
                const current=this.readState();
                const canonical={employees:merge(requests[1].result,current.employees),positions:merge(requests[2].result,current.positions)};
                if(intakeReviewVersion(current,scope,hoursPerDay)!==version || intakeReviewVersion(canonical,scope,hoursPerDay)!==version) throw new Error('Los datos de SA cambiaron. Pulsa Volver y abre la propuesta otra vez antes de aceptar.');
                const previous=new Map(entry.mappings.map(m=>[m.miniLocalId,m]));
                const effective=decisions.map(d=>{
                    // A remembered link only counts while its SA employee still exists; otherwise the person can be created again.
                    const remembered=ledger.links[linkId(entry.peerId,scope.projectId,d.miniLocalId)];
                    const known=previous.get(d.miniLocalId) || (remembered && canonical.employees.some(e=>e.id===remembered.saEmployeeId&&!e.deletedAt) ? remembered : null);
                    if(previous.has(d.miniLocalId) && (d.action!=='link' || d.employeeId!==known.saEmployeeId || d.update))throw new Error('Una fila aceptada no se modifica en la misma propuesta.');
                    if(known && d.action==='create') throw new Error('Este empleado ya está vinculado. Actualiza la revisión.');
                    return d;
                });
                applied=buildEmployeeIntakePlan(entry.payload,effective,{...canonical,scope,hoursPerDay,createId:this.createId});
                applied.mappings.forEach(m=>previous.set(m.miniLocalId,m));
                const result=proposalContract.validateResult({schema:'mini-roster-result/v1',proposalId:entry.payload.proposalId,saProjectId:scope.projectId,mappings:[...previous.values()]},entry.payload);
                entry.mappings=result.mappings;entry.result=result;
                entry.status=result.mappings.length===entry.payload.employees.length?'resolved':'pending';
                entry.updatedAt=Date.now();settled=entry;
                result.mappings.forEach(m=>{ledger.links[linkId(entry.peerId,scope.projectId,m.miniLocalId)]=m;});
                repeated=resolveRepeatedEmployees(ledger,entry,applied.mappings,linkId);
                applied.employees.forEach(e=>tx.objectStore('employees').put(e));
                applied.positions.forEach(p=>tx.objectStore('positions').put(p));
                tx.objectStore('settings').put(ledger);resolve({result,replayed:false,autoResolved:repeated});
            }catch(error){abort(error);}};});
        });
        this.assertContext(owner,scope.projectId);
        if(applied) {
            this.publish(applied);
            eventBus.emit('mini-employee-intake:accepted',{peerId:JSON.parse(id)[0],saProjectId:scope.projectId,mappings:output.result.mappings});
            if(settled)recordIntakeActivity(settled,{activityStore:this.activityStore});
            for(const {entry:other,added} of output.autoResolved||[]){
                recordIntakeActivity(other,{activityStore:this.activityStore});
                eventBus.emit('mini-employee-intake:accepted',{peerId:other.peerId,saProjectId:scope.projectId,mappings:added});
            }
            try { await this.onCommitted(); } catch(error) {output.syncWarning=String(error?.message||error);}
            this.assertContext(owner,scope.projectId);
        }
        return output;
    }
    async linksFor(peerId,projectId) {
        const ledger=await this.readLedger();
        return Object.fromEntries(Object.entries(ledger.links || {}).filter(([key])=>{const parts=JSON.parse(key);return parts[0]===peerId&&parts[1]===projectId;}).map(([key,value])=>[JSON.parse(key)[2],value]));
    }
    async discard(id,scope) {
        const owner=this.readOwner();await this.dbService.init();this.assertContext(owner,scope.projectId);
        const discarded=await this.transaction(['settings'],(tx,resolve,abort)=>{
            const settings=tx.objectStore('settings'),request=settings.get(keyFor(owner));
            request.onsuccess=()=>{try{
                this.assertContext(owner,scope.projectId);
                const ledger=request.result,entry=ledger?.items.find(e=>e.id===id);
                if(!entry||entry.payload.saProjectId!==scope.projectId)throw new Error('Propuesta no disponible en esta obra.');
                entry.status='discarded';entry.updatedAt=Date.now();settings.put(ledger);resolve(entry);
            }catch(error){abort(error);}};
        });
        recordIntakeActivity(discarded,{activityStore:this.activityStore});
        return discarded;
    }
    transaction(stores,work) {
        return new Promise((resolve,reject)=>{
            const tx=this.dbService.db.transaction(stores,'readwrite');let value, failure;
            tx.oncomplete=()=>resolve(value);
            tx.onabort=tx.onerror=()=>reject(failure || tx.error || new Error('No se pudo guardar el personal.'));
            const abort=error=>{failure=error;try{tx.abort();}catch(_){reject(error);}};
            try{work(tx,result=>{value=result;},abort);}catch(error){abort(error);}
        });
    }
}
export const miniEmployeeIntakeStore=new MiniEmployeeIntakeStore();
