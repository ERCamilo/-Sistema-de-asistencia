import { mergeIncomingEmployees } from './EmployeesIncomingMerge.js';
import { mergeIncomingPositions, mergeIncomingLeaders } from './CatalogIncomingMerge.js';

/** General-document reads can be partial, cached or older than a local edit. */
export function mergeLoadedRemoteEntities(local, loaded) {
    const options = { authoritative: false };
    return {
        employees: mergeIncomingEmployees(local.employees, loaded.employees, options),
        positions: mergeIncomingPositions(local.positions, loaded.positions, options),
        leaders: mergeIncomingLeaders(local.leaders, loaded.leaders, options)
    };
}

const add = (ids, value) => { if (value != null && value !== '') ids.add(String(value)); };

export function referencedPositionIds(state) {
    const ids = new Set();
    for (const employee of state.employees || []) {
        for (const id of employee.positions || []) add(ids, id);
        add(ids, employee.position);
    }
    for (const record of Object.values(state.attendance || {})) {
        if (record?.deletedAt != null) continue;
        add(ids, record?.selectedPosition);
        add(ids, record?.positionId);
        for (const part of record?.positionHours || []) add(ids, part.positionId);
    }
    return ids;
}

export function referencedLeaderIds(state) {
    const ids = new Set();
    for (const position of state.positions || []) add(ids, position.leaderId);
    for (const employee of state.employees || []) {
        for (const assignment of Object.values(employee.positionAssignments || {})) {
            add(ids, assignment.workLeaderId);
            if (assignment.isLoanPosition) add(ids, assignment.payerLeaderId);
        }
    }
    return ids;
}
