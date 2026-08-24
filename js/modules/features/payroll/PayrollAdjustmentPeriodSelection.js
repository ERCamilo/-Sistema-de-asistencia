import {
    ADJUSTMENT_INSTALLMENT_STATUS,
    getPayrollAdjustmentInstallmentRemainingAmount
} from './PayrollAdjustmentInstallmentPlan.js';

export const ADJUSTMENT_PERIOD_SELECTION_MODE = Object.freeze({
    PAUSE: 'pause',
    COUNT: 'count',
    FULL: 'full'
});

let runtimeSelections = [];

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeReference(reference = {}) {
    const normalized = {
        kind: text(reference.kind),
        planId: text(reference.planId),
        employeeId: text(reference.employeeId),
        periodStart: text(reference.periodStart),
        periodEnd: text(reference.periodEnd)
    };
    if (!['bonuses', 'deductions'].includes(normalized.kind) ||
        !normalized.planId || !normalized.employeeId ||
        !normalized.periodStart || !normalized.periodEnd ||
        normalized.periodStart > normalized.periodEnd) {
        throw new Error('La selección de pagos programados no es válida');
    }
    return normalized;
}

function sameReference(selection, reference) {
    return selection?.kind === reference.kind &&
        selection?.planId === reference.planId &&
        selection?.employeeId === reference.employeeId &&
        selection?.periodStart === reference.periodStart &&
        selection?.periodEnd === reference.periodEnd;
}

function normalizeChoice(choice = {}) {
    const mode = text(choice.mode);
    if (mode === ADJUSTMENT_PERIOD_SELECTION_MODE.PAUSE ||
        mode === ADJUSTMENT_PERIOD_SELECTION_MODE.FULL) {
        return { mode, count: null };
    }
    const count = Number(choice.count);
    if (mode !== ADJUSTMENT_PERIOD_SELECTION_MODE.COUNT ||
        !Number.isInteger(count) || count < 1) {
        throw new Error('Elige una cantidad válida para esta nómina');
    }
    return { mode, count };
}

export function getPayrollAdjustmentPendingInstallments(plan) {
    return [...(Array.isArray(plan?.installments) ? plan.installments : [])]
        .filter(item =>
            item?.id &&
            item.status === ADJUSTMENT_INSTALLMENT_STATUS.PENDING &&
            getPayrollAdjustmentInstallmentRemainingAmount(item) > 0
        )
        .sort((left, right) =>
            (Number(left.sequence) || 0) - (Number(right.sequence) || 0) ||
            text(left.id).localeCompare(text(right.id), 'es', { numeric: true })
        );
}

export function getPayrollAdjustmentPeriodSelection(selections = [], reference = {}) {
    const normalized = normalizeReference(reference);
    const found = (Array.isArray(selections) ? selections : [])
        .find(selection => sameReference(selection, normalized));
    if (!found) return null;
    try {
        return { ...normalized, ...normalizeChoice(found) };
    } catch {
        return null;
    }
}

export function setPayrollAdjustmentPeriodSelection(
    selections = [],
    reference = {},
    choice = {}
) {
    const normalized = normalizeReference(reference);
    const nextChoice = normalizeChoice(choice);
    return [
        ...(Array.isArray(selections) ? selections : [])
            .filter(selection => !sameReference(selection, normalized)),
        { ...normalized, ...nextChoice }
    ];
}

export function clearPayrollAdjustmentPeriodRuntime() {
    runtimeSelections = [];
}

export function getPayrollAdjustmentPeriodRuntimeSelections(periodStart, periodEnd) {
    const start = text(periodStart);
    const end = text(periodEnd);
    if (!start || !end || start > end) return [];
    return runtimeSelections
        .filter(selection =>
            selection.periodStart === start && selection.periodEnd === end
        )
        .map(selection => ({ ...selection }));
}

export function setPayrollAdjustmentPeriodRuntimeSelection(reference, choice) {
    runtimeSelections = setPayrollAdjustmentPeriodSelection(
        runtimeSelections,
        reference,
        choice
    );
    return getPayrollAdjustmentPeriodRuntimeSelections(
        reference?.periodStart,
        reference?.periodEnd
    );
}

export function removePayrollAdjustmentPeriodRuntimeSelections(references = []) {
    const normalized = (Array.isArray(references) ? references : []).map(normalizeReference);
    runtimeSelections = runtimeSelections.filter(selection =>
        !normalized.some(reference => sameReference(selection, reference))
    );
    const first = normalized[0];
    return first
        ? getPayrollAdjustmentPeriodRuntimeSelections(first.periodStart, first.periodEnd)
        : [];
}

export function setPayrollAdjustmentPeriodRuntimeSelections(references, choice) {
    let next = runtimeSelections;
    for (const reference of Array.isArray(references) ? references : []) {
        next = setPayrollAdjustmentPeriodSelection(next, reference, choice);
    }
    runtimeSelections = next;
    const first = references?.[0];
    return getPayrollAdjustmentPeriodRuntimeSelections(
        first?.periodStart,
        first?.periodEnd
    );
}

export function resolvePayrollAdjustmentPeriodApplication(plan, {
    kind,
    employeeId,
    periodStart,
    periodEnd,
    selections = []
} = {}) {
    const reference = normalizeReference({
        kind,
        planId: plan?.id,
        employeeId,
        periodStart,
        periodEnd
    });
    const pendingInstallments = getPayrollAdjustmentPendingInstallments(plan);
    const explicit = getPayrollAdjustmentPeriodSelection(selections, reference);
    const selected = explicit || {
        ...reference,
        mode: ADJUSTMENT_PERIOD_SELECTION_MODE.COUNT,
        count: 1
    };
    let installments;
    if (selected.mode === ADJUSTMENT_PERIOD_SELECTION_MODE.PAUSE) {
        installments = [];
    } else if (selected.mode === ADJUSTMENT_PERIOD_SELECTION_MODE.FULL) {
        installments = pendingInstallments;
    } else {
        installments = pendingInstallments.slice(0, Math.min(selected.count, pendingInstallments.length));
    }
    return {
        ...selected,
        pendingCount: pendingInstallments.length,
        installments,
        total: money(installments.reduce(
            (sum, installment) => sum + getPayrollAdjustmentInstallmentRemainingAmount(installment),
            0
        ))
    };
}

export function buildPayrollAdjustmentPeriodSelectionOptions(plan, context = {}) {
    const application = resolvePayrollAdjustmentPeriodApplication(plan, context);
    const options = [{
        value: ADJUSTMENT_PERIOD_SELECTION_MODE.PAUSE,
        label: 'Pausar esta nómina',
        total: 0
    }];
    const pending = getPayrollAdjustmentPendingInstallments(plan);
    let runningTotal = 0;
    pending.forEach((installment, index) => {
        runningTotal = money(
            runningTotal + getPayrollAdjustmentInstallmentRemainingAmount(installment)
        );
        options.push({
            value: `count:${index + 1}`,
            label: index === 0 ? '1 cuota' : `${index + 1} cuotas`,
            total: runningTotal
        });
    });
    options.push({
        value: ADJUSTMENT_PERIOD_SELECTION_MODE.FULL,
        label: 'Completar saldo',
        total: money(plan?.balance)
    });
    return {
        ...application,
        selectedValue: application.mode === ADJUSTMENT_PERIOD_SELECTION_MODE.COUNT
            ? `count:${application.count}`
            : application.mode,
        options
    };
}

export function parsePayrollAdjustmentPeriodSelectionValue(value) {
    const normalized = text(value);
    if (normalized === ADJUSTMENT_PERIOD_SELECTION_MODE.PAUSE ||
        normalized === ADJUSTMENT_PERIOD_SELECTION_MODE.FULL) {
        return { mode: normalized };
    }
    const match = /^count:(\d+)$/.exec(normalized);
    if (!match) throw new Error('Elige una opción válida para esta nómina');
    return { mode: ADJUSTMENT_PERIOD_SELECTION_MODE.COUNT, count: Number(match[1]) };
}

export default {
    ADJUSTMENT_PERIOD_SELECTION_MODE,
    buildPayrollAdjustmentPeriodSelectionOptions,
    clearPayrollAdjustmentPeriodRuntime,
    getPayrollAdjustmentPendingInstallments,
    getPayrollAdjustmentPeriodRuntimeSelections,
    getPayrollAdjustmentPeriodSelection,
    parsePayrollAdjustmentPeriodSelectionValue,
    removePayrollAdjustmentPeriodRuntimeSelections,
    resolvePayrollAdjustmentPeriodApplication,
    setPayrollAdjustmentPeriodRuntimeSelection,
    setPayrollAdjustmentPeriodRuntimeSelections,
    setPayrollAdjustmentPeriodSelection
};
