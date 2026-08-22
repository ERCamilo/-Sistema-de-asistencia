import { buildPayrollClosure, PAYROLL_CLOSURE_STATUS, voidPayrollClosure } from './PayrollClosure.js';
import {
    applyPayrollLoanSettlementBatch,
    buildPayrollLoanSettlementBatch,
    buildPayrollPreviewFingerprint,
    undoPayrollLoanSettlementBatch
} from './PayrollLoanSettlement.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';
import { buildPayrollAdjustmentSnapshot } from './PayrollClosureAdjustments.js';
import {
    applyPayrollAdjustmentInstallmentsForClosure,
    undoPayrollAdjustmentInstallmentsForClosure
} from './PayrollAdjustmentInstallmentSettlement.js';

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

function hasClosedPayrollClosureSuccessor(closures, closureId) {
    const byId = new Map((closures || []).filter(item => item?.id).map(item => [item.id, item]));
    return (closures || []).some(candidate => {
        if (candidate?.status !== PAYROLL_CLOSURE_STATUS.CLOSED) return false;
        let ancestor = candidate;
        while (ancestor?.supersedesId) {
            if (ancestor.supersedesId === closureId) return true;
            ancestor = byId.get(ancestor.supersedesId);
        }
        return false;
    });
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
    const invalidCount = rows.filter(item => money(item?.monto) < 0).length;
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
    bonuses = [],
    deductions = [],
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
        adjustments: buildPayrollAdjustmentSnapshot({ rows, bonuses, deductions }),
        supersedesId
    });
    assertPayrollClosureSize(closure);
    return {
        closure,
        batch: loanBatch ? {
            ...loanBatch,
            closureId: closure.id,
            supersedesClosureId: supersedesId || null
        } : null
    };
}

export function applyPayrollClosureEffects(employees, draft, {
    now = Date.now(),
    recordedBy = null
} = {}) {
    if (!draft?.closure?.id) throw new Error('El cierre de Nómina no es válido');
    let loanResult = null;
    if (draft.batch) {
        loanResult = applyPayrollLoanSettlementBatch(employees, draft.batch, {
            now,
            recordedBy
        });
    }
    const installmentResult = applyPayrollAdjustmentInstallmentsForClosure(
        employees,
        draft.closure,
        { now, recordedBy }
    );
    const affected = new Set([
        ...(draft.batch?.employees || []).map(item => String(item.employeeId)),
        ...installmentResult.affectedEmployeeIds
    ]);
    return {
        loanResult,
        appliedInstallmentCount: installmentResult.appliedCount,
        relinkedInstallmentCount: installmentResult.relinkedCount,
        affectedEmployeeIds: [...affected].sort((left, right) =>
            left.localeCompare(right, 'es', { numeric: true })
        )
    };
}

export function undoPayrollClosureEffects(employees, closure, {
    now = Date.now(),
    voidedBy = null,
    voidReason = 'Cierre anulado',
    activeClosures = []
} = {}) {
    if (!closure?.id) throw new Error('El cierre de Nómina no es válido');
    if (closure.status !== PAYROLL_CLOSURE_STATUS.CLOSED) {
        throw new Error('El cierre ya fue anulado y no se puede deshacer nuevamente');
    }
    if (hasClosedPayrollClosureSuccessor(activeClosures, closure.id)) {
        throw new Error('El cierre tiene una corrección vigente y no se puede deshacer');
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
    const installmentResult = undoPayrollAdjustmentInstallmentsForClosure(
        employees,
        closure,
        { now, voidedBy }
    );
    const affected = new Set([
        ...(closure.paymentRefs || []).map(ref => String(ref.employeeId)),
        ...installmentResult.affectedEmployeeIds
    ]);
    return {
        closure: voidPayrollClosure(closure, { voidedAt: now, voidedBy, voidReason }),
        voidedPaymentCount,
        revertedInstallmentCount: installmentResult.revertedCount,
        affectedEmployeeIds: [...affected].sort((left, right) =>
            left.localeCompare(right, 'es', { numeric: true })
        ),
        voidedBonusCount: (closure.rows || []).reduce(
            (count, row) => count + (row.bonusDetails || []).length,
            0
        ),
        voidedDeductionCount: (closure.rows || []).reduce(
            (count, row) => count + (row.deductionDetails || []).length,
            0
        )
    };
}

export default {
    applyPayrollClosureEffects,
    buildPayrollClosureDraft,
    getEffectivePayrollClosures,
    getPayrollClosureGate,
    undoPayrollClosureEffects
};
