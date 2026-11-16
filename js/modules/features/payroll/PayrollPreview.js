import { getEmployeePositionAssignment } from '../employees/EmployeePositionAssignments.js';
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

export const LEADER_HOURS_SCOPES = Object.freeze({ PAYROLL: 'payroll', ALL: 'all', LEADER: 'leader' });

export function normalizeLeaderHoursScope(value) {
    return Object.values(LEADER_HOURS_SCOPES).includes(value) ? value : LEADER_HOURS_SCOPES.PAYROLL;
}

function scaleDetails(details = [], ratio, includeFixed = true, attribution = null) {
    const matching = (item, parts) => parts.filter(part => item.scope === 'leader'
        ? String(part.assignmentSchemaVersion === 1 ? part.payerLeaderId : attribution.positions.find(position => String(position.id) === String(part.positionId))?.leaderId) === String(item.targetId)
        : item.scope === 'position' ? String(part.positionId) === String(item.targetId) : true);
    details = details.filter(item => {
        if (item?.type === 'percentage') return true;
        if (attribution && ['leader', 'position'].includes(item.scope)) {
            return attribution.kept.includes(matching(item, attribution.full)[0]);
        }
        return includeFixed;
    });
    let fixed = 0;
    let scaled = 0;
    const out = details.map(item => {
        if (item?.type !== 'percentage') {
            fixed += amount(item?.amount);
            return item;
        }
        const scopeRatio = attribution && amount(item.appliedTo) > 0
            ? matching(item, attribution.kept).reduce((sum, part) => sum + amount(part.subtotal), 0) / amount(item.appliedTo)
            : ratio;
        const next = { ...item, amount: money(amount(item.amount) * scopeRatio), appliedTo: money(amount(item.appliedTo) * scopeRatio) };
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
    return limitPayrollRowToBreakdown(row, (row?._positionBreakdown || []).filter(item => positionIds.has(String(item?.positionId))));
}

export function limitPayrollRowToBreakdown(row, kept, { includeFixed = true, positions = null } = {}) {
    const breakdown = row?._positionBreakdown || [];
    if (kept.length === breakdown.length && includeFixed) return row;
    if (kept.length === 0) return null;
    const sum = field => kept.reduce((total, item) => total + amount(item?.[field]), 0);
    const oldGross = amount(row._brutoOriginal);
    const gross = money(sum('subtotal'));
    const ratio = oldGross > 0 ? gross / oldGross : 0;
    const attribution = positions ? { kept, full: breakdown, positions } : null;
    const bonuses = scaleDetails(row._bonusDetails, ratio, includeFixed, attribution);
    const deductions = scaleDetails(row._deductionDetails, ratio, includeFixed, attribution);
    const newBonuses = (row._bonusDetails || []).length ? bonuses.total : includeFixed ? amount(row._bonuses) : 0;
    const newDeductions = (row._deductionDetails || []).length ? deductions.total : includeFixed ? amount(row._deductions) : 0;
    const delta = (gross - oldGross) + (newBonuses - amount(row._bonuses)) - (newDeductions - amount(row._deductions));
    const regularHours = sum('regularHours');
    const overtimeHours = sum('overtimeHours');
    const holidayHours = sum('holidayHours');
    const restDayHours = sum('restDayHours');
    const loans = includeFixed ? amount(row._loans) : 0;
    const net = money(amount(row.monto) + delta + amount(row._loans) - loans);
    return {
        ...row,
        monto: net,
        _montoBeforeLoans: money(amount(row._montoBeforeLoans ?? amount(row.monto) + amount(row._loans)) + delta),
        _brutoOriginal: gross,
        _bruto: money(amount(row._bruto ?? oldGross) + (gross - oldGross)),
        _bonuses: newBonuses,
        _loans: loans,
        _loanDetails: includeFixed ? (row._loanDetails || []) : [],
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
            .filter(item => !kept.includes(item))
            .map(item => ({
                positionId: item.positionId,
                positionName: item.positionName || 'Puesto',
                days: amount(item.days),
                hours: amount(item.regularHours) + amount(item.overtimeHours) + amount(item.holidayHours) + amount(item.restDayHours),
                subtotal: money(item.subtotal)
            })),
        _invalidLoanNet: loans > 0 && net < 0
    };
}

/**
 * Filtro por líder de la vista previa. Un empleado entra si trabajó en el
 * período en una posición de ese líder (desglose por posición de su fila) o si
 * alguna de sus posiciones actuales es de ese líder. 'all' devuelve todas
 * las filas. Con equipo/pagador configurados, solo entra lo que paga el líder.
 *
 * hoursScope:
 *   - 'payroll' (por defecto): solo tramos a cargo del pagador, también en registros antiguos.
 *   - 'all': todos sus puestos; con pagador configurado, solo
 *     los tramos a cargo del líder elegido.
 *   - 'leader': solo con las horas y días del equipo de ese líder; con pagador
 *     configurado también deben estar a su cargo. Se usa el equipo histórico
 *     del tramo, no el líder actual del catálogo.
 */
export function filterPayrollRowsByLeader(rows = [], { leaderId = 'all', positions = [], employees = [], hoursScope = LEADER_HOURS_SCOPES.PAYROLL } = {}) {
    const leader = String(leaderId || 'all');
    if (leader === 'all') return rows;
    const leaderPositions = new Set((positions || [])
        .filter(position => position?.leaderId != null && String(position.leaderId) === leader)
        .map(position => String(position.id)));

    const employeesById = new Map((employees || []).map(employee => [String(employee.id), employee]));
    const currentPositions = row => {
        const employee = employeesById.get(String(row._employeeId ?? row.id));
        return [...(employee?.positions || []), employee?.position]
            .filter(id => id != null)
            .map(String);
    };
    const configured = row => (row._positionBreakdown || []).some(part => part.assignmentSchemaVersion === 1)
        || Object.keys(employeesById.get(String(row._employeeId ?? row.id))?.positionAssignments || {}).length > 0;
    const onlyTeamHours = normalizeLeaderHoursScope(hoursScope) === LEADER_HOURS_SCOPES.LEADER;
    const inPayroll = normalizeLeaderHoursScope(hoursScope) === LEADER_HOURS_SCOPES.PAYROLL;
    const effectiveTeam = part => part.assignmentSchemaVersion === 1 ? part.workLeaderId
        : positions.find(position => String(position.id) === String(part.positionId))?.leaderId;
    const effectivePayer = part => part.assignmentSchemaVersion === 1 ? part.payerLeaderId
        : positions.find(position => String(position.id) === String(part.positionId))?.leaderId;
    return rows.map(row => {
        if (!configured(row) && !inPayroll) {
            if (onlyTeamHours) {
                return (row._positionBreakdown || []).length
                    ? limitPayrollRowToPositions(row, leaderPositions)
                    : currentPositions(row).some(id => leaderPositions.has(id)) ? row : null;
            }
            const worked = (row._positionBreakdown || []).map(item => String(item?.positionId));
            return [...worked, ...currentPositions(row)].some(id => leaderPositions.has(id)) ? row : null;
        }
        const employee = employeesById.get(String(row._employeeId ?? row.id));
        const parts = row._positionBreakdown || [];
        if (!parts.length && inPayroll) {
            const positionId = currentPositions(row)[0];
            const assignment = getEmployeePositionAssignment(employee, positions.find(item => String(item.id) === positionId));
            const payer = row._personalAdjustmentPayerId !== undefined ? row._personalAdjustmentPayerId
                : assignment.isLoanPosition ? assignment.payerLeaderId : assignment.workLeaderId;
            return String(payer) === leader ? row : null;
        }
        if (!parts.length) return currentPositions(row).some(positionId => {
            const position = positions.find(item => String(item.id) === positionId);
            const assignment = getEmployeePositionAssignment(employee, position);
            return String(assignment.isLoanPosition ? assignment.payerLeaderId : assignment.workLeaderId) === leader
                && (!onlyTeamHours || String(assignment.workLeaderId) === leader);
        }) ? row : null;
        const owned = parts.filter(part => String(effectivePayer(part)) === leader
            && (!onlyTeamHours || String(effectiveTeam(part)) === leader));
        const primary = parts.find(part => String(part.positionId) === String(employee?.positions?.[0])) || parts[0];
        return limitPayrollRowToBreakdown(row, owned, { includeFixed: String(row._personalAdjustmentPayerId !== undefined ? row._personalAdjustmentPayerId : effectivePayer(primary)) === leader, positions });
    }).filter(Boolean);
}
