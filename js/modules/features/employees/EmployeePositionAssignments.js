import { entityInScope } from '../projects/ProjectContext.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { resolveRestDayFactor } from '../payroll/PayrollFactors.js';

const copy = value => JSON.parse(JSON.stringify(value));
const id = value => value == null || value === '' ? null : String(value);
const configuration = value => ({
    workLeaderId: id(value?.workLeaderId),
    isLoanPosition: value?.isLoanPosition === true,
    payerLeaderId: id(value?.payerLeaderId),
    payerChosen: value?.payerChosen === true
});

export function getEmployeePositionAssignment(employee, position) {
    const saved = employee?.positionAssignments?.[position?.id];
    return saved ? configuration(saved) : {
        workLeaderId: id(position?.leaderId), isLoanPosition: false,
        payerLeaderId: null, payerChosen: false
    };
}

export function effectivePositionLeaderId(employee, position) {
    return getEmployeePositionAssignment(employee, position).workLeaderId;
}

function currentTerms(employee, position, { settings = {}, leaders = [] } = {}) {
    const assignment = getEmployeePositionAssignment(employee, position);
    const workLeaderId = assignment.workLeaderId;
    const payerLeaderId = assignment.isLoanPosition ? assignment.payerLeaderId : workLeaderId;
    const leader = leaders.find(item => id(item.id) === workLeaderId);
    const payer = leaders.find(item => id(item.id) === payerLeaderId);
    const hourlyRate = Number(employee?.positionSalaries?.[position.id]) || Number(position.hourlyRate)
        || Number(position.salaryConfig?.amount || 0) / 30 / (Number(settings.regularHoursPerDay) || 8);
    return {
        schemaVersion: 1, positionId: String(position.id), positionName: position.name || '',
        positionColor: position.color || '', ...assignment, payerLeaderId,
        workLeaderName: leader?.name || '', payerLeaderName: payer?.name || '',
        hourlyRate, workingDays: [...(employee?.customWorkingDays?.[position.id] || position.workingDays || [1, 2, 3, 4, 5])],
        overtimeFactor: settings.overtimeFactor ?? 1, holidayFactor: settings.holidayFactor ?? 2,
        restDayFactor: resolveRestDayFactor(position, leader, settings)
    };
}

/** New assignments do not reinterpret unsnapshotted work predating the edit. */
export function resolveEmployeePositionTerms(employee, position, record, context = {}) {
    const captured = record?.positionAssignments?.[position?.id];
    if (captured?.schemaVersion === 1) return captured;
    const saved = employee?.positionAssignments?.[position?.id];
    if (record && saved?.effectiveAt) {
        const recordedAt = Date.parse(record.createdAt) || Number(record.createdAt) || Number(record.updatedAt) || 0;
        const date = record.date || '';
        const editDate = getDateKey(new Date(saved.effectiveAt));
        if (date < editDate || date === editDate && recordedAt < saved.effectiveAt) {
            const history = [...(saved.history || [])].sort((a, b) => a.effectiveAt - b.effectiveAt);
            const previous = history.filter(item => {
                const day = getDateKey(new Date(item.effectiveAt));
                return day < date || day === date && item.effectiveAt <= recordedAt;
            }).pop() || history[0];
            if (previous?.terms) return previous.terms;
        }
    }
    return currentTerms(employee, position, context);
}

/** Pure local-write boundary. Existing terms survive note/hour edits and undo. */
export function captureAttendancePositionAssignments(record, state, now = Date.now()) {
    if (!record?.present || !state || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return record;
    const employee = (state.employees || []).find(item => id(item.id) === id(record.employeeId));
    if (!employee) return record;
    const positions = (record.positionHours?.length ? record.positionHours.map(part => part.positionId)
        : [record.selectedPosition || employee.positions?.[0]]).filter(Boolean);
    const snapshots = { ...(record.positionAssignments || {}) };
    const existing = state.attendance?.[`${record.employeeId}-${record.date}`];
    const previousPositions = existing?.positionHours?.length ? existing.positionHours.map(part => String(part.positionId))
        : [String(existing?.selectedPosition || employee.positions?.[0])];
    for (const positionId of positions) {
        if (snapshots[positionId]?.schemaVersion === 1 || !employee.positionAssignments?.[positionId]) continue;
        const position = (state.positions || []).find(item => id(item.id) === id(positionId));
        if (!position) continue;
        const preserve = existing?.present === true && previousPositions.includes(String(positionId));
        if (preserve && existing.positionAssignments?.[positionId]) {
            snapshots[positionId] = copy(existing.positionAssignments[positionId]);
            continue;
        }
        const reference = preserve ? existing : { ...record, createdAt: record.createdAt || now };
        const terms = resolveEmployeePositionTerms(employee, position, reference, state);
        const date = new Date(`${record.date}T12:00:00`);
        snapshots[positionId] = copy({ ...terms, dayKind: record.isHoliday || (state.settings?.holidays || []).includes(record.date)
            ? 'holiday' : terms.workingDays.includes(date.getDay()) ? 'regular' : 'rest' });
    }
    return Object.keys(snapshots).length ? { ...record, positionAssignments: snapshots } : record;
}

export function prepareEmployeePositionAssignments(employee, requested = {}, state, now = Date.now(), salaries = null) {
    const result = copy(employee?.positionAssignments || {});
    for (const [positionId, value] of Object.entries(requested)) {
        const position = state.positions.find(item => id(item.id) === id(positionId));
        if (!position) throw new Error('El puesto ya no está disponible. Recarga el empleado.');
        const next = configuration(value);
        const available = leaderId => (state.leaders || []).some(leader => id(leader.id) === leaderId
            && (!state.assignmentScope || entityInScope(leader, state.assignmentScope)));
        const previous = employee?.positionAssignments?.[positionId];
        const changed = JSON.stringify(configuration(previous)) !== JSON.stringify(next) || !previous
            || salaries !== null && Number(salaries[positionId] || 0) !== Number(employee?.positionSalaries?.[positionId] || 0);
        if (changed && ((next.workLeaderId && !available(next.workLeaderId))
            || next.isLoanPosition && (!next.workLeaderId || !next.payerLeaderId || !available(next.payerLeaderId)))) {
            throw new Error('Elige líderes válidos para la posición de préstamo.');
        }
        if (!changed) { result[positionId] = copy(previous); continue; }
        const history = previous?.history ? copy(previous.history) : [];
        history.push({ effectiveAt: previous?.effectiveAt || 0, terms: currentTerms(employee, position, state) });
        result[positionId] = { ...next, effectiveAt: now, history };
    }
    return result;
}

export function assignmentConfigurationChanged(first = {}, second = {}) {
    return JSON.stringify(Object.keys(first).sort().map(key => [key, configuration(first[key])]))
        !== JSON.stringify(Object.keys(second).sort().map(key => [key, configuration(second[key])]));
}
