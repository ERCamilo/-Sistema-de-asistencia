const KINDS = new Set(['deductions', 'bonuses']);
const SCOPES = new Set(['global', 'leader', 'position', 'employee']);

function normalizeKind(kind) {
    if (!KINDS.has(kind)) throw new Error(`Unsupported payroll adjustment kind: ${kind}`);
    return kind;
}

export function resolveAdjustmentScope(adjustment = {}) {
    let scope = SCOPES.has(adjustment.scope) ? adjustment.scope : null;
    if (!scope) {
        if (adjustment.employeeId != null) scope = 'employee';
        else if (adjustment.positionId != null) scope = 'position';
        else if (adjustment.leaderId != null) scope = 'leader';
        else scope = 'global';
    }

    let targetId = adjustment.targetId;
    if (targetId == null) {
        if (scope === 'employee') {
            targetId = adjustment.employeeId ?? adjustment.targetIds?.[0] ?? adjustment.employeeIds?.[0];
        }
        if (scope === 'position') targetId = adjustment.positionId;
        if (scope === 'leader') targetId = adjustment.leaderId;
    }

    return {
        scope,
        targetId: scope === 'global' || targetId == null ? null : String(targetId)
    };
}

export function resolveAdjustmentTargetIds(adjustment = {}) {
    const resolved = resolveAdjustmentScope(adjustment);
    if (resolved.scope !== 'employee') {
        return resolved.targetId == null ? [] : [resolved.targetId];
    }

    const source = Array.isArray(adjustment.targetIds) && adjustment.targetIds.length > 0
        ? adjustment.targetIds
        : Array.isArray(adjustment.employeeIds) && adjustment.employeeIds.length > 0
            ? adjustment.employeeIds
            : resolved.targetId == null ? [] : [resolved.targetId];
    return [...new Set(source.filter(id => id != null).map(String))]
        .sort((left, right) => left.localeCompare(right, 'es', { numeric: true }));
}

function canonicalAdjustment(adjustment) {
    const resolved = resolveAdjustmentScope(adjustment);
    return {
        id: adjustment.id,
        type: adjustment.type === 'percentage' ? 'percentage' : 'fixed',
        value: Number(adjustment.value) || 0,
        name: String(adjustment.name || ''),
        scope: resolved.scope,
        targetId: resolved.targetId
    };
}

export function normalizePayrollDefaults(settings = {}) {
    const source = settings.payrollDefaults || {};
    const reusableOnly = kind => (source[kind] || [])
        .filter(item => item?.id && resolveAdjustmentScope(item).scope !== 'employee')
        .map(canonicalAdjustment);
    return {
        version: 2,
        deductions: reusableOnly('deductions'),
        bonuses: reusableOnly('bonuses')
    };
}

export function hydrateRememberedAdjustments(exportConfig = {}, settings = {}) {
    const defaults = normalizePayrollDefaults(settings);
    const result = {};
    for (const kind of KINDS) {
        const current = [...(exportConfig[kind] || [])];
        const existingIds = new Set(current.map(item => String(item.id || '')));
        for (const saved of defaults[kind]) {
            if (!existingIds.has(String(saved.id))) {
                current.push({ ...saved, remembered: true, source: 'remembered-global' });
            }
        }
        result[kind] = current.map(item =>
            defaults[kind].some(saved => String(saved.id) === String(item.id))
                ? { ...item, remembered: true }
                : item
        );
    }
    return result;
}

export function updateRememberedDefault(settings, kind, adjustment, shouldRemember) {
    normalizeKind(kind);
    const defaults = normalizePayrollDefaults(settings);
    if (!adjustment?.id || resolveAdjustmentScope(adjustment).scope === 'employee') return defaults;
    const id = String(adjustment.id);
    defaults[kind] = defaults[kind].filter(item => String(item.id) !== id);
    if (shouldRemember) defaults[kind].push(canonicalAdjustment(adjustment));
    return defaults;
}

export function summarizeGlobalAdjustments(items, sign, formatMoney) {
    const globals = (items || []).filter(item => resolveAdjustmentScope(item).scope === 'global');
    if (globals.length === 0) return 'Sin ajustes globales';
    const tokens = globals.slice(0, 3).map(item => {
        const value = Number(item.value) || 0;
        return item.type === 'percentage'
            ? `${sign}${value}%`
            : `${sign}${formatMoney(value)}`;
    });
    if (globals.length > 3) tokens.push(`+${globals.length - 3} más`);
    return tokens.join(' ');
}

function sumPositionBase(entries) {
    return entries.reduce((total, item) => total + (Number(item?.subtotal) || 0), 0);
}

/**
 * Resolves one adjustment against an employee payroll snapshot.
 *
 * Percentage rules use an immutable gross base:
 * - global / employee: the employee's complete original gross;
 * - position: the matching position subtotal;
 * - leader: the sum of subtotals worked under that leader.
 *
 * Fixed rules are applied once per adjustment and employee, never once per
 * matching position.
 */
export function calculateScopedAdjustment(adjustment, context = {}, index = 0, fallbackLabel = 'Ajuste') {
    if (!adjustment) return null;

    const resolved = resolveAdjustmentScope(adjustment);
    const employeeId = context.employeeId == null ? null : String(context.employeeId);
    const breakdown = Array.isArray(context.breakdown) ? context.breakdown : [];
    const positionsById = new Map(
        (context.positions || []).map(position => [String(position.id), position])
    );

    let applies = false;
    let matchingEntries = [];

    if (resolved.scope === 'global') {
        applies = true;
        matchingEntries = breakdown;
    } else if (resolved.scope === 'employee') {
        applies = employeeId != null && resolveAdjustmentTargetIds(adjustment).includes(employeeId);
        matchingEntries = applies ? breakdown : [];
    } else if (resolved.scope === 'position') {
        matchingEntries = breakdown.filter(
            item => String(item.positionId) === resolved.targetId
        );
        applies = matchingEntries.length > 0;
    } else if (resolved.scope === 'leader') {
        matchingEntries = breakdown.filter(item => {
            const position = positionsById.get(String(item.positionId));
            return position?.leaderId != null
                && String(position.leaderId) === resolved.targetId;
        });
        applies = matchingEntries.length > 0;
    }

    if (!applies) return null;

    const totalGross = Number(context.totalGross) || 0;
    const appliedTo = resolved.scope === 'global' || resolved.scope === 'employee'
        ? totalGross
        : sumPositionBase(matchingEntries);
    const type = adjustment.type === 'percentage' ? 'percentage' : 'fixed';
    const value = Number(adjustment.value) || 0;
    const amount = type === 'percentage' ? (appliedTo * value) / 100 : value;
    const matchedPositionIds = [...new Set(
        matchingEntries
            .map(item => item?.positionId)
            .filter(id => id != null)
            .map(String)
    )];
    const fallbackIdPrefix = fallbackLabel === 'Bono'
        ? 'BON'
        : fallbackLabel === 'Deducción'
            ? 'DED'
            : 'ADJ';

    return {
        id: adjustment.id || `${fallbackIdPrefix}-${index + 1}`,
        name: adjustment.name || `${fallbackLabel} ${index + 1}`,
        type,
        value,
        amount,
        appliedTo,
        scope: resolved.scope,
        targetId: resolved.targetId,
        matchedPositionIds
    };
}

export function calculateScopedAdjustments(adjustments = [], context = {}, fallbackLabel = 'Ajuste') {
    const breakdown = (adjustments || [])
        .map((adjustment, index) =>
            calculateScopedAdjustment(adjustment, context, index, fallbackLabel)
        )
        .filter(Boolean);

    return {
        total: breakdown.reduce((sum, item) => sum + item.amount, 0),
        breakdown
    };
}
