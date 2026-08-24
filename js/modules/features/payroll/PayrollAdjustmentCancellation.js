import {
    ADJUSTMENT_INSTALLMENT_STATUS,
    ADJUSTMENT_PLAN_STATUS,
    isPayrollAdjustmentInstallmentPlan
} from './PayrollAdjustmentInstallmentPlan.js';
import { MAX_TOMBSTONES_PER_FIELD } from '../../services/NestedTombstones.js';

const VALID_KINDS = new Set(['bonuses', 'deductions']);

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

export function hasPayrollAdjustmentPlanMovement(plan) {
    return Boolean(
        (Array.isArray(plan?.history) && plan.history.length > 0) ||
        Number(plan?.appliedAmount) > 0 ||
        (Array.isArray(plan?.installments) && plan.installments.some(item =>
            Number(item?.appliedAmount) > 0 ||
            item?.status === ADJUSTMENT_INSTALLMENT_STATUS.APPLIED
        ))
    );
}

function normalizedMember(member = {}) {
    return {
        employeeId: text(member.employeeId),
        planId: text(member.planId),
        groupId: text(member.groupId),
        updatedAt: Number(member.updatedAt)
    };
}

function addTombstone(employee, kind, planId) {
    const deletedItemIds = { ...(employee.deletedItemIds || {}) };
    const existing = Array.isArray(deletedItemIds[kind]) ? [...deletedItemIds[kind]] : [];
    if (!existing.includes(planId)) existing.push(planId);
    deletedItemIds[kind] = existing.slice(-MAX_TOMBSTONES_PER_FIELD);
    return deletedItemIds;
}

/**
 * Builds one atomic employee collection update. Every referenced member is
 * validated before a copy is changed. Virgin plans are deleted with a
 * tombstone; plans with any audit movement become final cancellations.
 */
export function removeOrCancelPayrollAdjustmentPlans(employees = [], {
    kind,
    members = [],
    now = Date.now(),
    actor = null,
    reason = null
} = {}) {
    if (!VALID_KINDS.has(kind)) throw new Error('El tipo de programación no es válido');
    const timestamp = Number(now);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new Error('La fecha de cancelación no es válida');
    }
    const targets = (Array.isArray(members) ? members : []).map(normalizedMember);
    if (targets.length === 0 || targets.some(item =>
        !item.employeeId || !item.planId || !item.groupId || !Number.isFinite(item.updatedAt)
    )) {
        throw new Error('La programación cambió. Ábrela nuevamente e inténtalo otra vez.');
    }
    const unique = new Set(targets.map(item => `${item.employeeId}:${item.planId}`));
    if (unique.size !== targets.length) {
        throw new Error('La programación cambió. Ábrela nuevamente e inténtalo otra vez.');
    }

    const employeeById = new Map((employees || []).map(employee => [text(employee?.id), employee]));
    const operations = targets.map(target => {
        const employee = employeeById.get(target.employeeId);
        const plan = (Array.isArray(employee?.[kind]) ? employee[kind] : [])
            .find(item => text(item?.id) === target.planId);
        if (!employee || !isPayrollAdjustmentInstallmentPlan(plan) ||
            text(plan.employeeId) !== target.employeeId || plan.kind !== kind ||
            text(plan.groupId) !== target.groupId || Number(plan.updatedAt) !== target.updatedAt) {
            throw new Error('La programación cambió. Ábrela nuevamente e inténtalo otra vez.');
        }
        if (plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED) {
            throw new Error('Un pago programado completado no se puede quitar.');
        }
        if (plan.status === ADJUSTMENT_PLAN_STATUS.CANCELLED) {
            throw new Error('La programación ya fue cancelada.');
        }
        return { target, employee, plan, cancel: hasPayrollAdjustmentPlanMovement(plan) };
    });

    const byEmployee = new Map();
    operations.forEach(operation => {
        if (!byEmployee.has(operation.target.employeeId)) byEmployee.set(operation.target.employeeId, []);
        byEmployee.get(operation.target.employeeId).push(operation);
    });
    let deletedCount = 0;
    let cancelledCount = 0;
    const employeesOut = (employees || []).map(employee => {
        const employeeOperations = byEmployee.get(text(employee?.id));
        if (!employeeOperations) return employee;
        const operationByPlan = new Map(employeeOperations.map(item => [item.target.planId, item]));
        let deletedItemIds = employee.deletedItemIds;
        const plans = [];
        for (const plan of (Array.isArray(employee[kind]) ? employee[kind] : [])) {
            const operation = operationByPlan.get(text(plan?.id));
            if (!operation) {
                plans.push(plan);
                continue;
            }
            if (!operation.cancel) {
                deletedCount++;
                deletedItemIds = addTombstone({ deletedItemIds }, kind, text(plan.id));
                continue;
            }
            cancelledCount++;
            plans.push({
                ...plan,
                status: ADJUSTMENT_PLAN_STATUS.CANCELLED,
                cancellation: {
                    cancelledAt: timestamp,
                    cancelledBy: actor == null ? null : text(actor),
                    reason: reason == null || text(reason).trim() === '' ? null : text(reason).trim()
                },
                updatedAt: timestamp
            });
        }
        const nextEmployee = { ...employee, [kind]: plans, updatedAt: timestamp };
        if (deletedItemIds) nextEmployee.deletedItemIds = deletedItemIds;
        return nextEmployee;
    });

    return { employees: employeesOut, deletedCount, cancelledCount };
}

export default {
    hasPayrollAdjustmentPlanMovement,
    removeOrCancelPayrollAdjustmentPlans
};
