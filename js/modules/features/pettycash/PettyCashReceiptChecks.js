/**
 * Revisiones locales de una factura leída por el OCR.
 *
 * Deciden qué se marca "por revisar" en la cámara de facturas, sin
 * servicios externos: el total cuadra, el ITBIS es el 18% (o 16%) del
 * subtotal, el RNC/cédula tiene dígito verificador válido, el NCF tiene un
 * formato conocido y no se repite con el mismo emisor, y la fecha cae dentro
 * del periodo. Solo se revisa lo que el OCR leyó: un campo vacío no es un error.
 *
 * Cada aviso trae `detail` (lo leído frente a lo calculado, los dígitos que
 * faltan o la fecha con día y mes invertidos) y `box`, la posición del dato en
 * la foto cuando el lector la envía.
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

const ITBIS_RATE = 0.18;
const ITBIS_REDUCED_RATE = 0.16;
const round2 = (n) => Math.round(n * 100) / 100;
const NCF_LENGTH = { B: 11, E: 13 };

/** Recuadro [y0, x0, y1, x1] (0–1000) del campo en la foto, si el lector lo envió. */
function boxFor(movement, field) {
    const box = field ? movement?.ocrBoxes?.[field] : null;
    return Array.isArray(box) && box.length === 4 && box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)
        ? box.slice() : null;
}

const issue = (code, field, message, extra = {}) => ({ code, field, message, ...extra });

const pad = (n) => String(n).padStart(2, '0');
function isoDate(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
        ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Fecha de la factura en ISO: acepta AAAA-MM-DD y día/mes/año (formato dominicano). */
export function parseReceiptDate(value) {
    const raw = String(value ?? '').trim();
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (m) {
        const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        return isoDate(year, Number(m[2]), Number(m[1]));
    }
    return null;
}

const swapDayMonth = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return d !== m ? isoDate(y, d, m) : null;
};
const shiftDays = (iso, days) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};
const localToday = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Faltan dígitos: cuántos, si lo leído es un prefijo corto de un formato conocido. */
function missingNcfDigits(ncf) {
    const expected = NCF_LENGTH[ncf[0]];
    return expected && /^[BE]\d+$/.test(ncf) && ncf.length < expected ? expected - ncf.length : 0;
}
function missingRncDigits(d) {
    if (d.length < 9) return 9 - d.length;
    if (d.length === 10) return 1;
    return 0;
}

export function checkReceipt(movement, { period = null, movements = [], today = localToday() } = {}) {
    if (!movement) return [];
    const issues = [];
    const add = (code, field, message, extra) => issues.push(issue(code, field, message, { box: boxFor(movement, field), ...extra }));
    const total = num(movement.total) ?? num(movement.amount);
    const subtotal = num(movement.subtotal);
    const itbis = num(movement.itbis);

    if (!total) {
        add('missing-total', 'total', 'No se pudo leer el total.');
    } else if (subtotal !== null && itbis !== null && Math.abs(subtotal + itbis - total) > TOTAL_TOLERANCE) {
        add('total-mismatch', 'total', 'Subtotal + ITBIS no da el total leído.', { detail: { read: total, calc: round2(subtotal + itbis) } });
    }

    if (subtotal && itbis) {
        const full = round2(subtotal * ITBIS_RATE);
        const reduced = round2(subtotal * ITBIS_REDUCED_RATE);
        const near = (x) => Math.abs(itbis - x) <= TOTAL_TOLERANCE;
        if (!near(full) && !near(reduced)) {
            const detail = { read: itbis, calc: full, base: subtotal };
            if (itbis > full) add('itbis-rate', 'itbis', 'El ITBIS es mayor que el 18% del subtotal.', { detail });
            else add('itbis-rate', 'itbis', 'El ITBIS no es el 18% del subtotal.', { detail, hint: 'Puede ser correcto si hay artículos exentos o al 16%.' });
        }
    }

    const rnc = digits(movement.rncEmisor);
    if (rnc && !isValidRnc(movement.rncEmisor)) {
        const missing = missingRncDigits(rnc);
        add('rnc-invalid', 'rncEmisor', missing ? 'RNC incompleto.' : 'El RNC no es válido (dígito verificador).',
            { detail: { read: String(movement.rncEmisor), missing } });
    }

    const ncf = String(movement.ncf ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (ncf && !isValidNcf(ncf)) {
        const missing = missingNcfDigits(ncf);
        add('ncf-format', 'ncf', missing ? 'NCF incompleto.' : 'El NCF no tiene un formato conocido.', { detail: { read: ncf, missing } });
    } else if (ncf) {
        const issuer = digits(movement.rncEmisor);
        const repeated = movements.some((other) => other && other.id !== movement.id
            && String(other.ncf ?? '').replace(/[\s-]/g, '').toUpperCase() === ncf
            && (!issuer || !digits(other.rncEmisor) || digits(other.rncEmisor) === issuer));
        if (repeated) add('ncf-duplicate', 'ncf', 'Este NCF ya está registrado en otro gasto.');
    }

    // Periodo cerrado: sus fechas. Periodo abierto: desde su apertura hasta 30 días después de hoy.
    const rawDate = movement.fechaEmision || movement.date;
    const date = parseReceiptDate(rawDate);
    if (period && date) {
        const from = period.openingDate || shiftDays(today, -30);
        const to = period.closingDate || shiftDays(today, 30);
        const inside = (d) => d >= from && d <= to;
        if (!inside(date)) {
            const swapped = swapDayMonth(date);
            add('date-outside-period', 'date', 'La fecha está fuera del periodo de la caja.',
                { detail: { read: String(rawDate), suggestion: swapped && inside(swapped) ? swapped : null } });
        }
    }
    // Lo que la persona ya dio por bueno desde la vista previa no vuelve a salir.
    const accepted = new Set(Array.isArray(movement.reviewAccepted) ? movement.reviewAccepted : []);
    return issues.filter(i => !accepted.has(i.code));
}

/**
 * Cómo se puede resolver cada aviso desde la vista previa de la cámara:
 *   apply  → un cambio listo para guardar (`patch`), p. ej. usar lo calculado;
 *   input  → escribir el dato (empieza con lo detectado), validado con `validate`;
 *   accept → dar por bueno lo leído (el aviso no vuelve a salir).
 */
export function fixesFor(issue) {
    const d = issue?.detail || {};
    const accept = { kind: 'accept', code: issue?.code };
    switch (issue?.code) {
        case 'total-mismatch':
            return [{ kind: 'apply', patch: { total: d.calc, amount: d.calc }, value: d.calc }, accept];
        case 'itbis-rate':
            return [{ kind: 'apply', patch: { itbis: d.calc }, value: d.calc }, accept];
        case 'date-outside-period':
            return d.suggestion
                ? [{ kind: 'apply', patch: { date: d.suggestion, fechaEmision: d.suggestion }, value: d.suggestion }, accept]
                : [{ kind: 'input', field: 'date', validate: 'date', value: d.read || '' }, accept];
        case 'ncf-format':
            return [{ kind: 'input', field: 'ncf', validate: 'ncf', value: d.read || '' }, accept];
        case 'rnc-invalid':
            return [{ kind: 'input', field: 'rncEmisor', validate: 'rnc', value: d.read || '' }, accept];
        case 'ncf-duplicate':
            return [accept];
        case 'missing-total':
            return [{ kind: 'input', field: 'total', validate: 'amount', value: '' }];
        default:
            return [];
    }
}

/** Valida lo que se escribió para resolver un aviso y devuelve el cambio a guardar. */
export function validateFixInput(validate, raw) {
    const text = String(raw ?? '').trim();
    if (validate === 'ncf') {
        const ncf = text.replace(/[\s-]/g, '').toUpperCase();
        return isValidNcf(ncf) ? { ok: true, patch: { ncf } } : { ok: false };
    }
    if (validate === 'rnc') {
        return isValidRnc(text) ? { ok: true, patch: { rncEmisor: digits(text) } } : { ok: false };
    }
    if (validate === 'amount') {
        const n = Number(text.replace(/[^\d.]/g, ''));
        return Number.isFinite(n) && n > 0 ? { ok: true, patch: { total: n, amount: n } } : { ok: false };
    }
    if (validate === 'date') {
        const iso = parseReceiptDate(text);
        return iso ? { ok: true, patch: { date: iso, fechaEmision: iso } } : { ok: false };
    }
    return { ok: false };
}

/**
 * Estado que muestra la cámara para una foto: reading | waiting | failed | review | ok.
 * failed = no se obtuvo ningún dato (✕); review = se leyó pero algo puede estar mal (!).
 * @param {object} job       registro de la cola (ocrStatus, queueStatus)
 * @param {object} movement  gasto con los datos leídos
 */
export function receiptReviewState(job = {}, movement = null, context = {}) {
    const ocr = job?.ocrStatus;
    if (ocr === 'failed') return { state: 'failed', issues: [] };
    if (ocr === 'needs-review') return { state: 'failed', issues: [issue('not-read', null, 'No se obtuvo ningún dato de esta foto.')] };
    if (ocr === 'extracted') {
        const issues = checkReceipt(movement, context);
        return { state: issues.length ? 'review' : 'ok', issues };
    }
    const WAITING = { 'waiting-network': 'network', 'waiting-session': 'session', paused: 'paused' };
    if (WAITING[job?.queueStatus]) return { state: 'waiting', reason: WAITING[job.queueStatus], issues: [] };
    return { state: 'reading', issues: [] };
}
