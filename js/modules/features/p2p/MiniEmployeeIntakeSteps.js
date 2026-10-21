import { intakeSuggestions } from './MiniEmployeeIntake.js';
import { sameEmployeeNumber } from '../employees/EmployeeNumberIdentity.js';
import { resolvePositionBaseHourlyRate } from '../employees/EmployeePositionMetrics.js';
import { hourlyToDaily } from '../payroll/SalaryConversion.js';
import { entityInScope } from '../projects/ProjectContext.js';
import { normalizeMiniAttendanceNumber } from '../attendance/MiniAttendanceDraft.js';
import {
    buildDefaultMiniAttendanceAliasScope
} from '../../services/MiniAttendanceAliasStore.js';

const TEXT_PEER_ID = 'attendance:texto';
const STEPS = {
    link: ['action', 'target', 'confirm'],
    create: ['action', 'position', 'salary', 'details']
};

export function compareByEmployeeNumber(a, b) {
    const left = Number(a?.number), right = Number(b?.number);
    const leftOk = Number.isFinite(left), rightOk = Number.isFinite(right);
    if (leftOk && rightOk && left !== right) return left - right;
    if (leftOk !== rightOk) return leftOk ? -1 : 1;
    return String(a?.number ?? '').localeCompare(String(b?.number ?? ''), 'es', { numeric: true })
        || String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'es');
}

/** SA employees for the "link" step: similar ones first, then everyone (paused included). */
export function buildCandidateLists(row, employees, scope) {
    const live = employees.filter(e => e && !e.deletedAt && entityInScope(e, scope)).sort(compareByEmployeeNumber);
    const similarIds = new Set(intakeSuggestions(row, live, scope).map(e => e.id));
    const describe = employee => ({ employee, paused: employee.active === false, sameNumber: sameEmployeeNumber(employee.number, row.number) });
    return { similar: live.filter(e => similarIds.has(e.id)).map(describe), all: live.map(describe) };
}

/** Default daily salary of a position, or null when it has none. */
export function positionDailySuggestion(position, hoursPerDay) {
    const hourly = resolvePositionBaseHourlyRate(position, hoursPerDay);
    return hourly > 0 ? Math.round(hourlyToDaily(hourly, hoursPerDay) * 100) / 100 : null;
}

export function stepsFor(choice) {
    return STEPS[choice?.action] || ['action'];
}

/** Where Mini's number/name are remembered; same scopes the attendance import reads. */
export function intakeAliasScope(entry, owner, projectId) {
    const peerId = String(entry?.peerId || '');
    if (peerId === TEXT_PEER_ID) return buildDefaultMiniAttendanceAliasScope(owner);
    if (!peerId || peerId.startsWith('attendance:')) return null;
    return { ownerUid: String(owner), siteId: String(projectId), sourceId: `peer:${peerId}` };
}

/** A link to an employee with another number must be remembered like the attendance import does. */
export function aliasRecordsForLinks(entry, decisions, employees, owner, projectId) {
    const scope = intakeAliasScope(entry, owner, projectId);
    if (!scope) return [];
    const records = [];
    for (const decision of decisions) {
        if (decision.action !== 'link') continue;
        const source = entry.payload.employees.find(e => e.miniLocalId === decision.miniLocalId);
        const target = employees.find(e => e.id === decision.employeeId);
        if (!source || !target) continue;
        if (normalizeMiniAttendanceNumber(source.number) === normalizeMiniAttendanceNumber(target.number)) continue;
        records.push({
            scope, rawNumber: source.number, rawName: source.name, targetEmployeeId: target.id,
            targetNumberSnapshot: target.number ?? null, targetNameSnapshot: target.name ?? null
        });
    }
    return records;
}
