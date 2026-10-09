import { VoiceStore } from './VoiceStore.js';
import { VoiceRecorder } from './VoiceRecorder.js';
import { LOAN_FIELDS, VOICE_ENDPOINT_PREFIX, isVoiceEndpointAllowed, createVoiceContext, sendVoiceRecording, resolveVoiceEmployees, voiceBlocked, voiceDraftReady } from './VoiceCore.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';

const fieldLabels = { principal: 'Monto', interestRate: 'Interés (%)', interestIncluded: 'Interés incluido', installmentMode: 'Cobro', installmentCount: 'Cantidad de cuotas', installmentFrequencyWeeks: 'Frecuencia (semanas)', startDate: 'Fecha', concept: 'Concepto' };
const projectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';
const money = value => Number(value).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export class VoiceMvpUI {
    constructor(adapter, { store = new VoiceStore(), recorderFactory = options => new VoiceRecorder(options) } = {}) {
        this.adapter = adapter; this.store = store; this.recorderFactory = recorderFactory;
        this.message = ''; this.busy = false; this.history = []; this.matches = []; this.allEmployees = false;
    }
    mount() {
        this.launcher = document.createElement('button'); this.launcher.type = 'button'; this.launcher.className = 'voice-launcher';
        this.launcher.textContent = '🎙 Voz · MVP'; this.launcher.setAttribute('aria-label', 'Abrir borrador de voz');
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
        this.unsubscribe = this.adapter.subscribeSession?.(() => {
            this.launcher.hidden = this.wiped || !this.adapter.getUser();
            const uid = this.adapter.getUser()?.uid;
            if (!uid || (this.record && uid !== this.record.uid) || (this.recording && uid !== this.recordingUid)) { this.close(); this.record = null; }
        });
        this.launcher.hidden = !this.adapter.getUser();
        return this;
    }
    async run(callback) {
        try { await callback(); } catch (error) { this.message = error.message || 'No se pudo completar la acción.'; if (this.dialog.open) this.render(); }
    }
    identity() {
        if (this.wiped) throw Error('Los datos locales se borraron. Recarga SA antes de usar Voz.');
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
        return localStorage.getItem(`${VOICE_ENDPOINT_PREFIX}${this.identity().uid}`) || this.adapter.getEndpoint() || '';
    }
    async open() {
        const identity = this.identity();
        if (this.record && (this.record.uid !== identity.uid || this.record.projectKey !== identity.projectKey)) this.record = null;
        this.history = await this.store.list(identity.uid, identity.projectKey); this.message = '';
        if (!this.record) this.record = this.history[0] || null;
        await this.refreshMatches(); this.render(); this.dialog.showModal();
    }
    close() {
        this.recorder?.cancel(); this.recording = false;
        if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.audioURL = null;
        this.dialog.close(); this.launcher.focus();
    }
    async save() { this.guard(); await this.store.put(this.record); }
    async refreshMatches() {
        const identity = this.identity();
        const aliases = await this.store.aliases(identity.uid, identity.projectKey);
        this.matches = resolveVoiceEmployees(this.record?.mention || {}, this.adapter.getEmployees(), aliases);
    }
    selected() { return this.adapter.getEmployees().find(e => e.id === this.record?.selectedEmployeeId); }
    applyResult(result, record = this.record) {
        record.result = result; record.mention = { ...result.employee }; record.transcript = result.transcript;
        record.draft = result.loan ? { ...result.loan } : null;
        record.selectedEmployeeId = null; record.reviewed = false; record.dirty = false; record.pendingResult = null;
    }
    async action(action, id) {
        if (action === 'close') { this.close(); return; }
        if (action === 'stop') { this.recorder?.stop(); return; }
        if (this.busy || this.recording) return;
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
            this.allEmployees = false; this.message = ''; await this.refreshMatches(); this.render(); return;
        }
        this.guard();
        if (action === 'save-audio') { delete this.record.unsaved; try { await this.save(); } catch (error) { this.record.unsaved = true; throw error; } this.render(); return; }
        if (action === 'process') { await this.process(); return; }
        if (action === 'apply-result') {
            if (!confirm('¿Reemplazar los campos editados con el nuevo resultado?')) return;
            this.applyResult(this.record.pendingResult); await this.save(); await this.refreshMatches(); this.render(); return;
        }
        if (action === 'delete') {
            if (!confirm('¿Eliminar este audio y su borrador del dispositivo?')) return;
            await this.store.remove(this.record.uid, this.record.requestId); this.record = null;
            const identity = this.identity(); this.history = await this.store.list(identity.uid, identity.projectKey); this.render(); return;
        }
        if (action === 'choose') { this.allEmployees = true; this.render(); return; }
        if (action === 'select') {
            const employee = this.adapter.getEmployees().find(e => e.id === id); if (!employee) throw Error('Empleado no disponible en el proyecto activo.');
            this.record.selectedEmployeeId = id; this.record.dirty = true; this.allEmployees = false; await this.save(); this.render(); return;
        }
        const employee = this.selected(); if (!employee) throw Error('Selecciona al empleado correcto primero.');
        if (action === 'learn') {
            const alias = this.dialog.querySelector('[data-voice-alias]').value;
            await this.store.saveAlias(this.record.uid, this.record.projectKey, employee.id, alias); this.message = 'Coincidencia confirmada y guardada solo en este dispositivo.';
            await this.refreshMatches(); this.render(); return;
        }
        if (action === 'clear-aliases') { await this.store.clearAliases(this.record.uid, this.record.projectKey, employee.id); this.message = 'Alias locales del empleado eliminados.'; await this.refreshMatches(); this.render(); return; }
        if (voiceBlocked(this.record.result)) throw Error('La instrucción está negada o no se pudo interpretar. Graba una nueva instrucción.');
        if (action === 'loan') {
            if ((this.record.result.needsReview || this.record.result.issues.length) && !this.record.reviewed) throw Error('Revisa las advertencias y confirma que las revisaste.');
            if (!voiceDraftReady(this.record.draft)) throw Error('Completa los campos pendientes del préstamo.');
            const validation = this.adapter.validateLoan(this.record.draft); if (!validation.valid) throw Error(validation.errors.join('. '));
            await this.adapter.onLoan(employee.id, { ...this.record.draft }); this.close(); return;
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
            else { this.applyResult(result, record); this.message = 'Resultado recibido como borrador. No se ha guardado ninguna operación.'; }
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
        this.guard(); const field = input.dataset.voiceField;
        if (field) {
            this.record.draft ||= Object.fromEntries(LOAN_FIELDS.map(k => [k, null]));
            const v = input.value;
            this.record.draft[field] = v === '' ? null : ['principal', 'interestRate', 'installmentCount', 'installmentFrequencyWeeks'].includes(field) ? Number(v) : field === 'interestIncluded' ? v === 'true' : v;
        }
        if (input.dataset.voiceMention) this.record.mention[input.dataset.voiceMention] = input.value || null;
        if (input.dataset.voiceTranscript !== undefined) this.record.transcript = input.value;
        if (input.dataset.voiceReviewed !== undefined) this.record.reviewed = input.checked;
        this.record.dirty = true; await this.save(); await this.refreshMatches(); this.render();
    }
    render() {
        const record = this.record; const result = record?.result; const selected = this.selected();
        const blocked = voiceBlocked(result); const disabled = this.busy || this.recording;
        if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.audioURL = record?.audio ? URL.createObjectURL(record.audio) : null;
        const button = (action, text, off = false, id = '') => `<button type="button" data-voice-action="${action}" data-id="${escapeAttr(id)}" ${off ? 'disabled' : ''}>${text}</button>`;
        const choice = employee => button('select', `${escapeHTML(employee.name)} · #${escapeHTML(employee.number || '—')}`, disabled, employee.id);
        let preview = '';
        if (selected && record?.draft && voiceDraftReady(record.draft)) {
            try { const p = this.adapter.previewLoan(selected, record.draft); preview = `<p>Nuevo préstamo: <strong>${money(p.total)}</strong>${p.installments?.length ? ` · Cuotas: ${p.installments.map(x => money(x.amount)).join(' / ')}` : ''}</p><p>Saldo actual → proyectado: <strong>${money(p.current)} → ${money(p.projected)}</strong></p>`; } catch (_) { preview = '<p>Completa o corrige los datos para ver la proyección.</p>'; }
        }
        const loanInputs = result?.intent === 'crear_prestamo' ? `<fieldset ${disabled ? 'disabled' : ''}><legend>Préstamo · borrador</legend>${LOAN_FIELDS.map(field => {
            const v = record.draft?.[field] ?? ''; const options = field === 'installmentMode' ? [['lump', 'Pago único'], ['installments', 'Cuotas']] : field === 'interestIncluded' ? [['true', 'Sí'], ['false', 'No']] : null;
            return `<label>${fieldLabels[field]} ${v === '' ? '<small>Pendiente</small>' : ''}${options ? `<select data-voice-field="${field}"><option value="">Seleccionar</option>${options.map(([key, label]) => `<option value="${key}" ${String(v) === key ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<input data-voice-field="${field}" type="${field === 'startDate' ? 'date' : ['concept'].includes(field) ? 'text' : 'number'}" ${field === 'concept' ? '' : 'step="any"'} value="${escapeAttr(String(v))}">`}</label>`;
        }).join('')}</fieldset>${preview}${button('loan', 'Revisar en el formulario habitual', disabled || blocked || !selected || !voiceDraftReady(record.draft) || ((result.needsReview || result.issues.length) && !record.reviewed))}` : '';
        this.dialog.innerHTML = `<header><h2>Voz · MVP</h2>${button('close', 'Cerrar')}</header>
            <p role="status">${escapeHTML(this.message)}</p><p>Máximo 60 segundos · 10 MiB. Audio conservado en este dispositivo.</p>
            <div class="voice-actions">${button('record', '🎙 Grabar nueva instrucción', disabled)}${this.recording ? button('stop', 'Detener y conservar') : ''}</div>
            ${record ? `<audio controls src="${escapeAttr(this.audioURL || '')}"></audio><p>Formato: ${escapeHTML(record.mimeType)} · ${(record.audio.size / 1024).toFixed(0)} KiB</p><div class="voice-actions">${button('process', 'Procesar / reintentar', disabled || !!record.unsaved)}${record.unsaved ? button('save-audio', 'Reintentar guardado local') : ''}${button('delete', 'Eliminar audio y borrador', disabled)}</div>` : ''}
            ${record?.pendingResult ? button('apply-result', 'Reemplazar ediciones con nuevo resultado', disabled) : ''}
            ${result ? `<label>Texto entendido<textarea data-voice-transcript ${disabled ? 'disabled' : ''}>${escapeHTML(record.transcript)}</textarea></label><p>Intención: ${escapeHTML(result.intent)}</p>
                ${result.needsReview || result.issues.length ? `<section class="voice-review"><strong>Revisión necesaria</strong><ul>${result.issues.map(x => `<li>${escapeHTML(x.field || '')}: ${escapeHTML(x.message)}</li>`).join('')}</ul><label><input type="checkbox" data-voice-reviewed ${record.reviewed ? 'checked' : ''} ${disabled ? 'disabled' : ''}> Revisé las advertencias</label></section>` : ''}
                ${blocked ? '<p role="alert">Instrucción negada o no reconocida. Graba una nueva instrucción; no hay una acción confirmable.</p>' : ''}
                <label>Nombre mencionado<input data-voice-mention="spokenName" value="${escapeAttr(record.mention.spokenName || '')}" ${disabled ? 'disabled' : ''}></label>
                <label>Número mencionado<input data-voice-mention="spokenNumber" value="${escapeAttr(record.mention.spokenNumber || '')}" ${disabled ? 'disabled' : ''}></label>
                <h3>${selected ? `${escapeHTML(selected.name)} · #${escapeHTML(selected.number || '—')}` : 'Selecciona al empleado'}</h3>
                <h4>Posibles coincidencias</h4><div class="voice-choices">${this.matches.map(x => choice(x.employee)).join('') || '<p>Sin coincidencias. Busca entre todos los empleados.</p>'}</div>
                ${button('choose', 'Es otro empleado / ver todos', disabled)}
                ${this.allEmployees ? `<label>Filtrar empleados<input data-voice-search></label><div class="voice-all">${this.adapter.getEmployees().map(e => `<div data-voice-name="${escapeAttr((e.name + ' ' + e.number).toLowerCase())}">${choice(e)}</div>`).join('')}</div>` : ''}
                ${selected ? `<label>Alias confirmado<input data-voice-alias value="${escapeAttr(record.mention.spokenName || '')}"></label>${button('learn', 'Guardar esta coincidencia', disabled)}${button('clear-aliases', 'Eliminar alias locales del empleado', disabled)}` : ''}
                <div class="voice-actions">${button('profile', 'Abrir perfil', disabled || blocked || !selected)}${button('attendance', 'Ir a asistencia', disabled || blocked || !selected)}${button('loans', 'Ir a préstamos', disabled || blocked || !selected)}</div>${loanInputs}` : ''}
            <details><summary>Audios locales de esta cuenta y proyecto</summary>${this.history.map(x => button('load', new Date(x.createdAt).toLocaleString(), disabled, x.requestId)).join('')}</details>
            <details><summary>Configuración de la prueba</summary><label>URL del webhook de voz<input data-voice-endpoint value="${escapeAttr(this.endpoint())}" ${disabled ? 'disabled' : ''}></label><p>Origen actual: ${escapeHTML(location.origin)}. Este origen debe autorizarse en n8n. El endpoint HTTP de desarrollo requiere Tailscale y el origen exacto http://127.0.0.1:8080.</p></details>`;
        this.dialog.querySelector('[data-voice-search]')?.addEventListener('input', event => {
            for (const row of this.dialog.querySelectorAll('[data-voice-name]')) row.hidden = !row.dataset.voiceName.includes(event.target.value.toLowerCase());
        });
    }
    destroy() { this.recorder?.cancel(); this.unsubscribe?.(); this.unsubscribeScope?.(); window.removeEventListener('sa:voice-wipe', this.onWipe); if (this.audioURL) URL.revokeObjectURL(this.audioURL); this.store.close(); this.dialog.remove(); this.launcher.remove(); }
}
