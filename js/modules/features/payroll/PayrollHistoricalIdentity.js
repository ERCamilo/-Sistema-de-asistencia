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
        const leader = position?.leaderId == null
            ? null
            : (leaders || []).find(item => String(item.id) === String(position.leaderId));
        return leader ? [String(leader.id), {
            id: String(leader.id),
            name: leader.name || '',
            number: leader.number ?? ''
        }] : null;
    }).filter(Boolean)).values()];

    return {
        positionName: positionNames.length > 0 ? positionNames.join(', ') : 'Sin posicion',
        leaderRefs
    };
}

export default { buildPayrollHistoricalOrganization };
