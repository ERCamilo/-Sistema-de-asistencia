import {
    ADJUSTMENT_INSTALLMENT_STATUS,
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    getPayrollAdjustmentInstallmentAppliedAmount,
    getPayrollAdjustmentInstallmentRemainingAmount,
    isPayrollAdjustmentInstallmentPlan,
    recomputePayrollAdjustmentInstallmentPlan
} from './PayrollAdjustmentInstallmentPlan.js';

export const MANUAL_ADJUSTMENT_MOVEMENT_RECORD_TYPE =
    'payroll-adjustment-manual-movement';

const VALID_KINDS = new Set(Object.values(ADJUSTMENT_PLAN_KIND));

function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function normalizeDate(value) {
    const normalized = text(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) throw new Error('Selecciona una fecha válida');
    const candidate = new Date(
        Number(match[1]), Number(match[2]) - 1, Number(match[3])
    );
    if (candidate.getFullYear() !== Number(match[1]) ||
        candidate.getMonth() !== Number(match[2]) - 1 ||
        candidate.getDate() !== Number(match[3])) {
        throw new Error('Selecciona una fecha válida');
    }
    return normalized;
}

function findDuplicateMovement(employee, movementId) {
    for (const kind of VALID_KINDS) {
        for (const plan of (Array.isArray(employee?.[kind]) ? employee[kind] : [])) {
            const existing = (Array.isArray(plan?.history) ? plan.history : [])
                .find(entry => text(entry?.id) === movementId);
            if (existing) return existing;
        }
    }
    return null;
}

function validatePlan(employee, input) {
    const kind = text(input.kind);
    if (!VALID_KINDS.has(kind)) {
        throw new Error('Selecciona una bonificación o un descuento válido');
    }
    const planId = text(input.planId);
    const plan = (Array.isArray(employee?.[kind]) ? employee[kind] : [])
        .find(item => text(item?.id) === planId);
    if (!isPayrollAdjustmentInstallmentPlan(plan) || plan.kind !== kind) {
        throw new Error('El plan seleccionado no es válido');
    }
    if (text(plan.employeeId) !== text(employee?.id)) {
        throw new Error('El plan no pertenece a este empleado');
    }
    return { kind, planId, plan };
}

export function applyManualAdjustmentMovement(employee, input = {}, {
    now = Date.now()
} = {}) {
    if (!employee?.id) throw new Error('El empleado no es válido');
    const { kind, planId, plan } = validatePlan(employee, input);
    const movementId = text(input.id);
    if (!movementId) throw new Error('No se pudo identificar el movimiento');

    const duplicate = findDuplicateMovement(employee, movementId);
    if (duplicate) {
        return { employee, movement: duplicate, changed: false };
    }
    if (plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED || money(plan.balance) === 0) {
        throw new Error('Este plan ya está completado');
    }
    if (plan.status !== ADJUSTMENT_PLAN_STATUS.ACTIVE) {
        throw new Error('Este plan no está disponible para registrar movimientos');
    }

    const amount = money(input.amount);
    if (!Number.isFinite(Number(input.amount)) || amount <= 0) {
        throw new Error('El monto debe ser mayor que cero');
    }
    if (amount > money(plan.balance)) {
        throw new Error('El monto no puede ser mayor que el saldo pendiente');
    }
    const date = normalizeDate(input.date);
    const recordedBy = text(input.recordedBy);
    if (!recordedBy) throw new Error('Indica quién registró el movimiento');
    const note = text(input.note);
    const timestamp = Number(now) || Date.now();

    const nextEmployee = clone(employee);
    const nextPlan = nextEmployee[kind].find(item => text(item?.id) === planId);
    let remainingMovement = amount;
    const allocations = [];
    const installments = [...nextPlan.installments].sort((left, right) =>
        (Number(left?.sequence) || 0) - (Number(right?.sequence) || 0) ||
        text(left?.id).localeCompare(text(right?.id), 'es', { numeric: true })
    );

    for (const installment of installments) {
        if (remainingMovement === 0 ||
            installment?.status === ADJUSTMENT_INSTALLMENT_STATUS.CANCELLED) {
            continue;
        }
        const remainingInstallment = getPayrollAdjustmentInstallmentRemainingAmount(installment);
        if (remainingInstallment === 0) continue;
        const applied = money(Math.min(remainingMovement, remainingInstallment));
        installment.appliedAmount = money(
            getPayrollAdjustmentInstallmentAppliedAmount(installment) + applied
        );
        installment.updatedAt = timestamp;
        remainingMovement = money(remainingMovement - applied);
        allocations.push({
            installmentId: text(installment.id),
            sequence: Number(installment.sequence) || 0,
            amount: applied
        });
    }
    if (remainingMovement !== 0) {
        throw new Error('El movimiento no se pudo distribuir entre las cuotas pendientes');
    }

    const movement = {
        id: movementId,
        recordType: MANUAL_ADJUSTMENT_MOVEMENT_RECORD_TYPE,
        action: 'applied',
        source: 'manual',
        movementType: 'manual',
        amount,
        date,
        recordedAt: timestamp,
        recordedBy,
        note: note || null,
        allocations,
        voided: false,
        voidedAt: null,
        voidedBy: null,
        updatedAt: timestamp
    };
    nextPlan.history.push(movement);
    recomputePayrollAdjustmentInstallmentPlan(nextPlan, timestamp);
    nextEmployee.updatedAt = timestamp;
    return { employee: nextEmployee, movement, changed: true };
}

export default {
    applyManualAdjustmentMovement
};
