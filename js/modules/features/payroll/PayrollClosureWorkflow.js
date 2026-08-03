import { buildPayrollClosure, PAYROLL_CLOSURE_STATUS, voidPayrollClosure } from './PayrollClosure.js';
import {
    buildPayrollLoanSettlementBatch,
    buildPayrollPreviewFingerprint,
    undoPayrollLoanSettlementBatch
} from './PayrollLoanSettlement.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

export function getEffectivePayrollClosures(closures = []) {
    const closed = (closures || []).filter(item =>
        item?.id && item.status === PAYROLL_CLOSURE_STATUS.CLOSED
    );
    const supersededIds = new Set(closed.map(item => item.supersedesId).filter(Boolean));
    return closed
        .filter(item => !supersededIds.has(item.id))
        .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0));
}

export function getPayrollClosureGate({
    rows = [],
    fingerprint = '',
    paidConfirmation = null,
    activeClosures = [],
    correctionSupersedesId = null,
    historyReady = true,
    inProgress = false
} = {}) {
    const effectiveClosures = getEffectivePayrollClosures(activeClosures);
    const activeClosure = effectiveClosures[0] || null;
    const exactClosure = effectiveClosures.find(item => item.fingerprint === fingerprint) || null;
    const invalidCount = rows.filter(item => money(item?.monto) <= 0).length;
    const payrollPaid = Boolean(fingerprint && paidConfirmation?.fingerprint === fingerprint);
    const hasLoans = rows.some(item => money(item?._loans) > 0);
    const correctionReady = Boolean(
        activeClosure && correctionSupersedesId === activeClosure.id && !exactClosure
    );
    const latestClosure = [...(activeClosures || [])]
        .filter(item => item?.id)
        .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0))[0] || null;
    const nextSupersedesId = correctionReady
        ? activeClosure.id
        : (!activeClosure ? latestClosure?.id || null : null);

    let reason = null;
    if (rows.length === 0) reason = 'no-rows';
    else if (invalidCount > 0) reason = 'invalid-net';
    else if (!historyReady) reason = 'history-loading';
    else if (inProgress) reason = 'in-progress';
    else if (!payrollPaid) reason = 'payroll-not-confirmed';
    else if (exactClosure) reason = 'already-closed';
    else if (activeClosure && !correctionReady) reason = 'correction-required';

    return {
        enabled: reason === null,
        hasRows: rows.length > 0,
        hasLoans,
        invalidCount,
        payrollPaid,
        activeClosure,
        exactClosure,
        correctionReady,
        nextSupersedesId,
        reason
    };
}

export function buildPayrollClosureDraft({
    employees = [],
    rows = [],
    periodStart,
    periodEnd,
    periodSource = 'custom',
    closedAt = Date.now(),
    closedBy = null,
    supersedesId = null
} = {}) {
    const fingerprint = buildPayrollPreviewFingerprint({ periodStart, periodEnd, rows });
    const hasLoans = rows.some(item => money(item?._loans) > 0);
    const loanBatch = hasLoans ? buildPayrollLoanSettlementBatch({
        employees,
        rows,
        periodStart,
        periodEnd,
        createdAt: closedAt,
        recordedBy: closedBy
    }) : null;
    const closure = buildPayrollClosure({
        periodStart,
        periodEnd,
        periodSource,
        rows,
        fingerprint,
        closedAt,
        closedBy,
        loanSettlementBatchId: loanBatch?.id || null,
        paymentRefs: loanBatch?.paymentRefs || [],
        supersedesId
    });
    assertPayrollClosureSize(closure);
    return {
        closure,
        batch: loanBatch ? { ...loanBatch, closureId: closure.id } : null
    };
}

export function undoPayrollClosureEffects(employees, closure, {
    now = Date.now(),
    voidedBy = null,
    voidReason = 'Cierre anulado'
} = {}) {
    if (!closure?.id) throw new Error('El cierre de Nómina no es válido');
    if (Number(now) > Number(closure.undoUntil || 0)) {
        throw new Error('El período para deshacer este cierre expiró');
    }
    let voidedPaymentCount = 0;
    if (closure.loanSettlementBatchId) {
        const result = undoPayrollLoanSettlementBatch(
            employees,
            closure.loanSettlementBatchId,
            { now, voidedBy }
        );
        voidedPaymentCount = result.voidedCount;
    }
    return {
        closure: voidPayrollClosure(closure, { voidedAt: now, voidedBy, voidReason }),
        voidedPaymentCount
    };
}

export default {
    buildPayrollClosureDraft,
    getEffectivePayrollClosures,
    getPayrollClosureGate,
    undoPayrollClosureEffects
};
