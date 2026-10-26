import { escapeHTML } from '../../utils/Sanitize.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { normalizeVoiceName, voiceAutoMatchLevel } from './VoiceMatching.js';
import { voiceRetentionPolicy } from './VoiceRetention.js';
import { voiceAliasCollisions, voiceRecordingInfo, voiceProjectKey, voiceBytes } from './VoiceSettingsData.js';
import { VoiceSettingsConfigView } from './VoiceSettingsConfigView.js';
import { VoiceSettingsAliasesView, VoiceSettingsPersonView, VoiceSettingsAliasEditView } from './VoiceSettingsAliasesView.js';
import { VoiceSettingsRecordingsView, VoiceSettingsAudioView, VoiceSettingsRetentionView, voiceExpiryText } from './VoiceSettingsRecordingsView.js';
import { vsIcon, vsButton, vsIconButton, vsArrow, vsFeedback, vsWave } from './VoiceSettingsViewUtils.js';

// Settings and business navigation are injected. This controller manages only
// the existing device-local voice store; it cannot register an operation.
export class VoiceSettingsUI {
    constructor(adapter, { store } = {}) {
        this.adapter = adapter; this.store = store; this.generation = 0; this.readEpoch = 0;
        this.view = 'home'; this.stack = []; this.search = ''; this.recordFilter = 'available'; this.busy = false;
        this.records = null; this.aliases = null; this.storage = null; this.errors = {}; this.aliasText = '';
        this.readCancels = new Set();
    }
    mount() {
        this.dialog = document.createElement('dialog'); this.dialog.className = 'voice-settings-dialog';
        this.dialog.setAttribute('aria-labelledby', 'vs-title');
        this.dialog.innerHTML = `<header class="vs-modal-header">${vsIconButton('back','back','Volver')}<span class="vs-icon-box" data-vs-header-icon></span><div class="vs-modal-heading"><h2 id="vs-title" tabindex="-1" autofocus>Voz</h2><small data-vs-subtitle></small></div>${vsIconButton('close','close','Cerrar')}</header><div class="vs-modal-body"></div><footer class="vs-modal-footer"></footer>`;
        document.body.append(this.dialog);
        this.dialog.addEventListener('click', event => {
            const control = event.target.closest('[data-vs-action]');
            if (control && !control.disabled) this.run(() => this.action(control.dataset.vsAction, control.dataset.value));
        });
        this.dialog.addEventListener('input', event => {
            if (event.target.hasAttribute('data-vs-search')) { this.search = event.target.value; this.filterEmployees(); }
            if (event.target.hasAttribute('data-vs-alias-input')) { this.aliasText = event.target.value; this.updateAliasWarning(); }
            if (event.target.hasAttribute('data-vs-seek')) {
                const audio = this.dialog.querySelector('audio'); if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value);
            }
        });
        this.dialog.addEventListener('compositionstart', () => { this.composing = true; });
        this.dialog.addEventListener('compositionend', () => { this.composing = false; if (this.dialog.open) this.render(); });
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.busy ? this.close() : this.back(); });
        const changed = () => {
            if (!this.dialog.open) return;
            if (!this.sameContext()) { this.close(); return; }
            const signature = JSON.stringify(this.adapter.getSettings());
            if (signature !== this.settingsSignature) {
                this.settingsSignature = signature;
                if (this.view === 'config' && !this.busy) this.render();
                if (JSON.stringify(this.policy()) !== this.policySignature) this.run(() => this.refresh());
            }
        };
        this.unsubscribeSession = this.adapter.subscribeSession?.(changed);
        this.unsubscribeScope = this.adapter.subscribeScope?.(changed);
        this.unsubscribeSettings = this.adapter.subscribeEnabled?.(changed);
        this.onWipe = () => { this.wiped = true; this.close(); };
        this.onDiscard = () => { if (this.dialog.open && !this.busy) this.run(() => this.refresh()); };
        window.addEventListener('sa:voice-wipe', this.onWipe); window.addEventListener('sa:voice-audio-discarded', this.onDiscard);
        this.onVisibility = () => {
            if (document.hidden) this.pauseAudio();
            else if (this.dialog.open) this.run(() => this.refresh());
        };
        document.addEventListener('visibilitychange', this.onVisibility);
        this.timer = setInterval(() => { if (this.dialog.open && !document.hidden && !this.busy) this.run(() => this.refresh()); }, 30000);
        return this;
    }
    captureContext() {
        const scope = this.adapter.getScope();
        return { uid: this.adapter.getUser()?.uid || null, projectKey: voiceProjectKey(scope), ready: !scope?.enabled || !!scope.projectId };
    }
    sameContext(context = this.context) { return !!context && JSON.stringify(context) === JSON.stringify(this.captureContext()); }
    guard(generation = this.generation, employeeId = null) {
        if (!this.dialog.open || generation !== this.generation || !this.sameContext() || this.wiped) throw Error('Cambió la cuenta o la obra. Vuelve a abrir Voz.');
        if (!this.context.uid || !this.context.ready) throw Error('Inicia sesión y selecciona una obra.');
        if (employeeId != null && !this.adapter.getEmployees().some(employee => employee.id === employeeId)) throw Error('El empleado ya no está disponible en esta obra.');
    }
    async run(callback) {
        const generation = this.generation;
        try { await callback(); }
        catch (error) { if (generation === this.generation && this.dialog.open && this.sameContext()) { this.error = error.message || 'No se pudo completar la acción.'; this.render(); } }
    }
    async open(initial = 'home') {
        this.close(); this.context = this.captureContext(); this.returnFocus = document.activeElement;
        this.view = initial; this.stack = initial === 'home' ? [] : ['home']; this.search = ''; this.error = ''; this.feedbackMessage = ''; this.confirmation = null;
        this.records = this.aliases = this.storage = null; this.errors = {}; this.busy = false;
        if (!this.context.uid || !this.context.ready || this.wiped) this.view = 'home';
        this.settingsSignature = JSON.stringify(this.adapter.getSettings());
        this.render(); this.dialog.showModal(); this.dialog.querySelector('#vs-title').focus();
        await this.refresh();
    }
    close() {
        this.generation++; this.readEpoch++; this.busy = false; this.confirmation = null;
        for (const cancel of [...this.readCancels]) cancel();
        this.releaseAudio();
        if (this.dialog?.open) this.dialog.close();
        this.dialog?.querySelector('.vs-modal-body')?.replaceChildren(); this.dialog?.querySelector('.vs-modal-footer')?.replaceChildren();
        this.context = null; this.records = this.aliases = this.storage = null; this.aliasText = ''; this.search = '';
        const target = this.returnFocus?.isConnected ? this.returnFocus : document.querySelector('[data-settings-action=open-voice-settings]');
        target?.focus({ preventScroll: true });
    }
    async refresh() {
        if (!this.dialog.open) return;
        if (!this.sameContext()) { this.close(); return; }
        if (!this.context.uid || !this.context.ready || this.wiped) { this.render(); return; }
        for (const cancel of [...this.readCancels]) cancel();
        const generation = this.generation, epoch = ++this.readEpoch, context = this.context, policy = this.policy();
        this.policySignature = JSON.stringify(policy);
        let maintenanceError = '';
        const guardRead = () => { this.guard(generation); if (epoch !== this.readEpoch) throw Error('La consulta fue reemplazada.'); };
        const maintenance = Promise.resolve().then(() => { guardRead(); return this.store.maintain(context.uid, policy, Date.now(), { guard: guardRead }); }).catch(error => { maintenanceError = error.message; });
        const readAfterMaintenance = callback => maintenance.then(() => { this.guard(generation); return callback(); });
        const results = await Promise.allSettled([
            this.readTask(readAfterMaintenance(() => this.store.list(context.uid, context.projectKey))),
            this.readTask(Promise.resolve().then(() => this.store.aliases(context.uid, context.projectKey))),
            this.readTask(readAfterMaintenance(() => this.store.storageStatus()))
        ]);
        if (generation !== this.generation || epoch !== this.readEpoch || !this.sameContext(context) || !this.dialog.open) return;
        this.errors = maintenanceError ? { maintenance: maintenanceError } : {};
        for (const [index,key] of ['records','aliases','storage'].entries()) {
            const result = results[index];
            const valid = result.status === 'fulfilled' && (key === 'storage'
                ? Number.isFinite(result.value?.bytes) && result.value.bytes >= 0 && Number.isInteger(result.value.count) && result.value.count >= 0
                : Array.isArray(result.value));
            this[key] = valid ? result.value : null;
            if (!valid) this.errors[key] = result.reason?.message || 'No se pudo consultar. Reintenta.';
        }
        if (this.view === 'audio' && !this.recordingInfos().some(row => row.record.requestId === this.recordId && row.available)) {
            this.releaseAudio(); this.view = 'recordings'; this.stack = ['home']; this.error = 'El audio venció o ya no está disponible.';
        }
        if (['person','edit-alias'].includes(this.view) && !this.employee()) { this.view = 'aliases'; this.stack = ['home']; this.error = 'El empleado ya no está disponible en esta obra.'; }
        if (this.view === 'audio' && this.dialog.querySelector('audio') && !this.error) {
            const expiry = this.dialog.querySelector('[data-vs-expiry]');
            if (expiry) expiry.innerHTML = vsIcon('clock') + voiceExpiryText(voiceRecordingInfo(this.recording(), this.adapter.getSettings()).expiresAt);
        } else this.render();
        Promise.resolve(this.adapter.onLocalDataChanged?.()).catch(() => {});
    }
    readTask(promise) {
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (value, error) => { if (done) return; done = true; clearTimeout(timer); this.readCancels.delete(cancel); error ? reject(error) : resolve(value); };
            const cancel = () => finish(null, Error('La consulta de voz se canceló.'));
            const timer = setTimeout(() => finish(null, Error('No se pudo consultar el archivo local. Reintenta.')), 8000);
            this.readCancels.add(cancel); Promise.resolve(promise).then(value=>finish(value),error=>finish(null,error));
        });
    }
    policy() { return voiceRetentionPolicy(this.adapter.getSettings()); }
    retentionText() { const p = this.policy(); return p.keep ? `${p.days} ${p.days === 1 ? 'día' : 'días'}` : 'No guardar'; }
    aliasesFor(id) { return this.aliases?.find(row => row.employeeId === id)?.aliases || []; }
    aliasCount() { return this.adapter.getEmployees().reduce((sum, employee) => sum + this.aliasesFor(employee.id).length, 0); }
    employee() { return this.adapter.getEmployees().find(employee => employee.id === this.employeeId); }
    recording() { return this.records?.find(record => record.requestId === this.recordId); }
    recordingInfos() { return (this.records || []).filter(record => record.purpose !== 'name-example').map(record => voiceRecordingInfo(record, this.adapter.getSettings())); }
    loanFor(record) {
        const employee = this.adapter.getEmployees().find(item => String(item.id) === String(record.selectedEmployeeId));
        return employee?.loans?.find(loan => String(loan.id) === String(record.completedLoanId) && loan.voiceRequestId === record.requestId);
    }
    navigate(view, push = true) {
        this.releaseAudio(); if (push) this.stack.push(this.view); this.view = view; this.error = ''; this.feedbackMessage = ''; this.render();
    }
    back() {
        if (this.busy) return;
        if (!this.stack.length) { this.close(); return; }
        this.confirmation = null; this.navigate(this.stack.pop(), false);
    }
    confirm(title, message, perform, label = 'Eliminar') {
        this.confirmation = { title, message, perform, label, generation: this.generation };
        this.navigate('confirm');
    }
    async mutate(callback) {
        const generation = this.generation; this.busy = true; this.error = ''; this.render();
        try { await callback(generation); }
        finally { if (generation === this.generation) { this.busy = false; if (this.dialog.open) this.render(); } }
    }
    async action(action, value = '') {
        if (action === 'close') { this.close(); return; }
        if (this.busy) return;
        if (!this.sameContext()) { this.close(); return; }
        if (action === 'back') { this.back(); return; }
        if (action === 'retry') { this.error = ''; await this.refresh(); return; }
        if (action === 'config') { this.navigate('config'); return; }
        if (['setting','precision','ambiguous'].includes(action)) {
            const settings = this.adapter.getSettings() || {};
            const keys = new Set(['voiceMvpEnabled','voiceFeedback','voiceUsePreviousInterest','voiceReviewBeforeSend']);
            if (action === 'setting' && (!keys.has(value) || value === 'voiceReviewBeforeSend' && !this.adapter.isDeveloper?.())) return;
            await this.adapter.setPreference(action === 'precision' ? 'voiceMatchPrecision' : action === 'ambiguous' ? 'voiceAmbiguousAction' : value,
                action !== 'setting' ? value : !(['voiceFeedback'].includes(value) ? settings[value] !== false : settings[value] === true));
            this.settingsSignature = JSON.stringify(this.adapter.getSettings()); this.render(); this.feedback('Cambio aplicado'); return;
        }
        if (action === 'retention') { this.navigate('retention'); return; }
        this.guard();
        if (action === 'aliases' || action === 'recordings') { this.search = ''; this.navigate(action); await this.refresh(); return; }
        if (action === 'person') { this.employeeId = value; this.guard(this.generation, value); this.navigate('person'); return; }
        if (action === 'edit-alias' || action === 'new-alias') {
            this.guard(this.generation, this.employeeId); this.editing = action === 'new-alias' ? null : value; this.aliasText = this.editing || ''; this.navigate('edit-alias'); return;
        }
        if (action === 'save-alias') {
            const identity = { ...this.context }, employeeId = this.employeeId, old = this.editing, text = this.aliasText;
            await this.mutate(async generation => {
                await this.store.editAlias(identity.uid, identity.projectKey, employeeId, old, text, { guard: () => this.guard(generation, employeeId) });
                this.guard(generation, employeeId); this.view = this.stack.pop() || 'person'; await this.refresh(); this.feedback('Pronunciación guardada');
            }); return;
        }
        if (action === 'remove-alias') {
            const identity = { ...this.context }, employeeId = this.employeeId;
            this.confirm(`¿Eliminar «${value}»?`, 'Dejará de ayudar a encontrar a este empleado.', async generation => {
                await this.store.removeAlias(identity.uid, identity.projectKey, employeeId, value, { guard: () => this.guard(generation, employeeId) });
                this.guard(generation, employeeId); this.view = this.stack.pop() || 'person'; await this.refresh(); this.feedback('Pronunciación eliminada');
            }); return;
        }
        if (action === 'teach') {
            this.guard(this.generation, this.employeeId); this.pauseAudio();
            await this.adapter.onTeachName(this.employeeId); return;
        }
        if (action === 'record-filter') { if (['available','soon','unavailable'].includes(value)) this.recordFilter = value; this.render(); return; }
        if (action === 'audio') {
            this.recordId = value;
            if (!this.recording() || !voiceRecordingInfo(this.recording(), this.adapter.getSettings()).available) throw Error('Audio no disponible. Actualiza la lista.');
            this.navigate('audio'); return;
        }
        if (action === 'play') {
            if (!this.recording() || !voiceRecordingInfo(this.recording(), this.adapter.getSettings()).available) { this.releaseAudio(); await this.refresh(); throw Error('El audio venció o fue eliminado.'); }
            const audio = this.dialog.querySelector('audio'); if (audio.paused) await audio.play(); else audio.pause(); return;
        }
        if (action === 'open-loan') { if (!this.loanFor(this.recording())) throw Error('El préstamo no está disponible en esta obra.'); this.adapter.onOpenLoan(this.recording().selectedEmployeeId); return; }
        if (action === 'remove-audio' || action === 'clear-audio') {
            const identity = { ...this.context }, records = action === 'remove-audio' ? [this.recording()] : this.recordingInfos().filter(row => row.available).map(row => row.record);
            if (!records.length || records.some(record => !record)) return;
            const ids = records.map(record => record.requestId), drafts = records.some(record => !record.completedLoanId);
            this.pauseAudio();
            this.confirm(action === 'remove-audio' ? '¿Eliminar este audio?' : `¿Eliminar ${ids.length} audios?`, `Solo de esta obra y este dispositivo. ${drafts ? 'Los borradores elegidos se eliminarán. ' : ''}Los préstamos y las pronunciaciones se conservan.`, async generation => {
                await this.store.discardRecordingAudio(identity.uid, identity.projectKey, ids, { guard: () => this.guard(generation) });
                this.guard(generation); this.view = 'recordings'; this.stack = ['home']; await this.refresh(); this.feedback('Audio eliminado');
            }); return;
        }
        if (action === 'retention-days') {
            const days = Number(value); if (!Number.isInteger(days) || days < 0 || days > 5) return;
            const old = this.policy(), apply = async generation => {
                this.guard(generation); await this.adapter.setAudioRetention(days); this.guard(generation);
                if (this.view === 'confirm') this.view = this.stack.pop() || 'retention';
                await this.refresh(); this.feedback('Conservación actualizada');
            };
            if (old.keep && (days === 0 || days < old.days)) this.confirm(days === 0 ? '¿Dejar de conservar audios?' : '¿Reducir la conservación?', 'Este ajuste se sincroniza. Se eliminarán los audios de préstamos que superen el nuevo plazo, también en otras obras. Los préstamos se conservan.', apply, days === 0 ? 'No guardar' : 'Aplicar');
            else await this.mutate(apply);
            return;
        }
        if (action === 'confirm') {
            const confirmation = this.confirmation;
            if (!confirmation) return;
            this.guard(confirmation.generation);
            await this.mutate(async generation => {
                await confirmation.perform(generation);
                if (generation === this.generation && this.dialog.open) { this.guard(generation); this.confirmation = null; }
            });
        }
    }
    feedback(message) { this.feedbackMessage = message; const node = this.dialog.querySelector('[data-vs-feedback]'); if (node) node.textContent = message; }
    filterEmployees() {
        const words = normalizeVoiceName(this.search).split(' ').filter(Boolean); let count = 0;
        for (const row of this.dialog.querySelectorAll('[data-vs-person-search]')) { row.hidden = !words.every(word => row.dataset.vsPersonSearch.includes(word)); if (!row.hidden) count++; }
        const empty = this.dialog.querySelector('[data-vs-no-employees]'); if (empty) empty.hidden = count > 0;
    }
    updateAliasWarning() {
        const input = this.dialog.querySelector('[data-vs-alias-input]'), button = this.dialog.querySelector('[data-vs-action=save-alias]'), warning = this.dialog.querySelector('[data-vs-alias-warning]');
        if (!input || !button || !warning) return;
        const value = normalizeVoiceName(this.aliasText), duplicate = this.aliasesFor(this.employeeId).some(alias => alias !== this.editing && normalizeVoiceName(alias) === value);
        const shared = voiceAliasCollisions(value, this.employeeId, this.adapter.getEmployees(), this.aliases || []);
        button.disabled = this.busy || !value || duplicate;
        warning.hidden = !duplicate && !shared.length;
        warning.textContent = duplicate ? 'Esta variante ya está guardada para este empleado.' : shared.length ? `También coincide con ${shared.map(employee=>employee.name).join(', ')}. Tendrás que elegir al buscar.` : '';
    }
    pauseAudio() { this.dialog?.querySelector('audio')?.pause(); }
    releaseAudio() { this.pauseAudio(); if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.audioURL = null; }
    bindAudio() {
        const audio = this.dialog.querySelector('audio'); if (!audio) return;
        if (audio.voiceSettingsBound) return;
        audio.voiceSettingsBound = true;
        const update = () => {
            const button = this.dialog.querySelector('[data-vs-action=play]'), seek = this.dialog.querySelector('[data-vs-seek]'), time = this.dialog.querySelector('[data-vs-time]');
            if (button) { button.innerHTML = vsIcon(audio.paused ? 'play' : 'pause'); button.setAttribute('aria-label', audio.paused ? 'Reproducir audio' : 'Pausar audio'); button.setAttribute('aria-pressed', String(!audio.paused)); }
            if (seek) { seek.max = String(Number.isFinite(audio.duration) ? audio.duration : (this.recording()?.durationMs || 0)/1000 || 1); seek.value = String(audio.currentTime || 0); }
            if (time) { const seconds = Math.floor(audio.currentTime || 0); time.textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
        };
        for (const event of ['play','pause','ended','timeupdate','loadedmetadata']) audio.addEventListener(event, update);
        audio.addEventListener('error', () => { this.error = 'No se pudo reproducir este formato de audio en el navegador.'; const node = this.dialog.querySelector('[data-vs-feedback]'); if (node) node.textContent = this.error; });
        update();
    }
    render() {
        if (this.composing && this.dialog.open) return;
        if (['person','edit-alias'].includes(this.view) && !this.employee()) { this.view = 'aliases'; this.stack = ['home']; this.error = 'El empleado ya no está disponible en esta obra.'; }
        if (this.view === 'audio' && !this.recording()) { this.releaseAudio(); this.view = 'recordings'; this.stack = ['home']; }
        const body = this.dialog.querySelector('.vs-modal-body'), footer = this.dialog.querySelector('.vs-modal-footer');
        const active = this.dialog.contains(document.activeElement) ? document.activeElement : null;
        const focusAction = active?.dataset?.vsAction, focusValue = active?.dataset?.value, inputKey = active?.hasAttribute?.('data-vs-search') ? 'data-vs-search' : active?.hasAttribute?.('data-vs-alias-input') ? 'data-vs-alias-input' : null;
        const selection = inputKey ? [active.selectionStart,active.selectionEnd] : null;
        const structural = this.renderedView !== this.view, oldTop = structural ? 0 : body.scrollTop;
        const before = this.dialog.open ? this.dialog.getBoundingClientRect() : null;
        const toolsOpen = !structural && body.querySelector('details')?.open;
        this.renderedView = this.view;
        const titles = { home:'Voz',config:'Configuración',aliases:'Pronunciaciones',person:'Pronunciaciones','edit-alias':this.editing==null?'Nueva pronunciación':'Editar pronunciación',recordings:'Grabaciones',audio:'Audio del préstamo',retention:'Conservar audio',confirm:'Confirmar' };
        const heading = this.dialog.querySelector('#vs-title'); heading.textContent = titles[this.view] || 'Voz';
        this.dialog.dataset.vsView = this.view;
        this.dialog.querySelector('[data-vs-subtitle]').textContent = this.view === 'config' ? 'Tu forma de trabajar' : this.view === 'aliases' ? 'Cómo le llaman en la obra' : this.adapter.getProjectName?.() || 'Obra actual';
        this.dialog.querySelector('[data-vs-header-icon]').innerHTML = vsIcon(this.view === 'home' ? 'mic' : this.view === 'config' ? 'settings' : ['aliases','person','edit-alias'].includes(this.view) ? 'users' : 'wave');
        const back = this.dialog.querySelector('[data-vs-action=back]'); back.hidden = this.view === 'home'; back.disabled = this.busy;
        const views = { config:VoiceSettingsConfigView, aliases:VoiceSettingsAliasesView, person:VoiceSettingsPersonView, 'edit-alias':VoiceSettingsAliasEditView, recordings:VoiceSettingsRecordingsView, audio:VoiceSettingsAudioView, retention:VoiceSettingsRetentionView };
        let html = '', foot = '';
        const available = this.recordingInfos().filter(row=>row.available);
        if (this.view === 'home') {
            const signedIn = this.context?.uid && this.context.ready && !this.wiped;
            const card = (action,title,sub,icon,disabled=false) => `<button type="button" class="vs-nav-card" data-vs-action="${action}" ${disabled?'disabled':''}><span class="vs-icon-box">${vsIcon(icon)}</span><span class="vs-copy"><strong>${title}</strong><small>${escapeHTML(sub)}</small></span>${vsArrow()}</button>`;
            const summary = `${this.adapter.getSettings()?.voiceMvpEnabled === true ? 'Activada' : 'Desactivada'} · Nivel ${voiceAutoMatchLevel(this.adapter.getSettings()?.voiceMatchPrecision).label.toLowerCase()}`;
            html = `<div class="vs-intro-line"><strong>Tu asistente de voz</strong>${vsWave()}</div>${card('config','Configuración',summary,'settings')}${card('aliases','Pronunciaciones',!signedIn?'Inicia sesión y elige una obra':this.aliases?`${this.adapter.getEmployees().length} empleados · ${this.aliasCount()} variantes`:this.errors.aliases?'No se pudo consultar':'Consultando…','users',!signedIn)}${card('recordings','Grabaciones',!signedIn?'Inicia sesión y elige una obra':this.records?`${available.length} audios · ${voiceBytes(available.reduce((sum,row)=>sum+row.bytes,0))}`:this.errors.records?'No se pudo consultar':'Consultando…','wave',!signedIn)}`;
            foot = `<span class="vs-footnote">${vsIcon('phone')}Audios y alias en este dispositivo</span>`;
        } else if (this.view === 'confirm') {
            html = `<span class="vs-delete-symbol">${vsIcon('trash')}</span><h3 class="vs-confirm-title">${escapeHTML(this.confirmation?.title || '')}</h3><p class="vs-confirm-copy">${escapeHTML(this.confirmation?.message || '')}</p>`;
            foot = `<div class="vs-footer-actions">${vsButton('back','Conservar',{disabled:this.busy})}${vsButton('confirm',this.confirmation?.label||'Eliminar',{danger:true,disabled:this.busy})}</div>`;
        } else {
            const requiresAliases = ['aliases','person','edit-alias'].includes(this.view), requiresRecords = ['recordings','audio'].includes(this.view);
            const missing = requiresAliases && !this.aliases || requiresRecords && !this.records;
            html = missing ? '<p class="vs-loading">'+(this.errors.aliases||this.errors.records?'No se pudieron consultar estos datos.':'Consultando…')+'</p>' : views[this.view]?.(this) || '';
            if (this.view === 'person' && !missing) foot = `<div class="vs-footer-actions">${vsButton('new-alias','Agregar variante',{icon:'plus',primary:true,disabled:this.busy})}</div>`;
            else if (this.view === 'edit-alias' && !missing) foot = `<div class="vs-footer-actions">${vsButton('back','Cancelar',{disabled:this.busy})}${vsButton('save-alias','Guardar',{primary:true,disabled:this.busy})}</div>`;
            else if (this.view === 'audio' && !missing) foot = `<div class="vs-footer-actions">${vsButton('remove-audio','Eliminar audio',{icon:'trash',disabled:this.busy})}</div>`;
            else if (this.view === 'recordings' && !missing) foot = `<span class="vs-footnote">${vsIcon('phone')}Solo en esta obra y dispositivo</span>${vsButton('clear-audio','Limpiar audios',{disabled:this.busy||!available.length})}`;
            else foot = `<span class="vs-footnote">${vsIcon(this.view==='config'?'check':'phone')}${this.view==='config'?'Cambios automáticos':'Datos de este dispositivo'}</span>`;
        }
        const errors = [this.error, ...Object.values(this.errors)].filter(Boolean);
        DOMDiff.apply(body, `${errors.length ? `<div class="vs-inline-error" role="alert">${escapeHTML([...new Set(errors)].join(' '))}${vsButton('retry','Reintentar',{disabled:this.busy})}</div>` : ''}${this.wiped?'<p class="vs-notice">Recarga SA para volver a consultar los datos locales.</p>':''}${html}`);
        DOMDiff.apply(footer, foot + vsFeedback());
        this.feedback(this.feedbackMessage || '');
        if (toolsOpen && body.querySelector('details')) body.querySelector('details').open = true;
        this.filterEmployees(); this.updateAliasWarning(); body.scrollTop = oldTop;
        if (this.view === 'audio' && this.recording()?.audio) {
            if (!this.audioURL) this.audioURL = URL.createObjectURL(this.recording().audio);
            const audio = body.querySelector('audio'); if (audio) { if (audio.getAttribute('src') !== this.audioURL) audio.src = this.audioURL; this.bindAudio(); }
        }
        if (structural) heading.focus({preventScroll:true});
        else if (inputKey) {
            const input = body.querySelector(`[${inputKey}]`); input?.focus({preventScroll:true});
            if (input && selection?.[0] != null) input.setSelectionRange(...selection);
        } else if (focusAction) [...this.dialog.querySelectorAll('[data-vs-action]')].find(node=>node.dataset.vsAction===focusAction&&node.dataset.value===focusValue)?.focus({preventScroll:true});
        const after = this.dialog.open ? this.dialog.getBoundingClientRect() : null;
        if (structural && before?.height && after?.height && before.height !== after.height && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.dialog.animate?.([{height:`${before.height}px`},{height:`${after.height}px`}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
    destroy() {
        this.close(); clearInterval(this.timer); this.unsubscribeSession?.(); this.unsubscribeScope?.(); this.unsubscribeSettings?.();
        window.removeEventListener('sa:voice-wipe',this.onWipe); window.removeEventListener('sa:voice-audio-discarded',this.onDiscard); document.removeEventListener('visibilitychange',this.onVisibility); this.dialog.remove();
    }
}
