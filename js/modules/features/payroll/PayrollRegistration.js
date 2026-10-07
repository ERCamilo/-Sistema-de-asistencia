/**
 * 📌 PayrollRegistration — registrar el cierre de un periodo ya pagado.
 *
 * El periodo se pagó sin cerrar la nómina y sus abonos de préstamos ya se
 * anotaron a mano. El cierre que se registra NO cobra préstamos otra vez:
 * enlaza esos abonos (payrollClosureId + marca) y los guarda como préstamos de
 * cada fila. No se crea lote, no se crea ni anula ningún abono y lo que deben
 * los empleados no cambia. Deshacer el cierre solo quita el enlace.
 */
export const PAYROLL_REGISTRATION_KIND = 'already-paid';
export const REGISTRATION_LOAN_MODE = Object.freeze({ LINK: 'link', NONE: 'none' });
export const LINKED_PAYMENT_CONCEPT = 'Abono ya anotado';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

/** Registro en curso válido, o null. */
export function normalizePayrollRegistration(value) {
    if (!value || typeof value !== 'object') return null;
    const periodStart = text(value.periodStart);
    const periodEnd = text(value.periodEnd);
    if (!ISO_DAY.test(periodStart) || !ISO_DAY.test(periodEnd) || periodStart > periodEnd) return null;
    return {
        periodStart,
        periodEnd,
        payDate: ISO_DAY.test(text(value.payDate)) ? text(value.payDate) : null,
        supersedesId: text(value.supersedesId) || null,
        loanMode: value.loanMode === REGISTRATION_LOAN_MODE.NONE
            ? REGISTRATION_LOAN_MODE.NONE
            : REGISTRATION_LOAN_MODE.LINK
    };
}

/** El registro solo aplica mientras el generador muestre exactamente su periodo. */
export function getActivePayrollRegistration(value, periodStart, periodEnd) {
    const registration = normalizePayrollRegistration(value);
    if (!registration) return null;
    return registration.periodStart === text(periodStart) && registration.periodEnd === text(periodEnd)
        ? registration
        : null;
}

export function isPayrollRegistrationClosure(closure) {
    return closure?.registrationKind === PAYROLL_REGISTRATION_KIND;
}

/**
 * Solo un descuento de nómina pertenece a un cierre de nómina: canal
 * 'payroll', o sin canal con origen 'payroll' o 'conversion'. Los abonos en
 * efectivo, por transferencia o directos sin canal quedan fuera.
 */
export function isPayrollDeductionPayment(payment) {
    const channel = text(payment?.channel);
    if (channel) return channel === 'payroll';
    return ['payroll', 'conversion'].includes(text(payment?.origin));
}

/** Abonos vigentes del periodo exacto, sin cierre (de cualquier canal). */
function unlinkedPeriodEntries(employees, periodStart, periodEnd) {
    const entries = [];
    for (const employee of employees || []) {
        for (const loan of employee?.loans || []) {
            for (const payment of loan?.payments || []) {
                if (!payment || payment.voided === true || text(payment.payrollClosureId)) continue;
                if (text(payment.payrollPeriodStart) !== text(periodStart) ||
                    text(payment.payrollPeriodEnd) !== text(periodEnd)) continue;
                entries.push({ employee, loan, payment });
            }
        }
    }
    return entries;
}

function toRegistrationPayments(entries) {
    return entries
        .map(({ employee, loan, payment }) => ({
            employeeId: text(employee.id),
            employeeNumber: text(employee.number),
            loanId: text(loan.id),
            paymentId: text(payment.id),
            amount: money(payment.amount),
            date: text(payment.date)
        }))
        .filter(item => item.employeeId && item.loanId && item.paymentId)
        .sort((left, right) =>
            left.employeeNumber.localeCompare(right.employeeNumber, 'es', { numeric: true }) ||
            left.date.localeCompare(right.date) || left.paymentId.localeCompare(right.paymentId));
}

/**
 * Abonos de nómina del periodo exacto que todavía no pertenecen a un cierre
 * (mismo criterio que la revisión de cierres del Historial).
 */
export function collectRegistrationPayments(employees, periodStart, periodEnd) {
    return toRegistrationPayments(unlinkedPeriodEntries(employees, periodStart, periodEnd)
        .filter(({ payment }) => isPayrollDeductionPayment(payment)));
}

/** Abonos del periodo en efectivo, transferencia o directos: nunca se enlazan. */
export function collectExcludedRegistrationPayments(employees, periodStart, periodEnd) {
    return toRegistrationPayments(unlinkedPeriodEntries(employees, periodStart, periodEnd)
        .filter(({ payment }) => !isPayrollDeductionPayment(payment)));
}

/**
 * Resumen por empleado de los abonos que se enlazarían. Los abonos de
 * empleados sin fila en la nómina de hoy quedan aparte (no se enlazan).
 */
export function summarizeRegistrationPayments(payments = [], rows = null, excluded = []) {
    const rowIds = rows ? new Set(rows.map(row => text(row?._employeeId))) : null;
    const included = rowIds ? payments.filter(item => rowIds.has(item.employeeId)) : payments;
    const byEmployee = new Map();
    for (const item of included) {
        const current = byEmployee.get(item.employeeId) || {
            employeeId: item.employeeId,
            employeeNumber: item.employeeNumber,
            count: 0,
            amount: 0
        };
        current.count += 1;
        current.amount = money(current.amount + item.amount);
        byEmployee.set(item.employeeId, current);
    }
    const outside = rowIds ? payments.filter(item => !rowIds.has(item.employeeId)) : [];
    return {
        count: included.length,
        total: money(included.reduce((sum, item) => sum + item.amount, 0)),
        employees: [...byEmployee.values()],
        outsideCount: outside.length,
        outsideTotal: money(outside.reduce((sum, item) => sum + item.amount, 0)),
        excludedCount: (excluded || []).length,
        excludedTotal: money((excluded || []).reduce((sum, item) => sum + item.amount, 0))
    };
}

/**
 * Préstamos de cada fila = suma de sus abonos ya anotados (modo «link») o
 * cero (modo «none»). Nunca usa la selección de cobro del paso 4.
 *
 * El periodo ya se pagó: si los abonos superan el neto calculado hoy, el neto
 * queda en cero y el exceso se informa (_registrationExcess) en lugar de
 * bloquear. Un neto negativo antes de préstamos (deducciones) sigue negativo.
 */
export function applyRegistrationLoans(rows = [], payments = [], loanMode = REGISTRATION_LOAN_MODE.LINK) {
    const byEmployee = new Map();
    if (loanMode !== REGISTRATION_LOAN_MODE.NONE) {
        for (const item of payments) {
            if (!byEmployee.has(item.employeeId)) byEmployee.set(item.employeeId, []);
            byEmployee.get(item.employeeId).push(item);
        }
    }
    return (rows || []).map(row => {
        const baseAmount = Number(row._montoBeforeLoans ?? row.monto) || 0;
        const linked = byEmployee.get(text(row._employeeId)) || [];
        const loanAmount = money(linked.reduce((sum, item) => sum + item.amount, 0));
        const rawAmount = loanAmount > 0 ? baseAmount - loanAmount : baseAmount;
        const excess = loanAmount > 0 && baseAmount >= 0 && money(rawAmount) < 0 ? money(-rawAmount) : 0;
        const finalAmount = excess > 0 ? 0 : rawAmount;
        return {
            ...row,
            monto: finalAmount,
            _montoBeforeLoans: baseAmount,
            _loans: loanAmount,
            _loanDetails: linked.map(item => ({
                loanId: item.loanId,
                paymentId: item.paymentId,
                concept: LINKED_PAYMENT_CONCEPT,
                date: item.date,
                selectedAmount: item.amount,
                linked: true
            })),
            _registrationExcess: excess,
            _invalidLoanNet: loanAmount > 0 && money(finalAmount) < 0
        };
    });
}

/** Empleados cuyos abonos ya hechos superan el neto calculado hoy. */
export function registrationExcessRows(rows = []) {
    return (rows || [])
        .filter(row => Number(row?._registrationExcess) > 0)
        .map(row => ({
            employeeId: text(row._employeeId),
            employeeNumber: text(row._number ?? row.id),
            excess: money(row._registrationExcess)
        }))
        .sort((left, right) => left.employeeNumber.localeCompare(right.employeeNumber, 'es', { numeric: true }));
}

/** Referencias de los abonos enlazados, tomadas de las filas de la nómina. */
export function linkedPaymentRefsFromRows(rows = []) {
    return (rows || []).flatMap(row => (row?._loanDetails || [])
        .filter(detail => detail?.linked === true && detail.paymentId)
        .map(detail => ({
            employeeId: text(row._employeeId),
            loanId: text(detail.loanId),
            paymentId: text(detail.paymentId),
            amount: money(detail.selectedAmount)
        })));
}

function findPayment(employees, ref) {
    const employee = (employees || []).find(item => text(item?.id) === text(ref.employeeId));
    const loan = (employee?.loans || []).find(item => text(item?.id) === text(ref.loanId));
    const payment = (loan?.payments || []).find(item => text(item?.id) === text(ref.paymentId));
    return payment ? { employee, loan, payment } : null;
}

/**
 * Enlaza los abonos del cierre registrado. Verifica antes de tocar nada que
 * cada abono siga vigente, sin cierre y en el periodo del cierre.
 */
export function linkRegistrationPayments(employees, closure, { now = Date.now() } = {}) {
    const refs = closure?.linkedPaymentRefs || [];
    const targets = refs.map(ref => {
        const found = findPayment(employees, ref);
        const payment = found?.payment;
        if (!payment || payment.voided === true || text(payment.payrollClosureId) ||
            text(payment.payrollPeriodStart) !== text(closure.periodStart) ||
            text(payment.payrollPeriodEnd) !== text(closure.periodEnd) ||
            money(payment.amount) !== money(ref.amount)) {
            throw new Error('Los abonos del periodo cambiaron. Revisa el registro antes de cerrarlo.');
        }
        return found;
    });
    const affected = new Set();
    for (const { employee, loan, payment } of targets) {
        payment.payrollClosureId = text(closure.id);
        payment.payrollClosureLinked = true;
        payment.payrollClosureLinkedAt = now;
        payment.updatedAt = now;
        loan.updatedAt = now;
        employee.updatedAt = now;
        affected.add(text(employee.id));
    }
    return { linkedCount: targets.length, affectedEmployeeIds: [...affected] };
}

/** Quita solo el enlace que puso el registro; los abonos siguen vigentes. */
export function unlinkRegistrationPayments(employees, closure, { now = Date.now() } = {}) {
    const affected = new Set();
    let unlinkedCount = 0;
    for (const ref of closure?.linkedPaymentRefs || []) {
        const found = findPayment(employees, ref);
        const payment = found?.payment;
        if (!payment || payment.payrollClosureLinked !== true ||
            text(payment.payrollClosureId) !== text(closure.id)) continue;
        delete payment.payrollClosureId;
        delete payment.payrollClosureLinked;
        delete payment.payrollClosureLinkedAt;
        payment.updatedAt = now;
        found.loan.updatedAt = now;
        found.employee.updatedAt = now;
        affected.add(text(found.employee.id));
        unlinkedCount++;
    }
    return { unlinkedCount, affectedEmployeeIds: [...affected] };
}

export default {
    applyRegistrationLoans,
    collectExcludedRegistrationPayments,
    collectRegistrationPayments,
    isPayrollDeductionPayment,
    registrationExcessRows,
    getActivePayrollRegistration,
    isPayrollRegistrationClosure,
    linkRegistrationPayments,
    linkedPaymentRefsFromRows,
    normalizePayrollRegistration,
    summarizeRegistrationPayments,
    unlinkRegistrationPayments
};
