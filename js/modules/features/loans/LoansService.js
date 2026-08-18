/**
 * 💵 LoansService — Pure data operations for the employee loans ledger.
 *
 * Replaces the thin `emp.advances[]` model with a richer `emp.loans[]` that
 * tracks:
 *   - principal + interest + concept
 *   - status (active | paid | written-off)
 *   - installments (optional repayment schedule)
 *   - payments[] (audit-trail of every abono)
 *
 * All functions are pure with respect to the `emp` object you pass in —
 * they mutate `emp.loans` in place but do not touch the global state proxy
 * or save to disk. Callers are responsible for invoking saveApplicationData()
 * after a successful operation.
 *
 * MIGRATION: legacy data lives under `emp.advances[]` with shape
 *   { id?, amount, interest, date, note }
 * The function migrateAdvancesToLoans(emp) converts each one to a loan with
 * an empty payments[] array. Idempotent — safe to run on already-migrated
 * data.
 *
 * MONEY MATH: we round to 2 decimals at the boundary (display/save) so
 * floating-point drift cannot accumulate. Internal arithmetic uses JS
 * numbers — for a payroll app of this scale, the precision is sufficient.
 */

import { recordNestedTombstone } from '../../services/NestedTombstones.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const LOAN_STATUS = Object.freeze({
    ACTIVE: 'active',
    PAID: 'paid',
    WRITTEN_OFF: 'written-off'
});

export const INSTALLMENT_MODE = Object.freeze({
    LUMP: 'lump',                 // collect everything on next payroll
    INSTALLMENTS: 'installments'  // spread across N scheduled installments
});

export const VALIDATION = Object.freeze({
    MAX_INTEREST_PERCENT: 100,    // 100% = full doubling is the cap
    MAX_PRINCIPAL: 1_000_000,     // sanity ceiling; adjust if the org needs more
    MAX_INSTALLMENTS: 52,         // one year of weekly installments
    ALLOWED_FREQUENCY_WEEKS: [1, 2, 3, 4]
});

// ─── Money helpers ───────────────────────────────────────────────────────────

/** Round to 2 decimals to avoid float drift on persisted values. */
export function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ─── ID generation ───────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(prefix) {
    _idCounter++;
    // 🫆 P4: el sufijo aleatorio evita colisiones ENTRE dispositivos — el
    // contador reinicia en cada carga de página, así que dos dispositivos
    // creando en el mismo milisegundo generaban el MISMO id y el merge
    // fusionaba préstamos/abonos distintos.
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}-${rand}`;
}

// ─── Loan sequence number (Fase 2, U4) ───────────────────────────────────────

/**
 * El número que el dispositivo cree que corresponde al próximo préstamo del
 * empleado. `seq` es una SEÑAL de detección de creaciones concurrentes, NO
 * una identidad (la PK sigue siendo el UUID): dos dispositivos offline que
 * crean "el 4to préstamo" generan UUIDs distintos pero el MISMO seq=4 — esa
 * coincidencia es la primera señal del detector de duplicados
 * (LoanDuplicateDetector.js).
 *
 * max(seq)+1 y NO count+1: tras un hard-delete (deleteLoan) el conteo
 * retrocede y count+1 reciclaría el seq de un préstamo vivo, generando
 * falsas señales de duplicado. Sin ningún seq finito (datos legacy),
 * fallback a cantidad + 1.
 */
export function nextLoanSeq(loans) {
    const arr = Array.isArray(loans) ? loans : [];
    const seqs = arr.map(l => l?.seq).filter(Number.isFinite);
    if (seqs.length > 0) return Math.max(...seqs) + 1;
    return arr.length + 1;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate input for a new loan. Returns { valid: boolean, errors: string[] }.
 */
export function validateLoanInput(params) {
    const errors = [];
    const principal = Number(params.principal);
    const interestRate = Number(params.interestRate ?? 0);

    if (!Number.isFinite(principal) || principal <= 0) {
        errors.push('El monto del préstamo debe ser mayor a 0');
    }
    if (principal > VALIDATION.MAX_PRINCIPAL) {
        errors.push(`El monto excede el máximo permitido (${VALIDATION.MAX_PRINCIPAL.toLocaleString()})`);
    }
    if (!Number.isFinite(interestRate) || interestRate < 0) {
        errors.push('El interés no puede ser negativo');
    }
    if (interestRate > VALIDATION.MAX_INTEREST_PERCENT) {
        errors.push(`El interés excede el máximo permitido (${VALIDATION.MAX_INTEREST_PERCENT}%)`);
    }
    if (!params.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(params.startDate)) {
        errors.push('La fecha de inicio es obligatoria y debe estar en formato YYYY-MM-DD');
    } else {
        const start = new Date(params.startDate + 'T00:00:00');
        const year = start.getFullYear();
        if (year < 2000 || year > 2100) {
            errors.push('La fecha de inicio está fuera de un rango razonable (2000-2100)');
        }
    }

    if (params.installmentMode === INSTALLMENT_MODE.INSTALLMENTS) {
        const count = Number(params.installmentCount);
        const freq = Number(params.installmentFrequencyWeeks);
        if (!Number.isInteger(count) || count < 2 || count > VALIDATION.MAX_INSTALLMENTS) {
            errors.push(`La cantidad de cuotas debe estar entre 2 y ${VALIDATION.MAX_INSTALLMENTS}`);
        }
        if (!VALIDATION.ALLOWED_FREQUENCY_WEEKS.includes(freq)) {
            errors.push(`La frecuencia debe ser una de: ${VALIDATION.ALLOWED_FREQUENCY_WEEKS.join(', ')} semanas`);
        }
    }

    return { valid: errors.length === 0, errors };
}

/** Validate a payment (abono) entry. */
export function validatePaymentInput(loan, params) {
    const errors = [];
    const amount = Number(params.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
        errors.push('El monto del abono debe ser mayor a 0');
    } else {
        const balance = getBalance(loan);
        // Allow tiny rounding overpayments (e.g. 100.001 to settle 100.00)
        if (amount > balance + 0.01) {
            errors.push(`El abono (${amount.toFixed(2)}) excede el saldo pendiente (${balance.toFixed(2)})`);
        }
    }
    if (!params.date || !/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        errors.push('La fecha del abono es obligatoria');
    }
    return { valid: errors.length === 0, errors };
}

/** Validate a refinancing (refinanciamiento) entry. */
export function validateRefinanceInput(loan, params) {
    const errors = [];
    const rate = Number(params.interestRate);
    if (!Number.isFinite(rate) || rate <= 0) {
        errors.push('La tasa de interés del refinanciamiento debe ser mayor a 0');
    } else if (rate > VALIDATION.MAX_INTEREST_PERCENT) {
        errors.push(`El interés excede el máximo permitido (${VALIDATION.MAX_INTEREST_PERCENT}%)`);
    }
    if (params.date && !/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        errors.push('La fecha debe estar en formato YYYY-MM-DD');
    }
    if (params.basis && !['principal', 'balance'].includes(params.basis)) {
        errors.push('Base de interés inválida (capital original o saldo restante)');
    }
    return { valid: errors.length === 0, errors };
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Convert legacy `emp.advances[]` entries to `emp.loans[]`. Idempotent.
 * Each legacy advance becomes a fully-formed loan with empty payments[].
 */
export function migrateAdvancesToLoans(emp) {
    if (!emp) return 0;
    if (!Array.isArray(emp.loans)) emp.loans = [];

    const legacy = Array.isArray(emp.advances) ? emp.advances : [];
    let migrated = 0;

    for (const adv of legacy) {
        // Skip if this advance was already migrated (by id match)
        if (adv.id && emp.loans.some(l => l._migratedFromAdvanceId === adv.id)) continue;

        emp.loans.push({
            id: genId('LOAN'),
            // Fase 2 U4: los migrados también llevan seq (señal de detección).
            seq: nextLoanSeq(emp.loans),
            _migratedFromAdvanceId: adv.id || null,
            principal: round2(adv.amount || 0),
            interestRate: Number(adv.interest || 0),
            interestType: 'simple',
            interestIncluded: !!adv.interestIncluded,
            startDate: adv.date || new Date().toISOString().slice(0, 10),
            concept: adv.note || 'Adelanto (migrado)',
            status: LOAN_STATUS.ACTIVE,
            installmentMode: INSTALLMENT_MODE.LUMP,
            installmentFrequencyWeeks: 2,
            installments: [],
            payments: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            closedAt: null,
            closedBy: null
        });
        migrated++;
    }

    return migrated;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Create a new loan and append it to emp.loans. Throws on validation error.
 *
 * @param {object} emp
 * @param {object} params
 * @param {number} params.principal           – principal amount in money units
 * @param {number} [params.interestRate=0]   – percentage (e.g. 5 = 5%)
 * @param {string} params.startDate           – 'YYYY-MM-DD'
 * @param {string} [params.concept]
 * @param {'lump'|'installments'} [params.installmentMode='lump']
 * @param {number} [params.installmentFrequencyWeeks=2]
 * @param {number} [params.installmentCount]
 * @returns {object} the created loan
 */
export function createLoan(emp, params) {
    if (!emp) throw new Error('Empleado no proporcionado');
    if (!Array.isArray(emp.loans)) emp.loans = [];

    const { valid, errors } = validateLoanInput(params);
    if (!valid) throw new Error(errors.join('. '));

    const mode = params.installmentMode || INSTALLMENT_MODE.LUMP;
    const installments = mode === INSTALLMENT_MODE.INSTALLMENTS
        ? generateInstallmentSchedule({
            principal: round2(params.principal),
            interestRate: Number(params.interestRate || 0),
            interestIncluded: !!params.interestIncluded,
            startDate: params.startDate,
            count: Number(params.installmentCount),
            frequencyWeeks: Number(params.installmentFrequencyWeeks)
        })
        : [];

    const loan = {
        id: genId('LOAN'),
        // Fase 2 U4: señal de detección de creaciones concurrentes, no PK.
        seq: nextLoanSeq(emp.loans),
        principal: round2(params.principal),
        interestRate: Number(params.interestRate || 0),
        interestType: params.interestType || 'simple',
        interestIncluded: !!params.interestIncluded,
        startDate: params.startDate,
        concept: (params.concept || '').trim() || 'Préstamo',
        status: LOAN_STATUS.ACTIVE,
        installmentMode: mode,
        installmentFrequencyWeeks: Number(params.installmentFrequencyWeeks || 2),
        installments,
        payments: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        closedAt: null,
        closedBy: null
    };
    emp.loans.push(loan);
    emp.updatedAt = Date.now();
    return loan;
}

/** Generate an installment schedule. Exported for testing & UI preview. */
export function generateInstallmentSchedule({ principal, interestRate, interestIncluded, startDate, count, frequencyWeeks }) {
    const totalDue = principal + (interestIncluded ? 0 : (principal * interestRate / 100));
    // Use floor on the per-installment amount and put the remainder in the
    // last installment so the sum exactly equals totalDue (no rounding drift).
    const perInstallment = round2(Math.floor((totalDue / count) * 100) / 100);
    const installments = [];
    let allocated = 0;
    const start = new Date(startDate + 'T00:00:00');

    for (let i = 0; i < count; i++) {
        const dueDate = new Date(start);
        dueDate.setDate(dueDate.getDate() + (i + 1) * 7 * frequencyWeeks);

        const isLast = i === count - 1;
        const amount = isLast ? round2(totalDue - allocated) : perInstallment;
        allocated = round2(allocated + amount);

        installments.push({
            id: genId('INST'),
            seq: i + 1,
            dueDate: dueDate.toISOString().slice(0, 10),
            scheduledAmount: amount,
            note: ''
        });
    }
    return installments;
}

/** Record a payment (abono) against a loan. Throws on validation error. */
export function recordPayment(emp, loanId, params) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    if (loan.status !== LOAN_STATUS.ACTIVE) {
        throw new Error('Solo se pueden registrar abonos en préstamos activos');
    }

    const { valid, errors } = validatePaymentInput(loan, params);
    if (!valid) throw new Error(errors.join('. '));

    const now = Number.isFinite(Number(params.recordedAt))
        ? Number(params.recordedAt)
        : Date.now();
    const paymentId = params.id || genId('PAY');
    if ((loan.payments || []).some(item => String(item.id) === String(paymentId))) {
        throw new Error(`Ya existe un abono con el identificador ${paymentId}`);
    }
    const payment = {
        id: paymentId,
        date: params.date,
        amount: round2(params.amount),
        note: (params.note || '').trim(),
        recordedBy: params.recordedBy || null,
        recordedAt: now,
        // 🕒 P2: updatedAt por-payment. Sin esto, en una colisión de merge
        // (mismo id en server y local) ganaba siempre "local" y una copia
        // vieja podía pisar una anulación hecha en otro dispositivo.
        updatedAt: now,
        voided: false,
        voidedAt: null
    };
    if (params.source) payment.source = String(params.source);
    if (params.payrollBatchId) payment.payrollBatchId = String(params.payrollBatchId);
    if (params.payrollClosureId) payment.payrollClosureId = String(params.payrollClosureId);
    if (params.payrollPreviewFingerprint) {
        payment.payrollPreviewFingerprint = String(params.payrollPreviewFingerprint);
    }
    if (params.payrollIdempotencyKey) {
        payment.payrollIdempotencyKey = String(params.payrollIdempotencyKey);
    }
    if (Array.isArray(params.payrollChargeKeys)) {
        payment.payrollChargeKeys = [...new Set(params.payrollChargeKeys.map(String))];
    }
    if (params.payrollPeriodStart) payment.payrollPeriodStart = String(params.payrollPeriodStart);
    if (params.payrollPeriodEnd) payment.payrollPeriodEnd = String(params.payrollPeriodEnd);
    for (const field of [
        'payrollBatchCreatedAt',
        'payrollBatchUndoUntil',
        'payrollBatchTotal',
        'payrollBatchEmployeeCount',
        'payrollExpectedPaymentCount'
    ]) {
        if (Number.isFinite(Number(params[field]))) payment[field] = Number(params[field]);
    }
    if (params.payrollBatchSnapshot && typeof params.payrollBatchSnapshot === 'object') {
        payment.payrollBatchSnapshot = params.payrollBatchSnapshot;
    }
    loan.payments.push(payment);
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();

    // Auto-close if fully paid (within 1 cent of zero)
    const remaining = getBalance(loan);
    if (remaining <= 0.01) {
        loan.status = LOAN_STATUS.PAID;
        loan.closedAt = Date.now();
        loan.closedBy = params.recordedBy || null;
    }

    return payment;
}

/** Restore a soft-voided payment without creating a duplicate merge identity. */
export function restorePayment(emp, loanId, paymentId, restoredBy = null, restoredAt = Date.now()) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    const payment = (loan.payments || []).find(p => String(p.id) === String(paymentId));
    if (!payment) throw new Error(`Abono no encontrado: ${paymentId}`);
    if (!payment.voided) return payment;
    if (loan.status === LOAN_STATUS.WRITTEN_OFF) {
        throw new Error('No se puede restaurar un abono de un préstamo anulado');
    }

    const { valid, errors } = validatePaymentInput(loan, payment);
    if (!valid) throw new Error(errors.join('. '));

    const now = Number.isFinite(Number(restoredAt)) ? Number(restoredAt) : Date.now();
    payment.voided = false;
    payment.voidedAt = null;
    payment.voidedBy = null;
    payment.restoredAt = now;
    payment.restoredBy = restoredBy;
    payment.updatedAt = now;
    loan.updatedAt = now;
    emp.updatedAt = now;

    if (getBalance(loan) <= 0.01) {
        loan.status = LOAN_STATUS.PAID;
        loan.closedAt = now;
        loan.closedBy = restoredBy;
    } else if (loan.status === LOAN_STATUS.PAID) {
        loan.status = LOAN_STATUS.ACTIVE;
        loan.closedAt = null;
        loan.closedBy = null;
    }
    return payment;
}

/**
 * ♻️ Refinance a loan: the employee couldn't pay (fully or partially), so we
 * add interest to the loan. The interest base is chosen per refinancing:
 *   - basis 'principal' → interest on the ORIGINAL capital (loan.principal)
 *   - basis 'balance'   → interest on the REMAINING balance at this moment
 *
 * v1: only adds interest (and history). It does NOT touch due dates or
 * regenerate installments. The loan stays ACTIVE; its totalDue/balance grow.
 *
 * @returns {object} the refinancing event appended to loan.refinancings[]
 */
export function refinanceLoan(emp, loanId, params = {}) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    if (loan.status !== LOAN_STATUS.ACTIVE) {
        throw new Error('Solo se pueden refinanciar préstamos activos');
    }
    const balance = getBalance(loan);
    if (balance <= 0.01) {
        throw new Error('No se puede refinanciar un préstamo sin saldo pendiente');
    }

    const { valid, errors } = validateRefinanceInput(loan, params);
    if (!valid) throw new Error(errors.join('. '));

    const createsReplacement = params.replacement !== false && params.installmentCount != null && Number(params.installmentCount) > 0;
    const basis = params.basis === 'principal' ? 'principal' : 'balance';
    const baseAmount = basis === 'balance' ? balance : round2(Number(loan.principal || 0));
    const rate = Number(params.interestRate);
    const interestAmount = round2(baseAmount * rate / 100);

    const now = Date.now();
    const event = {
        id: genId('REFIN'),
        date: params.date || new Date().toISOString().slice(0, 10),
        basis,
        baseAmount,
        interestRate: rate,
        interestAmount,
        unpaidAmount: (params.unpaidAmount != null && Number.isFinite(Number(params.unpaidAmount)))
            ? round2(Number(params.unpaidAmount)) : null,
        note: (params.note || '').trim(),
        createdBy: params.createdBy || null,
        createdAt: now,
        // 🕒 updatedAt por-evento (espejo de payments): sin esto, una
        // anulación hecha en un dispositivo perdía el merge contra una copia
        // vieja no-anulada con el mismo id en otro dispositivo.
        updatedAt: now,
        voided: false,
        voidedAt: null
    };

    if (createsReplacement) {
        const count = Number(params.installmentCount);
        const frequencyWeeks = Number(params.installmentFrequencyWeeks || 2);
        if (!Number.isInteger(count) || count < 1 || count > VALIDATION.MAX_INSTALLMENTS) throw new Error(`La cantidad de cuotas debe estar entre 1 y ${VALIDATION.MAX_INSTALLMENTS}`);
        if (!VALIDATION.ALLOWED_FREQUENCY_WEEKS.includes(frequencyWeeks)) throw new Error(`La frecuencia debe ser una de: ${VALIDATION.ALLOWED_FREQUENCY_WEEKS.join(', ')} semanas`);
        const effectiveAt = Number.isFinite(Number(params.effectiveAt)) ? Number(params.effectiveAt) : now;
        const principal = balance;
        const startDate = params.date || new Date(effectiveAt).toISOString().slice(0, 10);
        const replacementInterest = interestAmount;
        const totalDue = round2(principal + replacementInterest);
        event.kind = 'replacement';
        event.effectiveAt = effectiveAt;
        event.replacementTerms = {
            version: 2, principal, interestRate: rate, interestIncluded: false, startDate,
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS, installmentFrequencyWeeks: frequencyWeeks, installmentCount: count,
            installments: generateInstallmentSchedule({ principal: totalDue, interestRate: 0, interestIncluded: true, startDate, count, frequencyWeeks }),
            interestAmount: replacementInterest, totalDue,
            paidAmountAtReplacement: getPaidAmount(loan), effectiveAt
        };
    }

    if (!Array.isArray(loan.refinancings)) loan.refinancings = [];
    loan.refinancings.push(event);
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();
    return event;
}

/**
 * Anula un refinanciamiento registrado por error. Soft-void: conserva el
 * evento (auditoría) pero lo saca del cálculo de interés/saldo. Reversible a
 * nivel datos. Refresca updatedAt para que la anulación gane el merge.
 */
export function voidRefinancing(emp, loanId, refinId, voidedBy = null) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    const event = (loan.refinancings || []).find(r => r.id === refinId);
    if (!event) throw new Error(`Refinanciamiento no encontrado: ${refinId}`);
    if (event.voided) return event; // idempotent

    event.voided = true;
    event.voidedAt = Date.now();
    event.voidedBy = voidedBy;
    event.updatedAt = Date.now();
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();

    // Si al quitar este interés el préstamo queda sin saldo, se salda solo
    // (espejo del auto-close de recordPayment).
    if (loan.status === LOAN_STATUS.ACTIVE && getBalance(loan) <= 0.01) {
        loan.status = LOAN_STATUS.PAID;
        loan.closedAt = Date.now();
        loan.closedBy = voidedBy;
    }
    return event;
}

/** Mark a previously recorded payment as voided. Preserves audit trail. */
export function voidPayment(emp, loanId, paymentId, voidedBy = null) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    const payment = loan.payments.find(p => p.id === paymentId);
    if (!payment) throw new Error(`Abono no encontrado: ${paymentId}`);
    if (payment.voided) return payment; // idempotent

    payment.voided = true;
    payment.voidedAt = Date.now();
    payment.voidedBy = voidedBy;
    // 🕒 P2: la anulación debe ganar el merge contra copias viejas del
    // mismo payment en otros dispositivos.
    payment.updatedAt = Date.now();
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();

    // If voiding moves the loan back to having a balance, re-open it
    if (loan.status === LOAN_STATUS.PAID && getBalance(loan) > 0.01) {
        loan.status = LOAN_STATUS.ACTIVE;
        loan.closedAt = null;
        loan.closedBy = null;
    }
    return payment;
}

/** Soft-delete: mark the loan as written-off. Preserves all data. */
export function writeOffLoan(emp, loanId, writtenOffBy = null) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    loan.status = LOAN_STATUS.WRITTEN_OFF;
    loan.closedAt = Date.now();
    loan.closedBy = writtenOffBy;
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();
    return loan;
}

/** Reverse a write-off (un-archive). */
export function reopenLoan(emp, loanId) {
    const loan = (emp.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    if (loan.status !== LOAN_STATUS.WRITTEN_OFF) return loan;

    loan.status = getBalance(loan) <= 0.01 ? LOAN_STATUS.PAID : LOAN_STATUS.ACTIVE;
    loan.closedAt = loan.status === LOAN_STATUS.PAID ? Date.now() : null;
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();
    return loan;
}

/**
 * Hard-delete: elimina un préstamo ANULADO de emp.loans[] de forma permanente y
 * registra un tombstone para que el borrado sobreviva al sync multi-dispositivo.
 * Sin el tombstone, el merge por unión (EmployeeMerge.unionById) lo resucitaría
 * desde la copia remota.
 *
 * Solo se permite sobre préstamos written-off: un préstamo activo o saldado
 * conserva valor contable (saldo, historial de abonos) y no debe poder borrarse
 * desde la UI. El llamador es responsable de saveApplicationData().
 *
 * @returns {object} el préstamo eliminado
 * @throws si el préstamo no existe o no está anulado
 */
export function deleteLoan(emp, loanId) {
    const loans = emp.loans || [];
    const loan = loans.find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    if (loan.status !== LOAN_STATUS.WRITTEN_OFF) {
        throw new Error('Solo se pueden eliminar préstamos anulados');
    }
    emp.loans = loans.filter(l => l.id !== loanId);
    recordNestedTombstone(emp, 'loans', loanId); // también sube emp.updatedAt
    return loan;
}

// ─── Derived calculations ────────────────────────────────────────────────────

/**
 * The effective contract for a loan. A refinancing may persist a full
 * replacementTerms snapshot; the latest non-voided snapshot becomes the one
 * source of truth for current KPIs, cards, schedules and payroll deductions.
 * Older loans and interest-only refinancing events retain their stored terms.
 */
export function getActiveLoanTerms(loan = {}) {
    const base = {
        principal: Number(loan.principal || 0),
        interestRate: Number(loan.interestRate || 0),
        interestIncluded: !!loan.interestIncluded,
        startDate: loan.startDate,
        installmentMode: loan.installmentMode || INSTALLMENT_MODE.LUMP,
        installmentFrequencyWeeks: Number(loan.installmentFrequencyWeeks || 2),
        installments: Array.isArray(loan.installments) ? loan.installments : []
    };

    const replacement = (loan.refinancings || [])
        .filter(event => !event?.voided && event.replacementTerms && typeof event.replacementTerms === 'object')
        .sort((left, right) => {
            const leftTime = Number(left.effectiveAt ?? left.createdAt) || Date.parse(left.date || '') || 0;
            const rightTime = Number(right.effectiveAt ?? right.createdAt) || Date.parse(right.date || '') || 0;
            return leftTime - rightTime || String(left.id || '').localeCompare(String(right.id || ''));
        })
        .at(-1)?.replacementTerms;
    if (!replacement) return base;
    return {
        ...base,
        ...replacement,
        principal: Number(replacement.principal ?? base.principal),
        interestRate: Number(replacement.interestRate ?? base.interestRate),
        interestIncluded: replacement.interestIncluded ?? base.interestIncluded,
        installments: Array.isArray(replacement.installments) ? replacement.installments : base.installments
    };
}

/** Total amount the loan should collect (principal + interest + refinancing interest). */
export function getTotalDue(loan) {
    const terms = getActiveLoanTerms(loan);
    const principal = terms.principal;
    const rate = terms.interestRate;
    const interest = terms.interestIncluded ? 0 : (principal * rate / 100);
    return round2(principal + interest + getRefinanceInterest(loan));
}

/** Total interest added by all NON-VOIDED refinancing events on this loan. */
export function getRefinanceInterest(loan) {
    const events = [...(loan.refinancings || [])]
        .filter(event => !event?.voided)
        .sort((left, right) => refinancingOrder(left, right));
    const latestReplacement = events.filter(event => event.replacementTerms && typeof event.replacementTerms === 'object').at(-1);
    const applicable = latestReplacement
        ? events.filter(event => refinancingOrder(event, latestReplacement) > 0 && !event.replacementTerms)
        : events.filter(event => !event.replacementTerms);
    return round2(applicable.reduce((sum, event) => sum + Number(event.interestAmount || 0), 0));
}

function refinancingOrder(left, right) {
    const timestamp = event => Number(event?.effectiveAt ?? event?.createdAt) || Date.parse(event?.date || '') || 0;
    return timestamp(left) - timestamp(right) || String(left?.id || '').localeCompare(String(right?.id || ''));
}

/** Number of times this loan has been refinanced (excludes voided events). */
export function getRefinanceCount(loan) {
    return (loan.refinancings || []).filter(r => !r.voided).length;
}

/** Accrued total interest: original loan interest + all refinancing interest. */
export function getTotalInterestAccrued(loan) {
    return round2(getInterestAmount(loan) + getRefinanceInterest(loan));
}

/** Total of all NON-VOIDED payments made against the loan. */
export function getPaidAmount(loan) {
    return round2((loan.payments || [])
        .filter(p => !p.voided)
        .reduce((sum, p) => sum + Number(p.amount || 0), 0));
}

/** Remaining balance: totalDue - paidAmount (clamped to >= 0). */
export function getBalance(loan) {
    const due = getTotalDue(loan);
    const replacement = (loan.refinancings || [])
        .filter(event => !event?.voided && event.replacementTerms && typeof event.replacementTerms === 'object')
        .sort((left, right) => (Number(left.effectiveAt ?? left.createdAt) || 0) - (Number(right.effectiveAt ?? right.createdAt) || 0) || String(left.id || '').localeCompare(String(right.id || '')))
        .at(-1)?.replacementTerms;
    const paid = Math.max(0, getPaidAmount(loan) - Number(replacement?.paidAmountAtReplacement || 0));
    return Math.max(0, round2(due - paid));
}

/**
 * Returns every remaining payroll charge in payment order.
 *
 * Installment loans expose the unpaid portion of the current installment plus
 * all later installments. This lets payroll select the next installment by
 * default while still allowing an employee to advance several consecutive
 * installments. `isDue` is evaluated against the payroll period end supplied
 * by the caller. The payroll UI may still select the first future option when
 * the user explicitly applies upcoming charges.
 */
export function getPayrollDeductionOptions(loan, asOfDate = null) {
    if (loan.status !== LOAN_STATUS.ACTIVE) return [];
    const balance = getBalance(loan);
    if (balance <= 0) return [];

    const today = asOfDate || new Date().toISOString().slice(0, 10);

    const terms = getActiveLoanTerms(loan);
    if (terms.installmentMode !== INSTALLMENT_MODE.INSTALLMENTS) {
        return [{
            kind: 'lump',
            amount: balance,
            dueDate: terms.startDate,
            isInstallment: false,
            installmentSeq: null,
            isDue: true
        }];
    }

    const replacement = (loan.refinancings || [])
        .filter(event => !event?.voided && event.replacementTerms && typeof event.replacementTerms === 'object')
        .sort((left, right) => (Number(left.effectiveAt ?? left.createdAt) || 0) - (Number(right.effectiveAt ?? right.createdAt) || 0) || String(left.id || '').localeCompare(String(right.id || '')))
        .at(-1)?.replacementTerms;
    let paidToAllocate = Math.max(0, getPaidAmount(loan) - Number(replacement?.paidAmountAtReplacement || 0));
    let selectableBalance = balance;
    const options = [];

    for (const inst of terms.installments) {
        const scheduledAmount = round2(inst.scheduledAmount);
        const appliedToInstallment = Math.min(paidToAllocate, scheduledAmount);
        paidToAllocate = round2(Math.max(0, paidToAllocate - appliedToInstallment));
        const remainingOfInstallment = round2(scheduledAmount - appliedToInstallment);

        if (remainingOfInstallment <= 0 || selectableBalance <= 0) {
            continue;
        }

        const amount = round2(Math.min(remainingOfInstallment, selectableBalance));
        options.push({
            kind: 'installment',
            amount,
            dueDate: inst.dueDate,
            isInstallment: true,
            installmentSeq: inst.seq,
            isDue: inst.dueDate <= today
        });
        selectableBalance = round2(selectableBalance - amount);
    }

    if (selectableBalance > 0) {
        const lastScheduledDate = terms.installments[terms.installments.length - 1]?.dueDate;
        const dueDate = lastScheduledDate || terms.startDate;
        options.push({
            kind: 'balance-adjustment',
            amount: selectableBalance,
            dueDate,
            isInstallment: false,
            installmentSeq: null,
            isDue: !dueDate || dueDate <= today
        });
    }

    return options;
}

/**
 * Returns the oldest due and unpaid payroll charge as of `asOfDate`.
 * Lump-mode loans preserve their historical behavior and return the complete
 * balance as one virtual charge.
 */
export function getNextPayrollDeduction(loan, asOfDate = null) {
    const options = getPayrollDeductionOptions(loan, asOfDate);
    if (!Array.isArray(options)) return null;
    return options.find(option => option.isDue) || null;
}

// ─── Aggregations across the whole employee set ──────────────────────────────

/** All active loans across all employees (flat list). */
export function getAllActiveLoans(state) {
    const out = [];
    for (const emp of (state.employees || [])) {
        for (const loan of (emp.loans || [])) {
            if (loan.status === LOAN_STATUS.ACTIVE) out.push({ emp, loan });
        }
    }
    return out;
}

/**
 * Employees with at least one ACTIVE loan, with summary numbers.
 * Sorted by total outstanding balance descending.
 */
export function getEmployeesWithDebt(state) {
    const result = [];
    for (const emp of (state.employees || [])) {
        const loans = (emp.loans || []).filter(l => l.status === LOAN_STATUS.ACTIVE);
        if (loans.length === 0) continue;

        const totalBalance = round2(loans.reduce((s, l) => s + getBalance(l), 0));
        const totalDue = round2(loans.reduce((s, l) => s + getTotalDue(l), 0));
        const totalPaid = round2(loans.reduce((s, l) => s + getPaidAmount(l), 0));

        result.push({
            employeeId: emp.id,
            name: emp.name,
            number: emp.number,
            active: emp.active !== false,
            loanCount: loans.length,
            totalBalance,
            totalDue,
            totalPaid
        });
    }
    result.sort((a, b) => b.totalBalance - a.totalBalance);
    return result;
}

/** Total amount currently outstanding across the org. */
export function getTotalExposure(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .filter(l => l.status === LOAN_STATUS.ACTIVE)
            .reduce((s, l) => s + getBalance(l), 0)
    );
}

/**
 * Total amount paid (abonado) across all *active* loans org-wide. Excludes
 * loans that are already saldados/anulados — that's a separate KPI ("totales
 * recuperados") if we ever surface it.
 */
export function getTotalPaidActive(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .filter(l => l.status === LOAN_STATUS.ACTIVE)
            .reduce((s, l) => s + getPaidAmount(l), 0)
    );
}

/** Employees who had loans in the past, but none are active currently. */
export function getEmployeesWithOnlyInactiveLoans(state) {
    const result = [];
    for (const emp of (state.employees || [])) {
        const allLoans = emp.loans || [];
        if (allLoans.length === 0) continue;
        
        const hasActive = allLoans.some(l => l.status === LOAN_STATUS.ACTIVE);
        if (hasActive) continue;
        
        const totalDue = round2(allLoans.reduce((s, l) => s + getTotalDue(l), 0));
        const totalPaid = round2(allLoans.reduce((s, l) => s + getPaidAmount(l), 0));
        const totalBalance = round2(allLoans.reduce((s, l) => s + getBalance(l), 0));
        
        result.push({
            employeeId: emp.id,
            name: emp.name,
            number: emp.number,
            loanCount: allLoans.length,
            totalDue,
            totalPaid,
            totalBalance
        });
    }
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return result;
}

/** Get the interest amount of a single loan. */
export function getInterestAmount(loan) {
    const terms = getActiveLoanTerms(loan);
    return terms.interestIncluded ? 0 : round2(terms.principal * terms.interestRate / 100);
}

/** Sum of interest for all currently active loans. */
export function getTotalActiveInterest(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .filter(l => l.status === LOAN_STATUS.ACTIVE)
            .reduce((s, l) => s + getInterestAmount(l), 0)
    );
}

/** Sum of interest for all historical loans (active, paid, written-off). */
export function getTotalHistoricalInterest(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .reduce((s, l) => s + getInterestAmount(l), 0)
    );
}

/** Sum of totalDue for all historical loans. */
export function getTotalHistoricalDue(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .reduce((s, l) => s + getTotalDue(l), 0)
    );
}

/** Sum of paidAmount for all historical loans. */
export function getTotalHistoricalPaid(state) {
    return round2(
        (state.employees || [])
            .flatMap(e => e.loans || [])
            .reduce((s, l) => s + getPaidAmount(l), 0)
    );
}

/** Number of closed loans (paid or written-off). */
export function getClosedLoansCount(state) {
    return (state.employees || [])
        .flatMap(e => e.loans || [])
        .filter(l => l.status === LOAN_STATUS.PAID || l.status === LOAN_STATUS.WRITTEN_OFF)
        .length;
}
