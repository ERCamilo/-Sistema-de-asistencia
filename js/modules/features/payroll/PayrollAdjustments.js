const KINDS = new Set(['deductions', 'bonuses']);

function normalizeKind(kind) {
    if (!KINDS.has(kind)) throw new Error(`Unsupported payroll adjustment kind: ${kind}`);
    return kind;
}

function canonicalAdjustment(adjustment) {
    return {
        id: adjustment.id,
        type: adjustment.type === 'percentage' ? 'percentage' : 'fixed',
        value: Number(adjustment.value) || 0,
        name: String(adjustment.name || '')
    };
}

export function normalizePayrollDefaults(settings = {}) {
    const source = settings.payrollDefaults || {};
    const globalOnly = kind => (source[kind] || [])
        .filter(item => item?.id && !item.employeeId)
        .map(canonicalAdjustment);
    return {
        version: 1,
        deductions: globalOnly('deductions'),
        bonuses: globalOnly('bonuses')
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
    if (!adjustment?.id || adjustment.employeeId) return defaults;
    const id = String(adjustment.id);
    defaults[kind] = defaults[kind].filter(item => String(item.id) !== id);
    if (shouldRemember) defaults[kind].push(canonicalAdjustment(adjustment));
    return defaults;
}

export function summarizeGlobalAdjustments(items, sign, formatMoney) {
    const globals = (items || []).filter(item => !item.employeeId);
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
