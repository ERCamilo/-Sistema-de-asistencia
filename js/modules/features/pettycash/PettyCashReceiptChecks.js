/**
 * Revisiones locales de una factura leída por el OCR.
 *
 * Deciden qué se marca "por revisar" en la cámara de facturas, sin
 * servicios externos: el total cuadra, el RNC/cédula tiene dígito
 * verificador válido, el NCF tiene un formato conocido y no se repite con
 * el mismo emisor, y la fecha cae dentro del periodo. Solo se revisa lo que
 * el OCR leyó: un campo vacío no es un error.
 *
 * Probado en js/tests/PettyCashReceiptChecks.test.js.
 */

const digits = (value) => String(value ?? '').replace(/\D/g, '');
const num = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};
const TOTAL_TOLERANCE = 1;

/** RNC (9 dígitos, módulo 11) o cédula (11 dígitos, módulo 10). */
export function isValidRnc(value) {
    const d = digits(value);
    if (d.length === 9) {
        const weights = [7, 9, 8, 6, 5, 4, 3, 2];
        const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
        const mod = sum % 11;
        const check = mod === 0 ? 2 : mod === 1 ? 1 : 11 - mod;
        return check === Number(d[8]);
    }
    if (d.length === 11) {
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            let p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
            if (p >= 10) p -= 9;
            sum += p;
        }
        return (10 - (sum % 10)) % 10 === Number(d[10]);
    }
    return false;
}

/** NCF en papel (B01–B04, B11–B17 + 8 dígitos) o e-CF (E31–E34, E41–E47 + 10 dígitos). */
export function isValidNcf(value) {
    const ncf = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
    return /^B(0[1-4]|1[1-7])\d{8}$/.test(ncf) || /^E(3[1-4]|4[1-7])\d{10}$/.test(ncf);
}

const issue = (code, field, message) => ({ code, field, message });

export function checkReceipt(movement, { period = null, movements = [] } = {}) {
    if (!movement) return [];
    const issues = [];
    const total = num(movement.total) ?? num(movement.amount);
    const subtotal = num(movement.subtotal);
    const itbis = num(movement.itbis);

    if (!total) {
        issues.push(issue('missing-total', 'total', 'No se pudo leer el total.'));
    } else if (subtotal !== null && itbis !== null && Math.abs(subtotal + itbis - total) > TOTAL_TOLERANCE) {
        issues.push(issue('total-mismatch', 'total', 'Subtotal + ITBIS no da el total leído.'));
    }

    if (digits(movement.rncEmisor) && !isValidRnc(movement.rncEmisor)) {
        issues.push(issue('rnc-invalid', 'rncEmisor', 'El RNC no es válido (dígito verificador).'));
    }

    const ncf = String(movement.ncf ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (ncf && !isValidNcf(ncf)) {
        issues.push(issue('ncf-format', 'ncf', 'El NCF no tiene un formato conocido.'));
    } else if (ncf) {
        const issuer = digits(movement.rncEmisor);
        const repeated = movements.some((other) => other && other.id !== movement.id
            && String(other.ncf ?? '').replace(/[\s-]/g, '').toUpperCase() === ncf
            && (!issuer || !digits(other.rncEmisor) || digits(other.rncEmisor) === issuer));
        if (repeated) issues.push(issue('ncf-duplicate', 'ncf', 'Este NCF ya está registrado en otro gasto.'));
    }

    const date = movement.fechaEmision || movement.date;
    if (period && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        const outside = (period.openingDate && date < period.openingDate)
            || (period.closingDate && date > period.closingDate);
        if (outside) issues.push(issue('date-outside-period', 'date', 'La fecha está fuera del periodo de la caja.'));
    }
    return issues;
}

/**
 * Estado que muestra la cámara para una foto: reading | waiting | failed | review | ok.
 * @param {object} job       registro de la cola (ocrStatus, queueStatus)
 * @param {object} movement  gasto con los datos leídos
 */
export function receiptReviewState(job = {}, movement = null, context = {}) {
    const ocr = job?.ocrStatus;
    if (ocr === 'failed') return { state: 'failed', issues: [] };
    if (ocr === 'needs-review') return { state: 'review', issues: [issue('not-read', null, 'No se pudieron leer los datos de esta foto.')] };
    if (ocr === 'extracted') {
        const issues = checkReceipt(movement, context);
        return { state: issues.length ? 'review' : 'ok', issues };
    }
    const WAITING = { 'waiting-network': 'network', 'waiting-session': 'session', paused: 'paused' };
    if (WAITING[job?.queueStatus]) return { state: 'waiting', reason: WAITING[job.queueStatus], issues: [] };
    return { state: 'reading', issues: [] };
}
