/**
 * 🧩 MissingPositionRepair — «Puestos no encontrados» (Multiobra).
 *
 * Incidente 2026-11-16: una restauración cambió el catálogo de puestos y 42
 * empleados quedaron apuntando a 7 ids que ya no existen (ni en el
 * dispositivo ni en la nube). validateDataIntegrity se niega, con razón, a
 * limpiarlos en masa. Este módulo permite REPARARLOS con revisión humana:
 *
 *   1. findMissingPositionReferences: qué ids faltan, quién y qué días los usan
 *      y qué nombre tenían (asignaciones congeladas en la asistencia, en el
 *      empleado o en cierres; o nombres traídos de un respaldo).
 *   2. suggestRepairTarget: el puesto actual con el mismo nombre, en la obra
 *      de esos empleados (sin obra = obra predeterminada). Nunca adivina si
 *      hay dudas.
 *   3. planPositionRepair: cambios exactos por empleado y día, salarios que se
 *      pasan y quién quedará con la tarifa general del puesto.
 *   4. applyPositionRepairPlan / undoPositionRepair: mutan el estado con las
 *      estampas de sincronización y devuelven/consumen los datos para deshacer.
 *
 * Puro: no persiste ni toca la nube; el llamador guarda (saveApplicationData
 * con dateKeys) y reconstruye el índice de asistencia.
 */
import { remapPositionInAttendanceRecord } from '../../services/AttendancePositionAudit.js';
import { stampAttendanceWrite } from '../attendance/AttendanceRecordWriter.js';
import { dailyToHourly, SALARY_MODE } from '../payroll/SalaryConversion.js';

const KEYED_FIELDS = ['positionSalaries', 'positionSalaryModes', 'positionAssignments', 'customWorkingDays'];
const id = value => String(value ?? '').trim();
const list = value => (Array.isArray(value) ? value : []);
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const own = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);

export function normalizePositionName(value) {
    return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ').trim();
}

function dateOfAttendance(record, key) {
    if (record?.date) return String(record.date);
    const match = String(key).match(/(\d{4}-\d{2}-\d{2})$/);
    return match ? match[1] : null;
}

function attendanceUses(record, positionId) {
    if (!record || record.deletedAt) return false;
    if (id(record.selectedPosition) === positionId) return true;
    return list(record.positionHours).some(entry => id(entry?.positionId) === positionId);
}

/** Tarifa por hora general del puesto (sin salario personal). */
export function generalHourlyRate(position, hoursPerDay = 8) {
    const hourly = Number(position?.hourlyRate) || 0;
    if (hourly > 0) return hourly;
    const monthly = Number(position?.salaryConfig?.amount) || 0;
    return monthly > 0 ? monthly / 30 / (Number(hoursPerDay) || 8) : 0;
}

/**
 * @param {{employees, positions, attendance, payrollClosures}} data
 * @param {{defaultProjectId?: string, extraNames?: Object<string,string>}} [options]
 *   extraNames: nombres encontrados fuera del dispositivo (p. ej. respaldos).
 */
export function findMissingPositionReferences(data = {}, { defaultProjectId = null, extraNames = {} } = {}) {
    const catalog = new Set(list(data.positions).map(position => id(position?.id)).filter(Boolean));
    const found = new Map();
    const entry = positionId => {
        if (!found.has(positionId)) {
            found.set(positionId, {
                positionId, employeeIds: new Set(), salaryEmployeeIds: new Set(),
                attendanceKeys: new Set(), projectIds: new Set(), names: new Map()
            });
        }
        return found.get(positionId);
    };
    const hint = (positionId, name, weight = 1) => {
        const clean = String(name ?? '').trim();
        if (!clean || !found.has(positionId)) return;
        const names = found.get(positionId).names;
        names.set(clean, (names.get(clean) || 0) + weight);
    };

    for (const employee of list(data.employees)) {
        if (employee?.deletedAt || employee?.mergedIntoId) continue;
        const employeeId = id(employee.id);
        const referenced = new Set([...list(employee.positions).map(id), ...Object.keys(employee.positionSalaries || {}).map(id)]);
        for (const positionId of referenced) {
            if (!positionId || catalog.has(positionId)) continue;
            const item = entry(positionId);
            if (list(employee.positions).map(id).includes(positionId)) item.employeeIds.add(employeeId);
            if (Number(employee.positionSalaries?.[positionId]) > 0) item.salaryEmployeeIds.add(employeeId);
            const projectId = id(employee.projectId) || id(defaultProjectId);
            if (projectId) item.projectIds.add(projectId);
            hint(positionId, employee.positionAssignments?.[positionId]?.positionName);
        }
    }

    for (const [key, record] of Object.entries(data.attendance || {})) {
        const ids = new Set([id(record?.selectedPosition), ...list(record?.positionHours).map(h => id(h?.positionId))]);
        for (const positionId of ids) {
            if (!positionId || catalog.has(positionId) || !attendanceUses(record, positionId)) continue;
            // Asistencia de un id que ningún empleado usa: también se repara.
            const item = entry(positionId);
            item.attendanceKeys.add(key);
            hint(positionId, record?.positionAssignments?.[positionId]?.positionName);
        }
    }

    for (const closure of list(data.payrollClosures)) {
        for (const row of list(closure?.rows)) {
            for (const part of [...list(row?.positionBreakdown), ...list(row?._positionBreakdown)]) {
                hint(id(part?.positionId), part?.positionName);
            }
        }
    }
    for (const [positionId, name] of Object.entries(extraNames || {})) hint(id(positionId), name, 1000);

    return [...found.values()].map(item => {
        const names = [...item.names.entries()].sort((a, b) => b[1] - a[1]);
        return {
            positionId: item.positionId,
            employeeIds: [...item.employeeIds],
            salaryEmployeeIds: [...item.salaryEmployeeIds],
            attendanceKeys: [...item.attendanceKeys],
            projectIds: [...item.projectIds],
            name: names[0]?.[0] || null,
            nameHints: names.map(([name, count]) => ({ name, count }))
        };
    }).filter(item => item.employeeIds.length || item.salaryEmployeeIds.length || item.attendanceKeys.length)
        .sort((a, b) => b.employeeIds.length - a.employeeIds.length || b.attendanceKeys.length - a.attendanceKeys.length
            || a.positionId.localeCompare(b.positionId));
}

/** Puesto actual con el mismo nombre; null si no hay nombre o hay dudas. */
export function suggestRepairTarget(missing, positions = [], { defaultProjectId = null } = {}) {
    const wanted = normalizePositionName(missing?.name);
    const candidates = wanted
        ? list(positions).filter(position => !position?.deletedAt && normalizePositionName(position?.name) === wanted)
            .map(position => ({ id: id(position.id), name: position.name, projectId: id(position.projectId) || id(defaultProjectId) || null }))
        : [];
    const projects = new Set(list(missing?.projectIds).map(id));
    const sameProject = projects.size ? candidates.filter(candidate => projects.has(id(candidate.projectId))) : candidates;
    const pool = sameProject.length ? sameProject : (projects.size ? [] : candidates);
    return {
        targetId: pool.length === 1 ? pool[0].id : null,
        candidates,
        reason: !wanted ? 'no-name' : !candidates.length ? 'no-match' : pool.length === 1 ? 'same-name' : 'ambiguous'
    };
}

function moveKeyed(map, fromId, toId) {
    const next = { ...(map || {}) };
    let movedValue = false;
    let keptExisting = false;
    if (own(next, fromId)) {
        if (own(next, toId)) keptExisting = true;
        else { next[toId] = next[fromId]; movedValue = true; }
        delete next[fromId];
    }
    return { next, movedValue, keptExisting };
}

function retargetAssignments(assignments, fromId, toId, toName) {
    if (!assignments || !own(assignments, fromId)) return assignments;
    const next = { ...assignments };
    if (!own(next, toId)) {
        const moved = { ...next[fromId] };
        if (own(moved, 'positionId')) moved.positionId = toId;
        if (own(moved, 'positionName') && toName) moved.positionName = toName;
        next[toId] = moved;
    }
    delete next[fromId];
    return next;
}

/**
 * @param {object} data      {employees, positions, attendance}
 * @param {Object<string,{targetId:string, salaries?:Object<string,number>}>} decisions
 *   salaries: salario DIARIO escrito en la revisión, por empleado.
 * @param {{hoursPerDay?: number}} [options]
 */
export function planPositionRepair(data = {}, decisions = {}, { hoursPerDay = 8 } = {}) {
    const positionsById = new Map(list(data.positions).map(position => [id(position?.id), position]));
    const errors = [];
    const mapping = new Map();
    for (const [fromRaw, decision] of Object.entries(decisions || {})) {
        const fromId = id(fromRaw);
        const toId = id(decision?.targetId);
        if (!toId) continue;
        if (positionsById.has(fromId)) errors.push({ code: 'SOURCE_EXISTS', fromId });
        else if (!positionsById.has(toId)) errors.push({ code: 'TARGET_MISSING', fromId, toId });
        else mapping.set(fromId, { toId, target: positionsById.get(toId), salaries: decision?.salaries || {} });
    }
    const stats = {};
    for (const [fromId, { toId }] of mapping) {
        stats[fromId] = { targetId: toId, employees: 0, salaries: 0, keptExistingSalary: 0, generalRate: 0, enteredSalary: 0, days: 0 };
    }
    if (errors.length || !mapping.size) {
        return { ok: false, errors: errors.length ? errors : [{ code: 'NOTHING_TO_DO' }], employeeChanges: [], attendanceChanges: [], dateKeys: [], generalRate: [], stats };
    }

    const employeeChanges = [];
    const generalRate = [];
    for (const employee of list(data.employees)) {
        const positions = list(employee?.positions).map(id);
        const touches = [...mapping.keys()].some(fromId => positions.includes(fromId)
            || KEYED_FIELDS.some(field => own(employee?.[field], fromId)));
        if (!touches) continue;
        const before = {};
        // null = el campo no existía (JSON pierde undefined; deshacer debe borrarlo).
        for (const field of ['positions', ...KEYED_FIELDS]) before[field] = employee[field] === undefined ? null : clone(employee[field]);
        const after = { positions: [...new Set(positions.map(pid => mapping.get(pid)?.toId || pid))] };
        for (const field of KEYED_FIELDS) after[field] = employee[field] ? { ...employee[field] } : employee[field];

        for (const [fromId, { toId, target, salaries }] of mapping) {
            const usesIt = positions.includes(fromId);
            if (usesIt) stats[fromId].employees++;
            const hadSalary = Number(employee.positionSalaries?.[fromId]) > 0;
            if (hadSalary) stats[fromId].salaries++;
            for (const field of ['positionSalaries', 'positionSalaryModes', 'customWorkingDays']) {
                if (!after[field] || !own(after[field], fromId)) continue;
                const moved = moveKeyed(after[field], fromId, toId);
                after[field] = moved.next;
                if (field === 'positionSalaries' && moved.keptExisting && hadSalary) stats[fromId].keptExistingSalary++;
            }
            after.positionAssignments = retargetAssignments(after.positionAssignments, fromId, toId, target?.name);
            const typed = Number(salaries?.[id(employee.id)]);
            if (usesIt && Number.isFinite(typed) && typed > 0) {
                after.positionSalaries = { ...(after.positionSalaries || {}), [toId]: dailyToHourly(typed, hoursPerDay) };
                after.positionSalaryModes = { ...(after.positionSalaryModes || {}), [toId]: SALARY_MODE.DAILY };
                stats[fromId].enteredSalary++;
            } else if (usesIt && !(Number(after.positionSalaries?.[toId]) > 0)) {
                stats[fromId].generalRate++;
                generalRate.push({
                    employeeId: id(employee.id), number: employee.number ?? '', name: employee.name ?? '',
                    fromId, targetId: toId, targetName: target?.name || '',
                    hourlyRate: generalHourlyRate(target, hoursPerDay)
                });
            }
        }
        employeeChanges.push({ employeeId: id(employee.id), before, after });
    }

    const attendanceChanges = [];
    const dateKeys = new Set();
    for (const [key, record] of Object.entries(data.attendance || {})) {
        let current = record;
        let changed = false;
        for (const [fromId, { toId, target }] of mapping) {
            if (!attendanceUses(current, fromId)) continue;
            const remapped = remapPositionInAttendanceRecord(current, { fromId, toId, now: 0 });
            if (!remapped.changed) continue;
            current = { ...remapped.record, positionAssignments: retargetAssignments(remapped.record.positionAssignments, fromId, toId, target?.name) };
            if (current.positionAssignments === undefined) delete current.positionAssignments;
            stats[fromId].days++;
            changed = true;
        }
        if (!changed) continue;
        attendanceChanges.push({ key, before: clone(record), record: current });
        const date = dateOfAttendance(record, key);
        if (date) dateKeys.add(date);
    }

    return { ok: true, errors: [], employeeChanges, attendanceChanges, dateKeys: [...dateKeys], generalRate, stats,
        mapping: Object.fromEntries([...mapping].map(([fromId, { toId }]) => [fromId, toId])) };
}

function setFields(employee, fields, now) {
    for (const [field, value] of Object.entries(fields)) {
        if (value === undefined || value === null) delete employee[field];
        else employee[field] = clone(value);
    }
    employee.updatedAt = now;
    employee.positionsUpdatedAt = now;
    employee._isDirty = true;
}

/** Aplica el plan sobre `data` (en sitio) y devuelve los datos para deshacer. */
export function applyPositionRepairPlan(data, plan, { now = Date.now() } = {}) {
    if (!plan?.ok) throw new Error('El plan de reparación de puestos no es válido');
    const employeesById = new Map(list(data.employees).map(employee => [id(employee?.id), employee]));
    const undo = { version: 1, at: now, mapping: plan.mapping, employees: {}, attendance: {} };
    for (const change of plan.employeeChanges) {
        const employee = employeesById.get(change.employeeId);
        if (!employee) continue;
        undo.employees[change.employeeId] = clone(change.before);
        setFields(employee, change.after, now);
    }
    for (const change of plan.attendanceChanges) {
        undo.attendance[change.key] = clone(change.before);
        data.attendance[change.key] = stampAttendanceWrite(change.record, now);
    }
    undo.dateKeys = [...plan.dateKeys];
    return undo;
}

/** Revierte una reparación con los datos que devolvió applyPositionRepairPlan. */
export function undoPositionRepair(data, undo, { now = Date.now() } = {}) {
    if (!undo || undo.version !== 1) throw new Error('No hay una reparación de puestos para deshacer');
    const employeesById = new Map(list(data.employees).map(employee => [id(employee?.id), employee]));
    const employeeIds = [];
    for (const [employeeId, fields] of Object.entries(undo.employees || {})) {
        const employee = employeesById.get(employeeId);
        if (!employee) continue;
        setFields(employee, fields, now);
        employeeIds.push(employeeId);
    }
    for (const [key, record] of Object.entries(undo.attendance || {})) {
        if (!record) continue;
        data.attendance[key] = stampAttendanceWrite(record, now);
    }
    return { employeeIds, attendanceKeys: Object.keys(undo.attendance || {}), dateKeys: [...(undo.dateKeys || [])] };
}

export default {
    findMissingPositionReferences, suggestRepairTarget, planPositionRepair,
    applyPositionRepairPlan, undoPositionRepair, generalHourlyRate, normalizePositionName
};
