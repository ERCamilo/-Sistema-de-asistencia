import { intakeSuggestions } from './MiniEmployeeIntake.js';
import { sameEmployeeNumber } from '../employees/EmployeeNumberIdentity.js';
import { resolvePositionBaseHourlyRate } from '../employees/EmployeePositionMetrics.js';
import { hourlyToDaily } from '../payroll/SalaryConversion.js';
import { normalizePersonName } from '../projects/ProjectDuplicateCandidates.js';
import { rankMiniAttendanceEmployeeSuggestions } from '../attendance/MiniAttendanceDraft.js';
import { entityInScope } from '../projects/ProjectContext.js';
import { normalizeMiniAttendanceNumber, normalizeMiniAttendanceName } from '../attendance/MiniAttendanceDraft.js';
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

const nameTokens = name => normalizePersonName(name).split(' ').filter(Boolean);

/** Same words (any order), one name contained in the other, or a near-identical spelling. */
function similarName(a, b) {
    const left = nameTokens(a), right = nameTokens(b);
    if (!left.length || !right.length) return false;
    const [short, long] = left.length <= right.length ? [left, right] : [right, left];
    if (short.every(token => long.includes(token))) return true;
    const ranked = rankMiniAttendanceEmployeeSuggestions({ rawNumber: '', rawName: a, employees: [{ id: 'x', name: b, number: '' }], limit: 1 });
    return (ranked[0]?.nameScore || 0) >= 0.88;
}

/** The only active SA employee with Mini's number and a similar name: safe to offer a one-tap link. */
export function quickMatch(row, employees, scope) {
    const matches = buildCandidateLists(row, employees, scope).all
        .filter(c => c.sameNumber && !c.paused && similarName(row.name, c.employee.name));
    return matches.length === 1 ? matches[0].employee : null;
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

/** Links to a SA record whose number or name differs from Mini's must be remembered like the attendance import does. */
export function aliasRecordsForMappings(entry, mappings, employees, owner, projectId) {
    const scope = intakeAliasScope(entry, owner, projectId);
    if (!scope) return [];
    const records = [];
    for (const mapping of mappings) {
        const source = entry.payload.employees.find(e => e.miniLocalId === mapping.miniLocalId);
        const target = employees.find(e => e.id === mapping.saEmployeeId);
        if (!source || !target) continue;
        if (normalizeMiniAttendanceNumber(source.number) === normalizeMiniAttendanceNumber(target.number)
            && normalizeMiniAttendanceName(source.name) === normalizeMiniAttendanceName(target.name)) continue;
        records.push({
            scope, rawNumber: source.number, rawName: source.name, targetEmployeeId: target.id,
            targetNumberSnapshot: target.number ?? null, targetNameSnapshot: target.name ?? null
        });
    }
    return records;
}

export function aliasRecordsForLinks(entry, decisions, employees, owner, projectId) {
    const links = decisions.filter(d => d.action === 'link').map(d => ({ miniLocalId: d.miniLocalId, saEmployeeId: d.employeeId }));
    return aliasRecordsForMappings(entry, links, employees, owner, projectId);
}
