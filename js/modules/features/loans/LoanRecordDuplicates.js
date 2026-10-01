/**
 * 🔁 LoanRecordDuplicates.js
 *
 * Detecta registros repetidos dentro de los préstamos: el mismo abono o el
 * mismo refinanciamiento anotado dos o tres veces (típico de dos
 * dispositivos que registraron lo mismo antes de sincronizar, o de volver a
 * cargar a mano lo que ya estaba), y préstamos que parecen el mismo.
 *
 * Solo DETECTA y propone. Anular es decisión de una persona (ver
 * LoanDuplicateReview.js).
 *
 * Reglas:
 *   - Abono repetido: mismo préstamo, mismo monto, fechas a ≤ 3 días, ambos
 *     vigentes. No se agrupan abonos de nómina que cobran cuotas o periodos
 *     distintos. El que se anotó primero es el original; los demás, copias.
 *   - Refinanciamiento repetido: mismo préstamo, mismo interés, misma base y
 *     tasa, fechas a ≤ 3 días.
 *   - Préstamo repetido: mismo empleado y monto, ninguno anulado, inicio a
 *     ≤ 3 días. Los pares con el mismo número de secuencia ya los avisa
 *     LoanDuplicateDetector en el detalle del empleado; aquí se omiten.
 *
 * Lo que una persona marcó como "no es copia" queda en
 * loan.duplicateReviewDismissed y no se vuelve a proponer.
 */

import { round2, getBalance, getTotalDue, getPaidAmount, LOAN_STATUS } from './LoansService.js';

export const DUPLICATE_KINDS = Object.freeze({
    PAYMENT: 'payment',
    REFINANCING: 'refinancing',
    LOAN: 'loan'
});

const RECORD_MAX_DAYS_APART = 3;
const LOAN_MAX_DAYS_APART = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDay(value) {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const time = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
}

function daysApart(left, right) {
    const a = parseDay(left);
    const b = parseDay(right);
    if (a === null || b === null) return Infinity;
    return Math.abs(a - b) / MS_PER_DAY;
}

function timeOf(record) {
    for (const field of ['recordedAt', 'createdAt', 'updatedAt']) {
        const value = Number(record?.[field]);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return parseDay(record?.date) ?? Infinity;
}

function chronological(left, right) {
    return timeOf(left) - timeOf(right) || String(left.id).localeCompare(String(right.id));
}

export function duplicateGroupKey(kind, ids) {
    return `${kind}:${[...ids].map(String).sort().join('|')}`;
}

function dismissedKeys(loan) {
    return new Set(Array.isArray(loan?.duplicateReviewDismissed) ? loan.duplicateReviewDismissed.map(String) : []);
}

/** Dos abonos de nómina que cobran cuotas o periodos distintos no son copia. */
function distinctPayrollCharges(a, b) {
    if (a.payrollIdempotencyKey && a.payrollIdempotencyKey === b.payrollIdempotencyKey) return false;
    const keysA = Array.isArray(a.payrollChargeKeys) ? a.payrollChargeKeys : [];
    const keysB = Array.isArray(b.payrollChargeKeys) ? b.payrollChargeKeys : [];
    if (keysA.length && keysB.length && !keysA.some(key => keysB.includes(key))) return true;
    if (a.payrollPeriodStart && b.payrollPeriodStart && a.payrollPeriodStart !== b.payrollPeriodStart) return true;
    if (a.payrollBatchId && b.payrollBatchId && a.payrollBatchId === b.payrollBatchId) return true;
    return false;
}

function samePayment(a, b) {
    return round2(a.amount) === round2(b.amount)
        && daysApart(a.date, b.date) <= RECORD_MAX_DAYS_APART
        && !distinctPayrollCharges(a, b);
}

function sameRefinancing(a, b) {
    return round2(a.interestAmount) === round2(b.interestAmount)
        && String(a.basis || '') === String(b.basis || '')
        && round2(a.interestRate) === round2(b.interestRate)
        && daysApart(refinancingDate(a), refinancingDate(b)) <= RECORD_MAX_DAYS_APART;
}

function refinancingDate(event) {
    if (event.date) return event.date;
    const created = Number(event.createdAt);
    return Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : '';
}

/** Agrupa registros vigentes: cada grupo = original + copias, en orden de registro. */
function clusterRecords(records, isSame) {
    const groups = [];
    for (const record of [...records].sort(chronological)) {
        const group = groups.find(item => isSame(item[0], record));
        if (group) group.push(record);
        else groups.push([record]);
    }
    return groups.filter(group => group.length > 1);
}

function describePayment(payment) {
    return {
        id: String(payment.id),
        date: payment.date || '',
        amount: round2(payment.amount),
        note: payment.note || '',
        recordedAt: Number(payment.recordedAt) || null,
        payroll: Boolean(payment.payrollBatchId || payment.payrollClosureId)
    };
}

function describeRefinancing(event) {
    return {
        id: String(event.id),
        date: event.date || '',
        amount: round2(event.interestAmount),
        note: event.note || '',
        recordedAt: Number(event.createdAt) || null,
        basis: event.basis || '',
        interestRate: Number(event.interestRate) || 0
    };
}

/**
 * Saldo y monto pagado de más de un préstamo si se anularan `voidIds`
 * (abonos y/o refinanciamientos). No modifica el préstamo.
 */
export function previewLoanAfterVoiding(loan, voidIds = []) {
    const ids = new Set([...voidIds].map(String));
    const copy = {
        ...loan,
        payments: (loan?.payments || []).map(item => ids.has(String(item.id)) ? { ...item, voided: true } : item),
        refinancings: (loan?.refinancings || []).map(item => ids.has(String(item.id)) ? { ...item, voided: true } : item)
    };
    return {
        balance: getBalance(copy),
        overpaid: Math.max(0, round2(getPaidAmount(copy) - getTotalDue(copy)))
    };
}

function loanLabel(loan) {
    return loan?.concept || 'Préstamo';
}

function recordGroupsForLoan(emp, loan) {
    const dismissed = dismissedKeys(loan);
    const groups = [];
    const overpaid = getPaidAmount(loan) - getTotalDue(loan) > 0.01;

    const payments = (loan.payments || []).filter(item => item && !item.voided);
    for (const cluster of clusterRecords(payments, samePayment)) {
        const key = duplicateGroupKey(DUPLICATE_KINDS.PAYMENT, cluster.map(item => item.id));
        if (dismissed.has(key)) continue;
        const [original, ...copies] = cluster;
        const sameNote = original.note && copies.every(item => item.note === original.note);
        groups.push({
            key,
            kind: DUPLICATE_KINDS.PAYMENT,
            employeeId: String(emp.id),
            loanId: String(loan.id),
            original: describePayment(original),
            copies: copies.map(describePayment),
            amount: round2(original.amount),
            // Seguro cuando el préstamo quedó pagado de más o la nota coincide
            // ("Saldo completo" dos veces): esas copias vienen marcadas.
            confidence: overpaid || sameNote ? 'high' : 'review'
        });
    }

    const refinancings = (loan.refinancings || []).filter(item => item && !item.voided);
    for (const cluster of clusterRecords(refinancings, sameRefinancing)) {
        const key = duplicateGroupKey(DUPLICATE_KINDS.REFINANCING, cluster.map(item => item.id));
        if (dismissed.has(key)) continue;
        const [original, ...copies] = cluster;
        groups.push({
            key,
            kind: DUPLICATE_KINDS.REFINANCING,
            employeeId: String(emp.id),
            loanId: String(loan.id),
            original: describeRefinancing(original),
            copies: copies.map(describeRefinancing),
            amount: round2(original.interestAmount),
            // Dos cargos de interés iguales en ≤ 3 días casi nunca son reales.
            confidence: 'high'
        });
    }
    return groups;
}

function isLoanPair(a, b) {
    if (round2(a.principal) !== round2(b.principal)) return false;
    if (Number.isFinite(a.seq) && Number.isFinite(b.seq) && a.seq === b.seq) return false;
    return daysApart(a.startDate, b.startDate) <= LOAN_MAX_DAYS_APART;
}

function describeLoan(loan) {
    return {
        id: String(loan.id),
        label: loanLabel(loan),
        startDate: loan.startDate || '',
        principal: round2(loan.principal),
        status: loan.status,
        seq: Number.isFinite(loan.seq) ? loan.seq : null,
        createdAt: Number(loan.createdAt) || null,
        paid: getPaidAmount(loan),
        paymentCount: (loan.payments || []).filter(item => !item.voided).length,
        balance: getBalance(loan)
    };
}

function loanPairsForEmployee(emp) {
    const loans = (emp.loans || []).filter(loan => loan && typeof loan === 'object' && loan.status !== LOAN_STATUS.WRITTEN_OFF);
    const pairs = [];
    for (let i = 0; i < loans.length; i++) {
        for (let j = i + 1; j < loans.length; j++) {
            const [a, b] = [loans[i], loans[j]].sort(chronological);
            if (!isLoanPair(a, b)) continue;
            const key = duplicateGroupKey(DUPLICATE_KINDS.LOAN, [a.id, b.id]);
            if (dismissedKeys(a).has(key) || dismissedKeys(b).has(key)) continue;
            pairs.push({
                key,
                kind: DUPLICATE_KINDS.LOAN,
                employeeId: String(emp.id),
                loans: [describeLoan(a), describeLoan(b)],
                amount: round2(a.principal),
                confidence: 'review'
            });
        }
    }
    return pairs;
}

/**
 * @param {Array} employees empleados ya filtrados por obra
 * @returns {{loans: Array, loanPairs: Array, counts: {payments:number, refinancings:number, loans:number, total:number}}}
 *   loans: un bloque por préstamo con sus grupos de abonos/refinanciamientos
 *   repetidos y el efecto de anular las copias sugeridas.
 */
export function findLoanRecordDuplicates(employees = []) {
    const loans = [];
    const loanPairs = [];
    for (const emp of Array.isArray(employees) ? employees : []) {
        if (!emp || !Array.isArray(emp.loans)) continue;
        for (const loan of emp.loans) {
            if (!loan || loan.status === LOAN_STATUS.WRITTEN_OFF) continue;
            const groups = recordGroupsForLoan(emp, loan);
            if (groups.length === 0) continue;
            const suggested = groups
                .filter(group => group.confidence === 'high')
                .flatMap(group => group.copies.map(item => item.id));
            // Un abono "a revisar" pasa a seguro cuando, al quitar las copias
            // seguras (p. ej. un refinanciamiento repetido), el préstamo queda
            // pagado de más justo por ese abono: se cargaron juntos dos veces.
            for (const group of groups) {
                if (group.kind !== DUPLICATE_KINDS.PAYMENT || group.confidence === 'high') continue;
                const { overpaid } = previewLoanAfterVoiding(loan, suggested);
                const copiesTotal = round2(group.copies.reduce((sum, item) => sum + item.amount, 0));
                if (overpaid > 0.01 && copiesTotal <= overpaid + 0.01) {
                    group.confidence = 'high';
                    suggested.push(...group.copies.map(item => item.id));
                }
            }
            loans.push({
                employeeId: String(emp.id),
                employeeName: emp.name || '',
                employeeNumber: emp.number ?? '',
                loanId: String(loan.id),
                loanLabel: loanLabel(loan),
                startDate: loan.startDate || '',
                principal: round2(loan.principal),
                status: loan.status,
                totalDue: getTotalDue(loan),
                paid: getPaidAmount(loan),
                balance: getBalance(loan),
                overpaid: Math.max(0, round2(getPaidAmount(loan) - getTotalDue(loan))),
                groups,
                suggested
            });
        }
        for (const pair of loanPairsForEmployee(emp)) {
            loanPairs.push({ ...pair, employeeName: emp.name || '', employeeNumber: emp.number ?? '' });
        }
    }
    const count = kind => loans.reduce((total, item) =>
        total + item.groups.filter(group => group.kind === kind).reduce((sum, group) => sum + group.copies.length, 0), 0);
    const counts = {
        payments: count(DUPLICATE_KINDS.PAYMENT),
        refinancings: count(DUPLICATE_KINDS.REFINANCING),
        loans: loanPairs.length
    };
    counts.total = counts.payments + counts.refinancings + counts.loans;
    return { loans, loanPairs, counts };
}

/**
 * "No es copia": guarda la clave en el préstamo (o en ambos, para pares de
 * préstamos) y estampa updatedAt para que la decisión gane el merge.
 * El llamador guarda.
 */
export function dismissDuplicateGroup(emp, loanIds, key, now = Date.now()) {
    for (const loanId of [].concat(loanIds)) {
        const loan = (emp?.loans || []).find(item => String(item.id) === String(loanId));
        if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
        const keys = new Set(Array.isArray(loan.duplicateReviewDismissed) ? loan.duplicateReviewDismissed : []);
        keys.add(String(key));
        loan.duplicateReviewDismissed = [...keys];
        loan.updatedAt = now;
    }
    if (emp) emp.updatedAt = now;
}

export default findLoanRecordDuplicates;
