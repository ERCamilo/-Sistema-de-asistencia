export const PAYROLL_CLOSURE_SCHEMA_VERSION = 2;
export const PAYROLL_CLOSURE_STATUS = Object.freeze({
    CLOSED: 'closed',
    VOIDED: 'voided'
});
export const PAYROLL_CLOSURE_UNDO_WINDOW_MS = 30_000;

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    const numeric = Number(value) || 0;
    return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

function stableToken(value) {
    const input = String(value);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < input.length; index++) {
        const code = input.charCodeAt(index);
        first ^= code;
        first = Math.imul(first, 0x01000193);
        second ^= code + index;
        second = Math.imul(second, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
                return result;
            }, {});
    }
    return value;
}

function compactRow(row = {}) {
    const leaderRefs = (row._leaderRefs || [])
        .filter(leader => leader?.id)
        .map(leader => ({
            id: text(leader.id),
            name: text(leader.name),
            number: text(leader.number)
        }))
        .sort((left, right) => left.number.localeCompare(right.number, 'es', { numeric: true }) ||
            left.name.localeCompare(right.name, 'es') || left.id.localeCompare(right.id));
    return {
        employeeId: text(row._employeeId),
        employeeNumber: text(row._number ?? row.id),
        employeeName: text(row._employeeName),
        employeePosition: text(row._employeePosition),
        leaderRefs,
        gross: money(row._brutoOriginal),
        bonuses: money(row._bonuses),
        deductions: money(row._deductions),
        loans: money(row._loans),
        net: money(row.monto),
        bonusDetails: canonicalValue(row._bonusDetails || []),
        deductionDetails: canonicalValue(row._deductionDetails || []),
        loanDetails: canonicalValue(row._loanDetails || [])
    };
}

export function buildPayrollClosureSnapshot({ periodStart, periodEnd, rows = [] } = {}) {
    return {
        periodStart: text(periodStart),
        periodEnd: text(periodEnd),
        rows: (rows || [])
            .map(compactRow)
            .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, 'es', { numeric: true }) ||
                a.employeeId.localeCompare(b.employeeId))
    };
}

function closureContent(closure = {}) {
    return {
        schemaVersion: Number(closure.schemaVersion) || PAYROLL_CLOSURE_SCHEMA_VERSION,
        id: text(closure.id),
        fingerprint: text(closure.fingerprint),
        periodStart: text(closure.periodStart),
        periodEnd: text(closure.periodEnd),
        periodSource: text(closure.periodSource),
        totals: clone(closure.totals || {}),
        employeeCount: Number(closure.employeeCount) || 0,
        rows: clone(closure.rows || []),
        adjustments: clone(closure.adjustments || { bonuses: [], deductions: [] }),
        loanSettlementBatchId: closure.loanSettlementBatchId || null,
        paymentRefs: clone(closure.paymentRefs || []),
        supersedesId: closure.supersedesId || null
    };
}

export function buildPayrollClosureId(fingerprint, supersedesId = null) {
    const normalized = text(fingerprint);
    if (!normalized) throw new Error('La identidad de la Nómina es obligatoria');
    const predecessor = text(supersedesId);
    const identity = predecessor ? `${normalized}|after:${predecessor}` : normalized;
    return `PAYROLL-CLOSURE-${stableToken(identity)}`;
}

export function buildPayrollClosure({
    periodStart,
    periodEnd,
    periodSource = 'custom',
    rows = [],
    fingerprint,
    closedAt = Date.now(),
    closedBy = null,
    undoWindowMs = PAYROLL_CLOSURE_UNDO_WINDOW_MS,
    loanSettlementBatchId = null,
    paymentRefs = [],
    adjustments = { bonuses: [], deductions: [] },
    supersedesId = null
} = {}) {
    if (!text(periodStart) || !text(periodEnd)) {
        throw new Error('El período de Nómina es obligatorio');
    }
    if (text(periodStart) > text(periodEnd)) {
        throw new Error('El orden del período de Nómina no es válido');
    }
    if (!text(fingerprint)) throw new Error('La identidad de la Nómina es obligatoria');
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('La Nómina debe contener al menos una fila pagable');
    }
    if (rows.some(row => money(row?.monto) <= 0)) {
        throw new Error('Todos los empleados deben conservar un pago neto mayor que cero');
    }

    const compactRows = buildPayrollClosureSnapshot({ periodStart, periodEnd, rows }).rows;
    const employeeKeys = new Set();
    for (const row of compactRows) {
        const key = row.employeeId || `number:${row.employeeNumber}`;
        if (employeeKeys.has(key)) {
            throw new Error(`La Nómina contiene un empleado duplicado: ${key}`);
        }
        employeeKeys.add(key);
    }
    const totals = compactRows.reduce((sum, row) => ({
        gross: money(sum.gross + row.gross),
        bonuses: money(sum.bonuses + row.bonuses),
        deductions: money(sum.deductions + row.deductions),
        loans: money(sum.loans + row.loans),
        net: money(sum.net + row.net)
    }), { gross: 0, bonuses: 0, deductions: 0, loans: 0, net: 0 });
    const normalizedClosedAt = Number(closedAt) || Date.now();

    return {
        schemaVersion: PAYROLL_CLOSURE_SCHEMA_VERSION,
        id: buildPayrollClosureId(fingerprint, supersedesId),
        fingerprint: text(fingerprint),
        periodStart: text(periodStart),
        periodEnd: text(periodEnd),
        periodSource: text(periodSource) || 'custom',
        status: PAYROLL_CLOSURE_STATUS.CLOSED,
        closedAt: normalizedClosedAt,
        closedBy: closedBy == null ? null : text(closedBy),
        updatedAt: normalizedClosedAt,
        totals,
        employeeCount: compactRows.length,
        rows: compactRows,
        adjustments: clone(adjustments || { bonuses: [], deductions: [] }),
        loanSettlementBatchId: loanSettlementBatchId == null ? null : text(loanSettlementBatchId),
        paymentRefs: clone(paymentRefs || []),
        undoUntil: normalizedClosedAt + Math.max(0, Number(undoWindowMs) || 0),
        supersedesId: supersedesId == null ? null : text(supersedesId),
        voidedAt: null,
        voidedBy: null,
        voidReason: null
    };
}

export function isSamePayrollClosureContent(first, second) {
    if (!first || !second) return false;
    return JSON.stringify(closureContent(first)) === JSON.stringify(closureContent(second));
}

export function voidPayrollClosure(closure, {
    voidedAt = Date.now(),
    voidedBy = null,
    voidReason = 'Cierre anulado'
} = {}) {
    if (!closure?.id || !closure?.fingerprint) {
        throw new Error('El cierre de Nómina no es válido');
    }
    if (closure.status === PAYROLL_CLOSURE_STATUS.VOIDED) return clone(closure);
    const normalizedVoidedAt = Number(voidedAt) || Date.now();
    return {
        ...clone(closure),
        status: PAYROLL_CLOSURE_STATUS.VOIDED,
        voidedAt: normalizedVoidedAt,
        voidedBy: voidedBy == null ? null : text(voidedBy),
        voidReason: text(voidReason) || 'Cierre anulado',
        updatedAt: normalizedVoidedAt
    };
}

export default {
    buildPayrollClosure,
    buildPayrollClosureId,
    buildPayrollClosureSnapshot,
    isSamePayrollClosureContent,
    voidPayrollClosure
};
