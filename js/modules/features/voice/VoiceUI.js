import { VoiceLoanView } from './VoiceLoanView.js';
import { VoiceEmployeeView } from './VoiceEmployeeView.js';
import { VoiceAudioView } from './VoiceAudioView.js';
import { voiceRetentionPolicy, voiceAudioExpiry, VOICE_AUDIO_BUDGET } from './VoiceRetention.js';
import { VoiceStore } from './VoiceStore.js';
import { VoiceRecorder } from './VoiceRecorder.js';
import { LOAN_FIELDS, VOICE_ENDPOINT_PREFIX, VOICE_DEV_ENDPOINT, normalizeVoiceName, isVoiceEndpointAllowed, createVoiceContext, sendVoiceRecording, resolveVoiceEmployees, voiceBlocked, voiceDraftReady } from './VoiceCore.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { completeVoiceLoanDraft, voiceLoanNote } from './VoiceLoanDraft.js';
import { getDateKey } from '../../utils/DateUtils.js';

const micIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
const projectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';

// Patch in place so editing and playback retain their live DOM nodes.
function patchVoiceNode(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next.cloneNode(true)); return; }
    if (current.nodeType === Node.TEXT_NODE) { if (current.data !== next.data) current.data = next.data; return; }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of [...current.attributes]) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of next.attributes) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    if (current.tagName === 'AUDIO') return;
    if (current.tagName === 'INPUT') { if (current.value !== next.value) current.value = next.value; current.checked = next.checked; return; }
    if (current.tagName === 'TEXTAREA') { if (current.value !== next.value) current.value = next.value; return; }
    const children = [...next.childNodes];
    children.forEach((child, index) => {
        if (current.childNodes[index]) patchVoiceNode(current.childNodes[index], child);
        else current.append(child.cloneNode(true));
    });
    while (current.childNodes.length > children.length) current.lastChild.remove();
    if (current.tagName === 'SELECT') current.value = next.value;
}

export class VoiceMvpUI {
    constructor(adapter, { store = new VoiceStore(), recorderFactory = options => new VoiceRecorder(options) } = {}) {
        this.adapter = adapter; this.store = store; this.recorderFactory = recorderFactory;
        this.message = ''; this.busy = false; this.history = []; this.matches = []; this.allEmployees = false;
    }
    mount() {
        this.launcher = document.createElement('button'); this.launcher.type = 'button'; this.launcher.className = 'voice-launcher';
        this.launcher.style.touchAction = 'none';
        this.launcher.innerHTML = `${micIcon}<span>Voz</span>`; this.launcher.setAttribute('aria-label', 'Mantén pulsado para grabar; suelta para terminar. Con teclado, pulsa para iniciar o detener.');
        this.dialog = document.createElement('dialog'); this.dialog.className = 'voice-dialog'; this.dialog.setAttribute('aria-label', 'Borrador de voz');
        document.body.append(this.launcher, this.dialog);
        this.wave = document.createElement('div'); this.wave.className = 'voice-wave'; this.wave.hidden = true;
        this.wave.innerHTML = '<span role="status">Grabando · suelta para terminar</span><div aria-hidden="true">' + '<i></i>'.repeat(9) + '</div>';
        document.body.append(this.wave);
        this.launcher.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.held) return;
            event.preventDefault(); this.held = true; this.pointerId = event.pointerId;
            this.launcher.setPointerCapture?.(event.pointerId);
            this.run(() => this.beginHold());
        });
        this.launcher.addEventListener('pointerup', event => { if (event.pointerId === this.pointerId) this.finishHold(); });
        this.launcher.addEventListener('pointercancel', () => this.cancelHold());
        this.launcher.addEventListener('lostpointercapture', () => { if (this.held) this.cancelHold(); });
        this.launcher.addEventListener('contextmenu', event => event.preventDefault());
        this.launcher.addEventListener('click', event => { if (event.detail === 0) this.run(() => this.recording ? this.finishHold() : this.beginHold()); });
        this.onBlur = () => { if (this.recording) this.cancelHold(); };
        this.onKey = event => { if (event.key === 'Escape' && this.recording) this.cancelHold(); };
        window.addEventListener('blur', this.onBlur); window.addEventListener('keydown', this.onKey);
        this.onVisibility = () => { if (document.hidden) this.cancelHold(); };
        document.addEventListener('visibilitychange', this.onVisibility);
        this.dialog.addEventListener('click', event => {
            const button = event.target.closest('[data-voice-action]');
            if (button) this.run(() => this.action(button.dataset.voiceAction, button.dataset.id));
        });
        this.dialog.addEventListener('change', event => this.run(() => this.change(event.target)));
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.run(() => this.action('close')); });
        this.onWipe = () => { this.wiped = true; this.close({ discard: true }); this.record = null; this.history = []; this.launcher.hidden = true; };
        window.addEventListener('sa:voice-wipe', this.onWipe);
        this.unsubscribeScope = this.adapter.subscribeScope?.(() => { this.close({ discard: true }); this.record = null; this.history = []; });
        this.unsubscribeEnabled = this.adapter.subscribeEnabled?.(() => { this.refreshVisibility(); this.run(() => this.maintenance()); });
        this.unsubscribe = this.adapter.subscribeSession?.(() => {
            this.refreshVisibility();
            this.run(() => this.maintenance());
            const uid = this.adapter.getUser()?.uid;
            if (!uid || (this.record && uid !== this.record.uid) || (this.recording && uid !== this.recordingUid)) { this.close({ discard: true }); this.record = null; }
        });
        this.refreshVisibility();
        this.run(() => this.maintenance());
        this.maintenanceTimer = setInterval(() => this.run(() => this.maintenance()), 5 * 60 * 1000);
        return this;
    }
    refreshVisibility() {
        this.launcher.hidden = this.wiped || this.adapter.isEnabled?.() === false || !this.adapter.getUser();
        if (this.launcher.hidden && ((this.dialog.open && this.view !== 'playback' && this.view !== 'storage') || this.recording)) this.close({ discard: true });
    }
    async run(callback) {
        try { await callback(); } catch (error) { if (!this.dialog.open) this.adapter.notify?.(error.message || 'No se pudo completar la acción.', 'warning'); this.messageError = true; this.message = error.message || 'No se pudo completar la acción.'; if (this.dialog.open) this.render(); }
    }
    identity(allowDisabled = false) {
        if (this.wiped) throw Error('Los datos locales se borraron. Recarga SA antes de usar Voz.');
        if (!allowDisabled && this.adapter.isEnabled?.() === false) throw Error('Activa la prueba de voz en Configuración → Tests.');
        const user = this.adapter.getUser(); if (!user) throw Error('Inicia sesión para usar el MVP de voz.');
        const scope = this.adapter.getScope(); if (scope?.enabled && !scope.projectId) throw Error('Selecciona un proyecto primero.');
        return { uid: user.uid, projectKey: projectKey(scope) };
    }
    guard(record = this.record) {
        const identity = this.identity(this.view === 'playback' || this.view === 'storage');
        if (record?.discarded) throw Error('Esta grabación se descartó.');
        if (!record || record.uid !== identity.uid || record.projectKey !== identity.projectKey) throw Error('Este borrador pertenece a otra cuenta o proyecto. Vuelve a abrir Voz.');
        return identity;
    }
    endpoint() {
        const saved = localStorage.getItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`);
        // The legacy HTTP endpoint cannot be used from the public HTTPS preview.
        return (saved === VOICE_DEV_ENDPOINT && location.protocol === 'https:' ? this.adapter.getEndpoint() : saved) || this.adapter.getEndpoint() || '';
    }
    async open() {
        const identity = this.identity();
        if (this.record && (this.record.uid !== identity.uid || this.record.projectKey !== identity.projectKey)) this.record = null;
        await this.maintenance();
        this.history = await this.store.list(identity.uid, identity.projectKey); this.message = '';
        if (!this.record?.audio || this.record.discarded || this.record.completedLoanId) this.record = this.history.find(r => r.audio && !r.completedLoanId) || null;
        this.view = this.record?.result ? (this.record.selectedEmployeeId ? 'loan' : 'employees') : 'audio';
        await this.prepareLoadedLoan(); await this.refreshMatches(); this.render(); this.dialog.showModal();
    }
    close({ discard = false } = {}) {
        if (discard && this.record && !this.record.completedLoanId) { const record = this.record; record.discarded = true; if (this.processingRecord === record) this.processingController?.abort(); this.store.remove?.(record.uid, record.requestId).catch(() => this.adapter.notify?.('No se pudo eliminar el audio descartado.', 'warning')); }
        this.finishConfirmation?.(false);
        this.recorder?.cancel(); this.recording = false; this.held = false; this.showWave(false);
        this.dialog.querySelector?.('audio')?.pause?.();
        if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.audioURL = null; this.audioBlob = null;
        if (this.record?.completedLoanId) { delete this.record.audio; delete this.record.fileBase64; }
        this.dialog.close(); this.launcher.focus();
    }
    showWave(on) {
        if (this.wave) { this.wave.hidden = !on; if (on) this.wave.querySelector('[role=status]').textContent = 'Activando micrófono…'; }
        this.launcher?.setAttribute('aria-pressed', String(on));
    }
    async beginHold() {
        this.held = true;
        if (this.busy || this.recording) { this.held = false; return; }
        this.identity();
        if (this.record && !this.record.completedLoanId) {
            this.record.discarded = true; await this.store.remove?.(this.record.uid, this.record.requestId);
        }
        this.record = null;
        if (!this.held) return;
        this.view = 'audio';
        if (this.dialog.open) this.dialog.close();
        await this.action('record');
    }
    finishHold() {
        this.held = false;
        if (this.recorder?.recorder?.state === 'recording') this.recorder.stop();
        else { this.recorder?.cancel(); this.recording = false; this.showWave(false); this.adapter.notify?.('No se grabó audio. Mantén pulsado de nuevo cuando el micrófono esté disponible.', 'info'); }
    }
    cancelHold() {
        if (!this.recording) return;
        this.held = false; this.recorder?.cancel(); this.recording = false; this.showWave(false);
    }
    async maintenance() {
        const user = this.adapter.getUser(); if (!user || this.wiped || this.maintaining) return;
        this.maintaining = true;
        try {
            await this.store.maintain?.(user.uid, voiceRetentionPolicy(this.adapter.getSettings?.()));
            this.storage = await this.store.storageStatus?.();
            if (this.view === 'playback' && this.record && voiceAudioExpiry(this.record, voiceRetentionPolicy(this.adapter.getSettings?.())) <= Date.now()) { this.close(); this.adapter.notify?.('El audio venció y fue eliminado.', 'info'); }
            if (this.adapter.getUser()?.uid !== user.uid) return;
            const status = document.querySelector('[data-voice-storage-status]');
            if (status && this.storage) status.textContent = `${(this.storage.bytes / 1048576).toFixed(1)} MiB / 50 MiB · ${this.storage.count} audios`;
            const warning = document.querySelector('[data-voice-storage-warning]');
            if (warning) { warning.hidden = !this.storage?.low; warning.textContent = 'Queda poco espacio. Elimina audios o desactiva su conservación.'; }
            const uid = user.uid; const scope = projectKey(this.adapter.getScope());
            for (const button of document.querySelectorAll('[data-voice-loan-audio]')) {
                const r = await this.store.get?.(uid, button.dataset.voiceLoanAudio);
                if (this.adapter.getUser()?.uid !== uid || projectKey(this.adapter.getScope()) !== scope) return;
                const available = r?.audio && r.projectKey === scope && String(r.selectedEmployeeId) === button.dataset.arg && String(r.completedLoanId) === button.dataset.loanId && voiceAudioExpiry(r, voiceRetentionPolicy(this.adapter.getSettings?.())) > Date.now();
                button.disabled = !available; button.textContent = available ? 'Escuchar audio' : 'Audio no disponible';
                button.title = available ? 'Grabación local de la instrucción' : 'El audio venció, se eliminó o no está en este navegador';
            }
        } finally { this.maintaining = false; }
    }
    async playLoanAudio(employeeId, requestId) {
        const identity = this.identity(true); await this.maintenance();
        const employee = this.adapter.getEmployees().find(e => String(e.id) === String(employeeId));
        const loan = employee?.loans?.find(l => l.voiceRequestId === requestId);
        if (!loan) throw Error('Préstamo no disponible en el proyecto activo.');
        const record = await this.store.get(identity.uid, requestId);
        if (this.adapter.getUser()?.uid !== identity.uid || projectKey(this.adapter.getScope()) !== identity.projectKey) throw Error('Cambió la cuenta o proyecto.');
        if (!record?.audio || record.projectKey !== identity.projectKey || String(record.completedLoanId) !== String(loan.id) || String(record.selectedEmployeeId) !== String(employeeId) || voiceAudioExpiry(record, voiceRetentionPolicy(this.adapter.getSettings?.())) <= Date.now()) throw Error('Audio no disponible en este navegador.');
        this.record = record; this.view = 'playback'; this.message = ''; this.render(); this.dialog.showModal();
    }
    async openStorage() {
        this.identity(true); await this.maintenance(); this.view = 'storage'; this.message = ''; this.render(); this.dialog.showModal();
    }
    async routeResult() {
        if (!this.record?.result || this.record.pendingResult) return;
        if (voiceBlocked(this.record.result)) { this.view = 'audio'; return; }
        if (!this.selected()) {
            const exact = this.matches.filter(m => m.score >= 1);
            // Conflicting name/number must be resolved by the user, even when the number is exact.
            let conflicts = false;
            if (this.record.mention.spokenName && this.record.mention.spokenNumber && exact.length === 1) {
                const named = resolveVoiceEmployees({ spokenName: this.record.mention.spokenName }, this.adapter.getEmployees(), this.employeeAliases);
                conflicts = !named.some(m => m.employee.id === exact[0].employee.id && m.score >= 1);
            }
            if (exact.length !== 1 || conflicts) { this.view = 'employees'; return; }
            this.record.selectedEmployeeId = exact[0].employee.id;
            this.applyInitialRate(exact[0].employee); await this.save();
        }
        if (this.record.result.intent === 'crear_prestamo') { this.view = 'loan'; return; }
        if ((this.record.result.needsReview || this.record.result.issues.length) && !this.record.reviewed) { this.view = 'navigation'; return; }
        const action = this.record.result.intent === 'abrir_prestamos' ? 'loans' : this.record.result.intent === 'abrir_asistencia' || this.record.result.intent === 'buscar_empleado' ? 'attendance' : 'profile';
        await this.action(action);
    }
    applyInitialRate(employee) {
        if (this.record.draft && this.record.rateDefault && !this.record.employeeDefaultsApplied) {
            this.record.draft.interestRate = completeVoiceLoanDraft({ interestRate: null }, this.adapter.getLoanDefaults?.(employee)).interestRate;
            this.record.employeeDefaultsApplied = true;
        }
    }
    async save() { this.guard(); await this.store.put(this.record); }
    async refreshMatches() {
        const identity = this.identity();
        const aliases = await this.store.aliases(identity.uid, identity.projectKey);
        this.employeeAliases = aliases;
        this.matches = resolveVoiceEmployees(this.record?.mention || {}, this.adapter.getEmployees(), aliases);
    }
    selected() { return this.adapter.getEmployees().find(e => e.id === this.record?.selectedEmployeeId); }
    loanReady() {
        if (!voiceDraftReady(this.record?.draft)) return false;
        if (this.record.draft.installmentMode !== 'lump') return true;
        const periods = this.adapter.getLoanDefaults?.(this.selected())?.periods;
        return !!this.record.draft.dueDate && (!periods || periods.some(p => p.payDate === this.record.draft.dueDate && p.payDate > getDateKey(new Date())));
    }
    async prepareLoadedLoan() {
        if (!this.record?.result?.loan || this.record.loanDefaultsVersion) return;
        this.record.rateDefault = this.record.draft?.interestRate == null;
        this.record.draft = completeVoiceLoanDraft(this.record.draft || this.record.result.loan, this.adapter.getLoanDefaults?.(this.selected()));
        this.record.loanDefaultsVersion = 1; await this.save();
    }
    applyResult(result, record = this.record) {
        record.result = result; record.mention = { ...result.employee }; record.transcript = result.transcript;
        record.draft = result.loan ? completeVoiceLoanDraft(result.loan, this.adapter.getLoanDefaults?.(null)) : null;
        record.rateDefault = result.loan?.interestRate === null;
        record.loanDefaultsVersion = 1;
        record.employeeDefaultsApplied = false; record.selectedEmployeeId = null; record.reviewed = false; record.dirty = false; record.pendingResult = null;
    }
    confirmInline(message) {
        return new Promise(resolve => {
            this.confirmation = message;
            this.finishConfirmation = accepted => {
                this.confirmation = null; this.finishConfirmation = null; this.focusAfterConfirmation = true;
                resolve(accepted); if (this.dialog.open) this.render();
            };
            this.render();
            this.dialog.querySelector('[data-voice-action="confirm-cancel"]')?.focus();
        });
    }
    async action(action, id) {
        if (action === 'confirm-accept' || action === 'confirm-cancel') { this.finishConfirmation?.(action === 'confirm-accept'); return; }
        if (this.confirmation && action !== 'close') return;
        this.messageError = false;
        if (action === 'close') { this.close({ discard: true }); return; }
        if (action === 'stop') { this.recorder?.stop(); return; }
        if (this.busy || this.recording) return;
        if (action === 'clear-audio') {
            const identity = this.identity(true);
            if (!await this.confirmInline('¿Eliminar los audios de esta cuenta en este navegador? Los préstamos se conservarán.')) return;
            if (this.identity(true).uid !== identity.uid) throw Error('Cambió la cuenta.');
            await this.store.clearAudio(identity.uid); if (this.record?.uid === identity.uid) { if (!this.record.completedLoanId) this.record.discarded = true; delete this.record.audio; } await this.maintenance(); this.message = 'Audios eliminados.'; this.render(); return;
        }
        if (this.view === 'playback' || this.view === 'storage') return;
        if (action === 'back-loan') { this.view = 'loan'; this.render(); return; }
        if (action === 'default-endpoint') { localStorage.removeItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`); this.message = 'URL predeterminada restaurada.'; this.render(); return; }
        if (action === 'record') {
            if (this.record && !this.record.completedLoanId) { this.record.discarded = true; await this.store.remove?.(this.record.uid, this.record.requestId); }
            this.record = null; if (this.dialog.open) this.dialog.close();
            const identity = this.identity(); this.message = ''; this.recordingUid = identity.uid; this.recording = true; this.showWave(true);
            this.recorder = this.recorderFactory({ onLevel: level => this.wave?.style.setProperty('--voice-level', String(level)), onError: error => { this.recording = false; this.held = false; this.showWave(false); this.message = error.message; this.view = 'audio'; this.render(); if (!this.dialog.open) this.dialog.showModal(); }, onComplete: captured => this.run(async () => {
                this.recording = false; this.held = false; this.showWave(false); this.view = 'audio'; this.allEmployees = false;
                if (this.identity().uid !== identity.uid || this.identity().projectKey !== identity.projectKey) throw Error('Cambió la cuenta o proyecto. Graba nuevamente.');
                const extension = captured.mimeType.includes('mp4') ? 'm4a' : captured.mimeType.includes('ogg') ? 'ogg' : 'webm';
                this.record = { ...identity, ...captured, requestId: crypto.randomUUID(), createdAt: Date.now(), fileName: `voice.${extension}`, context: createVoiceContext(), result: null, draft: null, mention: {}, dirty: false };
                const capturedRecord = this.record;
                try { await this.save(); this.history = await this.store.list(identity.uid, identity.projectKey); this.message = 'Audio guardado en este dispositivo. Listo para procesar.'; }
                catch (error) { capturedRecord.unsaved = true; throw error; }
                finally { if (!capturedRecord.discarded && this.record === capturedRecord && this.adapter.getUser()?.uid === identity.uid && projectKey(this.adapter.getScope()) === identity.projectKey) { await this.refreshMatches(); this.render(); if (!this.dialog.open) this.dialog.showModal(); } }
            }) });
            try { await this.recorder.start(); if (this.recording && this.wave && this.recorder.recorder?.state === 'recording') this.wave.querySelector('[role=status]').textContent = 'Grabando · suelta para terminar'; } catch (error) { if (!this.recording) return; this.recording = false; this.held = false; this.showWave(false); this.view = 'audio'; this.render(); if (!this.dialog.open) this.dialog.showModal(); throw error; }
            return;
        }
        if (action === 'load') {
            const identity = this.identity(); this.record = await this.store.get(identity.uid, id); this.guard();
            this.allEmployees = false; this.view = this.record.completedLoanId ? 'playback' : this.record.selectedEmployeeId ? 'loan' : 'employees'; this.message = ''; await this.prepareLoadedLoan(); await this.refreshMatches(); this.render(); return;
        }
        this.guard();
        if (action === 'save-audio') { delete this.record.unsaved; try { await this.save(); } catch (error) { this.record.unsaved = true; throw error; } this.render(); return; }
        if (action === 'process') { await this.process(); return; }
        if (action === 'apply-result') {
            if (!await this.confirmInline('¿Reemplazar los campos editados con el nuevo resultado?')) return;
            this.guard();
            this.applyResult(this.record.pendingResult); await this.save(); await this.refreshMatches(); await this.routeResult(); this.render(); return;
        }
        if (action === 'delete') {
            if (!await this.confirmInline('¿Eliminar este audio y su borrador del dispositivo?')) return;
            this.guard();
            await this.store.remove(this.record.uid, this.record.requestId); this.record = null;
            const identity = this.identity(); this.history = await this.store.list(identity.uid, identity.projectKey); this.render(); return;
        }
        if (action === 'choose') { this.view = 'employees'; this.allEmployees = true; this.render(); return; }
        if (action === 'select') {
            const employee = this.adapter.getEmployees().find(e => e.id === id); if (!employee) throw Error('Empleado no disponible en el proyecto activo.');
            this.record.selectedEmployeeId = id;
            this.applyInitialRate(employee);
            if (this.dialog.querySelector?.('[data-voice-remember]')?.checked) await this.store.saveAlias(this.record.uid, this.record.projectKey, employee.id, this.record.mention.spokenName);
            this.record.dirty = true; this.allEmployees = false; await this.save(); await this.routeResult(); this.render(); return;
        }
        const employee = this.selected(); if (!employee) throw Error('Selecciona al empleado correcto primero.');
        if (action === 'previous-interest') {
            const rate = this.adapter.getLoanDefaults?.(employee)?.previousRate;
            if (rate === null || rate === undefined) throw Error('Este empleado no tiene una tasa anterior válida.');
            this.record.draft.interestRate = rate; this.record.rateDefault = false; this.record.dirty = true; await this.save(); this.render(); return;
        }
        if (action === 'learn') {
            const alias = this.dialog.querySelector('[data-voice-alias]').value;
            if (!normalizeVoiceName(alias)) throw Error('Escribe la variante que quieres asociar al empleado.');
            await this.store.saveAlias(this.record.uid, this.record.projectKey, employee.id, alias); this.message = `Coincidencia asociada a ${employee.name} y guardada solo en este dispositivo.`;
            await this.refreshMatches(); this.render(); return;
        }
        if (action === 'clear-aliases') { await this.store.clearAliases(this.record.uid, this.record.projectKey, employee.id); this.message = 'Alias locales del empleado eliminados.'; await this.refreshMatches(); this.render(); return; }
        if (voiceBlocked(this.record.result)) throw Error('La instrucción está negada o no se pudo interpretar. Graba una nueva instrucción.');
        if (action === 'loan') {
            if (this.record.completedLoanId) throw Error('Esta grabación ya registró un préstamo. Graba una instrucción nueva.');
            if ((this.record.result.needsReview || this.record.result.issues.length) && !this.record.reviewed) throw Error('Revisa las advertencias y confirma que las revisaste.');
            if (!this.loanReady()) throw Error('Completa el monto y la fecha de cobro del préstamo. Revisa el calendario de nómina si no hay fechas disponibles.');
            const validation = this.adapter.validateLoan(this.record.draft); if (!validation.valid) throw Error(validation.errors.join('. '));
            const record = this.record;
            this.busy = true; this.render();
            try {
                const loan = await this.adapter.onLoan(employee.id, { ...record.draft, concept: voiceLoanNote(record, record.draft.concept) }, { requestId: record.requestId, guard: () => this.guard(record), confirm: message => this.confirmInline(message) });
                if (loan === null) { this.message = 'Registro cancelado. Conservamos el borrador.'; return; }
                record.completedLoanId = loan?.id || null; record.registeredAt = Number.isFinite(loan?.createdAt) ? loan.createdAt : Date.now();
                const policy = voiceRetentionPolicy(this.adapter.getSettings?.());
                record.audioExpiresAt = voiceAudioExpiry(record, policy);
                let warning = '';
                try {
                    const space = await this.store.storageStatus?.();
                    const retained = policy.keep && (!space || space.bytes <= VOICE_AUDIO_BUDGET && (space.available === null || space.available > 0));
                    if (!retained) { delete record.audio; delete record.fileBase64; record.audioDiscardedAt = Date.now(); }
                    await this.store.put(record);
                    if (!retained && policy.keep) warning = 'Préstamo registrado; no se conservó el audio por falta de espacio.';
                } catch (_) { warning = 'Préstamo registrado; no se pudo conservar el audio.'; await this.store.remove?.(record.uid, record.requestId).catch(() => {}); }
                this.close(); if (warning) this.adapter.notify?.(warning, 'warning');
                await this.maintenance();
            } finally { this.busy = false; if (this.dialog.open) this.render(); }
            return;
        }
        if ((this.record.result.needsReview || this.record.result.issues.length) && !this.record.reviewed) throw Error('Revisa las advertencias antes de continuar.');
        if (action === 'profile') this.adapter.onProfile(employee.id);
        if (action === 'attendance') this.adapter.onAttendance(employee.id);
        if (action === 'loans') this.adapter.onLoans(employee.id);
        await this.store.remove?.(this.record.uid, this.record.requestId); this.record = null; this.close();
    }
    async process() {
        if (this.record.unsaved) throw Error('Conserva el audio localmente antes de enviarlo.');
        if (this.record.retryAt > Date.now()) throw Error('Espera hasta ' + new Date(this.record.retryAt).toLocaleTimeString() + ' antes de reintentar.');
        const record = this.record; this.processingRecord = record; this.processingController = new AbortController(); this.busy = true; this.message = 'Procesando la grabación…'; this.render();
        try {
            const result = await sendVoiceRecording({ url: this.endpoint(), record, externalSignal: this.processingController.signal, getToken: async force => { this.guard(record); return this.adapter.getUser().getIdToken(force); } });
            this.guard(record);
            if (record.dirty) { record.pendingResult = result; this.message = 'Llegó un nuevo resultado. Tus ediciones se conservaron; puedes reemplazarlas explícitamente.'; }
            else { this.applyResult(result, record); this.message = 'Borrador listo para revisar.'; }
            record.retryAt = null; record.error = null; await this.store.put(record);
            if (this.record?.requestId === record.requestId) { await this.refreshMatches(); this.busy = false; await this.routeResult(); }
            else this.message = 'El resultado se conservó con su grabación original.';
        } catch (error) {
            if (record.discarded) return;
            record.error = { code: error.code || 'ERROR', status: error.status || null, message: error.message, retryable: !!error.retryable };
            record.retryAt = error.retryAfterMs ? Date.now() + error.retryAfterMs : null;
            clearTimeout(this.retryTimer);
            if (error.retryAfterMs) this.retryTimer = setTimeout(() => { if (this.dialog.open && this.record === record && !record.discarded) this.render(); }, error.retryAfterMs);
            if (!this.wiped && !record.discarded) await this.store.put(record); this.message = error.message;
        } finally { this.busy = false; if (this.dialog.open) this.render(); }
    }
    async change(input) {
        if (input.dataset.voiceEndpoint !== undefined) {
            const value = input.value.trim(); if (value && !isVoiceEndpointAllowed(value)) throw Error('Usa HTTPS o el endpoint Tailscale de desarrollo desde http://127.0.0.1:8080.');
            localStorage.setItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`, value); this.message = 'Endpoint guardado localmente. No contiene credenciales.'; return;
        }
        if (this.busy || this.recording || !this.record) return;
        if (!input.dataset.voiceField && !input.dataset.voiceMention && input.dataset.voiceTranscript === undefined && input.dataset.voiceReviewed === undefined) return;
        this.guard(); const field = input.dataset.voiceField;
        if (field) {
            this.record.draft ||= Object.fromEntries(LOAN_FIELDS.map(k => [k, null]));
            const v = input.value;
            this.record.draft[field] = v === '' ? null : ['principal', 'interestRate', 'installmentCount', 'installmentFrequencyWeeks'].includes(field) ? Number(v) : field === 'interestIncluded' ? v === 'true' : v;
            if (field === 'interestRate') this.record.rateDefault = false;
            if (field === 'installmentMode' && v === 'installments' && this.record.draft.installmentCount < 2) this.record.draft.installmentCount = 2;
        }
        if (input.dataset.voiceMention) { this.record.mention[input.dataset.voiceMention] = input.value || null; this.record.selectedEmployeeId = null; this.record.reviewed = false; this.view = 'employees'; }
        if (input.dataset.voiceTranscript !== undefined) this.record.transcript = input.value;
        if (input.dataset.voiceReviewed !== undefined) this.record.reviewed = input.checked;
        this.record.dirty = true; await this.save(); await this.refreshMatches(); this.render();
    }
    render() {
        const record = this.record; const result = record?.result; const selected = this.selected();
        if (this.view === 'loan' && !selected) this.view = 'employees';
        this.view ||= result ? selected ? 'loan' : 'employees' : 'audio';
        const blocked = voiceBlocked(result); const disabled = this.busy || this.recording;
        const oldBody = this.dialog.querySelector('.voice-body');
        const before = this.dialog.getBoundingClientRect();
        const phase = this.view || (this.recording ? 'recording' : result ? 'review' : record ? 'audio' : 'start');
        const previousPhase = this.phase;
        const structural = previousPhase !== phase; this.phase = phase;
        const active = this.dialog.contains(document.activeElement) ? document.activeElement : null;
        const focusKey = active && [...active.attributes].find(a => a.name.startsWith('data-voice-') && a.name !== 'data-voice-name');
        const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        const scrollTop = oldBody?.scrollTop || 0;
        this.viewScrolls ||= new Map();
        if (previousPhase) this.viewScrolls.set(previousPhase, scrollTop);
        const targetScroll = structural ? this.viewScrolls.get(phase) || 0 : scrollTop;
        const listScroll = this.dialog.querySelector('.voice-all')?.scrollTop || 0;
        const openDetails = [...this.dialog.querySelectorAll('details[open]')].map(d => d.querySelector('summary')?.textContent);
        const localInputs = [...(this.renderedRequestId === record?.requestId ? this.dialog.querySelectorAll('[data-voice-search], [data-voice-alias]') : [])].map(i => [i.hasAttribute('data-voice-search') ? 'data-voice-search' : 'data-voice-alias', i.value]);
        this.renderedRequestId = record?.requestId;
        const sameAudio = this.audioBlob === record?.audio;
        if (!sameAudio || (record?.audio && !this.audioURL)) {
            if (this.audioURL) URL.revokeObjectURL(this.audioURL);
            this.audioURL = record?.audio ? URL.createObjectURL(record.audio) : null; this.audioBlob = record?.audio;
        }
        const button = (action, text, off = false, id = '') => `<button type="button" data-voice-action="${action}" data-id="${escapeAttr(id)}" ${off ? 'disabled' : ''}>${text}</button>`;
        if (this.view === 'loan' && !selected) this.view = 'employees';
        const view = this.view || (record?.result ? selected ? 'loan' : 'employees' : 'audio');
        this.view = view;
        const review = result && (result.needsReview || result.issues.length) ? `<section class="voice-review"><strong>Revisión necesaria</strong><ul>${result.issues.map(x => `<li>${escapeHTML(x.message)}</li>`).join('')}</ul><label><input type="checkbox" data-voice-reviewed ${record.reviewed ? 'checked' : ''} ${disabled ? 'disabled' : ''}> Revisé las advertencias</label></section>` : '';
        const views = {
            audio: () => VoiceAudioView(this, button) + (blocked && result ? '<section class="voice-review" role="alert">Instrucción negada o no reconocida. No se registrará una operación.</section>' : ''),
            employees: () => VoiceEmployeeView(this, button),
            loan: () => review + VoiceLoanView(this, button),
            navigation: () => review + `<section class="voice-selected"><strong>${escapeHTML(selected?.name || '')}</strong><span class="voice-code">#${escapeHTML(selected?.number || '—')}</span></section>${button('choose', 'Otro empleado')}${button(result?.intent === 'abrir_prestamos' ? 'loans' : 'attendance', result?.intent === 'abrir_prestamos' ? 'Ir a préstamos' : 'Abrir perfil y asistencia', !selected || !!((result.needsReview || result.issues.length) && !record.reviewed))}`,
            playback: () => `<p>Grabación de la instrucción · disponible en este dispositivo.</p><audio controls src="${escapeAttr(this.audioURL || '')}"></audio><p>Se elimina el ${escapeHTML(new Date(record.audioExpiresAt).toLocaleString('es-DO', { timeZone: record.context?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false }))}.</p>`,
            storage: () => `<p>${this.storage ? `${(this.storage.bytes / 1048576).toFixed(1)} MiB / 50 MiB · ${this.storage.count} audios` : 'No se pudo estimar el espacio.'}</p>${button('clear-audio', 'Eliminar audios guardados')}`
        };
        const markup = `<p role="status">${escapeHTML(this.message)}</p>${this.storage?.low ? '<section class="voice-review" role="alert">Queda poco espacio para audios. Revisa Configuración → Tests.</section>' : ''}${views[view]()}`;
        if (!oldBody) this.dialog.innerHTML = `<header class="voice-header"><div class="voice-mark">${micIcon}</div><div><span class="voice-kicker">PRUEBA DE VOZ</span><h2 id="voice-title">Borrador de voz</h2><p>Revisa la instrucción antes de confirmar.</p></div>${button('close', 'Cerrar')}</header><div class="voice-progress"></div><div class="voice-body"></div><footer class="voice-footer"></footer>`;
        this.dialog.setAttribute('aria-labelledby', 'voice-title');
        const liveBody = this.dialog.querySelector('.voice-body');
        const body = document.createElement('div'); body.className = 'voice-body';
        const template = document.createElement('template'); template.innerHTML = markup;
        template.content.querySelector('header')?.remove();
        body.replaceChildren(template.content);
        const action = view === 'loan' ? 'loan' : view === 'audio' ? record?.audio ? 'process' : 'record' : view === 'navigation' ? result.intent === 'abrir_prestamos' ? 'loans' : 'attendance' : view === 'storage' ? 'clear-audio' : null;
        const primary = action ? body.querySelector(`[data-voice-action="${action}"]`) : null;
        const validation = action === 'loan' && record?.draft ? this.adapter.validateLoan(record.draft) : null;
        if (primary && validation && !validation.valid) primary.disabled = true;
        const footer = this.dialog.querySelector('.voice-footer');
        const titles = { audio: ['Revisa el audio', 'Escucha el audio antes de enviarlo.'], employees: ['Selecciona al empleado', 'Confirma a quién se refiere la instrucción.'], loan: ['Revisa el préstamo', 'Verifica los datos antes de registrarlo.'], navigation: ['Revisa la instrucción', 'Confirma las advertencias para continuar.'], playback: ['Audio del préstamo', 'Grabación local de la instrucción.'], storage: ['Audios guardados', 'Libera espacio en este navegador.'] };
        this.dialog.querySelector('#voice-title').textContent = titles[view][0];
        this.dialog.querySelector('.voice-header p').textContent = titles[view][1];
        this.dialog.dataset.voiceView = view;
        let hint = view === 'loan' ? 'El préstamo se registra solo al confirmar.' : view === 'employees' ? 'Selecciona al empleado correcto.' : 'Audio local · máximo 60 segundos.';
        if (primary?.disabled) {
            hint = record?.retryAt > Date.now() ? `Puedes reintentar a las ${new Date(record.retryAt).toLocaleTimeString()}.` : record?.unsaved ? 'Conserva el audio localmente antes de enviarlo.' : this.busy ? 'Espera a que termine el procesamiento.' : record?.completedLoanId ? 'Esta grabación ya registró un préstamo.' : !selected ? 'Selecciona al empleado correcto.' : (result?.needsReview || result?.issues.length) && !record.reviewed ? 'Confirma que revisaste las advertencias.' : !record?.draft?.principal ? 'Completa el monto del préstamo.' : validation && !validation.valid ? validation.errors.join('. ') : 'Completa los datos y la fecha de cobro.';
        }
        footer.innerHTML = `${view === 'playback' ? '' : button('close', view === 'storage' ? 'Cerrar' : 'Cancelar', this.busy && !!record?.completedLoanId)}<p class="voice-hint" id="voice-hint">${escapeHTML(hint)}</p>`;
        if (primary) { primary.classList.add('voice-primary'); primary.setAttribute('aria-describedby', 'voice-hint'); footer.append(primary); }
        if (this.confirmation) {
            footer.innerHTML = `<section class="voice-confirm" role="alert"><strong>Confirma la acción</strong><p>${escapeHTML(this.confirmation)}</p><div class="voice-actions">${button('confirm-cancel', 'Cancelar')}${button('confirm-accept', 'Confirmar')}</div></section>`;
            footer.querySelector('[data-voice-action="confirm-accept"]').classList.add('voice-primary');
            body.inert = true;
        } else body.inert = false;
        body.querySelector('[role="status"]').classList.add('voice-status');
        body.querySelector('[role="status"]').classList.toggle('is-error', !!this.messageError || !!record?.error);
        patchVoiceNode(liveBody, body);
        for (const d of liveBody.querySelectorAll('details')) d.open = openDetails.includes(d.querySelector('summary')?.textContent);
        for (const [key, value] of localInputs) { const input = liveBody.querySelector(`[${key}]`); if (input) input.value = value; }
        liveBody.inert = !!this.confirmation; liveBody.scrollTop = scrollTop;
        const list = liveBody.querySelector('.voice-all'); if (list) list.scrollTop = listScroll;
        if (focusKey && !this.confirmation) {
            const target = [...this.dialog.querySelectorAll(`[${focusKey.name}]`)].find(el => el.getAttribute(focusKey.name) === focusKey.value && (!active.dataset.id || el.dataset.id === active.dataset.id));
            (target || this.dialog.querySelector('.voice-primary, [data-voice-search]'))?.focus({ preventScroll: true });
            if (selection && target && (['text', 'search', 'url', 'tel', 'password'].includes(target.type) || target.tagName === 'TEXTAREA')) target.setSelectionRange(...selection);
        }
        const searchInput = this.dialog.querySelector('[data-voice-search]');
        if (searchInput) searchInput.oninput = event => {
            if (!this.allEmployees && event.target.value.trim()) { this.allEmployees = true; this.render(); return; }
            const query = normalizeVoiceName(event.target.value).split(' ').filter(Boolean);
            let count = 0;
            for (const row of this.dialog.querySelectorAll('[data-voice-name]')) { row.hidden = !query.every(term => row.dataset.voiceName.includes(term)); if (!row.hidden) count++; }
            this.dialog.querySelector('[data-voice-empty]').hidden = count > 0;
        };
        const search = liveBody.querySelector('[data-voice-search]');
        if (search?.value) search.dispatchEvent(new Event('input'));
        if (this.focusAfterConfirmation && !this.confirmation) {
            const target = this.dialog.querySelector('.voice-primary:not(:disabled)');
            if (target) { target.focus({ preventScroll: true }); this.focusAfterConfirmation = false; }
        }
        let morphed = false;
        if (structural && this.dialog.open && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            const after = this.dialog.getBoundingClientRect();
            if (before.height && after.height && before.height !== after.height) {
                this.morph?.cancel();
                this.morph = this.dialog.animate?.([{ height: `${before.height}px` }, { height: `${after.height}px` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
                if (this.morph) { morphed = true; this.morph.finished.then(() => { if (this.phase === phase) liveBody.scrollTop = targetScroll; }).catch(() => {}); }
            }
        }
        if (!morphed) liveBody.scrollTop = targetScroll;
    }
    destroy() { this.processingController?.abort(); clearTimeout(this.retryTimer); clearInterval(this.maintenanceTimer); window.removeEventListener('blur', this.onBlur); window.removeEventListener('keydown', this.onKey); document.removeEventListener('visibilitychange', this.onVisibility); this.wave?.remove(); this.recorder?.cancel(); this.unsubscribe?.(); this.unsubscribeScope?.(); this.unsubscribeEnabled?.(); window.removeEventListener('sa:voice-wipe', this.onWipe); if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.store.close(); this.dialog.remove(); this.launcher.remove(); }
}
