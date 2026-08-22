export const ADJUSTMENT_PLAN_RECORD_TYPE = 'payroll-adjustment-installment-plan';
export const ADJUSTMENT_PLAN_VERSION = 1;

export const ADJUSTMENT_PLAN_KIND = Object.freeze({
    BONUS: 'bonuses',
    DEDUCTION: 'deductions'
});

export const ADJUSTMENT_PLAN_STATUS = Object.freeze({
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
});

export const ADJUSTMENT_INSTALLMENT_STATUS = Object.freeze({
    PENDING: 'pending',
    APPLIED: 'applied',
    CANCELLED: 'cancelled'
});

const VALID_KINDS = new Set(Object.values(ADJUSTMENT_PLAN_KIND));
const MAX_INSTALLMENTS = 52;

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function moneyToCents(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100);
}


export function normalizeFirstPeriodStart(value) {
    const normalized = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) throw new Error('Selecciona la primera nómina del plan');

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(year, month - 1, day);
    if (
        candidate.getFullYear() !== year ||
        candidate.getMonth() !== month - 1 ||
        candidate.getDate() !== day
    ) {
        throw new Error('Selecciona una primera nómina válida');
    }
    return normalized;
}

function validatePlanInput(input = {}) {
    if (!VALID_KINDS.has(input.kind)) {
        throw new Error('El tipo de ajuste debe ser una bonificación o una deducción individual');
    }
    if (input.type != null && input.type !== 'fixed') {
        throw new Error('Los planes a cuotas solo admiten monto fijo');
    }
    if (input.scope != null && input.scope !== 'employee') {
        throw new Error('Los planes a cuotas solo admiten alcance por empleado');
    }

    const employeeIds = [...new Set(
        (Array.isArray(input.employeeIds) ? input.employeeIds : [])
            .filter(id => id != null && String(id).trim() !== '')
            .map(id => String(id).trim())
    )].sort((left, right) => left.localeCompare(right, 'es', { numeric: true }));
    if (employeeIds.length === 0) {
        throw new Error('Selecciona al menos un empleado');
    }

    const totalAmount = roundMoney(input.totalAmount);
    if (!Number.isFinite(Number(input.totalAmount)) || totalAmount <= 0) {
        throw new Error('El monto total debe ser mayor a cero');
    }

    const installmentCount = Number(input.installmentCount);
    if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > MAX_INSTALLMENTS) {
        throw new Error(`La cantidad de cuotas debe ser un número entero entre 2 y ${MAX_INSTALLMENTS}`);
    }
    if (installmentCount > moneyToCents(totalAmount)) {
        throw new Error('La cantidad de cuotas no puede generar cuotas de valor cero');
    }

    const createdAt = Number(input.createdAt);
    if (!Number.isFinite(createdAt) || createdAt < 0) {
        throw new Error('La fecha de creación del plan es obligatoria');
    }

    return {
        kind: input.kind,
        employeeIds,
        name: String(input.name || '').trim() || (
            input.kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Bonificación' : 'Deducción'
        ),
        totalAmount,
        installmentCount,
        firstPeriodStart: normalizeFirstPeriodStart(input.firstPeriodStart),
        createdAt
    };
}

/**
 * Splits an amount using integer cents. Every installment except the last uses
 * the same floored amount; the last receives the exact remainder.
 */
export function splitAdjustmentInstallments(totalAmount, installmentCount) {
    const cents = moneyToCents(totalAmount);
    const count = Number(installmentCount);
    if (!Number.isInteger(count) || count < 2) {
        throw new Error('La cantidad de cuotas debe ser un número entero mayor a uno');
    }
    if (!Number.isFinite(Number(totalAmount)) || cents <= 0) {
        throw new Error('El monto total debe ser mayor a cero');
    }
    if (count > cents) {
        throw new Error('La cantidad de cuotas no puede generar cuotas de valor cero');
    }

    const regularCents = Math.floor(cents / count);
    const amounts = Array.from({ length: count }, () => regularCents);
    amounts[count - 1] = cents - (regularCents * (count - 1));
    return amounts.map(value => value / 100);
}

function createUniqueId(createId, usedIds, prefix, context) {
    const id = String(createId(prefix, context) ?? '').trim();
    if (!id) throw new Error(`No se pudo crear el identificador ${prefix}`);
    if (usedIds.has(id)) throw new Error(`El identificador generado está duplicado: ${id}`);
    usedIds.add(id);
    return id;
}

/**
 * Creates one independent plan per employee. Dependencies are injected so the
 * same input and id source always produce the same immutable result.
 */
export function createPayrollAdjustmentInstallmentPlans(input = {}, dependencies = {}) {
    const normalized = validatePlanInput(input);
    if (typeof dependencies.createId !== 'function') {
        throw new Error('Se requiere una función para crear identificadores');
    }

    const createId = dependencies.createId;
    const usedIds = new Set();
    const groupId = createUniqueId(createId, usedIds, 'ADJ-GROUP', {
        kind: normalized.kind,
        employeeIds: [...normalized.employeeIds],
        createdAt: normalized.createdAt
    });
    const installmentAmounts = splitAdjustmentInstallments(
        normalized.totalAmount,
        normalized.installmentCount
    );

    return normalized.employeeIds.map((employeeId, employeeIndex) => {
        const id = createUniqueId(createId, usedIds, 'ADJ-PLAN', {
            groupId,
            employeeId,
            employeeIndex,
            kind: normalized.kind
        });
        const installments = installmentAmounts.map((amount, installmentIndex) => ({
            id: createUniqueId(createId, usedIds, 'ADJ-INSTALLMENT', {
                groupId,
                planId: id,
                employeeId,
                installmentIndex
            }),
            sequence: installmentIndex + 1,
            amount,
            appliedAmount: 0,
            status: ADJUSTMENT_INSTALLMENT_STATUS.PENDING
        }));

        return {
            recordType: ADJUSTMENT_PLAN_RECORD_TYPE,
            version: ADJUSTMENT_PLAN_VERSION,
            id,
            groupId,
            employeeId,
            kind: normalized.kind,
            type: 'fixed',
            name: normalized.name,
            totalAmount: normalized.totalAmount,
            balance: normalized.totalAmount,
            appliedAmount: 0,
            installmentCount: normalized.installmentCount,
            firstPeriodStart: normalized.firstPeriodStart,
            appliedInstallments: 0,
            progressPercent: 0,
            status: ADJUSTMENT_PLAN_STATUS.ACTIVE,
            installments,
            history: [],
            createdAt: normalized.createdAt,
            updatedAt: normalized.createdAt
        };
    });
}

export function isPayrollAdjustmentInstallmentPlan(entry) {
    return Boolean(
        entry &&
        typeof entry === 'object' &&
        entry.recordType === ADJUSTMENT_PLAN_RECORD_TYPE &&
        entry.version === ADJUSTMENT_PLAN_VERSION
    );
}

export function getPayrollAdjustmentInstallmentAppliedAmount(installment) {
    const total = roundMoney(installment?.amount || 0);
    const stored = roundMoney(installment?.appliedAmount || 0);
    if (installment?.status === ADJUSTMENT_INSTALLMENT_STATUS.APPLIED && stored === 0) {
        return total;
    }
    return roundMoney(Math.min(total, Math.max(0, stored)));
}

export function getPayrollAdjustmentInstallmentRemainingAmount(installment) {
    return roundMoney(Math.max(
        0,
        roundMoney(installment?.amount || 0) -
            getPayrollAdjustmentInstallmentAppliedAmount(installment)
    ));
}

export function recomputePayrollAdjustmentInstallmentPlan(plan, updatedAt) {
    const installments = Array.isArray(plan?.installments) ? plan.installments : [];
    installments.forEach(installment => {
        if (!installment || installment.status === ADJUSTMENT_INSTALLMENT_STATUS.CANCELLED) return;
        installment.status = getPayrollAdjustmentInstallmentRemainingAmount(installment) === 0
            ? ADJUSTMENT_INSTALLMENT_STATUS.APPLIED
            : ADJUSTMENT_INSTALLMENT_STATUS.PENDING;
    });
    plan.appliedInstallments = installments.filter(item =>
        item?.status === ADJUSTMENT_INSTALLMENT_STATUS.APPLIED
    ).length;
    plan.appliedAmount = roundMoney(installments.reduce(
        (sum, item) => sum + getPayrollAdjustmentInstallmentAppliedAmount(item), 0
    ));
    plan.balance = roundMoney(Math.max(0, roundMoney(plan.totalAmount) - plan.appliedAmount));
    plan.progressPercent = roundMoney(plan.totalAmount > 0
        ? (plan.appliedAmount / roundMoney(plan.totalAmount)) * 100
        : 0);
    plan.status = plan.balance === 0 && plan.appliedInstallments === installments.length
        ? ADJUSTMENT_PLAN_STATUS.COMPLETED
        : ADJUSTMENT_PLAN_STATUS.ACTIVE;
    plan.updatedAt = updatedAt;
    return plan;
}

function normalizeModernPlan(plan) {
    return {
        ...plan,
        totalAmount: roundMoney(plan.totalAmount),
        balance: roundMoney(plan.balance),
        appliedAmount: roundMoney(plan.appliedAmount),
        installmentCount: Number(plan.installmentCount) || 0,
        appliedInstallments: Number(plan.appliedInstallments) || 0,
        progressPercent: Number(plan.progressPercent) || 0,
        installments: (Array.isArray(plan.installments) ? plan.installments : []).map(installment => ({
            ...installment,
            amount: roundMoney(installment.amount),
            appliedAmount: roundMoney(installment.appliedAmount)
        })),
        history: (Array.isArray(plan.history) ? plan.history : []).map(entry => ({ ...entry }))
    };
}

/**
 * Modern plans are copied and normalized. Legacy adjustments are returned by
 * reference so compatibility is explicit: this phase never migrates them.
 */
export function normalizeEmployeeAdjustmentEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map(entry =>
        isPayrollAdjustmentInstallmentPlan(entry) ? normalizeModernPlan(entry) : entry
    );
}
