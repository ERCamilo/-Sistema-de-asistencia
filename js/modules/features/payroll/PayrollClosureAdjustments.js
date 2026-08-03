import { resolveAdjustmentScope } from './PayrollAdjustments.js';

const KINDS = Object.freeze({
    bonuses: { detailsKey: '_bonusDetails', prefix: 'BON' },
    deductions: { detailsKey: '_deductionDetails', prefix: 'DED' }
});

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function adjustmentId(adjustment, index, prefix) {
    return text(adjustment?.id) || `${prefix}-${index + 1}`;
}

function normalizeAdjustment(adjustment = {}, index = 0, prefix = 'ADJ') {
    const resolved = resolveAdjustmentScope(adjustment);
    return {
        id: adjustmentId(adjustment, index, prefix),
        name: text(adjustment.name),
        type: adjustment.type === 'percentage' ? 'percentage' : 'fixed',
        value: Number(adjustment.value) || 0,
        scope: resolved.scope,
        targetId: resolved.targetId,
        remembered: Boolean(adjustment.remembered)
    };
}

function appliedIds(rows, detailsKey) {
    return new Set((rows || []).flatMap(row => row?.[detailsKey] || [])
        .map(detail => text(detail?.id))
        .filter(Boolean));
}

function closureRules(closure, kind) {
    const meta = KINDS[kind];
    return (closure?.adjustments?.[kind] || [])
        .map((rule, index) => normalizeAdjustment(rule, index, meta.prefix));
}

function sameRule(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function buildPayrollAdjustmentSnapshot({ rows = [], bonuses = [], deductions = [] } = {}) {
    return Object.fromEntries(Object.entries(KINDS).map(([kind, meta]) => {
        const ids = appliedIds(rows, meta.detailsKey);
        const rules = (kind === 'bonuses' ? bonuses : deductions)
            .map((rule, index) => normalizeAdjustment(rule, index, meta.prefix))
            .filter(rule => ids.has(rule.id))
            .sort((left, right) => left.id.localeCompare(right.id, 'es', { numeric: true }));
        return [kind, rules];
    }));
}

export function consumePayrollClosureAdjustments(exportConfig = {}, closure = {}) {
    const next = { ...exportConfig };
    for (const [kind, meta] of Object.entries(KINDS)) {
        const consumedIds = new Set(closureRules(closure, kind)
            .filter(rule => !rule.remembered)
            .map(rule => rule.id));
        next[kind] = (exportConfig[kind] || []).filter((rule, index) =>
            !consumedIds.has(adjustmentId(rule, index, meta.prefix))
        );
    }
    return next;
}

export function restorePayrollClosureAdjustments(exportConfig = {}, closure = {}) {
    const next = {
        ...exportConfig,
        periodStart: text(closure.periodStart) || exportConfig.periodStart,
        periodEnd: text(closure.periodEnd) || exportConfig.periodEnd
    };

    for (const [kind, meta] of Object.entries(KINDS)) {
        const current = [...(exportConfig[kind] || [])];
        const currentById = new Map(current.map((rule, index) => [
            adjustmentId(rule, index, meta.prefix),
            { rule, normalized: normalizeAdjustment(rule, index, meta.prefix) }
        ]));

        for (const rule of closureRules(closure, kind).filter(item => !item.remembered)) {
            const existing = currentById.get(rule.id);
            if (existing && !sameRule(existing.normalized, rule)) {
                throw new Error(`No se puede restaurar el ajuste ${rule.id}: su identidad ya pertenece a otra regla`);
            }
            if (!existing) {
                current.push({ ...rule });
                currentById.set(rule.id, { rule, normalized: rule });
            }
        }
        next[kind] = current;
    }

    return next;
}

export default {
    buildPayrollAdjustmentSnapshot,
    consumePayrollClosureAdjustments,
    restorePayrollClosureAdjustments
};
