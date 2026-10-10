import { VoiceRecorder } from './VoiceRecorder.js';
import { createVoiceContext, normalizeVoiceName, resolveVoiceEmployees, sendVoiceRecording } from './VoiceCore.js';
import { voiceEmployeeCard, voiceIcon } from './VoiceVisuals.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';

const projectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';
export function VoiceNameEntry(employee, enabled) {
    if (!enabled) return '';
    return `<section class="employee-voice-name"><button type="button" data-voice-name-employee="${escapeAttr(employee?.id || '')}" ${employee ? '' : 'disabled'}>${voiceIcon('mic')} Enseñar nombre por voz</button>${employee ? '<span>Variantes locales de cómo lo llamamos</span>' : '<span>Guarda el empleado para enseñarle el nombre.</span>'}</section>`;
}

// Names/aliases stay device-local; this panel never invokes business operations.
export class VoiceNameEnrollmentUI {
    constructor(adapter, {store, recorderFactory = options => new VoiceRecorder(options)} = {}) {
        this.adapter=adapter;this.store=store;this.recorderFactory=recorderFactory;this.generation=0;
    }
    mount() {
        this.dialog=document.createElement('dialog');this.dialog.className='voice-dialog voice-name-dialog';
        this.dialog.setAttribute('aria-label','Enseñar nombre por voz');document.body.append(this.dialog);
        this.onEntry=event=>{const button=event.target.closest('[data-voice-name-employee]');if(button && !button.disabled) this.open(button.dataset.voiceNameEmployee).catch(error=>this.adapter.notify?.(error.message,'warning'));};
        document.addEventListener('click',this.onEntry);
        this.dialog.addEventListener('click',event=>{const button=event.target.closest('[data-name-action]');if(button && !button.disabled) this.run(()=>this.action(button.dataset.nameAction,button.dataset.id));});
        this.dialog.addEventListener('input',event=>{
            if(event.target.hasAttribute('data-name-variant')) {this.variant=event.target.value;this.variantDirty=true;this.updateVariantState();}
        });
        this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
        // Keep the employee editor's document-level focus trap/ESC handler underneath.
        this.dialog.addEventListener('keydown',event=>{if(event.key==='Escape' || event.key==='Tab') event.stopPropagation();});
        const check=()=>{if(this.identity && !this.valid()) this.close();};
        this.unsubscribeEnabled=this.adapter.subscribeEnabled?.(check);
        this.unsubscribeScope=this.adapter.subscribeScope?.(check);
        this.unsubscribeSession=this.adapter.subscribeSession?.(check);
        this.onWipe=()=>{this.wiped=true;this.close();};window.addEventListener('sa:voice-wipe',this.onWipe);
        this.onHidden=()=>{if(document.hidden && this.recording) {this.recorder?.cancel();this.recording=false;this.message='Grabación cancelada. Puedes intentarlo de nuevo.';this.render();}};
        document.addEventListener('visibilitychange',this.onHidden);
        return this;
    }
    valid() {
        return !this.wiped && this.adapter.isEnabled?.() !== false && !!this.adapter.getUser() && this.adapter.getUser().uid===this.identity?.uid && projectKey(this.adapter.getScope())===this.identity?.projectKey && this.adapter.getEmployees().some(e=>e.id===this.employee?.id);
    }
    guard(generation=this.generation) {
        if(generation!==this.generation || !this.valid()) throw Error('Cambió la cuenta, el proyecto o la prueba de voz.');
    }
    async run(callback) {
        const generation=this.generation;
        try {await callback();} catch(error) {
            if(!this.dialog.open || generation!==this.generation) return;
            this.message=error.message || 'No se pudo completar la acción.';this.render();
        }
    }
    async open(employeeId) {
        this.close();
        const employee=this.adapter.getEmployees().find(e=>e.id===employeeId),user=this.adapter.getUser(),scope=this.adapter.getScope();
        if(this.wiped || this.adapter.isEnabled?.()===false || !user || !employee || (scope?.enabled && !scope.projectId)) throw Error('Activa Voz e inicia sesión en el proyecto del empleado.');
        this.identity={uid:user.uid,projectKey:projectKey(scope)};this.employee=employee;this.variant='';this.variantDirty=false;this.pendingVariant='';this.message='';this.busy=false;this.recording=false;
        const generation=this.generation;
        await this.refresh(generation);this.guard(generation);this.render();this.dialog.showModal();
    }
    async refresh(generation=this.generation) {const rows=await this.store.aliases(this.identity.uid,this.identity.projectKey);this.guard(generation);this.aliasRows=rows;this.variants=rows.find(row=>row.employeeId===this.employee.id)?.aliases || [];}
    async discardAudio() {
        const record=this.record;this.record=null;
        this.dialog.querySelector('audio')?.pause();
        if(this.audioURL) URL.revokeObjectURL(this.audioURL);this.audioURL=null;
        if(record) {record.discarded=true;await this.store.remove(record.uid,record.requestId);}
    }
    close() {
        this.generation++;this.controller?.abort();clearTimeout(this.retryTimer);this.recorder?.cancel();this.recording=false;this.busy=false;
        void this.discardAudio().catch(()=>this.adapter.notify?.('No se pudo eliminar el audio de ejemplo. Se limpiará como borrador temporal.','warning'));
        if(this.dialog?.open) this.dialog.close();this.dialog?.replaceChildren();this.identity=null;this.employee=null;this.transcript='';this.variant='';this.variants=[];this.aliasRows=[];
    }
    async action(action,id) {
        if(action==='close') {this.close();return;}
        this.guard();if(action==='stop') {this.recorder?.stop();return;}
        if(this.busy || this.recording) return;
        const generation=this.generation;
        if(action==='record') {
            await this.discardAudio();this.guard(generation);this.message='';this.variant='';this.variantDirty=false;this.pendingVariant='';this.transcript='';this.recording=true;this.render();
            const identity={...this.identity};
            this.recorder=this.recorderFactory({
                onLevel:level=>{if(generation===this.generation) this.dialog.querySelector('.voice-name-meter')?.style.setProperty('--level',String(level));},
                onError:error=>{if(generation===this.generation) {this.recording=false;this.message=error.message;this.render();}},
                onComplete:captured=>this.run(async()=>{
                    this.guard(generation);this.recording=false;
                    const extension=captured.mimeType.includes('mp4')?'m4a':captured.mimeType.includes('ogg')?'ogg':'webm';
                    const record={...identity,...captured,purpose:'name-example',requestId:crypto.randomUUID(),createdAt:Date.now(),context:createVoiceContext(),fileName:`name.${extension}`};
                    this.record=record;
                    await this.store.put(record);
                    if(record.discarded || generation!==this.generation) {await this.store.remove(record.uid,record.requestId);return;}
                    this.guard(generation);this.audioURL=URL.createObjectURL(record.audio);this.render();
                })
            });
            const recorder=this.recorder;
            try {await recorder.start();this.guard(generation);} catch(error) {recorder.cancel();if(generation===this.generation) this.recording=false;throw error;}
            return;
        }
        if(action==='process') {
            if(!this.record) throw Error('Graba primero el nombre.');
            if(this.record.retryAt>Date.now()) throw Error('Espera antes de reintentar la transcripción.');
            this.busy=true;this.message='Transcribiendo…';this.render();this.controller=new AbortController();
            const record=this.record;
            try {
                const result=await sendVoiceRecording({url:this.adapter.getEndpoint(),record,externalSignal:this.controller.signal,getToken:async force=>{this.guard(generation);return this.adapter.getUser().getIdToken(force);}});
                this.guard(generation);
                this.transcript=result.transcript;
                const blocked=result.issues.some(x=>/NEGAT|MULTIPLE_ACTIONS/.test(x.code));
                const nextVariant=blocked?'':result.employee.spokenName || '';
                if(this.variantDirty) this.pendingVariant=nextVariant;
                else this.variant=nextVariant;
                this.message=blocked?'La grabación contiene una negación o varias acciones. Graba solo cómo lo llamas.':result.issues.map(x=>x.message).join(' ') || (this.variant?'Revisa la variante antes de guardarla.':'No se reconoció un nombre. Escríbelo o vuelve a grabar.');
                record.retryAt=null;
            } catch(error) {
                if(error.retryAfterMs && generation===this.generation) {
                    record.retryAt=Date.now()+error.retryAfterMs;
                    this.retryTimer=setTimeout(()=>{if(generation===this.generation && this.dialog.open) this.render();},error.retryAfterMs);
                }
                throw error;
            } finally {if(generation===this.generation) {this.busy=false;this.render();}}
            return;
        }
        if(action==='use-variant') {this.variant=this.pendingVariant;this.pendingVariant='';this.variantDirty=false;this.render();return;}
        if(action==='save') {
            const alias=normalizeVoiceName(this.variant).slice(0,160);if(!alias) throw Error('Escribe o graba una variante del nombre.');
            this.busy=true;this.render();
            try {
                await this.store.saveAlias(this.identity.uid,this.identity.projectKey,this.employee.id,alias);
                this.guard(generation);await this.discardAudio();this.guard(generation);
                this.variant='';this.transcript='';await this.refresh(generation);this.message='Variante confirmada. Audio eliminado.';
            } finally {if(generation===this.generation) {this.busy=false;this.render();}}
            return;
        }
        if(action==='remove') {
            this.busy=true;this.render();
            try {await this.store.removeAlias(this.identity.uid,this.identity.projectKey,this.employee.id,id);this.guard(generation);await this.refresh(generation);this.message='Variante eliminada.';}
            finally {if(generation===this.generation) {this.busy=false;this.render();}}
        }
    }
    updateVariantState() {
        const value=normalizeVoiceName(this.variant).slice(0,160),button=this.dialog.querySelector('[data-name-action=save]');
        if(button) button.disabled=this.busy || this.recording || !value;
        const collisions=value?resolveVoiceEmployees({spokenName:value},this.adapter.getEmployees(),this.aliasRows).filter(x=>x.score===1 && x.employee.id!==this.employee.id):[];
        const warning=this.dialog.querySelector('[data-name-collision]');
        if(warning) {warning.hidden=!collisions.length;warning.textContent=collisions.length?`También coincide con ${collisions.map(x=>x.employee.name).join(', ')}. La búsqueda exigirá selección.`:'';}
    }
    render() {
        if(!this.identity) return;
        const activeAction=this.dialog.contains(document.activeElement) ? document.activeElement.dataset.nameAction : null;
        this.dialog.querySelector('audio')?.pause();
        const button=(action,label,disabled=false,id='')=>`<button type="button" data-name-action="${action}" data-id="${escapeAttr(id)}" ${disabled?'disabled':''}>${label}</button>`;
        this.dialog.innerHTML=`<header class="voice-header"><h2 id="voice-name-title">Cómo lo llamamos</h2>${button('close',`${voiceIcon('close')}<span class="voice-sr">Cerrar</span>`)}</header><div class="voice-body">${voiceEmployeeCard(this.employee)}<p role="status">${escapeHTML(this.message || 'Di solo el nombre o apodo que usan en la obra.')}</p>${this.recording?`<div class="voice-name-meter" role="status">Grabando<span></span></div>${button('stop','Terminar grabación')}`:button('record',`${voiceIcon('mic')} ${this.record?'Volver a grabar':'Grabar nombre'}`,this.busy)}${this.record?`<audio controls src="${escapeAttr(this.audioURL || '')}" class="voice-name-audio"></audio>${button('process',this.busy?'Transcribiendo…':this.transcript?'Volver a transcribir':'Transcribir',this.busy || this.record.retryAt>Date.now())}`:''}${this.pendingVariant?`<section class="voice-review">Nuevo resultado: ${escapeHTML(this.pendingVariant)}${button('use-variant','Usar nuevo resultado',this.busy)}</section>`:''}${this.transcript?`<p>Texto entendido: ${escapeHTML(this.transcript)}</p>`:''}<label>Variante<input data-name-variant maxlength="160" value="${escapeAttr(this.variant || '')}" placeholder="Cómo lo llamamos" ${this.busy || this.recording?'disabled':''}></label><p data-name-collision role="status" hidden></p><h3>${this.variants?.length || 0} ${this.variants?.length===1?'variante confirmada':'variantes confirmadas'}</h3><div class="voice-name-variants">${(this.variants || []).map(alias=>`<div><span>${escapeHTML(alias)}</span>${button('remove',`${voiceIcon('trash')}<span class="voice-sr">Eliminar ${escapeHTML(alias)}</span>`,this.busy || this.recording,alias)}</div>`).join('')}</div><p>Variantes locales a esta cuenta, proyecto y navegador.</p></div><footer class="voice-footer">${button('close','Cerrar')}${button('save','Confirmar variante',this.busy || this.recording || !normalizeVoiceName(this.variant))}</footer>`;
        this.dialog.setAttribute('aria-labelledby','voice-name-title');this.dialog.querySelector('[data-name-action=save]').classList.add('voice-primary');this.updateVariantState();
        if(activeAction && this.dialog.open) (this.dialog.querySelector(`[data-name-action="${activeAction}"]:not(:disabled)`) || this.dialog.querySelector('[data-name-action=process]:not(:disabled), [data-name-action=record]:not(:disabled), [data-name-action=close]'))?.focus({preventScroll:true});
    }
    destroy() {this.close();document.removeEventListener('click',this.onEntry);document.removeEventListener('visibilitychange',this.onHidden);window.removeEventListener('sa:voice-wipe',this.onWipe);this.unsubscribeEnabled?.();this.unsubscribeScope?.();this.unsubscribeSession?.();this.dialog.remove();}
}
