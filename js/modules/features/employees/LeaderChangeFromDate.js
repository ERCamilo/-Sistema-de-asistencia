/**
 * Cambio de líder con fecha.
 *
 * Regla (usuario, 2026-11-10): al cambiar el líder de un puesto o el líder
 * individual de un empleado, el cambio vale para todo el período de pago
 * abierto o desde la fecha que se elija, por si se anota en la app otro día
 * que en la realidad. Los días anteriores a esa fecha quedan con el líder
 * anterior. Igual para empleados con o sin líder individual.
 *
 * Funciones puras: calculan qué asistencias cambian de equipo registrado y
 * devuelven copias nuevas; quien llama las escribe en el estado y las sube.
 * Solo se toca `positionAssignments` del registro: horas, puesto, importes y
 * cierres quedan intactos, y las nóminas cerradas conservan su propia copia.
 */
import { resolveEmployeePositionTerms } from './EmployeePositionAssignments.js';
import { stampAttendanceWrite } from '../attendance/AttendanceRecordWriter.js';

const text = value => value == null ? '' : String(value);
const clone = value => JSON.parse(JSON.stringify(value));
const DATE_KEY = /\d{4}-\d{2}-\d{2}$/;

/** A change "from" a date starts with its first minute, whenever it is typed into the app. */
export function leaderChangeEffectiveAt(fromDate) {
    return new Date(`${fromDate}T00:00:00`).getTime();
}

const dateOf = (record, key) => record?.date || DATE_KEY.exec(key)?.[0] || '';
const worksPosition = (record, employee, positionId) => {
    const worked = Array.isArray(record.positionHours) && record.positionHours.length
        ? record.positionHours.map(part => part?.positionId || record.selectedPosition || employee?.positions?.[0])
        : [record.selectedPosition || employee?.positions?.[0]];
    return worked.some(value => text(value) === text(positionId));
};
const sameTeam = (first, second) => text(first?.workLeaderId) === text(second?.workLeaderId)
    && text(first?.payerLeaderId) === text(second?.payerLeaderId) && (first?.isLoanPosition === true) === (second?.isLoanPosition === true);

/** Live, present records of the open period, with their employee and date. */
function* workedDays(state, { periodStart, employeeId = null }) {
    const employees = new Map((state.employees || []).map(employee => [text(employee.id), employee]));
    for (const [key, record] of Object.entries(state.attendance || {})) {
        if (!record || record.present !== true || record.deletedAt != null) continue;
        const date = dateOf(record, key);
        if (!date || date < periodStart) continue;
        const employee = employees.get(text(record.employeeId)) || employees.get(key.slice(0, -11));
        if (!employee || employeeId != null && text(employee.id) !== text(employeeId)) continue;
        yield { key, record, date, employee };
    }
}

function teamSnapshot(employee, position, record, date, state, previous, { today = false } = {}) {
    // Never resolve through the stale snapshot, nor as work recorded before the change.
    // `today`: the team the employee has now, whatever the date of the work.
    const terms = resolveEmployeePositionTerms(employee, position,
        { date: today ? '9999-12-31' : date, createdAt: Number.MAX_SAFE_INTEGER }, state);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const dayKind = previous?.dayKind || (record.isHoliday || (state.settings?.holidays || []).includes(date) ? 'holiday'
        : (terms.workingDays || []).includes(weekday) ? 'regular' : 'rest');
    return clone({ ...terms, dayKind });
}

function withSnapshot(record, positionId, snapshot, now) {
    const next = clone(record);
    next.positionAssignments = { ...(next.positionAssignments || {}), [positionId]: snapshot };
    return stampAttendanceWrite(next, now);
}

const result = (records) => ({ records, dateKeys: [...new Set(Object.values(records).map(record => record.date).filter(Boolean))] });

/** How many recorded days of the open period the question is about (0 ⇒ nothing to ask). */
export function countLeaderChangeDays(state, { positionIds = [], periodStart, employeeId = null }) {
    let days = 0;
    for (const { record, employee } of workedDays(state, { periodStart, employeeId })) {
        if (positionIds.some(positionId => worksPosition(record, employee, positionId)
            && (employeeId != null || !employee.positionAssignments?.[positionId]))) days++;
    }
    return days;
}

/**
 * The catalogue leader of a job changed (state already holds the new one).
 * Employees with their own leader for the job do not follow the catalogue.
 *  - before `fromDate`: days that would follow the catalogue keep the previous leader;
 *  - from `fromDate` on: days an earlier dated change had kept now follow the new one.
 */
export function planPositionLeaderChange(state, { positionBefore, fromDate, periodStart, now = Date.now() }) {
    const records = {};
    const positionId = positionBefore?.id;
    const positionAfter = (state.positions || []).find(position => text(position.id) === text(positionId));
    if (!positionAfter || !fromDate || !periodStart) return result(records);
    for (const { key, record, date, employee } of workedDays(state, { periodStart })) {
        if (employee.positionAssignments?.[positionId] || !worksPosition(record, employee, positionId)) continue;
        const kept = record.positionAssignments?.[positionId];
        if (date < fromDate) {
            if (kept?.schemaVersion === 1) continue;
            const snapshot = teamSnapshot(employee, positionBefore, record, date, state);
            if (text(snapshot.workLeaderId) === text(positionAfter.leaderId)) continue; // nothing to protect
            records[key] = withSnapshot({ ...record, date }, positionId, snapshot, now);
        } else if (kept?.schemaVersion === 1) {
            const snapshot = teamSnapshot(employee, positionAfter, record, date, state, kept);
            if (!sameTeam(kept, snapshot)) records[key] = withSnapshot({ ...record, date }, positionId, snapshot, now);
        }
    }
    return result(records);
}

/**
 * The individual leader or payer of an employee changed (state already holds
 * the new assignment, effective at `leaderChangeEffectiveAt(fromDate)`). Days
 * from `fromDate` on that carry the previous team are rewritten; days without
 * recorded terms already follow the effective date, and earlier days are kept.
 */
export function planEmployeeLeaderChange(state, { employeeId, positionIds = [], fromDate, now = Date.now() }) {
    const records = {};
    if (!fromDate) return result(records);
    for (const { key, record, date, employee } of workedDays(state, { periodStart: fromDate, employeeId })) {
        let next = null;
        for (const positionId of positionIds) {
            const kept = record.positionAssignments?.[positionId];
            const position = (state.positions || []).find(item => text(item.id) === text(positionId));
            if (!position || kept?.schemaVersion !== 1 || !worksPosition(record, employee, positionId)) continue;
            const snapshot = teamSnapshot(employee, position, record, date, state, kept);
            if (sameTeam(kept, snapshot)) continue;
            next = withSnapshot(next || { ...record, date }, positionId, snapshot, now);
        }
        if (next) records[key] = next;
    }
    return result(records);
}

/** Team a day is attributed to today, exactly as payroll resolves it. */
function attributedTeam(employee, position, record, date, state) {
    const positionId = position.id;
    if (!employee.positionAssignments?.[positionId] && record.positionAssignments?.[positionId]?.schemaVersion !== 1) {
        const leaderId = position.leaderId ?? null;
        return { workLeaderId: leaderId, payerLeaderId: leaderId, isLoanPosition: false };
    }
    return resolveEmployeePositionTerms(employee, position, { ...record, date }, state);
}

function* daysWithOtherLeader(state, { employeeId, positionId, periodStart }) {
    const position = (state.positions || []).find(item => text(item.id) === text(positionId));
    if (!position) return;
    for (const { key, record, date, employee } of workedDays(state, { periodStart, employeeId })) {
        if (!worksPosition(record, employee, positionId)) continue;
        const kept = record.positionAssignments?.[positionId];
        const target = teamSnapshot(employee, position, record, date, state, kept, { today: true });
        const current = attributedTeam(employee, position, record, date, state);
        if (!sameTeam(current, target)) yield { key, record, date, current, target };
    }
}

/**
 * Days of the open period whose recorded team is not the one the employee has
 * today for that job (an older change that only applied "from now on").
 */
export function findDaysWithOtherLeader(state, { employeeId, positionId, periodStart }) {
    const leaderName = leaderId => (state.leaders || []).find(leader => text(leader.id) === text(leaderId))?.name || '';
    const names = new Set();
    let days = 0, firstDate = '', currentLeaderName = '';
    for (const { date, current, target } of daysWithOtherLeader(state, { employeeId, positionId, periodStart })) {
        days++;
        if (!firstDate || date < firstDate) firstDate = date;
        names.add(leaderName(current.workLeaderId) || current.workLeaderName || 'Sin líder');
        currentLeaderName = leaderName(target.workLeaderId) || 'Sin líder';
    }
    return { days, leaderNames: [...names].sort(), firstDate, currentLeaderName };
}

/** Moves those days, from `fromDate` on, to the team the employee has today. */
export function planAlignLeaderFromDate(state, { employeeId, positionId, fromDate, now = Date.now() }) {
    const records = {};
    if (!fromDate) return result(records);
    for (const { key, record, date, target } of daysWithOtherLeader(state, { employeeId, positionId, periodStart: fromDate })) {
        records[key] = withSnapshot({ ...record, date }, positionId, target, now);
    }
    return result(records);
}
