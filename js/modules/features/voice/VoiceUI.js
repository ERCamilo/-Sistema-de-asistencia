import { voiceFacts, suggestedVoiceIntent, isVoiceIntentUnclear } from './VoiceIntent.js';
import { voiceIcon, voicePlayer, voiceEmployeeCard } from './VoiceVisuals.js';
import { VoiceLoanView } from './VoiceLoanView.js';
import { VoiceEmployeeView } from './VoiceEmployeeView.js';
import { VoiceAudioView } from './VoiceAudioView.js';
import { voiceRetentionPolicy, voiceAudioExpiry, VOICE_AUDIO_BUDGET } from './VoiceRetention.js';
import { VoiceStore } from './VoiceStore.js';
import { VoiceRecorder } from './VoiceRecorder.js';
import { LOAN_FIELDS, VOICE_TEST_ENDPOINT, VOICE_ENDPOINT_PREFIX, VOICE_DEV_ENDPOINT, normalizeVoiceName, isVoiceEndpointAllowed, createVoiceContext, sendVoiceRecording, resolveVoiceEmployees, voiceBlocked, voiceHardBlocked, voiceDraftReady } from './VoiceCore.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { completeVoiceLoanDraft, voiceLoanNote } from './VoiceLoanDraft.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { createVoiceFeedback } from './VoiceFeedback.js';

const micIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
// Per-bar height factors so the live bars read as a waveform, not a block.
const WAVE_BAR_FACTORS = [0.35, 0.55, 0.8, 0.5, 0.95, 0.65, 0.4, 0.85, 1, 0.6, 0.9, 0.6, 1, 0.85, 0.4, 0.65, 0.95, 0.5, 0.8, 0.55, 0.35];
const SAVED_STATE_MS = 1200;
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
    constructor(adapter, { store = new VoiceStore(), recorderFactory = options => new VoiceRecorder(options), feedback = null } = {}) {
        this.adapter = adapter; this.store = store; this.recorderFactory = recorderFactory;
        // Sound + vibration cues (settings.voiceFeedback, on by default).
        this.feedback = feedback || createVoiceFeedback({ isEnabled: () => this.adapter.getSettings?.()?.voiceFeedback !== false });
        this.message = ''; this.busy = false; this.history = []; this.matches = []; this.allEmployees = false;
    }
    mount() {
        this.launcher = document.createElement('button'); this.launcher.type = 'button'; this.launcher.className = 'voice-launcher';
        this.launcher.style.touchAction = 'none';
        this.launcher.innerHTML = `${micIcon}<span>Voz</span>`; this.launcher.setAttribute('aria-label', 'Mantén pulsado para grabar; suelta para terminar. Con teclado, pulsa para iniciar o detener.');
        this.dialog = document.createElement('dialog'); this.dialog.className = 'voice-dialog'; this.dialog.setAttribute('aria-label', 'Borrador de voz');
        document.body.append(this.launcher, this.dialog);
        this.wave = document.createElement('div'); this.wave.className = 'voice-wave'; this.wave.hidden = true;
        this.wave.innerHTML = `<div class="voice-wave-head"><span class="voice-rec-dot" aria-hidden="true"></span><span role="status">Activando micrófono…</span><span class="voice-wave-hint"></span></div><div class="voice-wave-bars" aria-hidden="true">${WAVE_BAR_FACTORS.map(k => `<i style="--k:${k}"></i>`).join('')}</div>`;
        this.launcher.dataset.voiceState = 'idle';
        document.body.append(this.wave);
        this.launcher.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.held) return;
            event.preventDefault(); this.feedback.prime(); this.toggleMode = false; this.held = true; this.pointerId = event.pointerId;
            this.launcher.setPointerCapture?.(event.pointerId);
            this.run(() => this.beginHold());
        });
        this.launcher.addEventListener('pointerup', event => { if (event.pointerId === this.pointerId) this.finishHold(); });
        this.launcher.addEventListener('pointercancel', () => this.cancelHold());
        this.launcher.addEventListener('lostpointercapture', () => { if (this.held) this.cancelHold(); });
        this.launcher.addEventListener('contextmenu', event => event.preventDefault());
        this.launcher.addEventListener('click', event => { if (event.detail !== 0) return; this.feedback.prime(); if (!this.recording) this.toggleMode = true; this.run(() => this.recording ? this.finishHold() : this.beginHold()); });
        this.onBlur = () => { if (this.recording) this.cancelHold(); };
        this.onKey = event => { if (event.key === 'Escape' && this.recording) this.cancelHold(); };
        window.addEventListener('blur', this.onBlur); window.addEventListener('keydown', this.onKey);
        this.onVisibility = () => { if (document.hidden) this.cancelHold(); };
        document.addEventListener('visibilitychange', this.onVisibility);
        this.dialog.addEventListener('click', event => {
            const button = event.target.closest('[data-voice-action]');
            if (button) this.run(() => this.action(button.dataset.voiceAction, button.dataset.id));
        });
        this.dialog.addEventListener('input', event => {
            if (event.target.hasAttribute('data-voice-seek')) { const audio = this.dialog.querySelector('audio'); if (audio) audio.currentTime = Number(event.target.value); }
        });
        this.dialog.addEventListener('change', event => this.run(() => this.change(event.target)));
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.run(() => this.action('close')); });
        this.onWipe = () => { this.wiped = true; this.close({ discard: true }); this.record = null; this.history = []; this.launcher.hidden = true; };
        window.addEventListener('sa:voice-wipe', this.onWipe);
        this.unsubscribeScope = this.adapter.subscribeScope?.(() => { this.close({ discard: true }); this.record = null; this.history = []; });
        this.onStorageRetry = event => {
            if (event.target.closest?.('[data-voice-storage-retry]')) this.refreshStorageStatus({ force: true });
        };
        document.addEventListener('click', this.onStorageRetry);
        this.unsubscribeEnabled = this.adapter.subscribeEnabled?.(() => { this.refreshVisibility(); this.refreshStorageStatus(); });
        this.unsubscribe = this.adapter.subscribeSession?.(() => {
            this.refreshVisibility();
            this.refreshStorageStatus();
            const uid = this.adapter.getUser()?.uid;
            if (!uid || (this.record && uid !== this.record.uid) || (this.recording && uid !== this.recordingUid)) { this.close({ discard: true }); this.record = null; }
        });
        this.refreshVisibility();
        this.refreshStorageStatus();
        this.maintenanceTimer = setInterval(() => this.refreshStorageStatus({ force: true }), 5 * 60 * 1000);
        return this;
    }
    // Same conditions that show the launcher, computed live so other entry
    // points (bottom-nav centre button) never read a stale `hidden`.
    isAvailable() {
        return !this.wiped && this.adapter.isEnabled?.() !== false && !!this.adapter.getUser();
    }
    // Hold-to-talk for entry points other than the launcher. Resolves true
    // while recording; on failure (already notified) the hold is released so
    // the next attempt is not ignored.
    // `toggle`: started from a tap (menu "Dictar"); a second tap ends it.
    startHold({ toggle = false } = {}) {
        if (this.held) return Promise.resolve(!!this.recording);
        this.feedback.prime();
        this.toggleMode = toggle;
        this.held = true;
        return this.run(() => this.beginHold()).then(() => {
            if (!this.recording) this.held = false;
            return !!this.recording;
        });
    }
    endHold() { if (this.held || this.recording) this.finishHold(); }
    // idle → listening → saved (✓, brief) → idle. Mirrored on the launcher
    // (data-voice-state) and broadcast for other entry points (bottom nav).
    setCaptureState(state) {
        clearTimeout(this.savedTimer); clearInterval(this.clockTimer);
        if (this.launcher) this.launcher.dataset.voiceState = state;
        window.dispatchEvent(new CustomEvent('sa:voice-state', { detail: { state } }));
        if (state === 'listening') { this.listenStartedAt = Date.now(); this.renderClock(); this.clockTimer = setInterval(() => this.renderClock(), 1000); }
        if (state === 'saved') this.savedTimer = setTimeout(() => this.setCaptureState('idle'), SAVED_STATE_MS);
    }
    renderClock() {
        const status = this.wave?.querySelector('[role=status]'); if (!status) return;
        const seconds = Math.max(0, Math.floor((Date.now() - this.listenStartedAt) / 1000));
        status.textContent = `Escuchando · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        this.updateWaveHint();
    }
    updateWaveHint() {
        const hint = this.wave?.querySelector('.voice-wave-hint');
        if (hint) hint.textContent = this.held && !this.toggleMode ? 'Suelta para terminar' : 'Toca de nuevo para terminar';
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
        if (this.testEndpointUid === this.identity().uid) return VOICE_TEST_ENDPOINT;
        const saved = localStorage.getItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`);
        // The legacy HTTP endpoint cannot be used from the public HTTPS preview.
        return (saved === VOICE_TEST_ENDPOINT || saved === VOICE_DEV_ENDPOINT && location.protocol === 'https:' ? this.adapter.getEndpoint() : saved) || this.adapter.getEndpoint() || '';
    }
    async open() {
        const identity = this.identity();
        if (this.record && (this.record.uid !== identity.uid || this.record.projectKey !== identity.projectKey)) this.record = null;
        await this.maintenance();
        this.history = await this.store.list(identity.uid, identity.projectKey); this.message = '';
        if (!this.record?.audio || this.record.discarded || this.record.completedLoanId) this.record = this.history.find(r => r.audio && !r.completedLoanId && r.purpose !== 'name-example') || null;
        this.view = this.record?.result ? (this.record.selectedEmployeeId ? 'loan' : 'employees') : 'audio';
        await this.prepareLoadedLoan(); await this.refreshMatches(); this.render(); this.dialog.showModal();
        if (this.record?.result && !this.record.pendingResult && (this.effectiveResult()?.intent === 'registrar_gasto_caja_chica' || isVoiceIntentUnclear(this.record.result))) { await this.routeResult(); if (this.dialog.open) this.render(); }
    }
    close({ discard = false } = {}) {
        this.testEndpointUid = null;
        if (discard && this.record && !this.record.completedLoanId) { const record = this.record; record.discarded = true; if (this.processingRecord === record) this.processingController?.abort(); this.store.remove?.(record.uid, record.requestId).catch(() => this.adapter.notify?.('No se pudo eliminar el audio descartado.', 'warning')); }
        this.finishConfirmation?.(false);
        if (this.recording) { this.feedback.play('cancel'); this.setCaptureState('idle'); }
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
        this.testEndpointUid = null;
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
        else { this.recorder?.cancel(); this.recording = false; this.showWave(false); this.feedback.play('cancel'); this.setCaptureState('idle'); this.adapter.notify?.('No se grabó audio. Mantén pulsado de nuevo cuando el micrófono esté disponible.', 'info'); }
    }
    cancelHold() {
        if (!this.recording) return;
        this.held = false; this.recorder?.cancel(); this.recording = false; this.showWave(false);
        this.feedback.play('cancel'); this.setCaptureState('idle');
    }
    paintStorageStatus(state, storage = null) {
        this.storageReadState = state;
        const status = document.querySelector('[data-voice-storage-status]');
        const messages = {
            anonymous: 'Inicia sesión para gestionar tus audios.',
            wiped: 'Los datos locales se borraron. Recarga la aplicación para consultar los audios.',
            loading: 'Consultando el espacio de audios…',
            error: 'No se pudo consultar el espacio de audios. Puedes reintentar.'
        };
        if (status) status.textContent = state === 'ready'
            ? `${(storage.bytes / 1048576).toFixed(1)} MiB / 50 MiB · ${storage.count} audios en este dispositivo`
            : messages[state];
        const retry = document.querySelector('[data-voice-storage-retry]');
        if (retry) { retry.hidden = state !== 'error'; retry.disabled = state === 'loading'; }
        const manage = document.querySelector('[data-settings-action="manage-voice-audio"]');
        if (manage) manage.disabled = ['anonymous', 'wiped', 'loading'].includes(state);
        const warning = document.querySelector('[data-voice-storage-warning]');
        if (warning) {
            warning.hidden = state !== 'ready' || !storage?.low;
            warning.textContent = 'Queda poco espacio. Elimina audios o desactiva su conservación.';
        }
    }
    // Background refresh reports inline; explicit voice actions still use run().
    storageContext() {
        return JSON.stringify([this.adapter.getUser()?.uid, voiceRetentionPolicy(this.adapter.getSettings?.()), !!this.wiped]);
    }
    async refreshStorageStatus({ force = false } = {}) {
        if (this.destroyed) return;
        if (!force && this.storageContextKey === this.storageContext()
            && ['ready', 'error', 'anonymous', 'wiped'].includes(this.storageReadState)) {
            this.paintStorageStatus(this.storageReadState, this.storage);
            await this.refreshLoanAudioButtons();
            return;
        }
        try { await this.maintenance(); } catch (_) { /* maintenance painted the recoverable error */ }
    }
    maintenance() {
        const user = this.adapter.getUser();
        if (!user || this.wiped) {
            this.storage = null;
            this.storageContextKey = this.storageContext();
            this.paintStorageStatus(this.wiped ? 'wiped' : 'anonymous');
            return this.refreshLoanAudioButtons();
        }
        if (this.maintenanceFlight) return this.maintenanceFlight;
        const readContext = this.storageContext();
        this.storageContextKey = readContext;
        this.paintStorageStatus('loading');
        let timer;
        const read = async () => {
            await this.store.maintain?.(user.uid, voiceRetentionPolicy(this.adapter.getSettings?.()));
            return this.store.storageStatus?.();
        };
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('No se pudo consultar el almacenamiento de audios.')), 8000);
        });
        this.maintenanceFlight = (async () => {
            try {
                const storage = await Promise.race([read(), timeout]);
                if (this.destroyed || this.wiped || this.adapter.getUser()?.uid !== user.uid) return;
                this.storage = storage;
                const available = Number.isFinite(storage?.bytes) && storage.bytes >= 0
                    && Number.isInteger(storage?.count) && storage.count >= 0;
                this.paintStorageStatus(available ? 'ready' : 'error', storage);
                if (this.view === 'playback' && this.record && voiceAudioExpiry(this.record, voiceRetentionPolicy(this.adapter.getSettings?.())) <= Date.now()) { this.close(); this.adapter.notify?.('El audio venció y fue eliminado.', 'info'); }
                await this.refreshLoanAudioButtons();
            } catch (error) {
                if (this.destroyed || this.wiped || this.adapter.getUser()?.uid !== user.uid) return;
                this.storage = null;
                this.paintStorageStatus('error');
                throw error;
            } finally {
                clearTimeout(timer);
                this.maintenanceFlight = null;
                // A session change during a read needs its own result.
                if (!this.destroyed && readContext !== this.storageContext()) this.refreshStorageStatus({ force: true });
            }
        })();
        return this.maintenanceFlight;
    }
    async refreshLoanAudioButtons() {
        const user = this.adapter.getUser();
        const scope = projectKey(this.adapter.getScope?.());
        const epoch = this.loanAudioReadEpoch = (this.loanAudioReadEpoch || 0) + 1;
        for (const button of document.querySelectorAll('[data-voice-loan-audio]')) {
            let record = null;
            let failed = false;
            try { if (user && !this.wiped) record = await this.store.get?.(user.uid, button.dataset.voiceLoanAudio); }
            catch (_) { failed = true; }
            if (this.destroyed || epoch !== this.loanAudioReadEpoch || this.adapter.getUser()?.uid !== user?.uid || projectKey(this.adapter.getScope?.()) !== scope) return;
            if (!button.isConnected) continue;
            const available = !this.wiped && record?.audio && record.projectKey === scope
                && String(record.selectedEmployeeId) === button.dataset.arg && String(record.completedLoanId) === button.dataset.loanId
                && voiceAudioExpiry(record, voiceRetentionPolicy(this.adapter.getSettings?.())) > Date.now();
            button.disabled = !available;
            button.textContent = available ? 'Escuchar audio' : failed ? 'No se pudo consultar el audio' : 'Audio no disponible';
            button.title = available ? 'Grabación local de la instrucción' : failed
                ? 'Vuelve a abrir la cuenta para reintentar.' : 'El audio venció, se eliminó o no está en este navegador';
        }
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
    effectiveResult() { return this.record?.result ? { ...this.record.result, intent: this.record.manualIntent || this.record.result.intent } : null; }
    async chooseIntent(intent) {
        this.guard();
        if (!['crear_prestamo', 'registrar_gasto_caja_chica', 'buscar_empleado'].includes(intent)) throw Error('Selecciona una acción disponible.');
        if (voiceHardBlocked(this.record.result)) throw Error('La instrucción contiene una negación o varias operaciones. Aclárala antes de registrar.');
        if (this.record.completedLoanId || this.record.completedCashId || this.record.cashDraft?.pendingMovement) throw Error('Esta grabación ya tiene un registro confirmado o pendiente.');
        const facts = voiceFacts(this.record.result);
        if (intent === 'registrar_gasto_caja_chica' && this.record.draft) {
            if (this.record.cashDraft) this.record.cashDraft.amount = this.record.draft.principal;
            else this.record.cashTransfer = { amount: this.record.draft.principal, note: this.record.draft.concept === [facts.concept, facts.note].filter(Boolean).join(' · ') ? facts.note : this.record.draft.concept || facts.note };
        }
        if (intent === 'crear_prestamo') {
            this.record.draft ||= completeVoiceLoanDraft({ principal: facts.amount, concept: [facts.concept, facts.note].filter(Boolean).join(' · ') }, this.adapter.getLoanDefaults?.(this.selected()));
            if (this.record.cashDraft) {
                this.record.draft.principal = this.record.cashDraft.amount;
                if (!this.record.visitedLoan) this.record.draft.concept = [this.record.cashDraft.concept, this.record.cashDraft.note].filter(Boolean).join(' · ');
            }
        }
        this.record.manualIntent = intent; this.record.dirty = true;
        await this.save(); await this.refreshMatches(); await this.routeResult();
        if (this.record && this.effectiveResult()?.intent !== 'registrar_gasto_caja_chica') { this.render(); if (!this.dialog.open) this.dialog.showModal(); }
    }
    async routeResult() {
        if (!this.record?.result || this.record.pendingResult) return;
        if (voiceHardBlocked(this.record.result)) { this.view = 'audio'; return; }
        if (!this.record.manualIntent && isVoiceIntentUnclear(this.record.result)) {
            const suggested = suggestedVoiceIntent(this.record.result, this.adapter.getSettings?.()?.voiceAmbiguousAction || 'loan');
            if (!suggested) { this.view = 'intent'; return; }
            this.record.manualIntent = suggested; await this.save(); await this.refreshMatches();
        }
        if (this.effectiveResult()?.intent === 'registrar_gasto_caja_chica') {
            if (!this.adapter.onPettyCash) throw Error('Esta versión no tiene el formulario de Caja Chica por voz.');
            const record = this.record;
            this.close();
            await this.adapter.onPettyCash(record, {
                guard: () => this.guard(record),
                save: async () => { this.guard(record); await this.store.put(record); },
                switchTo: intent => this.chooseIntent(intent),
                back: () => { this.guard(record); this.view = 'audio'; this.render(); this.dialog.showModal(); },
                remove: async () => { await this.store.remove(record.uid, record.requestId); if (this.record === record) this.record = null; }
            });
            return;
        }
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
        if (this.effectiveResult()?.intent === 'crear_prestamo') { this.record.draft ||= completeVoiceLoanDraft({ principal: voiceFacts(this.record.result).amount, concept: voiceFacts(this.record.result).note || voiceFacts(this.record.result).concept }, this.adapter.getLoanDefaults?.(this.selected())); this.record.visitedLoan = true; this.view = 'loan'; return; }
        if ((this.record.result.needsReview || this.record.result.issues.length) && !this.record.reviewed) { this.view = 'employees'; return; }
        const action = this.effectiveResult()?.intent === 'abrir_prestamos' ? 'loans' : this.effectiveResult()?.intent === 'abrir_asistencia' || this.effectiveResult()?.intent === 'buscar_empleado' ? 'attendance' : 'profile';
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
        if (this.effectiveResult()?.intent === 'registrar_gasto_caja_chica') {
            this.employeeAliases = []; this.matches = []; return;
        }
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
        record.cashDraft = null; record.cashTransfer = null; record.manualIntent = null; record.visitedLoan = result.intent === 'crear_prestamo';
        record.result = result; const facts = voiceFacts(result); record.mention = { spokenName: facts.spokenName, spokenNumber: facts.spokenNumber }; record.transcript = result.transcript;
        record.draft = result.loan || facts.amount != null ? completeVoiceLoanDraft({ ...result.loan, principal: result.loan?.principal ?? facts.amount, concept: result.loan?.concept ?? [facts.concept, facts.note].filter(Boolean).join(' · ') }, this.adapter.getLoanDefaults?.(null)) : null;
        record.rateDefault = result.loan?.interestRate == null;
        record.loanDefaultsVersion = 1;
        record.employeeDefaultsApplied = false; record.selectedEmployeeId = null; record.reviewed = false; record.dirty = false; record.pendingResult = null; record.rememberName = false;
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
        if (action === 'play-audio') {
            const audio = this.dialog.querySelector('audio');
            if (audio) { if (audio.paused) await audio.play(); else audio.pause(); }
            return;
        }
        if (action === 'retention') {
            if (this.busy || this.recording || this.view !== 'storage') return;
            const days = Number(id), identity = this.identity(true);
            if (!Number.isInteger(days) || days < 0 || days > 5 || !this.adapter.setAudioRetention) return;
            if (days === 0 && !await this.confirmInline('¿Dejar de guardar y eliminar los audios de préstamos?')) return;
            if (this.identity(true).uid !== identity.uid) throw Error('Cambió la cuenta.');
            this.adapter.setAudioRetention(days); await this.maintenance(); this.render(); return;
        }
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
        if (action === 'test-endpoint') { this.testEndpointUid = this.identity().uid; this.message = 'Webhook de prueba temporal. Activa la escucha en n8n antes de enviar.'; this.render(); return; }
        if (action === 'default-endpoint') { this.testEndpointUid = null; localStorage.removeItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`); this.message = 'Webhook de producción seleccionado.'; this.render(); return; }
        if (action === 'record') {
            if (this.record && !this.record.completedLoanId) { this.record.discarded = true; await this.store.remove?.(this.record.uid, this.record.requestId); }
            this.record = null; if (this.dialog.open) this.dialog.close();
            const identity = this.identity(); this.message = ''; this.recordingUid = identity.uid; this.recording = true; this.showWave(true);
            this.recordLevels = [];
            this.recorder = this.recorderFactory({ onLevel: level => { this.wave?.style.setProperty('--voice-level', String(level)); if (this.recording) this.recordLevels.push(level); }, onError: error => { this.recording = false; this.held = false; this.showWave(false); this.feedback.play('error'); this.setCaptureState('idle'); this.message = error.message; this.view = 'audio'; this.render(); if (!this.dialog.open) this.dialog.showModal(); }, onComplete: captured => this.run(async () => {
                this.recording = false; this.held = false; this.showWave(false); this.feedback.play('stop'); this.setCaptureState('saved'); this.view = 'audio'; this.allEmployees = false;
                if (this.identity().uid !== identity.uid || this.identity().projectKey !== identity.projectKey) throw Error('Cambió la cuenta o proyecto. Graba nuevamente.');
                const extension = captured.mimeType.includes('mp4') ? 'm4a' : captured.mimeType.includes('ogg') ? 'ogg' : 'webm';
                this.record = { ...identity, ...captured, levels: this.recordLevels.slice(0,800), requestId: crypto.randomUUID(), createdAt: Date.now(), fileName: `voice.${extension}`, context: createVoiceContext(), result: null, draft: null, mention: {}, dirty: false };
                const capturedRecord = this.record;
                try { await this.save(); this.history = await this.store.list(identity.uid, identity.projectKey); this.message = 'Audio guardado en este dispositivo. Listo para procesar.'; }
                catch (error) { capturedRecord.unsaved = true; throw error; }
                finally { if (!capturedRecord.discarded && this.record === capturedRecord && this.adapter.getUser()?.uid === identity.uid && projectKey(this.adapter.getScope()) === identity.projectKey) { await this.refreshMatches(); this.render(); if (!this.dialog.open) this.dialog.showModal(); } }
                if (!capturedRecord.unsaved && !capturedRecord.discarded && this.record === capturedRecord && this.adapter.getSettings && this.adapter.getSettings()?.voiceReviewBeforeSend !== true) await this.process();
            }) });
            try { await this.recorder.start(); if (this.recording && this.wave && this.recorder.recorder?.state === 'recording') { this.feedback.play('start'); this.setCaptureState('listening'); } } catch (error) { if (!this.recording) return; this.recording = false; this.held = false; this.showWave(false); this.feedback.play('error'); this.setCaptureState('idle'); this.view = 'audio'; this.render(); if (!this.dialog.open) this.dialog.showModal(); throw error; }
            return;
        }
        if (action === 'load') {
            const identity = this.identity(); this.record = await this.store.get(identity.uid, id); this.guard();
            this.allEmployees = false; this.view = this.record.completedLoanId ? 'playback' : this.record.selectedEmployeeId ? 'loan' : 'employees'; this.message = ''; await this.prepareLoadedLoan(); await this.refreshMatches();
            if (!this.record.completedLoanId && !this.record.pendingResult && (isVoiceIntentUnclear(this.record.result) || this.effectiveResult()?.intent === 'registrar_gasto_caja_chica')) await this.routeResult();
            if (this.record && this.dialog.open) this.render(); return;
        }
        this.guard();
        if (action === 'save-audio') { delete this.record.unsaved; try { await this.save(); } catch (error) { this.record.unsaved = true; throw error; } this.render(); return; }
        if (action === 'intent-loan') { await this.chooseIntent('crear_prestamo'); return; }
        if (action === 'intent-cash') { await this.chooseIntent('registrar_gasto_caja_chica'); return; }
        if (action === 'intent-search') { await this.chooseIntent('buscar_empleado'); return; }
        if (action === 'process') { await this.process(); return; }
        if (action === 'apply-result') {
            if (!await this.confirmInline('¿Reemplazar los campos editados con el nuevo resultado?')) return;
            this.guard();
            this.applyResult(this.record.pendingResult); await this.save(); await this.refreshMatches(); await this.routeResult(); if (this.record) this.render(); return;
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
            this.record.dirty = true; this.allEmployees = false; await this.save(); await this.routeResult(); if (this.record) this.render(); return;
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
        if (voiceBlocked(this.effectiveResult())) throw Error('La instrucción está negada o no se pudo interpretar. Graba una nueva instrucción.');
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
                record.cashDraft = null; record.cashTransfer = null;
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
            this.testEndpointUid = value === VOICE_TEST_ENDPOINT ? this.identity().uid : null;
            if (value === VOICE_TEST_ENDPOINT) { this.message = 'Webhook de prueba temporal.'; return; }
            localStorage.setItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`, value); this.message = 'Endpoint guardado localmente. No contiene credenciales.'; return;
        }
        if (this.busy || this.recording || !this.record) return;
        if (!input.dataset.voiceField && !input.dataset.voiceMention && input.dataset.voiceTranscript === undefined && input.dataset.voiceReviewed === undefined && input.dataset.voiceRemember === undefined) return;
        this.guard(); const field = input.dataset.voiceField;
        if (field) {
            this.record.draft ||= Object.fromEntries(LOAN_FIELDS.map(k => [k, null]));
            const v = input.value;
            this.record.draft[field] = v === '' ? null : ['principal', 'interestRate', 'installmentCount', 'installmentFrequencyWeeks'].includes(field) ? Number(v) : field === 'interestIncluded' ? v === 'true' : v;
            if (field === 'interestRate') this.record.rateDefault = false;
            if (field === 'installmentCount' && Number.isInteger(this.record.draft.installmentCount) && this.record.draft.installmentCount >= 1) this.record.draft.installmentMode = this.record.draft.installmentCount > 1 ? 'installments' : 'lump';
            if (field === 'installmentMode' && v === 'installments' && this.record.draft.installmentCount < 2) this.record.draft.installmentCount = 2;
        }
        if (input.dataset.voiceMention) { this.record.mention[input.dataset.voiceMention] = input.value || null; this.record.selectedEmployeeId = null; this.record.reviewed = false; this.record.rememberName = false; this.view = 'employees'; }
        if (input.dataset.voiceTranscript !== undefined) this.record.transcript = input.value;
        if (input.dataset.voiceReviewed !== undefined) this.record.reviewed = input.checked;
        if (input.dataset.voiceRemember !== undefined) this.record.rememberName = input.checked;
        this.record.dirty = true; await this.save(); await this.refreshMatches(); this.render();
    }
    render() {
        const record = this.record; const result = record?.result; const selected = this.selected();
        if (this.view === 'navigation' || (this.view === 'loan' && !selected)) this.view = 'employees';
        this.view ||= result ? selected ? 'loan' : 'employees' : 'audio';
        const blocked = voiceBlocked(this.effectiveResult()); const disabled = this.busy || this.recording;
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
        const views = {
            intent: () => `<section class="voice-review"><h3>¿Qué quieres hacer?</h3><p>${escapeHTML(record.transcript)}</p><p>${escapeHTML(String(voiceFacts(result).amount ?? 'Sin monto'))} · ${escapeHTML(voiceFacts(result).spokenName || voiceFacts(result).concept || 'Completa los datos en el borrador')}</p></section>${button('intent-loan','Préstamo',this.busy)}${button('intent-cash','Caja chica',this.busy)}${button('intent-search','Buscar empleado',this.busy)}`,
            audio: () => VoiceAudioView(this, button) + (blocked && result ? '<section class="voice-review" role="alert">Instrucción negada o no reconocida. No se registrará una operación. Revisa el texto y el motivo en Opciones de audio.</section>' : ''),
            employees: () => VoiceEmployeeView(this, button),
            loan: () => VoiceLoanView(this, button),
            playback: () => `${voiceEmployeeCard(selected)}${voicePlayer(this,button)}<p class="voice-expiry">${voiceIcon('clock')} Hasta ${escapeHTML(new Date(record.audioExpiresAt).toLocaleDateString('es-DO', {day:'numeric',month:'short',timeZone:record.context?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}))}</p>`,
            storage: () => {
                const settings = this.adapter.getSettings?.() || {};
                const selectedDays = settings.voiceKeepLoanAudio === false ? 0 : Number(settings.voiceAudioRetentionDays || 5);
                const bytes = this.storage?.bytes || 0;
                return `<div class="voice-retention" role="group" aria-label="Conservación de audio">${[0,1,2,3,4,5].map(days => button('retention', days ? `${days}<span>${days === 1 ? 'día' : 'días'}</span>` : 'No<span>guardar</span>', !this.adapter.setAudioRetention,String(days)).replace('<button ',`<button aria-pressed="${selectedDays === days}" `)).join('')}</div><div class="voice-storage-meter"><label for="voice-storage-meter">${this.storage ? `${(bytes/1048576).toFixed(1)} / 50 MiB` : 'Espacio no disponible'}</label><meter id="voice-storage-meter" min="0" max="50" value="${Math.min(50,bytes/1048576)}">${bytes}</meter></div>${button('clear-audio',`${voiceIcon('trash')} Eliminar audios`)}`;
            }
        };
        const markup = `<p role="status">${escapeHTML(this.messageError || record?.error || record?.pendingResult || this.busy ? this.message : '')}</p>${this.storage?.low ? '<section class="voice-review" role="alert">Queda poco espacio para audios. Revisa Configuración → Tests.</section>' : ''}${views[view]()}`;
        if (!oldBody) this.dialog.innerHTML = `<header class="voice-header"><h2 id="voice-title">Tu audio</h2>${button('close', `${voiceIcon('close')}<span class="voice-sr">Cerrar</span>`)}</header><div class="voice-body"></div><footer class="voice-footer"></footer>`;
        this.dialog.setAttribute('aria-labelledby', 'voice-title');
        const liveBody = this.dialog.querySelector('.voice-body');
        const body = document.createElement('div'); body.className = 'voice-body';
        const template = document.createElement('template'); template.innerHTML = markup;
        template.content.querySelector('header')?.remove();
        body.replaceChildren(template.content);
        const action = view === 'loan' ? 'loan' : view === 'audio' ? record?.audio ? 'process' : 'record' : view === 'employees' && selected && result.intent !== 'crear_prestamo' ? result.intent === 'abrir_prestamos' ? 'loans' : 'attendance' : view === 'storage' ? 'clear-audio' : null;
        const primary = action ? body.querySelector(`[data-voice-action="${action}"]`) : null;
        const validation = action === 'loan' && record?.draft ? this.adapter.validateLoan(record.draft) : null;
        if (primary && validation && !validation.valid) primary.disabled = true;
        const footer = this.dialog.querySelector('.voice-footer');
        const titles = { intent: 'Elegir acción', audio: 'Tu audio', employees: '¿Quién es?', loan: 'Nuevo préstamo', playback: 'Audio del préstamo', storage: 'Audio guardado' };
        this.dialog.querySelector('#voice-title').textContent = titles[view];
        this.dialog.dataset.voiceView = view;
        let hint = '';
        if (primary?.disabled) {
            hint = record?.retryAt > Date.now() ? `Puedes reintentar a las ${new Date(record.retryAt).toLocaleTimeString()}.` : record?.unsaved ? 'Conserva el audio localmente antes de enviarlo.' : this.busy ? 'Espera a que termine el procesamiento.' : record?.completedLoanId ? 'Esta grabación ya registró un préstamo.' : !selected ? 'Selecciona al empleado correcto.' : (result?.needsReview || result?.issues.length) && !record.reviewed ? 'Confirma que revisaste las advertencias.' : !record?.draft?.principal ? 'Completa el monto del préstamo.' : validation && !validation.valid ? validation.errors.join('. ') : 'Completa los datos y la fecha de cobro.';
        }
        footer.innerHTML = `${view === 'playback' ? '' : button('close', view === 'storage' ? 'Cerrar' : view === 'loan' ? `${voiceIcon('close')}<span class="voice-sr">Cancelar</span>` : 'Cancelar', this.busy && !!record?.completedLoanId)}<p class="voice-hint" id="voice-hint">${escapeHTML(hint)}</p>`;
        if (view === 'storage') footer.querySelector('[data-voice-action=close]')?.remove();
        if (primary) { primary.classList.add('voice-primary'); primary.setAttribute('aria-describedby', 'voice-hint'); footer.append(primary); }
        if (this.confirmation) {
            footer.innerHTML = `<section class="voice-confirm" role="alert"><strong>Confirma la acción</strong><p>${escapeHTML(this.confirmation)}</p><div class="voice-actions">${button('confirm-cancel', 'Cancelar')}${button('confirm-accept', 'Confirmar')}</div></section>`;
            footer.querySelector('[data-voice-action="confirm-accept"]').classList.add('voice-primary');
            body.inert = true;
        } else body.inert = false;
        body.querySelector('[role="status"]').classList.add('voice-status');
        body.querySelector('[role="status"]').classList.toggle('is-error', !!this.messageError || !!record?.error);
        patchVoiceNode(liveBody, body);
        this.bindPlayer();
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
    bindPlayer() {
        const audio = this.dialog.querySelector('audio'); if (!audio) return;
        const update = () => {
            const control = this.dialog.querySelector('[data-voice-action=play-audio]');
            if (control) { control.innerHTML = `${voiceIcon(audio.paused ? 'play' : 'pause')}<span class="voice-sr">${audio.paused ? 'Reproducir audio' : 'Pausar audio'}</span>`; control.setAttribute('aria-pressed',String(!audio.paused)); }
            const seek = this.dialog.querySelector('[data-voice-seek]');
            const duration = Number.isFinite(audio.duration) ? audio.duration : (this.record?.durationMs || 0)/1000;
            if (seek) { seek.max = String(Math.max(.1,duration)); seek.value = String(audio.currentTime || 0); }
            const time = this.dialog.querySelector('[data-voice-time]');
            const seconds = Math.floor(audio.currentTime || duration || 0);
            if (time) time.textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
        };
        if (!audio.voiceBound) { for (const event of ['play','pause','ended','timeupdate','loadedmetadata']) audio.addEventListener(event,update); audio.voiceBound = true; }
        update();
    }
    destroy() { this.destroyed = true; document.removeEventListener('click', this.onStorageRetry); clearTimeout(this.savedTimer); clearInterval(this.clockTimer); this.feedback.close(); this.processingController?.abort(); clearTimeout(this.retryTimer); clearInterval(this.maintenanceTimer); window.removeEventListener('blur', this.onBlur); window.removeEventListener('keydown', this.onKey); document.removeEventListener('visibilitychange', this.onVisibility); this.wave?.remove(); this.recorder?.cancel(); this.unsubscribe?.(); this.unsubscribeScope?.(); this.unsubscribeEnabled?.(); window.removeEventListener('sa:voice-wipe', this.onWipe); if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.store.close(); this.dialog.remove(); this.launcher.remove(); }
}
