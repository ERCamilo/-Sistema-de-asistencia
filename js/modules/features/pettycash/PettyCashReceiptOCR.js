export const RECEIPT_RETRY_DELAYS_MS = Object.freeze([5000, 30000, 120000]);
export const RECEIPT_MAX_AUTO_ATTEMPTS = RECEIPT_RETRY_DELAYS_MS.length;

function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
}
export function normalizeReceiptOcr(data, allowedCategories = []) {
    const source = data && typeof data === 'object' ? data : {};
    const allowed = new Set(Array.isArray(allowedCategories) ? allowedCategories : []);
    const category = allowed.has(source.categoria) ? source.categoria : null;
    const amount = hasValue(source.total)
        ? Number(source.total)
        : (hasValue(source.subtotal) ? Number(source.subtotal) : null);
    const normalizedAmount = Number.isFinite(amount) ? amount : null;
    const got = [source.emisor, source.total, source.ncf, source.fecha].some(hasValue);

    return {
        got,
        amount: normalizedAmount,
        paidTo: hasValue(source.emisor) ? String(source.emisor) : null,
        description: hasValue(source.concepto) ? String(source.concepto) : null,
        date: hasValue(source.fecha) ? String(source.fecha) : null,
        category,
        fiscal: {
            rncEmisor: source.rncEmisor ?? null,
            ncf: source.ncf ?? null,
            cliente: source.cliente ?? null,
            rncCliente: source.rncCliente ?? null,
            subtotal: source.subtotal ?? null,
            itbis: source.itbis ?? null,
            total: source.total ?? null,
            fechaEmision: source.fecha ?? null,
            notas: source.notas ?? null,
            items: Array.isArray(source.items) ? source.items : []
        }
    };
}

export function applyReceiptOcrToMovement(movement, normalized) {
    if (!movement || !normalized) return movement;
    if (normalized.amount !== null) movement.amount = normalized.amount;
    if (normalized.paidTo) movement.paidTo = normalized.paidTo;
    if (normalized.description) movement.description = normalized.description;
    if (normalized.date) {
        movement.date = normalized.date;
        movement.fechaEmision = normalized.date;
    }
    if (normalized.category) movement.category = normalized.category;

    const fiscal = normalized.fiscal || {};
    ['rncEmisor', 'ncf', 'cliente', 'rncCliente', 'subtotal', 'itbis', 'total', 'notas'].forEach((key) => {
        if (hasValue(fiscal[key])) movement[key] = fiscal[key];
    });
    if (Array.isArray(fiscal.items) && fiscal.items.length) movement.items = fiscal.items;
    return movement;
}

export function applyReceiptOcrToForm(form, normalized) {
    if (!form || !normalized) return form;
    if (normalized.amount !== null) form.amount = normalized.amount;
    if (normalized.paidTo) form.paidTo = normalized.paidTo;
    if (normalized.description) form.description = normalized.description;
    if (normalized.date) form.date = normalized.date;
    if (normalized.category) form.category = normalized.category;
    form.ocr = { ...(normalized.fiscal || {}) };
    form.hasReceipt = true;
    return form;
}

export async function requestReceiptOcr({
    url,
    idToken,
    fileDataUrl,
    imageDataUrl,
    mimeType = 'image/jpeg',
    fileName = null,
    fetchImpl = globalThis.fetch
}) {
    if (!url) throw new Error('No hay URL de OCR configurada.');
    if (!idToken) throw new Error('No hay una sesión válida para procesar la factura.');
    const source = fileDataUrl || imageDataUrl;
    if (!source) throw new Error('No hay un comprobante para procesar.');
    if (typeof fetchImpl !== 'function') throw new Error('El navegador no permite enviar la factura.');

    const base64 = String(source).split(',')[1] || String(source);
    const normalizedMimeType = String(mimeType || 'image/jpeg').toLowerCase();
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fileBase64: base64,
            imageBase64: normalizedMimeType.startsWith('image/') ? base64 : undefined,
            mimeType: normalizedMimeType,
            fileName,
            idToken
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => null);
    if (!data || data.ok === false) throw new Error(data?.error || 'Respuesta de OCR vacía');
    return data;
}

export function receiptRetryState(currentAttempts, { online = true, now = Date.now() } = {}) {
    const attempts = Math.max(0, Number(currentAttempts) || 0);
    if (!online) {
        return {
            attempts,
            queueStatus: 'waiting-network',
            nextRetryAt: null
        };
    }

    const nextAttempts = attempts + 1;
    if (nextAttempts >= RECEIPT_MAX_AUTO_ATTEMPTS) {
        return {
            attempts: nextAttempts,
            queueStatus: 'paused',
            nextRetryAt: null
        };
    }

    return {
        attempts: nextAttempts,
        queueStatus: 'retry-wait',
        nextRetryAt: Number(now) + RECEIPT_RETRY_DELAYS_MS[nextAttempts - 1]
    };
}
