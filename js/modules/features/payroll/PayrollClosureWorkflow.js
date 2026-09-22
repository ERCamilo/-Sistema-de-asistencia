import { buildPayrollClosure, canonicalProjectId, PAYROLL_CLOSURE_STATUS, voidPayrollClosure } from './PayrollClosure.js';
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
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { captureEntityProjectScope, entityInScope } from '../projects/EntityProjectScope.js';

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
    supersedesId = null,
    projectId
} = {}) {
    if (isProjectsEnabled() && !projectId) {
        assertTandaBBlockedWhenScoped('PayrollClosureWorkflow.buildPayrollClosureDraft');
    }
    const closureProjectId = projectId !== undefined ? canonicalProjectId(projectId) : undefined;
    const projectAware = closureProjectId !== undefined;
    const operationScope = (isProjectsEnabled() && closureProjectId)
        ? { ...captureEntityProjectScope(), enabled: true, projectId: closureProjectId }
        : null;
    const filteredEmployees = operationScope
        ? (employees || []).filter(e => entityInScope(e, operationScope))
        : (employees || []);
    if (operationScope) {
        const allowedEmployeeIds = new Set(filteredEmployees.map(e => String(e.id)));
        const foreignRow = (rows || []).find(row => !allowedEmployeeIds.has(String(row?._employeeId ?? row?.employeeId ?? row?.id ?? '')));
        if (foreignRow) throw new Error(`El empleado "${foreignRow?._employeeId ?? foreignRow?.employeeId ?? foreignRow?.id ?? 'desconocido'}" no pertenece al proyecto "${closureProjectId}"`);
    }
    const fingerprint = projectAware
        ? buildPayrollPreviewFingerprint({ projectId: closureProjectId, periodStart, periodEnd, rows })
        : buildPayrollPreviewFingerprint({ periodStart, periodEnd, rows });
    const hasLoans = rows.some(item => money(item?._loans) > 0);
    const loanBatch = hasLoans ? buildPayrollLoanSettlementBatch({
        employees: filteredEmployees,
        rows,
        periodStart,
        periodEnd,
        createdAt: closedAt,
        recordedBy: closedBy,
        ...(projectAware ? { projectId: closureProjectId } : {})
    }) : null;
    const closureOptions = {
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
    };
    if (projectAware) closureOptions.projectId = closureProjectId;
    const closure = buildPayrollClosure(closureOptions);
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
    const isScoped = isProjectsEnabled();
    const closureProjectId = draft?.closure?.projectId;
    if (isScoped && !closureProjectId) {
        assertTandaBBlockedWhenScoped('PayrollClosureWorkflow.applyPayrollClosureEffects');
    }
    if (!draft?.closure?.id) throw new Error('El cierre de Nómina no es válido');
    const canonicalOwner = closureProjectId ? canonicalProjectId(closureProjectId) : null;
    const operationScope = (isScoped && canonicalOwner)
        ? { ...captureEntityProjectScope(), enabled: true, projectId: canonicalOwner }
        : null;
    const scopedEmployees = operationScope
        ? (employees || []).filter(e => entityInScope(e, operationScope))
        : (employees || []);
    if (operationScope) {
        const allowedEmployeeIds = new Set(scopedEmployees.map(e => String(e.id)));
        const foreignRow = (draft?.closure?.rows || []).find(row => !allowedEmployeeIds.has(String(row?._employeeId ?? row?.employeeId ?? row?.id ?? '')));
        if (foreignRow) throw new Error(`El empleado "${foreignRow?._employeeId ?? foreignRow?.employeeId ?? foreignRow?.id ?? 'desconocido'}" no pertenece al proyecto "${canonicalOwner}"`);
    }
    let loanResult = null;
    if (draft.batch) {
        if (canonicalOwner && !draft.batch.projectId) {
            draft.batch.projectId = canonicalOwner;
        }
        loanResult = applyPayrollLoanSettlementBatch(scopedEmployees, draft.batch, {
            now,
            recordedBy
        });
    }
    let installmentResult = { appliedCount: 0, relinkedCount: 0, affectedEmployeeIds: [] };
    const hasAdjustmentInstallments = (draft.closure.adjustments?.bonuses || []).some(b => b.installments?.length) ||
        (draft.closure.adjustments?.deductions || []).some(d => d.installments?.length);
    if (!isScoped || hasAdjustmentInstallments) {
        installmentResult = applyPayrollAdjustmentInstallmentsForClosure(
            scopedEmployees,
            draft.closure,
            { now, recordedBy }
        );
    }
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
    const isScoped = isProjectsEnabled();
    const closureProjectId = closure?.projectId;
    if (isScoped && !closureProjectId) {
        assertTandaBBlockedWhenScoped('PayrollClosureWorkflow.undoPayrollClosureEffects');
    }
    if (!closure?.id) throw new Error('El cierre de Nómina no es válido');
    if (closure.status !== PAYROLL_CLOSURE_STATUS.CLOSED) {
        throw new Error('El cierre ya fue anulado y no se puede deshacer nuevamente');
    }
    if (hasClosedPayrollClosureSuccessor(activeClosures, closure.id)) {
        throw new Error('El cierre tiene una corrección vigente y no se puede deshacer');
    }
    const canonicalOwner = closureProjectId ? canonicalProjectId(closureProjectId) : null;
    const operationScope = (isScoped && canonicalOwner)
        ? { ...captureEntityProjectScope(), enabled: true, projectId: canonicalOwner }
        : null;
    const scopedEmployees = operationScope
        ? (employees || []).filter(e => entityInScope(e, operationScope))
        : (employees || []);
    if (operationScope) {
        const allowedEmployeeIds = new Set(scopedEmployees.map(e => String(e.id)));
        const foreignRow = (closure?.rows || []).find(row => !allowedEmployeeIds.has(String(row?._employeeId ?? row?.employeeId ?? row?.id ?? '')));
        if (foreignRow) throw new Error(`El empleado "${foreignRow?._employeeId ?? foreignRow?.employeeId ?? foreignRow?.id ?? 'desconocido'}" no pertenece al proyecto "${canonicalOwner}"`);
    }
    let voidedPaymentCount = 0;
    if (closure.loanSettlementBatchId) {
        const result = undoPayrollLoanSettlementBatch(
            scopedEmployees,
            closure.loanSettlementBatchId,
            { now, voidedBy }
        );
        voidedPaymentCount = result.voidedCount;
    }
    let installmentResult = { revertedCount: 0, affectedEmployeeIds: [] };
    const hasAdjustmentInstallments = (closure.adjustments?.bonuses || []).some(b => b.installments?.length) ||
        (closure.adjustments?.deductions || []).some(d => d.installments?.length);
    if (!isScoped || hasAdjustmentInstallments) {
        installmentResult = undoPayrollAdjustmentInstallmentsForClosure(
            scopedEmployees,
            closure,
            { now, voidedBy }
        );
    }
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
