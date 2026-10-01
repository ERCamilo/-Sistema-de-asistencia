const PREVIEW_CATEGORIES = ['bonuses', 'deductions', 'loans'];

export function getPayrollPreviewInclusion(inclusion = {}) {
    return PREVIEW_CATEGORIES.reduce((result, category) => ({
        ...result,
        [category]: inclusion[category] !== false
    }), {});
}

function amount(value) {
    return Number(value) || 0;
}

function money(value) {
    return Math.round((amount(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Produces a payment preview without changing the configured adjustments or
 * temporary loan selection. The source rows remain the canonical configured
 * calculation; this projection is only for review, export and closure.
 */
export function applyPayrollPreviewInclusion(rows = [], inclusion = {}) {
    const effectiveInclusion = getPayrollPreviewInclusion(inclusion);
    return rows.map(row => {
        const sourceBonuses = amount(row._bonuses);
        const sourceDeductions = amount(row._deductions);
        const sourceLoans = amount(row._loans);
        const amountBeforeLoans = amount(row._montoBeforeLoans ?? row.monto + sourceLoans);
        const amountBeforeCategories = amountBeforeLoans - sourceBonuses + sourceDeductions;
        const bonuses = effectiveInclusion.bonuses ? sourceBonuses : 0;
        const deductions = effectiveInclusion.deductions ? sourceDeductions : 0;
        const loans = effectiveInclusion.loans ? sourceLoans : 0;
        const net = amountBeforeCategories + bonuses - deductions - loans;

        return {
            ...row,
            monto: net,
            _montoBeforeLoans: amountBeforeCategories + bonuses - deductions,
            _bonuses: bonuses,
            _deductions: deductions,
            _loans: loans,
            _bonusDetails: effectiveInclusion.bonuses ? [...(row._bonusDetails || [])] : [],
            _deductionDetails: effectiveInclusion.deductions ? [...(row._deductionDetails || [])] : [],
            _loanDetails: effectiveInclusion.loans ? [...(row._loanDetails || [])] : [],
            _invalidLoanNet: effectiveInclusion.loans && loans > 0 && money(net) < 0
        };
    });
}

export function getPayrollPreviewCategoryCounts(configuredCounts = {}, inclusion = {}) {
    const effectiveInclusion = getPayrollPreviewInclusion(inclusion);
    return PREVIEW_CATEGORIES.reduce((result, category) => {
        const total = Math.max(0, Math.trunc(Number(configuredCounts[category]) || 0));
        return {
            ...result,
            [category]: { active: effectiveInclusion[category] ? total : 0, total }
        };
    }, {});
}

export function filterPayablePayrollPreviewRows(rows = []) {
    return rows.filter(row =>
        amount(row.monto) > 0.001
        || amount(row._loans) > 0
        || (row._bonusDetails || []).length > 0
        || (row._deductionDetails || []).length > 0
    );
}

export const LEADER_HOURS_SCOPES = Object.freeze({ ALL: 'all', LEADER: 'leader' });

export function normalizeLeaderHoursScope(value) {
    return value === LEADER_HOURS_SCOPES.LEADER ? LEADER_HOURS_SCOPES.LEADER : LEADER_HOURS_SCOPES.ALL;
}

function scaleDetails(details = [], ratio) {
    let fixed = 0;
    let scaled = 0;
    const out = details.map(item => {
        if (item?.type !== 'percentage') {
            fixed += amount(item?.amount);
            return item;
        }
        const next = { ...item, amount: money(amount(item.amount) * ratio), appliedTo: money(amount(item.appliedTo) * ratio) };
        scaled += next.amount;
        return next;
    });
    return { details: out, total: money(fixed + scaled) };
}

/**
 * Deja en la fila solo las horas y el bruto de las posiciones indicadas.
 * Las bonificaciones y deducciones porcentuales se recalculan sobre el bruto
 * nuevo; las de monto fijo y los préstamos quedan completos (son del
 * empleado, no de la posición). Devuelve null si no trabajó en ninguna.
 */
export function limitPayrollRowToPositions(row, positionIds) {
    const breakdown = row?._positionBreakdown || [];
    const kept = breakdown.filter(item => positionIds.has(String(item?.positionId)));
    if (kept.length === breakdown.length) return row;
    if (kept.length === 0) return null;
    const sum = field => kept.reduce((total, item) => total + amount(item?.[field]), 0);
    const oldGross = amount(row._brutoOriginal);
    const gross = money(sum('subtotal'));
    const ratio = oldGross > 0 ? gross / oldGross : 0;
    const bonuses = scaleDetails(row._bonusDetails, ratio);
    const deductions = scaleDetails(row._deductionDetails, ratio);
    const newBonuses = (row._bonusDetails || []).length ? bonuses.total : amount(row._bonuses);
    const newDeductions = (row._deductionDetails || []).length ? deductions.total : amount(row._deductions);
    const delta = (gross - oldGross) + (newBonuses - amount(row._bonuses)) - (newDeductions - amount(row._deductions));
    const regularHours = sum('regularHours');
    const overtimeHours = sum('overtimeHours');
    const holidayHours = sum('holidayHours');
    const restDayHours = sum('restDayHours');
    const net = money(amount(row.monto) + delta);
    return {
        ...row,
        monto: net,
        _montoBeforeLoans: money(amount(row._montoBeforeLoans ?? amount(row.monto) + amount(row._loans)) + delta),
        _brutoOriginal: gross,
        _bruto: money(amount(row._bruto ?? oldGross) + (gross - oldGross)),
        _bonuses: newBonuses,
        _deductions: newDeductions,
        _bonusDetails: bonuses.details,
        _deductionDetails: deductions.details,
        _regularHours: regularHours,
        _overtimeHours: overtimeHours,
        _holidayHours: holidayHours,
        _restDayHours: restDayHours,
        _totalHours: regularHours + overtimeHours + holidayHours + restDayHours,
        _positionBreakdown: kept,
        _leaderExcludedPositions: breakdown
            .filter(item => !positionIds.has(String(item?.positionId)))
            .map(item => ({
                positionId: item.positionId,
                positionName: item.positionName || 'Puesto',
                days: amount(item.days),
                hours: amount(item.regularHours) + amount(item.overtimeHours) + amount(item.holidayHours) + amount(item.restDayHours),
                subtotal: money(item.subtotal)
            })),
        _invalidLoanNet: amount(row._loans) > 0 && net < 0
    };
}

/**
 * Filtro por líder de la vista previa. Un empleado entra si trabajó en el
 * período en una posición de ese líder (desglose por posición de su fila) o si
 * alguna de sus posiciones actuales es de ese líder. 'all' o un líder que no
 * existe en la obra devuelve todas las filas.
 *
 * hoursScope:
 *   - 'all' (por defecto): el empleado entra con las horas de todos sus puestos.
 *   - 'leader': solo con las horas y días de los puestos de ese líder; quien no
 *     trabajó en ninguno de ellos en el período queda fuera.
 */
export function filterPayrollRowsByLeader(rows = [], { leaderId = 'all', positions = [], employees = [], hoursScope = LEADER_HOURS_SCOPES.ALL } = {}) {
    const leader = String(leaderId || 'all');
    if (leader === 'all') return rows;
    const leaderPositions = new Set((positions || [])
        .filter(position => position?.leaderId != null && String(position.leaderId) === leader)
        .map(position => String(position.id)));
    if (leaderPositions.size === 0) return [];
    const employeesById = new Map((employees || []).map(employee => [String(employee.id), employee]));
    const currentPositions = row => {
        const employee = employeesById.get(String(row._employeeId ?? row.id));
        return [...(employee?.positions || []), employee?.position]
            .filter(id => id != null)
            .map(String);
    };
    if (normalizeLeaderHoursScope(hoursScope) === LEADER_HOURS_SCOPES.LEADER) {
        return rows
            .map(row => ((row._positionBreakdown || []).length
                // Sin horas en el período: va con el líder de su puesto asignado.
                ? limitPayrollRowToPositions(row, leaderPositions)
                : (currentPositions(row).some(id => leaderPositions.has(id)) ? row : null)))
            .filter(Boolean);
    }
    return rows.filter(row => {
        const worked = (row._positionBreakdown || []).map(item => String(item?.positionId));
        return [...worked, ...currentPositions(row)].some(id => leaderPositions.has(id));
    });
}
