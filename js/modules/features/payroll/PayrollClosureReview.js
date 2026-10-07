/**
 * 🔎 PayrollClosureReview — revisión de los cierres de nómina guardados.
 *
 * Funciones puras (sin IndexedDB ni estado global) que señalan, con hechos,
 * lo que no cuadra en el Historial:
 *   - copias repetidas de un mismo cierre (mismo lote de abonos o mismo contenido);
 *   - cierres guardados antes de terminar su periodo o sin los abonos anotados
 *     a mano para ese periodo;
 *   - cierres con fechas fuera de la cuadrícula de pagos configurada;
 *   - periodos ya terminados de la cuadrícula que no tienen un cierre vigente.
 *
 * Anular una copia repetida solo anula el registro del cierre: sus abonos y su
 * lote siguen perteneciendo a la copia que se conserva.
 */
import { PAYROLL_CLOSURE_STATUS, voidPayrollClosure } from './PayrollClosure.js';
import { getEffectivePayrollClosures } from './PayrollClosureWorkflow.js';
import { buildPayPeriods } from '../loans/LoanPayPeriods.js';

export const DUPLICATE_CLOSURE_VOID_REASON = 'Copia repetida';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/** 'YYYY-MM-DD' → 'dd/mm'. */
export function shortDay(key) {
    const value = text(key);
    return ISO_DAY.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : value;
}

/** Fecha local (YYYY-MM-DD) de un instante en milisegundos. */
function localDateKey(ms) {
    const date = new Date(Number(ms));
    if (!Number.isFinite(date.getTime())) return '';
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isClosed(closure) {
    return closure?.status === PAYROLL_CLOSURE_STATUS.CLOSED && Boolean(closure?.id);
}

function isValidPayPeriod(payPeriod) {
    const length = Number(payPeriod?.periodLength);
    return ISO_DAY.test(text(payPeriod?.periodStart)) && Number.isInteger(length) && length >= 1 && length <= 366;
}

function paymentEntries(employees = []) {
    const entries = [];
    for (const employee of employees || []) {
        for (const loan of employee?.loans || []) {
            for (const payment of loan?.payments || []) {
                if (payment && typeof payment === 'object') entries.push({ employee, loan, payment });
            }
        }
    }
    return entries;
}

/**
 * Abonos vigentes anotados para el periodo exacto y todavía sin cierre
 * (payrollPeriodStart/End coinciden y no tienen payrollClosureId).
 */
export function findUnlinkedPeriodPayments(employees, periodStart, periodEnd) {
    return paymentEntries(employees).filter(({ payment }) =>
        payment.voided !== true &&
        !text(payment.payrollClosureId) &&
        text(payment.payrollPeriodStart) === text(periodStart) &&
        text(payment.payrollPeriodEnd) === text(periodEnd)
    );
}

function summarizeEntries(entries) {
    return {
        count: entries.length,
        total: money(entries.reduce((sum, { payment }) => sum + (Number(payment.amount) || 0), 0)),
        employeeCount: new Set(entries.map(({ employee }) => text(employee.id))).size
    };
}

/** Cantidad de abonos vigentes que referencian cada cierre. */
function paymentCountsByClosure(employees) {
    const counts = new Map();
    for (const { payment } of paymentEntries(employees)) {
        const id = text(payment.payrollClosureId);
        if (!id || payment.voided === true) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

function samePayload(left, right) {
    if (text(left.periodStart) !== text(right.periodStart) || text(left.periodEnd) !== text(right.periodEnd)) {
        return false;
    }
    const payload = closure => JSON.stringify({
        totals: closure.totals || {},
        rows: (closure.rows || []).map(row => ({
            employeeId: text(row.employeeId),
            gross: money(row.gross),
            bonuses: money(row.bonuses),
            deductions: money(row.deductions),
            loans: money(row.loans),
            net: money(row.net)
        }))
    });
    return (left.rows || []).length > 0 && payload(left) === payload(right);
}

function isDuplicatePair(left, right) {
    const leftBatch = text(left.loanSettlementBatchId);
    if (leftBatch && leftBatch === text(right.loanSettlementBatchId)) return true;
    return samePayload(left, right);
}

/**
 * Agrupa los cierres vigentes que son copias de un mismo cierre: comparten un
 * lote de abonos (loanSettlementBatchId) o tienen el mismo periodo y contenido.
 * En cada grupo se conserva el cierre al que apuntan los abonos; si ninguno,
 * el de esquema por obra (projectId); si no, el más reciente.
 */
export function findDuplicateClosureGroups(closures = [], employees = []) {
    // Solo cierres vigentes: uno reemplazado por una corrección no es una copia.
    const closed = getEffectivePayrollClosures(closures);
    const parent = closed.map((_, index) => index);
    const root = index => (parent[index] === index ? index : (parent[index] = root(parent[index])));
    for (let left = 0; left < closed.length; left++) {
        for (let right = left + 1; right < closed.length; right++) {
            if (text(closed[left].id) === text(closed[right].id)) continue;
            if (isDuplicatePair(closed[left], closed[right])) parent[root(right)] = root(left);
        }
    }
    const buckets = new Map();
    closed.forEach((closure, index) => {
        const key = root(index);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(closure);
    });
    const counts = paymentCountsByClosure(employees);
    const batchCounts = new Map();
    for (const { payment } of paymentEntries(employees)) {
        const batchId = text(payment.payrollBatchId);
        if (batchId && payment.voided !== true) batchCounts.set(batchId, (batchCounts.get(batchId) || 0) + 1);
    }
    const rank = closure => [
        counts.get(text(closure.id)) || 0,
        closure.projectId || Number(closure.schemaVersion) === 3 ? 1 : 0,
        Number(closure.closedAt) || 0
    ];
    return [...buckets.values()]
        .filter(group => group.length > 1)
        .map(group => {
            const ordered = [...group].sort((left, right) => {
                const a = rank(left);
                const b = rank(right);
                return (b[0] - a[0]) || (b[1] - a[1]) || (b[2] - a[2]) || text(left.id).localeCompare(text(right.id));
            });
            const keep = ordered[0];
            const groupIds = new Set(group.map(item => text(item.id)));
            const linkedToGroup = [...counts.entries()]
                .filter(([id]) => groupIds.has(id))
                .reduce((sum, [, count]) => sum + count, 0);
            const batchId = text(keep.loanSettlementBatchId);
            return {
                keep,
                duplicates: ordered.slice(1),
                paymentsCount: Math.max(linkedToGroup, batchId ? batchCounts.get(batchId) || 0 : 0),
                loansTotal: money(keep.totals?.loans)
            };
        })
        .sort((left, right) => text(right.keep.periodStart).localeCompare(text(left.keep.periodStart)));
}

/** Periodo de la cuadrícula que contiene la fecha dada. */
function gridPeriodAt(payPeriod, dateKey) {
    if (!isValidPayPeriod(payPeriod) || !ISO_DAY.test(text(dateKey))) return null;
    return buildPayPeriods(payPeriod, dateKey, { before: 0, after: 0 })[0] || null;
}

/** Periodo de la cuadrícula más parecido a [start, end]. */
function nearestGridPeriod(payPeriod, periodStart, periodEnd) {
    if (!isValidPayPeriod(payPeriod) || !ISO_DAY.test(text(periodStart)) || !ISO_DAY.test(text(periodEnd))) return null;
    const distance = period => Math.abs(toTime(period.start) - toTime(periodStart)) +
        Math.abs(toTime(period.end) - toTime(periodEnd));
    return buildPayPeriods(payPeriod, periodStart, { before: 1, after: 1 })
        .sort((left, right) => distance(left) - distance(right))[0] || null;
}

/**
 * Hechos de un cierre vigente. Un cierre anulado o reemplazado no se revisa.
 * @returns {{closedBeforePeriodEnd, missingPeriodLoans, offGrid, duplicateOf, needsReview}}
 */
export function reviewClosure(closure, { employees = [], payPeriod = null, duplicateOf = null } = {}) {
    const flags = {
        closedBeforePeriodEnd: null,
        missingPeriodLoans: null,
        offGrid: null,
        duplicateOf: duplicateOf ? text(duplicateOf) : null,
        needsReview: false
    };
    if (!isClosed(closure)) return flags;
    const closedOn = localDateKey(closure.closedAt);
    if (closedOn && closedOn < text(closure.periodEnd)) {
        flags.closedBeforePeriodEnd = { closedOn };
    }
    if (money(closure.totals?.loans) === 0) {
        const pending = summarizeEntries(findUnlinkedPeriodPayments(employees, closure.periodStart, closure.periodEnd));
        if (pending.count > 0) flags.missingPeriodLoans = pending;
    }
    const nearest = nearestGridPeriod(payPeriod, closure.periodStart, closure.periodEnd);
    if (nearest && (nearest.start !== text(closure.periodStart) || nearest.end !== text(closure.periodEnd))) {
        flags.offGrid = { periodStart: nearest.start, periodEnd: nearest.end, label: nearest.short };
    }
    flags.needsReview = Boolean(flags.duplicateOf || flags.closedBeforePeriodEnd || flags.missingPeriodLoans);
    return flags;
}

function isReplaceable(flags) {
    return Boolean(flags && !flags.duplicateOf && (flags.closedBeforePeriodEnd || flags.missingPeriodLoans));
}

/**
 * Periodos terminados de la cuadrícula (desde el primero con abonos de nómina)
 * sin un cierre vigente válido. Si el único cierre vigente del periodo está
 * señalado (guardado antes de tiempo o sin los abonos), se informa como
 * replaceableClosure: registrarlo de nuevo lo reemplaza.
 */
export function findPeriodsWithoutClosure({ employees = [], closures = [], payPeriod = null, today } = {}) {
    if (!isValidPayPeriod(payPeriod) || !ISO_DAY.test(text(today))) return [];
    const starts = paymentEntries(employees)
        .filter(({ payment }) => payment.voided !== true && ISO_DAY.test(text(payment.payrollPeriodStart)))
        .map(({ payment }) => text(payment.payrollPeriodStart))
        .sort();
    if (starts.length === 0) return [];
    const first = gridPeriodAt(payPeriod, starts[0]);
    const current = gridPeriodAt(payPeriod, today);
    if (!first || !current) return [];
    const length = Number(payPeriod.periodLength);
    const before = Math.round((toTime(current.start) - toTime(first.start)) / (length * DAY));
    const periods = buildPayPeriods(payPeriod, today, { before: Math.max(0, before), after: 0 })
        .filter(period => period.end < text(today) && period.start >= first.start);
    const effective = getEffectivePayrollClosures(closures);
    const duplicateIds = new Set(findDuplicateClosureGroups(closures, employees)
        .flatMap(group => group.duplicates.map(item => text(item.id))));
    const out = [];
    for (const period of periods) {
        const matching = effective.filter(closure =>
            !duplicateIds.has(text(closure.id)) &&
            text(closure.periodStart) === period.start && text(closure.periodEnd) === period.end
        );
        let replaceableClosure = null;
        if (matching.length > 0) {
            const reviewed = matching.map(closure => ({ closure, flags: reviewClosure(closure, { employees, payPeriod }) }));
            if (!reviewed.every(item => isReplaceable(item.flags))) continue;
            replaceableClosure = reviewed[0].closure;
        }
        const pending = summarizeEntries(findUnlinkedPeriodPayments(employees, period.start, period.end));
        out.push({
            periodStart: period.start,
            periodEnd: period.end,
            payDate: period.payDate,
            label: period.short,
            paymentsCount: pending.count,
            paymentsTotal: pending.total,
            employeeCount: pending.employeeCount,
            replaceableClosure
        });
    }
    return out.sort((left, right) => right.periodStart.localeCompare(left.periodStart));
}

/**
 * Revisión completa para el Historial.
 * @returns {{issues: Array, periodsWithoutClosure: Array, cardFlags: Map<string, object>}}
 */
export function buildClosureReview({ closures = [], employees = [], payPeriod = null, today } = {}) {
    const groups = findDuplicateClosureGroups(closures, employees);
    const duplicateOf = new Map();
    for (const group of groups) {
        for (const duplicate of group.duplicates) duplicateOf.set(text(duplicate.id), text(group.keep.id));
    }
    const effectiveIds = new Set(getEffectivePayrollClosures(closures).map(item => text(item.id)));
    const cardFlags = new Map();
    for (const closure of closures || []) {
        if (!closure?.id) continue;
        const id = text(closure.id);
        const superseded = isClosed(closure) && !effectiveIds.has(id);
        const flags = superseded
            ? { ...reviewClosure(null), superseded: true }
            : { ...reviewClosure(closure, { employees, payPeriod, duplicateOf: duplicateOf.get(id) }), superseded: false };
        cardFlags.set(id, flags);
    }
    const periodsWithoutClosure = findPeriodsWithoutClosure({ employees, closures, payPeriod, today });
    const issues = [
        ...groups.flatMap(group => group.duplicates.map(duplicate => ({
            kind: 'duplicate',
            closureId: text(duplicate.id),
            keepId: text(group.keep.id),
            periodStart: text(group.keep.periodStart),
            periodEnd: text(group.keep.periodEnd),
            paymentsCount: group.paymentsCount,
            loansTotal: group.loansTotal
        }))),
        ...periodsWithoutClosure
            .filter(period => period.replaceableClosure)
            .map(period => ({
                kind: 'replace',
                closureId: text(period.replaceableClosure.id),
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
                payDate: period.payDate,
                paymentsCount: period.paymentsCount,
                paymentsTotal: period.paymentsTotal,
                flags: cardFlags.get(text(period.replaceableClosure.id)) || null
            }))
    ];
    return { issues, periodsWithoutClosure, cardFlags };
}

/**
 * Anula SOLO el registro de una copia repetida (motivo «Copia repetida»).
 * No toca los abonos ni el lote: siguen perteneciendo a la copia conservada.
 */
export function voidDuplicatePayrollClosure(closure, {
    closures = [],
    employees = [],
    now = Date.now(),
    voidedBy = null
} = {}) {
    if (!isClosed(closure)) throw new Error('Este cierre ya no está vigente.');
    const group = findDuplicateClosureGroups(closures, employees)
        .find(item => item.duplicates.some(duplicate => text(duplicate.id) === text(closure.id)));
    if (!group) throw new Error('Este cierre ya no está repetido. Recarga el historial.');
    return voidPayrollClosure(closure, {
        voidedAt: now,
        voidedBy,
        voidReason: DUPLICATE_CLOSURE_VOID_REASON
    });
}

export default {
    buildClosureReview,
    findDuplicateClosureGroups,
    findPeriodsWithoutClosure,
    findUnlinkedPeriodPayments,
    reviewClosure,
    voidDuplicatePayrollClosure
};
