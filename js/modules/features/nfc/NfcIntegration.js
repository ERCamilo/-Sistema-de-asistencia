import { getNfcReadTest } from '../../ui/settings/NfcReadTest.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { buildNfcRequest, normalizeNfcUid, nfcEndpoint, sendNfcRequest } from './NfcCore.js';
import { readNfcPreferences, saveNfcPreferences, nfcStorage, NFC_PREFS_EVENT, NFC_PREFS_KEY } from './NfcPreferences.js';
import { nfcEmployeeSummary, NfcEmployeeEntry } from './NfcViews.js';

// One shared reader/modal for diagnostic and enrollment. The webhook owns
// associations; this controller never writes employees or attendance.
export class NfcIntegration {
    constructor(adapter, { reader, send = sendNfcRequest, storage = nfcStorage(), requestId = () => crypto.randomUUID() } = {}) {
        this.adapter = adapter; this.reader = reader; this.send = send; this.storage = storage; this.requestId = requestId; this.generation = 0;
    }
    mount() {
        this.onEntry = event => {
            const button = event.target.closest('[data-nfc-employee]');
            if (button && !button.disabled) this.open(button.dataset.nfcEmployee, button.closest('[data-nfc-editor]'));
            const saveUrl = event.target.closest('[data-nfc-setting-action="save-url"]');
            if (saveUrl) this.setting('customUrl', saveUrl.closest('[data-nfc-settings-scope]').querySelector('[data-nfc-setting="customUrl"]').value);
        };
        this.onChange = event => {
            const field = event.target;
            if (field.dataset.nfcSetting === 'enabled') this.setting('enabled', field.checked);
            if (field.dataset.nfcSetting === 'mode') this.setting('mode', field.value);
        };
        this.check = () => { if (this.context && !this.sameContext()) this.reader?.close(); this.refreshEntries(); };
        this.onPreferences = () => { this.check(); this.adapter.render?.(); };
        this.onStorage = event => { if (event.key === null || event.key === NFC_PREFS_KEY) this.onPreferences(); };
        document.addEventListener('click', this.onEntry); document.addEventListener('change', this.onChange);
        window.addEventListener(NFC_PREFS_EVENT, this.onPreferences); window.addEventListener('storage', this.onStorage);
        this.onWipe = () => { this.wiped = true; this.reader?.close(); };
        window.addEventListener('sa:voice-wipe', this.onWipe);
        this.unsubscribes = [this.adapter.subscribeScope?.(this.check), this.adapter.subscribeData?.(this.check)];
        return this;
    }
    refreshEntries() {
        for (const host of document.querySelectorAll('[data-nfc-editor]')) {
            const employee = this.adapter.getEmployees().find(row => row.id === host.dataset.nfcEditor && !row.deletedAt);
            DOMDiff.patchSelf(host, NfcEmployeeEntry(employee));
        }
    }
    setting(key, value) {
        const node = document.querySelector('[data-nfc-settings-status]');
        try {
            saveNfcPreferences({ [key]: value }, this.storage);
            if (node) node.textContent = key === 'enabled' ? (value ? 'Asociación activada en este navegador.' : 'Asociación desactivada.') : 'Destino guardado en este navegador.';
        } catch (error) {
            if (node) node.textContent = error.message;
            const field = document.querySelector(`[data-nfc-setting="${key}"]`);
            const config = readNfcPreferences(this.storage);
            if (key === 'enabled' && field) field.checked = config.enabled;
            if (key === 'mode' && field) field.value = config.mode;
        }
    }
    capture(employeeId) {
        const scope = this.adapter.getScope();
        if (this.wiped || this.adapter.canProceed?.() === false || (scope?.enabled && !scope.projectId)) throw Error('Espera a que termine la preparación de la obra.');
        const config = readNfcPreferences(this.storage);
        if (!config.enabled) throw Error('Activa la asociación de tarjetas en Ajustes → Pruebas.');
        const current = this.adapter.getEmployees().find(employee => employee.id === employeeId && !employee.deletedAt);
        if (!current) throw Error('El empleado ya no está disponible en esta obra.');
        const employee = { id: current.id, number: String(current.number ?? ''), name: String(current.name || '') };
        const context = { projectId: scope?.enabled ? scope.projectId : null, companyName: String(this.adapter.getCompanyName() || '') };
        return { employee, context, config, endpoint: nfcEndpoint(config) };
    }
    sameContext() {
        if (this.sourceEntry && (!this.sourceEntry.isConnected || this.sourceEntry.dataset.nfcEditor !== this.context?.employee.id)) return false;
        try { return !!this.context && JSON.stringify(this.context) === JSON.stringify(this.capture(this.context.employee.id)); }
        catch (_) { return false; }
    }
    valid(generation = this.generation) { return generation === this.generation && !!this.reader?.dialog.open && this.sameContext(); }
    guard(generation = this.generation) {
        if (!this.valid(generation)) throw Error('Cambió la empresa, la obra, el empleado o el destino. Vuelve a abrir NFC.');
    }
    open(employeeId, sourceEntry = null) {
        const reader = this.reader ||= getNfcReadTest();
        reader.close();
        let context;
        try { context = this.capture(employeeId); }
        catch (error) { this.adapter.notify?.(error.message, 'warning'); return; }
        reader.open({
            title: 'Asociar tarjeta',
            onClose: () => this.cancel(), onSuspend: () => reader.close(),
            onScan: () => {
                this.guard(); this.httpController?.abort();
                this.cardUid = ''; this.pending = null; this.lookupRequest = null; this.result = null; this.error = ''; this.note = ''; this.render();
            },
            onResult: result => { void this.readCard(result); },
            onAction: action => { if (action === 'register' || action === 'retry') void this.submit(action); }
        });
        this.context = context; this.sourceEntry = sourceEntry; this.cardUid = ''; this.result = null; this.pending = null; this.lookupRequest = null;
        this.busy = false; this.error = ''; this.note = 'Lee la tarjeta para consultar su disponibilidad.';
        this.render();
    }
    cancel() {
        ++this.generation; this.httpController?.abort(); this.httpController = null;
        this.context = null; this.sourceEntry = null; this.pending = null; this.lookupRequest = null; this.busy = false; this.result = null;
    }
    render() {
        if (!this.valid()) return;
        const region = this.reader.node('enrollment');
        this.reader.dialog.dataset.nfcHasCard = this.cardUid ? 'true' : 'false';
        region.innerHTML = `${nfcEmployeeSummary(this.context.employee, this.context.config)}<p class="nfc-enrollment-status" role="status" aria-live="polite">${escapeHTML(this.note)}</p>${this.error ? `<p class="nfc-enrollment-error" role="alert">${escapeHTML(this.error)}</p>` : ''}`;
        this.reader.externalBusy = this.busy; this.reader.controls();
        const register = this.reader.node('register');
        register.hidden = this.result?.status !== 'disponible' || !!this.pending; register.disabled = this.busy;
        const retry = this.reader.node('retry');
        retry.hidden = !this.error || (!this.pending && !this.lookupRequest); retry.disabled = this.busy;
        retry.textContent = this.pending ? 'Reintentar registro' : 'Volver a consultar';
        retry.classList.toggle('nfc-test-primary', !retry.hidden);
        this.reader.node('start').classList.toggle('nfc-test-primary', register.hidden && retry.hidden);
    }
    async readCard(result) {
        if (!this.valid() || this.busy) return;
        try {
            this.cardUid = normalizeNfcUid(result.uid);
            this.lookupRequest = buildNfcRequest('consultar', { ...this.context, requestId: this.requestId(), cardUid: this.cardUid });
            await this.perform(this.lookupRequest);
        } catch (error) { if (this.valid()) { this.error = error.message; this.render(); } }
    }
    async submit(action) {
        if (!this.valid() || this.busy) return;
        if (action === 'retry' && !this.pending && this.lookupRequest) { await this.perform(this.lookupRequest); return; }
        if (this.result?.status !== 'disponible' && !this.pending) return;
        try {
            this.pending ||= buildNfcRequest('asociar', { ...this.context, requestId: this.requestId(), cardUid: this.cardUid });
            await this.perform(this.pending);
        } catch (error) { if (this.valid()) { this.error = error.message; this.render(); } }
    }
    async perform(request) {
        const generation = this.generation;
        if (!this.valid(generation) || this.busy) return;
        const context = this.context;
        this.busy = true; this.error = ''; this.note = request.action === 'asociar' ? 'Registrando… Si cierras ahora, el envío podría haberse guardado.' : 'Consultando la tarjeta…'; this.render();
        const controller = this.httpController = new AbortController();
        try {
            this.guard(generation);
            const result = await this.send(context.endpoint, request, { signal: controller.signal });
            this.guard(generation); this.result = result;
            this.note = result.status === 'disponible' ? 'Tarjeta disponible. Revisa el empleado y el destino antes de guardar.'
                : result.status === 'otro_empleado' ? 'Esta tarjeta pertenece a otro empleado. No se puede reemplazar aquí.'
                : result.status === 'mismo_empleado' ? 'La tarjeta ya está asociada a este empleado.' : 'Tarjeta asociada. El registro fue confirmado por el webhook.';
            if (request.action === 'asociar') { this.pending = null; this.lookupRequest = null; }
        } catch (error) {
            if (!this.valid(generation)) return;
            this.error = error.message || 'No se pudo completar la operación.';
            if (error.code === 'CONFLICT') {
                this.pending = null; this.result = null; this.note = 'La asociación cambió. Consulta de nuevo antes de guardar.';
            } else if (request.action === 'asociar') this.note = 'No se pudo confirmar el registro. Puede haberse guardado; reintentar usa la misma solicitud.';
            else { this.result = null; this.note = 'No se confirmó la disponibilidad. Puedes volver a consultar.'; }
        } finally {
            if (generation === this.generation) { this.busy = false; this.httpController = null; if (this.sameContext()) this.render(); else this.reader.close(); }
        }
    }
    destroy() {
        this.reader?.close(); this.cancel();
        document.removeEventListener('click', this.onEntry); document.removeEventListener('change', this.onChange);
        window.removeEventListener(NFC_PREFS_EVENT, this.onPreferences); window.removeEventListener('storage', this.onStorage); window.removeEventListener('sa:voice-wipe', this.onWipe);
        this.unsubscribes?.forEach(unsubscribe => unsubscribe?.());
    }
}
