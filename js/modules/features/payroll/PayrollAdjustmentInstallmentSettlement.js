import {
    ADJUSTMENT_INSTALLMENT_STATUS,
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    getPayrollAdjustmentInstallmentAppliedAmount,
    getPayrollAdjustmentInstallmentRemainingAmount,
    isPayrollAdjustmentInstallmentPlan,
    recomputePayrollAdjustmentInstallmentPlan
} from './PayrollAdjustmentInstallmentPlan.js';
import {
    getPayrollAdjustmentPendingInstallments,
    resolvePayrollAdjustmentPeriodApplication
} from './PayrollAdjustmentPeriodSelection.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';

export const ADJUSTMENT_INSTALLMENT_APPLICATION_RECORD_TYPE =
    'payroll-adjustment-installment-application';

const KINDS = Object.freeze({
    [ADJUSTMENT_PLAN_KIND.BONUS]: 'bonusDetails',
    [ADJUSTMENT_PLAN_KIND.DEDUCTION]: 'deductionDetails'
});

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function sameEmployee(left, right) {
    return text(left) !== '' && text(left) === text(right);
}

function isCanonicalEmployeePlan(plan, employeeId, kind, { requireActive = true } = {}) {
    return Boolean(
        isPayrollAdjustmentInstallmentPlan(plan) &&
        sameEmployee(plan.employeeId, employeeId) &&
        plan.kind === kind &&
        plan.type === 'fixed' &&
        (requireActive
            ? plan.status === ADJUSTMENT_PLAN_STATUS.ACTIVE
            : [
                ADJUSTMENT_PLAN_STATUS.ACTIVE,
                ADJUSTMENT_PLAN_STATUS.PAUSED,
                ADJUSTMENT_PLAN_STATUS.COMPLETED,
                ADJUSTMENT_PLAN_STATUS.CANCELLED
            ].includes(plan.status)) &&
        Array.isArray(plan.installments) &&
        Array.isArray(plan.history)
    );
}

function isActiveApplication(entry) {
    return Boolean(
        entry?.action === 'applied' &&
        entry.source === 'payroll' &&
        entry.voided !== true &&
        text(entry.installmentId)
    );
}

function applicationsForPeriod(plan, periodStart, periodEnd) {
    return plan.history.filter(entry =>
        isActiveApplication(entry) &&
        text(entry.payrollPeriodStart) === text(periodStart) &&
        text(entry.payrollPeriodEnd) === text(periodEnd)
    ).sort((left, right) =>
        (Number(left.sequence) || 0) - (Number(right.sequence) || 0) ||
        text(left.installmentId).localeCompare(text(right.installmentId), 'es', { numeric: true })
    );
}

function detailFor(
    plan,
    installment,
    employeeId,
    kind,
    periodStart,
    periodEnd,
    payrollApplication = null
) {
    const amount = payrollApplication
        ? money(payrollApplication.amount)
        : installment.status === ADJUSTMENT_INSTALLMENT_STATUS.APPLIED
            ? getPayrollAdjustmentInstallmentAppliedAmount(installment)
            : getPayrollAdjustmentInstallmentRemainingAmount(installment);
    return {
        recordType: ADJUSTMENT_INSTALLMENT_APPLICATION_RECORD_TYPE,
        id: text(installment.id),
        planId: text(plan.id),
        groupId: text(plan.groupId),
        installmentId: text(installment.id),
        employeeId: text(employeeId),
        kind,
        name: text(plan.name),
        type: 'fixed',
        value: amount,
        amount,
        scope: 'employee',
        targetId: text(employeeId),
        sequence: Number(installment.sequence) || 0,
        installmentCount: Number(plan.installmentCount) || plan.installments.length,
        source: 'payroll-adjustment-installment',
        payrollPeriodStart: text(periodStart),
        payrollPeriodEnd: text(periodEnd)
    };
}

function previewDetails(employee, kind, periodStart, periodEnd, selections) {
    if (!text(periodStart) || !text(periodEnd) || text(periodStart) > text(periodEnd)) return [];
    return (Array.isArray(employee?.[kind]) ? employee[kind] : [])
        .filter(plan => isCanonicalEmployeePlan(
            plan, employee?.id, kind, { requireActive: false }
        ))
        .flatMap(plan => {
            const existing = applicationsForPeriod(plan, periodStart, periodEnd);
            if (existing.length > 0) {
                return existing.map(application => {
                    const applied = plan.installments.find(item =>
                        text(item?.id) === text(application.installmentId) &&
                        item.status === ADJUSTMENT_INSTALLMENT_STATUS.APPLIED
                    );
                    return applied ? detailFor(
                        plan,
                        applied,
                        employee.id,
                        kind,
                        periodStart,
                        periodEnd,
                        application
                    ) : null;
                }).filter(Boolean);
            }
            if (plan.status !== ADJUSTMENT_PLAN_STATUS.ACTIVE) return [];
            if (text(periodStart) < text(plan.firstPeriodStart)) return [];
            const application = resolvePayrollAdjustmentPeriodApplication(plan, {
                kind,
                employeeId: employee.id,
                periodStart,
                periodEnd,
                selections
            });
            return application.installments.map(installment => detailFor(
                plan, installment, employee.id, kind, periodStart, periodEnd
            ));
        })
        .sort((left, right) =>
            left.planId.localeCompare(right.planId, 'es', { numeric: true }) ||
            left.sequence - right.sequence ||
            left.installmentId.localeCompare(right.installmentId, 'es', { numeric: true })
        );
}

export function buildPayrollAdjustmentInstallmentPreview(employee, {
    periodStart,
    periodEnd,
    selections = []
} = {}) {
    const bonusDetails = previewDetails(
        employee, ADJUSTMENT_PLAN_KIND.BONUS, periodStart, periodEnd, selections
    );
    const deductionDetails = previewDetails(
        employee, ADJUSTMENT_PLAN_KIND.DEDUCTION, periodStart, periodEnd, selections
    );
    return {
        bonusTotal: money(bonusDetails.reduce((sum, item) => sum + item.amount, 0)),
        deductionTotal: money(deductionDetails.reduce((sum, item) => sum + item.amount, 0)),
        bonusDetails,
        deductionDetails
    };
}

function closureDetails(closure) {
    const result = [];
    const seen = new Map();
    for (const row of (closure?.rows || [])) {
        for (const [kind, detailsKey] of Object.entries(KINDS)) {
            for (const detail of (row?.[detailsKey] || [])) {
                if (detail?.recordType !== ADJUSTMENT_INSTALLMENT_APPLICATION_RECORD_TYPE) continue;
                const rowEmployeeId = text(row.employeeId);
                const detailEmployeeId = text(detail.employeeId || rowEmployeeId);
                if (rowEmployeeId && detailEmployeeId !== rowEmployeeId) {
                    throw new Error(`La cuota ${detail.installmentId || detail.id} pertenece a otro empleado`);
                }
                if (detail.kind && detail.kind !== kind) {
                    throw new Error(`La cuota ${detail.installmentId || detail.id} está en otra categoría`);
                }
                const normalized = {
                    ...detail,
                    employeeId: detailEmployeeId,
                    kind,
                    planId: text(detail.planId),
                    installmentId: text(detail.installmentId || detail.id),
                    amount: money(detail.amount),
                    payrollPeriodStart: text(detail.payrollPeriodStart || closure.periodStart),
                    payrollPeriodEnd: text(detail.payrollPeriodEnd || closure.periodEnd)
                };
                const key = `${normalized.employeeId}:${kind}:${normalized.planId}:${normalized.installmentId}`;
                const previous = seen.get(key);
                if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
                    throw new Error(`La cuota ${normalized.installmentId} está duplicada con datos diferentes`);
                }
                if (!previous) {
                    seen.set(key, normalized);
                    result.push(normalized);
                }
            }
        }
    }
    return result;
}

function findPlanTarget(employeeById, detail, { requireActive = false } = {}) {
    const employee = employeeById.get(detail.employeeId);
    if (!employee) throw new Error(`El empleado ${detail.employeeId} ya no existe`);
    const plan = (employee[detail.kind] || []).find(item => text(item?.id) === detail.planId);
    if (!isCanonicalEmployeePlan(plan, employee.id, detail.kind, { requireActive })) {
        throw new Error(`El plan ${detail.planId} ya no es válido para este empleado`);
    }
    const installment = plan.installments.find(item => text(item?.id) === detail.installmentId);
    if (!installment) throw new Error(`La cuota ${detail.installmentId} ya no existe`);
    return { employee, plan, installment };
}

function historyId(plan, installment, closure) {
    return [
        'ADJ-HISTORY',
        text(plan.id),
        text(installment.id),
        text(closure.id),
        text(closure.periodStart),
        text(closure.periodEnd)
    ].join(':');
}

function preflightApplication(employees, closure) {
    if (!closure?.id || !closure?.periodStart || !closure?.periodEnd) {
        throw new Error('El cierre de Nómina no es válido');
    }
    const employeeById = new Map((employees || []).map(item => [text(item?.id), item]));
    const operations = closureDetails(closure).map(detail => {
        if (detail.payrollPeriodStart !== text(closure.periodStart) ||
            detail.payrollPeriodEnd !== text(closure.periodEnd)) {
            throw new Error(`La cuota ${detail.installmentId} pertenece a otro período`);
        }
        const target = findPlanTarget(employeeById, detail);
        const { plan, installment } = target;
        const existing = plan.history.find(entry =>
            isActiveApplication(entry) && text(entry.installmentId) === text(installment.id)
        );
        if (existing && (
            money(existing.amount) !== detail.amount ||
            installment.status !== ADJUSTMENT_INSTALLMENT_STATUS.APPLIED ||
            getPayrollAdjustmentInstallmentAppliedAmount(installment) < detail.amount
        )) {
            throw new Error(`La cuota ${detail.installmentId} cambió desde la vista previa`);
        }
        if (existing) {
            if (text(existing.payrollClosureId) === text(closure.id)) {
                return { ...target, detail, history: existing, operation: 'existing' };
            }
            if (closure.supersedesId &&
                text(existing.payrollClosureId) === text(closure.supersedesId) &&
                text(existing.payrollPeriodStart) === text(closure.periodStart) &&
                text(existing.payrollPeriodEnd) === text(closure.periodEnd)) {
                return { ...target, detail, history: existing, operation: 'relink' };
            }
            throw new Error(`La cuota ${detail.installmentId} ya pertenece a otra Nómina`);
        }
        if (plan.status !== ADJUSTMENT_PLAN_STATUS.ACTIVE ||
            installment.status !== ADJUSTMENT_INSTALLMENT_STATUS.PENDING ||
            text(periodStartFor(plan)) > text(closure.periodStart) ||
            getPayrollAdjustmentInstallmentRemainingAmount(installment) !== detail.amount) {
            throw new Error(`La cuota ${detail.installmentId} cambió desde la vista previa`);
        }
        return { ...target, detail, history: null, operation: 'apply' };
    });

    const applyGroups = new Map();
    for (const operation of operations.filter(item => item.operation === 'apply')) {
        const key = [
            operation.detail.employeeId,
            operation.detail.kind,
            operation.detail.planId
        ].join(':');
        if (!applyGroups.has(key)) applyGroups.set(key, []);
        applyGroups.get(key).push(operation);
    }
    for (const group of applyGroups.values()) {
        const plan = group[0].plan;
        if (applicationsForPeriod(plan, closure.periodStart, closure.periodEnd).length > 0) {
            throw new Error(`El plan ${plan.id} ya tiene aplicaciones en este período`);
        }
        const requested = [...group].sort((left, right) =>
            left.detail.sequence - right.detail.sequence ||
            left.detail.installmentId.localeCompare(
                right.detail.installmentId, 'es', { numeric: true }
            )
        );
        const pending = getPayrollAdjustmentPendingInstallments(plan).slice(0, requested.length);
        if (pending.length !== requested.length || requested.some((operation, index) =>
            text(operation.detail.installmentId) !== text(pending[index]?.id)
        )) {
            throw new Error(`Las cuotas del plan ${plan.id} cambiaron desde la vista previa`);
        }
    }
    return operations;
}

function periodStartFor(plan) {
    return text(plan.firstPeriodStart);
}

export function applyPayrollAdjustmentInstallmentsForClosure(employees, closure, {
    now = Date.now(),
    recordedBy = null
} = {}) {
    assertTandaBBlockedWhenScoped('PayrollAdjustmentInstallmentSettlement.applyPayrollAdjustmentInstallmentsForClosure');
    const operations = preflightApplication(employees, closure);
    const timestamp = Number(now) || Date.now();
    const affected = new Set();
    let appliedCount = 0;
    let relinkedCount = 0;

    for (const operation of operations) {
        if (operation.operation === 'existing') continue;
        const { employee, plan, installment, detail } = operation;
        if (operation.operation === 'relink') {
            operation.history.payrollSupersedesClosureId = closure.supersedesId;
            operation.history.payrollClosureId = text(closure.id);
            operation.history.updatedAt = timestamp;
            plan.updatedAt = timestamp;
            employee.updatedAt = timestamp;
            affected.add(text(employee.id));
            relinkedCount++;
            continue;
        }
        const previouslyApplied = getPayrollAdjustmentInstallmentAppliedAmount(installment);
        installment.appliedAmount = money(previouslyApplied + detail.amount);
        installment.status = ADJUSTMENT_INSTALLMENT_STATUS.APPLIED;
        installment.updatedAt = timestamp;
        plan.history.push({
            id: historyId(plan, installment, closure),
            action: 'applied',
            installmentId: text(installment.id),
            sequence: Number(installment.sequence) || 0,
            amount: detail.amount,
            payrollClosureId: text(closure.id),
            payrollSupersedesClosureId: closure.supersedesId ? text(closure.supersedesId) : null,
            payrollPeriodStart: text(closure.periodStart),
            payrollPeriodEnd: text(closure.periodEnd),
            recordedAt: timestamp,
            recordedBy: recordedBy ?? closure.closedBy ?? null,
            source: 'payroll',
            voided: false,
            voidedAt: null,
            voidedBy: null,
            updatedAt: timestamp
        });
        recomputePayrollAdjustmentInstallmentPlan(plan, timestamp);
        employee.updatedAt = timestamp;
        affected.add(text(employee.id));
        appliedCount++;
    }
    return {
        appliedCount,
        relinkedCount,
        affectedEmployeeIds: [...affected].sort((left, right) =>
            left.localeCompare(right, 'es', { numeric: true })
        )
    };
}

export function undoPayrollAdjustmentInstallmentsForClosure(employees, closure, {
    now = Date.now(),
    voidedBy = null
} = {}) {
    assertTandaBBlockedWhenScoped('PayrollAdjustmentInstallmentSettlement.undoPayrollAdjustmentInstallmentsForClosure');
    if (!closure?.id) throw new Error('El cierre de Nómina no es válido');
    const employeeById = new Map((employees || []).map(item => [text(item?.id), item]));
    const operations = closureDetails(closure).map(detail => {
        const target = findPlanTarget(employeeById, detail);
        const history = target.plan.history.find(entry =>
            isActiveApplication(entry) &&
            text(entry.installmentId) === text(detail.installmentId) &&
            text(entry.payrollClosureId) === text(closure.id)
        );
        return history ? { ...target, detail, history } : null;
    }).filter(Boolean);
    const timestamp = Number(now) || Date.now();
    const affected = new Set();

    for (const { employee, plan, installment, history } of operations) {
        history.voided = true;
        history.voidedAt = timestamp;
        history.voidedBy = voidedBy;
        history.updatedAt = timestamp;
        installment.status = ADJUSTMENT_INSTALLMENT_STATUS.PENDING;
        installment.appliedAmount = money(Math.max(
            0,
            getPayrollAdjustmentInstallmentAppliedAmount(installment) - money(history.amount)
        ));
        installment.updatedAt = timestamp;
        recomputePayrollAdjustmentInstallmentPlan(plan, timestamp);
        employee.updatedAt = timestamp;
        affected.add(text(employee.id));
    }
    return {
        revertedCount: operations.length,
        affectedEmployeeIds: [...affected].sort((left, right) =>
            left.localeCompare(right, 'es', { numeric: true })
        )
    };
}

export default {
    applyPayrollAdjustmentInstallmentsForClosure,
    buildPayrollAdjustmentInstallmentPreview,
    undoPayrollAdjustmentInstallmentsForClosure
};
