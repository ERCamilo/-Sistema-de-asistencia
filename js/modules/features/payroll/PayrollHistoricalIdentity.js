import { filterPayrollRowsByLeader } from './PayrollPreview.js';
import { getEmployeePositionAssignment } from '../employees/EmployeePositionAssignments.js';
function assignedPositionIds(employee = {}) {
    if (Array.isArray(employee.positions) && employee.positions.length > 0) {
        return employee.positions;
    }
    return employee.position == null ? [] : [employee.position];
}

export function buildPayrollHistoricalOrganization({
    employee = {},
    breakdown = [],
    positions = [],
    leaders = []
} = {}) {
    const workedPositionIds = (breakdown || [])
        .map(item => item?.positionId)
        .filter(positionId => positionId !== null && positionId !== undefined);
    const positionIds = [...new Set((workedPositionIds.length > 0
        ? workedPositionIds
        : assignedPositionIds(employee)).map(String))];
    const positionNames = positionIds.map(positionId =>
        (breakdown || []).find(item => String(item.positionId) === positionId)?.positionName ||
        (positions || []).find(item => String(item.id) === positionId)?.name
    ).filter(Boolean);
    const leaderRefs = [...new Map(positionIds.map(positionId => {
        const position = (positions || []).find(item => String(item.id) === positionId);
        const part = breakdown.find(item => String(item.positionId) === positionId);
        const assignment = getEmployeePositionAssignment(employee, position);
        const leaderId = part?.assignmentSchemaVersion === 1 ? part.payerLeaderId
            : assignment.isLoanPosition ? assignment.payerLeaderId : assignment.workLeaderId;
        const leader = leaderId == null ? null : part?.payerLeaderName ? { id: leaderId, name: part.payerLeaderName }
            : (leaders || []).find(item => String(item.id) === String(leaderId));
        return leader ? [String(leader.id), {
            id: String(leader.id),
            name: leader.name || '',
            number: leader.number ?? ''
        }] : null;
    }).filter(Boolean)).values()];

    for (const part of breakdown) {
        if (part.assignmentSchemaVersion !== 1 || !part.payerLeaderId || leaderRefs.some(ref => ref.id === String(part.payerLeaderId))) continue;
        const leader = leaders.find(item => String(item.id) === String(part.payerLeaderId));
        leaderRefs.push({ id: String(part.payerLeaderId), name: part.payerLeaderName || leader?.name || '', number: leader?.number ?? '' });
    }
    return {
        positionName: positionNames.length > 0 ? positionNames.join(', ') : 'Sin posicion',
        leaderRefs
    };
}

export default { buildPayrollHistoricalOrganization };

export function filterHistoricalPayrollByPayer(rows, leaderId) {
    if (!leaderId) return rows;
    return rows.flatMap(row => {
        if (!row.positionBreakdown?.some(part => part.assignmentSchemaVersion === 1)) {
            return row.leaderRefs?.some(ref => String(ref.id) === String(leaderId)) ? [row] : [];
        }
        const source = { _employeeId: row.employeeId, monto: row.net, _brutoOriginal: row.gross,
            _positionBreakdown: row.positionBreakdown, _personalAdjustmentPayerId: row.personalAdjustmentPayerId,
            _bonuses: row.bonuses, _deductions: row.deductions, _loans: row.loans,
            _bonusDetails: row.bonusDetails, _deductionDetails: row.deductionDetails, _loanDetails: row.loanDetails };
        const result = filterPayrollRowsByLeader([source], { leaderId })[0];
        return result ? [{ ...row, gross: result._brutoOriginal, bonuses: result._bonuses,
            deductions: result._deductions, loans: result._loans, net: result.monto,
            bonusDetails: result._bonusDetails, deductionDetails: result._deductionDetails, loanDetails: result._loanDetails }] : [];
    });
}
