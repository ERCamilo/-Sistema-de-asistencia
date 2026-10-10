export { normalizeVoiceName, resolveVoiceEmployees } from './VoiceMatching.js';

export const VOICE_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxDurationMs: 60000 });
export const VOICE_ENDPOINT_PREFIX = 'sa-voice-endpoint:';
export const VOICE_DEV_ENDPOINT = 'http://100.91.16.14:5678/webhook/sa-voice-v1-dev';
export const VOICE_ENDPOINT = 'https://n8n.erlin.do/webhook/sa-voice-v1-dev';
export const VOICE_DEV_ORIGIN = 'http://127.0.0.1:8080';

export function isVoiceEndpointAllowed(value, origin = globalThis.location?.origin) {
    try {
        const url = new URL(value);
        if (url.username || url.password) return false;
        return url.protocol === 'https:' || (origin === VOICE_DEV_ORIGIN && url.href === VOICE_DEV_ENDPOINT);
    } catch (_) { return false; }
}
export const LOAN_FIELDS = ['principal', 'interestRate', 'interestIncluded', 'installmentMode', 'installmentCount', 'installmentFrequencyWeeks', 'startDate', 'concept'];
const INTENTS = ['buscar_empleado', 'crear_prestamo', 'abrir_asistencia', 'abrir_prestamos', 'desconocida'];
export function createVoiceContext(date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = key => parts.find(x => x.type === key).value;
    return { language: 'es-DO', timeZone, localDate: `${get('year')}-${get('month')}-${get('day')}` };
}

function invalid() { throw Object.assign(new Error('Respuesta de voz incompatible. Conservamos el audio para reintentar.'), { code: 'INVALID_RESPONSE' }); }
const nullableString = value => value === null || (typeof value === 'string' && value.length <= 2000);
export function readVoiceResponse(data, requestId) {
    const r = data?.result;
    if (data?.ok !== true || data.schemaVersion !== 1 || data.requestId !== requestId || !r || !INTENTS.includes(r.intent) || typeof r.transcript !== 'string' || r.transcript.length > 16000 || typeof r.needsReview !== 'boolean') invalid();
    if (!r.employee || !nullableString(r.employee.spokenName) || !nullableString(r.employee.spokenNumber)) invalid();
    if (!Array.isArray(r.issues) || r.issues.length > 50 || r.issues.some(x => !x || typeof x.code !== 'string' || typeof x.message !== 'string' || !nullableString(x.field))) invalid();
    let loan = null;
    if (r.intent === 'crear_prestamo') {
        if (!r.loan || typeof r.loan !== 'object') invalid();
        loan = {};
        for (const field of LOAN_FIELDS) {
            const v = r.loan[field];
            if (['principal', 'interestRate', 'installmentCount', 'installmentFrequencyWeeks'].includes(field)) {
                if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) invalid();
            } else if (field === 'interestIncluded') {
                if (v !== null && typeof v !== 'boolean') invalid();
            } else if (field === 'installmentMode') {
                if (v !== null && !['lump', 'installments'].includes(v)) invalid();
            } else if (!nullableString(v)) invalid();
            loan[field] = v;
        }
    }
    return { transcript: r.transcript, intent: r.intent, employee: { spokenName: r.employee.spokenName, spokenNumber: r.employee.spokenNumber }, loan, needsReview: r.needsReview, issues: r.issues.map(x => ({ code: x.code.slice(0, 100), field: x.field, message: x.message.slice(0, 1000) })) };
}

export function voiceBlocked(result) {
    return !result || result.intent === 'desconocida' || result.issues.some(x => /NEGAT|MULTIPLE_ACTIONS/.test(x.code));
}
export function voiceDraftReady(draft) {
    return draft && ['principal', 'interestRate', 'interestIncluded', 'installmentMode', 'startDate'].every(k => draft[k] !== null && draft[k] !== '') && (draft.installmentMode !== 'installments' || ['installmentCount', 'installmentFrequencyWeeks'].every(k => draft[k] !== null && draft[k] !== ''));
}

export async function voiceBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(Error('No se pudo leer el audio local.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
    });
}

export async function sendVoiceRecording({ url, record, getToken, fetchImpl = globalThis.fetch, timeoutMs = 90000, externalSignal = null, origin = globalThis.location?.origin }) {
    if (!isVoiceEndpointAllowed(url, origin)) throw Error('Usa HTTPS o el endpoint Tailscale de desarrollo desde http://127.0.0.1:8080.');
    if (record.audio && (record.audio.size > VOICE_LIMITS.maxBytes || record.durationMs > VOICE_LIMITS.maxDurationMs)) throw Error('El audio supera el límite de 60 segundos o 10 MiB.');
    const fileBase64 = record.fileBase64 || await voiceBase64(record.audio);
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const idToken = await getToken(attempt === 1);
            if (!idToken) throw Object.assign(Error('Inicia sesión para procesar el audio.'), { status: 401 });
            const response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, requestId: record.requestId, fileBase64, mimeType: record.mimeType, fileName: record.fileName, idToken, context: record.context }) });
            if (response.status === 401 && attempt === 0) continue;
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const retryHeader = response.headers?.get('Retry-After');
                const delay = retryHeader ? (Number.isFinite(Number(retryHeader)) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
                const code = data?.error?.code || `HTTP_${response.status}`;
                const messages = { 401: 'La sesión no pudo renovarse. Vuelve a iniciar sesión.', 403: 'Acceso denegado. Revisa los permisos del workflow o Cloudflare Access.', 429: 'Límite de solicitudes. Espera antes de reintentar.', 413: 'El audio supera los límites del servicio.', 415: 'El servicio no admite este formato de audio.' };
                throw Object.assign(Error(messages[response.status] || 'No se pudo procesar el audio. Conservamos el borrador.'), { code, status: response.status, retryAfterMs: Math.max(0, delay || (response.status === 429 ? 30000 : 0)), retryable: response.status === 429 || response.status >= 500 || code === 'REQUEST_IN_PROGRESS' });
            }
            return readVoiceResponse(data, record.requestId);
        }
    } catch (error) {
        if (!error.status && !error.code) throw Object.assign(Error(error.name === 'AbortError' ? 'El procesamiento tardó demasiado. Puedes reintentar.' : 'No se pudo conectar con n8n. Revisa la conexión y la preflight.'), { code: error.name === 'AbortError' ? 'PROCESSING_TIMEOUT' : 'NETWORK_ERROR', retryable: true });
        throw error;
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
}
