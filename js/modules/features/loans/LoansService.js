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
    return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
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

    const payment = {
        id: genId('PAY'),
        date: params.date,
        amount: round2(params.amount),
        note: (params.note || '').trim(),
        recordedBy: params.recordedBy || null,
        recordedAt: Date.now(),
        voided: false,
        voidedAt: null
    };
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

    const basis = params.basis === 'balance' ? 'balance' : 'principal';
    const baseAmount = basis === 'balance' ? balance : round2(Number(loan.principal || 0));
    const rate = Number(params.interestRate);
    const interestAmount = round2(baseAmount * rate / 100);

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
        createdAt: Date.now()
    };

    if (!Array.isArray(loan.refinancings)) loan.refinancings = [];
    loan.refinancings.push(event);
    loan.updatedAt = Date.now();
    emp.updatedAt = Date.now();
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

// ─── Derived calculations ────────────────────────────────────────────────────

/** Total amount the loan should collect (principal + interest + refinancing interest). */
export function getTotalDue(loan) {
    const principal = Number(loan.principal || 0);
    const rate = Number(loan.interestRate || 0);
    const interest = loan.interestIncluded ? 0 : (principal * rate / 100);
    return round2(principal + interest + getRefinanceInterest(loan));
}

/** Total interest added by all refinancing events on this loan. */
export function getRefinanceInterest(loan) {
    return round2((loan.refinancings || [])
        .reduce((sum, r) => sum + Number(r.interestAmount || 0), 0));
}

/** Number of times this loan has been refinanced. */
export function getRefinanceCount(loan) {
    return (loan.refinancings || []).length;
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
    const paid = getPaidAmount(loan);
    return Math.max(0, round2(due - paid));
}

/**
 * Returns the next scheduled installment that is due AND unpaid as of
 * `asOfDate` (default: today). For lump-mode loans, returns the remaining
 * balance as a single virtual installment.
 *
 * @returns {{amount: number, dueDate: string, isInstallment: boolean} | null}
 */
export function getNextPayrollDeduction(loan, asOfDate = null) {
    if (loan.status !== LOAN_STATUS.ACTIVE) return null;
    const balance = getBalance(loan);
    if (balance <= 0.01) return null;

    const today = asOfDate || new Date().toISOString().slice(0, 10);

    if (loan.installmentMode !== INSTALLMENT_MODE.INSTALLMENTS) {
        // Lump: deduct the full balance
        return { amount: balance, dueDate: loan.startDate, isInstallment: false };
    }

    // Installments: find the next unpaid installment whose dueDate <= today
    const paid = getPaidAmount(loan);
    let allocated = 0;

    for (const inst of (loan.installments || [])) {
        const instUpperBound = round2(allocated + inst.scheduledAmount);
        // This installment is "paid" if `paid >= instUpperBound`.
        if (paid >= instUpperBound) {
            allocated = instUpperBound;
            continue;
        }
        // It's partially paid or unpaid. If it's due, that's our target.
        if (inst.dueDate <= today) {
            const remainingOfThisInst = round2(instUpperBound - paid);
            return {
                amount: Math.min(remainingOfThisInst, balance),
                dueDate: inst.dueDate,
                isInstallment: true,
                installmentSeq: inst.seq
            };
        }
        break; // future installment, not due yet
    }
    return null;
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
    const principal = Number(loan.principal || 0);
    const rate = Number(loan.interestRate || 0);
    return loan.interestIncluded ? 0 : round2(principal * rate / 100);
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
