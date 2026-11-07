export const NFC_SCHEMA_VERSION = 1;
export const NFC_TEST_ENDPOINT = 'https://n8n.erlin.do/webhook-test/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d';
export const NFC_ENDPOINT = 'https://n8n.erlin.do/webhook/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d';

export function normalizeNfcUid(value) {
    const raw = String(value ?? '').trim();
    // Admit separators explicitly, including non-breaking spaces, never arbitrary text.
    if (!raw || !/^[\da-fA-F\s:\-]+$/u.test(raw)) throw Error('La tarjeta no entregó un UID hexadecimal válido.');
    const uid = raw.replace(/[\s:\-]/gu, '').toUpperCase();
    if (![8, 14, 20].includes(uid.length)) throw Error('El UID debe contener 4, 7 o 10 bytes para compararlo con el ESP32.');
    return uid;
}

export function normalizeNfcEndpoint(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch (_) { throw Error('Escribe la URL completa del webhook.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Usa una URL HTTPS sin credenciales ni fragmentos.');
    return url.href;
}

export function nfcEndpoint(config) {
    if (config?.mode === 'production') return NFC_ENDPOINT;
    if (config?.mode === 'custom') return normalizeNfcEndpoint(config.customUrl);
    return NFC_TEST_ENDPOINT;
}

export function buildNfcRequest(action, { requestId, cardUid, employee, context, requestedAt = new Date().toISOString() }) {
    if (!['consultar', 'asociar'].includes(action) || !requestId || !employee?.id || !employee.name || !context) {
        throw Error('Selecciona un empleado guardado y su contexto de trabajo.');
    }
    return {
        schemaVersion: NFC_SCHEMA_VERSION, action, requestId, cardUid: normalizeNfcUid(cardUid),
        employee: { id: String(employee.id), number: String(employee.number ?? ''), name: String(employee.name) },
        context: { companyName: String(context.companyName || ''), projectId: context.projectId || null },
        source: 'sa-web-nfc', requestedAt
    };
}

export class NfcRequestError extends Error {
    constructor(message, code, serverCode = null) {
        super(message); this.name = 'NfcRequestError'; this.code = code; this.serverCode = serverCode;
    }
}

const NFC_CONFLICT_MESSAGES = Object.freeze({
    TARJETA_OCUPADA: 'Esta tarjeta ya pertenece a otro empleado. Vuelve a consultar antes de guardar.',
    EMPLEADO_CON_TARJETA: 'Este empleado ya tiene otra tarjeta. Esta opción no permite reemplazarla.',
    REQUEST_ID_REUTILIZADO: 'El identificador de esta solicitud ya se utilizó con otros datos. Vuelve a leer la tarjeta.'
});

async function nfcConflictError(response) {
    let serverCode = null;
    try {
        const body = await response.json();
        if (body?.schemaVersion === NFC_SCHEMA_VERSION && body.ok === false
            && typeof body.error === 'string' && Object.prototype.hasOwnProperty.call(NFC_CONFLICT_MESSAGES, body.error)) {
            serverCode = body.error;
        }
    } catch (_) { /* Proxies and older endpoints may omit a JSON error body. */ }
    return new NfcRequestError(serverCode ? NFC_CONFLICT_MESSAGES[serverCode]
        : 'La tarjeta o el empleado ya tienen una asociación incompatible. Vuelve a consultar.', 'CONFLICT', serverCode);
}

export function readNfcResponse(data, request) {
    const invalid = () => { throw new NfcRequestError('El webhook no confirmó esta solicitud con el formato esperado.', 'INVALID_RESPONSE'); };
    if (!data || data.schemaVersion !== NFC_SCHEMA_VERSION || data.requestId !== request.requestId || data.cardUid !== request.cardUid || data.ok !== true) invalid();
    if (request.action === 'consultar') {
        if (!['disponible', 'mismo_empleado', 'otro_empleado'].includes(data.status)) invalid();
        if (data.status === 'disponible' && data.employeeId !== null) invalid();
        if (data.status === 'mismo_empleado' && data.employeeId !== request.employee.id) invalid();
        if (data.status === 'otro_empleado' && (typeof data.employeeId !== 'string' || !data.employeeId || data.employeeId === request.employee.id)) invalid();
    } else if (!['registrada', 'mismo_empleado'].includes(data.status) || data.employeeId !== request.employee.id
        || typeof data.registeredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.registeredAt) || !Number.isFinite(Date.parse(data.registeredAt))) invalid();
    return { status: data.status, employeeId: data.employeeId, registeredAt: data.registeredAt || null };
}

export async function sendNfcRequest(endpoint, request, { signal, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await fetchImpl(normalizeNfcEndpoint(endpoint), {
            method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request), signal: controller.signal
        });
        if (response.status === 409) throw await nfcConflictError(response);
        if ([401, 403].includes(response.status)) throw new NfcRequestError('El webhook rechazó el acceso. Revisa la configuración del destino.', 'ACCESS');
        if (response.status === 404) throw new NfcRequestError('El webhook no está disponible. En Test, activa «Listen for test event» en n8n.', 'NOT_FOUND');
        if (!response.ok) throw new NfcRequestError('El webhook no pudo completar la operación.', 'HTTP');
        let data;
        try { data = await response.json(); } catch (_) { throw new NfcRequestError('El webhook debe responder con JSON de confirmación.', 'INVALID_RESPONSE'); }
        return readNfcResponse(data, request);
    } catch (error) {
        if (timedOut) throw new NfcRequestError('El webhook tardó demasiado en responder.', 'TIMEOUT');
        if (signal?.aborted) throw error;
        if (error instanceof TypeError) throw new NfcRequestError('No se pudo conectar. Revisa la conexión y los permisos CORS del webhook.', 'NETWORK');
        throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
