// Device-only compatibility probe. No employee, persistence, webhook or tag writes.
const cardIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9v6m3-6v6m4-5a3 3 0 0 1 0 4m3-7a7 7 0 0 1 0 10"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';

export function SettingsNfcReadTestCard() {
    return `<section class="stg-card nfc-test-entry" aria-labelledby="nfc-read-test-title"><h3 id="nfc-read-test-title">Lectura NFC</h3><p>Comprueba si este teléfono puede leer el UID de tus tarjetas.</p><button type="button" class="btn btn-primary" data-settings-action="test-nfc-read">${cardIcon} Probar lectura NFC</button><small>Solo lectura: no asocia empleados ni envía información.</small></section>`;
}

export function nfcTestSupport(env = globalThis) {
    if (!env.isSecureContext) return 'Esta prueba necesita HTTPS. Abre el enlace seguro de Cloudflare.';
    if (typeof env.NDEFReader !== 'function') return 'Este navegador no ofrece Web NFC. Prueba Chrome en Android con NFC activado.';
    return '';
}

export function nfcTestError(error) {
    const messages = {
        NotAllowedError: 'No se autorizó NFC. Permite el acceso al sitio y vuelve a intentarlo.',
        NotSupportedError: 'El teléfono, la tarjeta o la configuración del navegador no admiten esta lectura.',
        NotReadableError: 'No se pudo activar el lector. Comprueba que NFC esté encendido y libre.',
        SecurityError: 'El navegador bloqueó NFC. Abre el enlace directamente en Chrome mediante HTTPS.'
    };
    return messages[error?.name] || 'No se pudo leer la tarjeta. Acércala de nuevo y comprueba si es compatible con NDEF.';
}

export function nfcTestResult(event) {
    const serial = String(event?.serialNumber || '');
    const uid = serial.replace(/[ :\-]/g, '').toUpperCase();
    return {
        uid: /^(?:[0-9A-F]{2})+$/.test(uid) ? uid : '',
        serial,
        recordTypes: Array.from(event?.message?.records || [], record => String(record.recordType || 'unknown'))
    };
}

export class NfcReadTest {
    constructor({ env = globalThis, doc = document, timeoutMs = 30000 } = {}) {
        this.env = env; this.doc = doc; this.timeoutMs = timeoutMs; this.epoch = 0;
    }
    mount() {
        this.dialog = this.doc.createElement('dialog');
        this.dialog.className = 'nfc-test-dialog';
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-labelledby', 'nfc-test-dialog-title');
        this.dialog.innerHTML = `<header>${cardIcon}<h2 id="nfc-test-dialog-title" tabindex="-1">Probar NFC</h2><button type="button" data-nfc-test="close" aria-label="Cerrar">${closeIcon}</button></header><div class="nfc-test-body"><p>Activa NFC, desbloquea el teléfono y acerca una tarjeta.</p><p data-nfc-test="support"></p><div class="nfc-test-result"><span>UID para comparar con el ESP32</span><output data-nfc-test="uid">Sin leer</output></div><p data-nfc-test="status" role="status" aria-live="polite"></p><p data-nfc-test="error" role="alert" hidden></p><details><summary>Detalles de la prueba</summary><pre data-nfc-test="details"></pre></details><small>Web NFC lee tarjetas NDEF compatibles. Que el teléfono tenga NFC no garantiza que pueda leer esta tarjeta desde la web.</small></div><footer><button type="button" data-nfc-test="copy" disabled>Copiar resultado</button><button type="button" data-nfc-test="start" class="nfc-test-primary">Leer tarjeta</button><button type="button" data-nfc-test="stop" hidden>Detener lectura</button></footer>`;
        this.doc.body.append(this.dialog);
        this.dialog.addEventListener('click', event => {
            const button = event.target.closest('[data-nfc-test]');
            if (!button || button.disabled || button.tagName !== 'BUTTON') return;
            if (button.dataset.nfcTest === 'start') void this.start();
            if (button.dataset.nfcTest === 'stop') this.stop('Lectura detenida. Puedes volver a intentarlo.');
            if (button.dataset.nfcTest === 'close') this.close();
            if (button.dataset.nfcTest === 'copy') void this.copy();
        });
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.release(); });
        // Keep the employee/settings modal's document handlers underneath.
        this.dialog.addEventListener('keydown', event => { if (['Escape', 'Tab'].includes(event.key)) event.stopPropagation(); });
        this.onHidden = () => { if (this.doc.hidden && this.reading) this.stop('Lectura detenida al salir de la pantalla. Vuelve a pulsar Leer tarjeta.'); };
        this.doc.addEventListener('visibilitychange', this.onHidden);
        this.onPageHide = () => this.release();
        this.env.addEventListener?.('pagehide', this.onPageHide);
        return this;
    }
    node(name) { return this.dialog.querySelector(`[data-nfc-test="${name}"]`); }
    open() {
        this.release(); this.result = null; this.returnFocus = this.doc.activeElement;
        const reason = nfcTestSupport(this.env);
        this.node('support').textContent = reason || 'Web NFC está disponible. Falta comprobar la tarjeta.';
        this.node('uid').textContent = 'Sin leer'; this.node('error').hidden = true;
        this.node('copy').disabled = true;
        this.diagnostic = { https: !!this.env.isSecureContext, webNfc: typeof this.env.NDEFReader === 'function', status: reason ? 'unsupported' : 'ready' };
        this.paintDetails(); this.controls();
        this.node('status').textContent = reason ? 'La lectura no se puede iniciar en este navegador.' : 'Pulsa Leer tarjeta para autorizar el acceso.';
        if (!this.dialog.open) this.dialog.showModal();
        this.dialog.querySelector('h2').focus();
    }
    controls() {
        this.node('start').hidden = !!this.reading;
        this.node('start').disabled = !!nfcTestSupport(this.env);
        this.node('stop').hidden = !this.reading;
    }
    paintDetails() { this.node('details').textContent = JSON.stringify(this.diagnostic, null, 2); }
    release() {
        ++this.epoch; clearTimeout(this.timer); this.controller?.abort();
        if (this.reader) { this.reader.onreading = null; this.reader.onreadingerror = null; }
        this.reader = null; this.controller = null; this.reading = false;
    }
    stop(message) {
        this.release(); this.controls();
        if (message) { this.node('status').textContent = message; this.diagnostic.status = 'stopped'; this.paintDetails(); }
    }
    async start() {
        if (this.reading || !this.dialog.open || nfcTestSupport(this.env)) return;
        this.release(); const epoch = this.epoch;
        this.result = null; this.node('copy').disabled = true;
        this.node('uid').textContent = 'Sin leer'; this.node('error').hidden = true;
        this.node('support').textContent = 'Web NFC está disponible. Falta comprobar la tarjeta.';
        this.diagnostic = { https: true, webNfc: true, status: 'requesting' }; this.paintDetails();
        this.reading = true; this.controls();
        this.node('status').textContent = 'Autorizando el lector NFC…';
        const valid = () => epoch === this.epoch && this.dialog.open;
        try {
            const reader = this.reader = new this.env.NDEFReader();
            const controller = this.controller = new AbortController();
            reader.onreading = event => {
                if (!valid()) return;
                this.result = nfcTestResult(event);
                this.release(); this.controls();
                this.diagnostic = { ...this.diagnostic, status: this.result.uid ? 'uid-read' : 'tag-without-uid', ...this.result };
                this.node('support').textContent = 'El navegador detectó la tarjeta.';
                this.node('uid').textContent = this.result.uid || 'No disponible';
                this.node('status').textContent = this.result.uid ? 'UID leído. Compáralo con el del ESP32; ignora espacios y dos puntos.' : 'Se detectó una tarjeta, pero no se obtuvo un UID válido. Aún no sirve para asociarla por UID.';
                this.node('copy').disabled = false; this.paintDetails();
            };
            reader.onreadingerror = () => { if (valid()) this.fail('No se pudo leer la tarjeta. Prueba de nuevo; podría no ser compatible con NDEF.', 'ReadingError'); };
            // Must happen in the button's user gesture, before any await.
            await reader.scan({ signal: controller.signal });
            if (!valid()) return;
            this.diagnostic.status = 'listening'; this.paintDetails();
            this.node('status').textContent = 'Acerca la tarjeta a la antena NFC del teléfono y mantenla quieta.';
            this.timer = setTimeout(() => {
                if (valid()) this.fail('No se detectó una tarjeta en 30 segundos. Revisa NFC y su posición; esto no confirma que sea incompatible.', 'Timeout');
            }, this.timeoutMs);
        } catch (error) { if (valid()) this.fail(nfcTestError(error), error?.name || 'Error'); }
    }
    fail(message, code) {
        this.release(); this.controls();
        this.diagnostic = { ...this.diagnostic, status: 'error', error: code };
        this.node('status').textContent = 'Lectura sin completar.';
        this.node('error').textContent = message; this.node('error').hidden = false;
        this.node('copy').disabled = false; this.paintDetails();
    }
    async copy() {
        const epoch = this.epoch;
        try {
            await this.env.navigator.clipboard.writeText(JSON.stringify(this.diagnostic, null, 2));
            if (epoch === this.epoch && this.dialog.open) this.node('status').textContent = 'Resultado copiado.';
        } catch (_) {
            if (epoch === this.epoch && this.dialog.open) { this.node('error').textContent = 'No se pudo copiar. Puedes seleccionar el UID o tomar una captura.'; this.node('error').hidden = false; }
        }
    }
    close() {
        this.release(); this.result = null; this.diagnostic = null;
        this.node('uid').textContent = 'Sin leer'; this.node('details').textContent = '';
        if (this.dialog.open) this.dialog.close();
        if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    }
    destroy() {
        this.close(); this.doc.removeEventListener('visibilitychange', this.onHidden);
        this.env.removeEventListener?.('pagehide', this.onPageHide); this.dialog.remove();
    }
}

let test;
export function openNfcReadTest() {
    if (!test?.dialog.isConnected) test = new NfcReadTest().mount();
    test.open();
}
