import { VoiceStore } from './VoiceStore.js';
import { VoiceRecorder } from './VoiceRecorder.js';
import { LOAN_FIELDS, VOICE_ENDPOINT_PREFIX, VOICE_DEV_ENDPOINT, normalizeVoiceName, isVoiceEndpointAllowed, createVoiceContext, sendVoiceRecording, resolveVoiceEmployees, voiceBlocked, voiceDraftReady } from './VoiceCore.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { completeVoiceLoanDraft, voiceLoanNote } from './VoiceLoanDraft.js';
import { getDateKey } from '../../utils/DateUtils.js';

const fieldLabels = { principal: 'Monto', interestRate: 'Interés (%)', interestIncluded: 'Interés incluido', installmentMode: 'Cobro', installmentCount: 'Cantidad de cuotas', startDate: 'Fecha del préstamo', concept: 'Concepto / nota (opcional)' };
const micIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
const projectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';
const money = value => Number(value).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
        this.launcher.innerHTML = `${micIcon}<span>Voz</span>`; this.launcher.setAttribute('aria-label', 'Abrir borrador de voz');
        this.dialog = document.createElement('dialog'); this.dialog.className = 'voice-dialog'; this.dialog.setAttribute('aria-label', 'Borrador de voz');
        document.body.append(this.launcher, this.dialog);
        this.launcher.addEventListener('click', () => this.run(() => this.open()));
        this.dialog.addEventListener('click', event => {
            const button = event.target.closest('[data-voice-action]');
            if (button) this.run(() => this.action(button.dataset.voiceAction, button.dataset.id));
        });
        this.dialog.addEventListener('change', event => this.run(() => this.change(event.target)));
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        this.onWipe = () => { this.wiped = true; this.close(); this.record = null; this.history = []; this.launcher.hidden = true; };
        window.addEventListener('sa:voice-wipe', this.onWipe);
        this.unsubscribeScope = this.adapter.subscribeScope?.(() => { this.close(); this.record = null; this.history = []; });
        this.unsubscribeEnabled = this.adapter.subscribeEnabled?.(() => this.refreshVisibility());
        this.unsubscribe = this.adapter.subscribeSession?.(() => {
            this.refreshVisibility();
            const uid = this.adapter.getUser()?.uid;
            if (!uid || (this.record && uid !== this.record.uid) || (this.recording && uid !== this.recordingUid)) { this.close(); this.record = null; }
        });
        this.refreshVisibility();
        return this;
    }
    refreshVisibility() {
        this.launcher.hidden = this.wiped || this.adapter.isEnabled?.() === false || !this.adapter.getUser();
        if (this.launcher.hidden && (this.dialog.open || this.recording)) this.close();
    }
    async run(callback) {
        try { await callback(); } catch (error) { this.messageError = true; this.message = error.message || 'No se pudo completar la acción.'; if (this.dialog.open) this.render(); }
    }
    identity() {
        if (this.wiped) throw Error('Los datos locales se borraron. Recarga SA antes de usar Voz.');
        if (this.adapter.isEnabled?.() === false) throw Error('Activa la prueba de voz en Configuración → Tests.');
        const user = this.adapter.getUser(); if (!user) throw Error('Inicia sesión para usar el MVP de voz.');
        const scope = this.adapter.getScope(); if (scope?.enabled && !scope.projectId) throw Error('Selecciona un proyecto primero.');
        return { uid: user.uid, projectKey: projectKey(scope) };
    }
    guard(record = this.record) {
        const identity = this.identity();
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
        this.history = await this.store.list(identity.uid, identity.projectKey); this.message = '';
        if (!this.record) this.record = this.history[0] || null;
        await this.prepareLoadedLoan(); await this.refreshMatches(); this.render(); this.dialog.showModal();
    }
    close() {
        this.finishConfirmation?.(false);
        this.recorder?.cancel(); this.recording = false;
        if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.audioURL = null;
        this.dialog.close(); this.launcher.focus();
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
        record.selectedEmployeeId = null; record.reviewed = false; record.dirty = false; record.pendingResult = null;
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
        if (action === 'close') { this.close(); return; }
        if (action === 'stop') { this.recorder?.stop(); return; }
        if (this.busy || this.recording) return;
        if (action === 'default-endpoint') { localStorage.removeItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`); this.message = 'URL predeterminada restaurada.'; this.render(); return; }
        if (action === 'record') {
            const identity = this.identity(); this.message = ''; this.recordingUid = identity.uid; this.recording = true; this.render();
            this.recorder = this.recorderFactory({ onError: error => { this.recording = false; this.message = error.message; if (this.dialog.open) this.render(); }, onComplete: captured => this.run(async () => {
                this.recording = false;
                if (this.identity().uid !== identity.uid || this.identity().projectKey !== identity.projectKey) throw Error('Cambió la cuenta o proyecto. Graba nuevamente.');
                const extension = captured.mimeType.includes('mp4') ? 'm4a' : captured.mimeType.includes('ogg') ? 'ogg' : 'webm';
                this.record = { ...identity, ...captured, requestId: crypto.randomUUID(), createdAt: Date.now(), fileName: `voice.${extension}`, context: createVoiceContext(), result: null, draft: null, mention: {}, dirty: false };
                try { await this.save(); this.history = await this.store.list(identity.uid, identity.projectKey); this.message = 'Audio guardado en este dispositivo. Listo para procesar.'; }
                catch (error) { this.record.unsaved = true; throw error; }
                finally { await this.refreshMatches(); this.render(); }
            }) });
            try { await this.recorder.start(); } catch (error) { this.recording = false; throw error; }
            return;
        }
        if (action === 'load') {
            const identity = this.identity(); this.record = await this.store.get(identity.uid, id); this.guard();
            this.allEmployees = false; this.message = ''; await this.prepareLoadedLoan(); await this.refreshMatches(); this.render(); return;
        }
        this.guard();
        if (action === 'save-audio') { delete this.record.unsaved; try { await this.save(); } catch (error) { this.record.unsaved = true; throw error; } this.render(); return; }
        if (action === 'process') { await this.process(); return; }
        if (action === 'apply-result') {
            if (!await this.confirmInline('¿Reemplazar los campos editados con el nuevo resultado?')) return;
            this.guard();
            this.applyResult(this.record.pendingResult); await this.save(); await this.refreshMatches(); this.render(); return;
        }
        if (action === 'delete') {
            if (!await this.confirmInline('¿Eliminar este audio y su borrador del dispositivo?')) return;
            this.guard();
            await this.store.remove(this.record.uid, this.record.requestId); this.record = null;
            const identity = this.identity(); this.history = await this.store.list(identity.uid, identity.projectKey); this.render(); return;
        }
        if (action === 'choose') { this.allEmployees = true; this.render(); return; }
        if (action === 'select') {
            const employee = this.adapter.getEmployees().find(e => e.id === id); if (!employee) throw Error('Empleado no disponible en el proyecto activo.');
            this.record.selectedEmployeeId = id;
            if (this.record.draft && this.record.rateDefault) {
                const defaults = this.adapter.getLoanDefaults?.(employee) || {};
                this.record.draft.interestRate = completeVoiceLoanDraft({ interestRate: null }, defaults).interestRate;
            }
            this.record.dirty = true; this.allEmployees = false; await this.save(); this.render(); return;
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
                record.completedLoanId = loan?.id || null;
                await this.store.put(record); this.close();
            } finally { this.busy = false; if (this.dialog.open) this.render(); }
            return;
        }
        if (action === 'profile') this.adapter.onProfile(employee.id);
        if (action === 'attendance') this.adapter.onAttendance(employee.id);
        if (action === 'loans') this.adapter.onLoans(employee.id);
        this.close();
    }
    async process() {
        if (this.record.unsaved) throw Error('Conserva el audio localmente antes de enviarlo.');
        if (this.record.retryAt > Date.now()) throw Error('Espera hasta ' + new Date(this.record.retryAt).toLocaleTimeString() + ' antes de reintentar.');
        const record = this.record; this.busy = true; this.message = 'Procesando… Puedes cerrar; conservaremos el audio.'; this.render();
        try {
            const result = await sendVoiceRecording({ url: this.endpoint(), record, getToken: async force => { this.guard(record); return this.adapter.getUser().getIdToken(force); } });
            this.guard(record);
            if (record.dirty) { record.pendingResult = result; this.message = 'Llegó un nuevo resultado. Tus ediciones se conservaron; puedes reemplazarlas explícitamente.'; }
            else { this.applyResult(result, record); this.message = 'Borrador listo para revisar.'; }
            record.retryAt = null; record.error = null; await this.store.put(record);
            if (this.record?.requestId === record.requestId) await this.refreshMatches();
            else this.message = 'El resultado se conservó con su grabación original.';
        } catch (error) {
            record.error = { code: error.code || 'ERROR', status: error.status || null, message: error.message, retryable: !!error.retryable };
            record.retryAt = error.retryAfterMs ? Date.now() + error.retryAfterMs : null;
            if (!this.wiped) await this.store.put(record); this.message = error.message;
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
        if (input.dataset.voiceMention) { this.record.mention[input.dataset.voiceMention] = input.value || null; this.record.selectedEmployeeId = null; this.record.reviewed = false; if (this.record.draft && this.record.rateDefault) this.record.draft.interestRate = 20; }
        if (input.dataset.voiceTranscript !== undefined) this.record.transcript = input.value;
        if (input.dataset.voiceReviewed !== undefined) this.record.reviewed = input.checked;
        this.record.dirty = true; await this.save(); await this.refreshMatches(); this.render();
    }
    render() {
        const record = this.record; const result = record?.result; const selected = this.selected();
        const blocked = voiceBlocked(result); const disabled = this.busy || this.recording;
        const oldBody = this.dialog.querySelector('.voice-body');
        const before = this.dialog.getBoundingClientRect();
        const phase = this.recording ? 'recording' : result ? 'review' : record ? 'audio' : 'start';
        const structural = this.phase !== phase; this.phase = phase;
        const active = this.dialog.contains(document.activeElement) ? document.activeElement : null;
        const focusKey = active && [...active.attributes].find(a => a.name.startsWith('data-voice-') && a.name !== 'data-voice-name');
        const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        const scrollTop = oldBody?.scrollTop || 0;
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
        const choice = employee => button('select', `<span class="voice-person"><strong>${escapeHTML(employee.name)}</strong><span class="voice-code">#${escapeHTML(employee.number || '—')}</span></span>`, disabled, employee.id);
        const aliasesFor = employee => this.employeeAliases?.find(row => row.employeeId === employee.id)?.aliases || [];
        const row = (employee, reason = '') => `<div data-voice-name="${escapeAttr(normalizeVoiceName([employee.name, employee.number, ...aliasesFor(employee)].join(' ')))}">${choice(employee)}${reason ? `<small>${escapeHTML(reason)}</small>` : ''}</div>`;
        const matchedIds = new Set(this.matches.map(match => match.employee.id));
        const remaining = this.adapter.getEmployees().filter(employee => !matchedIds.has(employee.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
        const selecting = !selected || this.allEmployees;
        let preview = '';
        if (selected && record?.draft && voiceDraftReady(record.draft)) {
            try { const p = this.adapter.previewLoan(selected, record.draft); preview = `<section class="voice-projection"><p>Nuevo préstamo: <strong>${money(p.total)}</strong>${p.installments?.length ? ` · Cuotas: ${p.installments.map(x => `${money(x.amount)}${x.dueDate ? ` (${escapeHTML(x.dueDate)})` : ''}`).join(' / ')}` : ''}</p><p>Saldo actual → proyectado: <strong>${money(p.current)} → ${money(p.projected)}</strong></p></section>`; } catch (_) { preview = '<p>Completa o corrige los datos para ver la proyección.</p>'; }
        }
        const loanDefaults = this.adapter.getLoanDefaults?.(selected) || {};
        const futurePeriods = (loanDefaults.periods || []).filter(period => period.payDate > getDateKey(new Date()));
        const loanInputs = result?.intent === 'crear_prestamo' ? `<fieldset ${disabled ? 'disabled' : ''}><legend>Préstamo · borrador</legend><p>${record.draft.installmentMode === 'lump' ? 'Un solo pago en la nómina seleccionada.' : 'Las cuotas usan el calendario del sistema actual de préstamos.'} </p>${LOAN_FIELDS.filter(field => field !== 'installmentFrequencyWeeks' && (field !== 'installmentCount' || record.draft.installmentMode === 'installments')).map(field => {
            const v = record.draft?.[field] ?? ''; const options = field === 'installmentMode' ? [['lump', 'Pago único'], ['installments', 'Cuotas']] : field === 'interestIncluded' ? [['true', 'Sí'], ['false', 'No']] : null;
            return `<label>${fieldLabels[field]} ${v === '' && field !== 'concept' ? '<small>Pendiente</small>' : ''}${options ? `<select data-voice-field="${field}"><option value="">Seleccionar</option>${options.map(([key, label]) => `<option value="${key}" ${String(v) === key ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<input data-voice-field="${field}" type="${field === 'startDate' ? 'date' : ['concept'].includes(field) ? 'text' : 'number'}" ${field === 'concept' ? '' : 'step="any"'} value="${escapeAttr(String(v))}">`}</label>`;
        }).join('')}${record.draft.installmentMode === 'lump' ? `<label>Nómina de cobro<select data-voice-field="dueDate"><option value="">Seleccionar fecha de pago</option>${futurePeriods.map(period => `<option value="${escapeAttr(period.payDate)}" ${record.draft.dueDate === period.payDate ? 'selected' : ''}>${escapeHTML(period.label || period.payDate)}</option>`).join('')}</select></label>${!futurePeriods.length ? '<p role="alert">Configura el calendario de nómina para elegir la próxima fecha de pago.</p>' : ''}` : ''}${selected && loanDefaults.previousRate !== null && loanDefaults.previousRate !== undefined && loanDefaults.previousRate !== 20 ? button('previous-interest', `Usar tasa anterior: ${escapeHTML(String(loanDefaults.previousRate))} %`, disabled) : ''}<p>Nota que se guardará: ${escapeHTML(record.createdAt ? voiceLoanNote(record, record.draft.concept) : 'Pendiente')}</p></fieldset>${preview}${record.completedLoanId ? '<p>Esta grabación ya registró un préstamo.</p>' : ''}${button('loan', 'Aceptar y registrar préstamo', disabled || blocked || !selected || !!record.completedLoanId || !this.loanReady() || ((result.needsReview || result.issues.length) && !record.reviewed))}` : '';
        const markup = `<header><h2>Voz · MVP</h2>${button('close', 'Cerrar')}</header>
            <p role="status">${escapeHTML(this.message)}</p><p>Máximo 60 segundos · 10 MiB.</p>
            <div class="voice-actions">${button('record', 'Grabar instrucción', disabled)}${this.recording ? button('stop', 'Detener y conservar') : ''}</div>
            ${record ? `<audio controls src="${escapeAttr(this.audioURL || '')}"></audio><p>Formato: ${escapeHTML(record.mimeType)} · ${(record.audio.size / 1024).toFixed(0)} KiB</p><div class="voice-actions">${button('process', 'Procesar / reintentar', disabled || !!record.unsaved)}${record.unsaved ? button('save-audio', 'Reintentar guardado local') : ''}${button('delete', 'Eliminar audio y borrador', disabled)}</div>` : ''}
            ${record?.pendingResult ? button('apply-result', 'Reemplazar ediciones con nuevo resultado', disabled) : ''}
            ${result ? `<label>Texto entendido<textarea data-voice-transcript ${disabled ? 'disabled' : ''}>${escapeHTML(record.transcript)}</textarea></label><p class="voice-intent">${result.intent === 'crear_prestamo' ? 'Nuevo préstamo' : 'Buscar empleado'}</p>
                ${result.needsReview || result.issues.length ? `<section class="voice-review"><strong>Revisión necesaria</strong><ul>${result.issues.map(x => `<li>${escapeHTML(x.field || '')}: ${escapeHTML(x.message)}</li>`).join('')}</ul><label><input type="checkbox" data-voice-reviewed ${record.reviewed ? 'checked' : ''} ${disabled ? 'disabled' : ''}> Revisé las advertencias</label></section>` : ''}
                ${blocked ? '<p role="alert">Instrucción negada o no reconocida. Graba una nueva instrucción; no hay una acción confirmable.</p>' : ''}
                <details class="voice-identity"><summary>Corregir nombre o número reconocido</summary><label>Nombre mencionado<input data-voice-mention="spokenName" value="${escapeAttr(record.mention.spokenName || '')}" ${disabled ? 'disabled' : ''}></label>
                <label>Número mencionado<input data-voice-mention="spokenNumber" value="${escapeAttr(record.mention.spokenNumber || '')}" ${disabled ? 'disabled' : ''}></label></details>
                <h3 class="${selected ? 'voice-selected' : ''}">${selected ? `<span>Empleado seleccionado</span><strong>${escapeHTML(selected.name)}</strong><span class="voice-code">#${escapeHTML(selected.number || '—')}</span>` : '¿A qué empleado te refieres?'}</h3>
                ${selected ? button('choose', 'Es otro empleado / cambiar selección', disabled) : '<p>Selecciona al empleado correcto.</p>'}
                ${selecting ? `<label>Buscar por nombre, número o alias<input data-voice-search ${disabled ? 'disabled' : ''}></label><div class="voice-all"><h4>Posibles coincidencias</h4><div class="voice-choices">${this.matches.map(x => row(x.employee, x.reason)).join('') || '<p>No encontramos coincidencias. Puedes asociar el nombre con cualquier empleado de la lista.</p>'}</div><h4>Otros empleados del proyecto (${remaining.length})</h4><div class="voice-choices">${remaining.map(e => row(e)).join('') || '<p>No hay otros empleados disponibles.</p>'}</div><p data-voice-empty hidden>Sin resultados para esta búsqueda. Prueba con otra parte del nombre o con el número.</p></div>` : ''}
                ${selected ? `<details class="voice-aliases"><summary>Guardar coincidencia de pronunciación</summary><p>Se conserva en este dispositivo y proyecto.</p><label>Variante reconocida<input data-voice-alias value="${escapeAttr(record.mention.spokenName || '')}" ${disabled ? 'disabled' : ''}></label>${button('learn', 'Guardar esta coincidencia', disabled)}<p>Variantes guardadas: ${aliasesFor(selected).map(escapeHTML).join(', ') || 'Ninguna'}</p>${button('clear-aliases', 'Eliminar alias locales del empleado', disabled)}</details>` : ''}
                ${result.intent === 'crear_prestamo' ? '<details><summary>Otros accesos del empleado</summary>' : ''}<div class="voice-actions">${button('profile', 'Abrir perfil', disabled || blocked || !selected)}${button('attendance', 'Ir a asistencia', disabled || blocked || !selected)}${button('loans', 'Ir a préstamos', disabled || blocked || !selected)}</div>${result.intent === 'crear_prestamo' ? '</details>' : ''}${loanInputs}` : ''}
            <details><summary>Audios locales de esta cuenta y proyecto</summary>${this.history.map(x => button('load', new Date(x.createdAt).toLocaleString(), disabled, x.requestId)).join('')}</details>
            <details><summary>Configuración de la prueba</summary><label>URL del webhook de voz<input data-voice-endpoint value="${escapeAttr(this.endpoint())}" ${disabled ? 'disabled' : ''}></label>${button('default-endpoint', 'Usar URL predeterminada', disabled)}<p>Origen actual: ${escapeHTML(location.origin)}. Este origen debe autorizarse en n8n. La prueba pública usa HTTPS; el endpoint HTTP de Tailscale solo se permite desde http://127.0.0.1:8080.</p></details>`;
        if (!oldBody) this.dialog.innerHTML = `<header class="voice-header"><div class="voice-mark">${micIcon}</div><div><span class="voice-kicker">PRUEBA DE VOZ</span><h2 id="voice-title">Borrador de voz</h2><p>Revisa la instrucción antes de confirmar.</p></div>${button('close', 'Cerrar')}</header><div class="voice-progress"></div><div class="voice-body"></div><footer class="voice-footer"></footer>`;
        this.dialog.setAttribute('aria-labelledby', 'voice-title');
        const liveBody = this.dialog.querySelector('.voice-body');
        const body = document.createElement('div'); body.className = 'voice-body';
        const template = document.createElement('template'); template.innerHTML = markup;
        template.content.querySelector('header')?.remove();
        body.replaceChildren(template.content);
        if (result) {
            const audio = body.querySelector('audio');
            if (audio) {
                const detail = document.createElement('details'); detail.className = 'voice-audio-details';
                detail.innerHTML = '<summary>Audio y reprocesamiento</summary>';
                const info = audio.nextElementSibling; const controls = info?.nextElementSibling;
                audio.before(detail); detail.append(audio); if (info) detail.append(info); if (controls) detail.append(controls);
                const recordButton = body.querySelector('[data-voice-action="record"]'); if (recordButton) detail.append(recordButton);
            }
        }
        let action = this.recording ? 'stop' : !record || blocked ? 'record' : record.unsaved ? 'save-audio' : !result ? 'process' : result.intent === 'crear_prestamo' ? 'loan' : 'profile';
        const primary = body.querySelector(`[data-voice-action="${action}"]`);
        const validation = action === 'loan' && record?.draft ? this.adapter.validateLoan(record.draft) : null;
        if (primary && validation && !validation.valid) primary.disabled = true;
        const footer = this.dialog.querySelector('.voice-footer');
        let hint = this.recording ? 'Máximo 60 segundos.' : 'El audio se conserva en este dispositivo.';
        if (primary?.disabled) {
            hint = this.busy ? 'Espera a que termine el procesamiento.' : record?.completedLoanId ? 'Esta grabación ya registró un préstamo.' : !selected ? 'Selecciona al empleado correcto.' : (result?.needsReview || result?.issues.length) && !record.reviewed ? 'Confirma que revisaste las advertencias.' : !record?.draft?.principal ? 'Completa el monto del préstamo.' : validation && !validation.valid ? validation.errors.join('. ') : 'Completa los datos y la fecha de cobro.';
        }
        footer.innerHTML = `<p class="voice-hint" id="voice-hint">${escapeHTML(hint)}</p>`;
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
            (target || this.dialog.querySelector('.voice-primary'))?.focus({ preventScroll: true });
            if (selection && target && (['text', 'search', 'url', 'tel', 'password'].includes(target.type) || target.tagName === 'TEXTAREA')) target.setSelectionRange(...selection);
        }
        const searchInput = this.dialog.querySelector('[data-voice-search]');
        if (searchInput) searchInput.oninput = event => {
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
        if (structural && this.dialog.open && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            const after = this.dialog.getBoundingClientRect();
            if (before.height && after.height && before.height !== after.height) {
                this.morph?.cancel();
                this.morph = this.dialog.animate?.([{ height: `${before.height}px` }, { height: `${after.height}px` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
            }
        }
    }
    destroy() { this.recorder?.cancel(); this.unsubscribe?.(); this.unsubscribeScope?.(); this.unsubscribeEnabled?.(); window.removeEventListener('sa:voice-wipe', this.onWipe); if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.store.close(); this.dialog.remove(); this.launcher.remove(); }
}
