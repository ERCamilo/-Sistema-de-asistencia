import { state, stateManager, invalidateEmployeeStats, buildAttendanceIndex } from '../../core/AppState.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { stampAttendanceWrite } from './AttendanceRecordWriter.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isValidIsoDate(value) {
    const match = ISO_DATE.exec(value || '');
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day;
}

function isNonNegativeHours(value) {
    return Number.isFinite(value) && value >= 0;
}

function validateWrite(write, date) {
    if (!write || typeof write.key !== 'string' || !write.key) {
        throw new TypeError('Invalid attendance write key');
    }
    const record = write.record;
    const positions = record?.positionHours;
    const positionIds = Array.isArray(positions)
        ? positions.map(position => position?.positionId)
        : [];
    const uniquePositionIds = new Set(positionIds);
    const positionHoursValid = Array.isArray(positions) &&
        positions.length > 0 &&
        positions.every(position =>
            typeof position?.positionId === 'string' &&
            position.positionId &&
            isNonNegativeHours(position.hours) &&
            isNonNegativeHours(position.overtimeHours));
    const positionTotals = positionHoursValid
        ? positions.reduce((totals, position) => ({
            normalHours: totals.normalHours + position.hours,
            overtimeHours: totals.overtimeHours + position.overtimeHours
        }), { normalHours: 0, overtimeHours: 0 })
        : null;
    const malformed = !record ||
        typeof record.employeeId !== 'string' || !record.employeeId ||
        record.date !== date ||
        record.present !== true ||
        !isNonNegativeHours(record.hoursWorked) ||
        !isNonNegativeHours(record.overtimeHours) ||
        record.hoursWorked + record.overtimeHours <= 0 ||
        record.hoursWorked + record.overtimeHours > 24 ||
        typeof record.selectedPosition !== 'string' || !record.selectedPosition ||
        !positionHoursValid ||
        uniquePositionIds.size !== positions?.length ||
        positions?.[0]?.positionId !== record.selectedPosition ||
        record.multiPosition !== (positions?.length > 1) ||
        positionTotals?.normalHours !== record.hoursWorked ||
        positionTotals?.overtimeHours !== record.overtimeHours;
    if (malformed) throw new TypeError(`Malformed attendance write: ${write.key}`);
    if (write.key !== `${record.employeeId}-${date}`) {
        throw new TypeError(`Attendance write key does not match record: ${write.key}`);
    }
}

export function validateMiniAttendanceApplyPlan(plan) {
    if (!plan || !isValidIsoDate(plan.date)) throw new TypeError('Invalid apply plan date');
    if (!Number.isInteger(plan.draftRevision) || plan.draftRevision < 1 ||
        !Number.isInteger(plan.conflictRevision) || plan.conflictRevision < 1 ||
        !Array.isArray(plan.writes) || !Array.isArray(plan.keptKeys)) {
        throw new TypeError('Malformed resolved apply plan');
    }

    const writeKeys = new Set();
    for (const write of plan.writes) {
        validateWrite(write, plan.date);
        if (writeKeys.has(write.key)) throw new TypeError(`Duplicate attendance write key: ${write.key}`);
        writeKeys.add(write.key);
    }
    const keptKeys = new Set();
    for (const key of plan.keptKeys) {
        if (typeof key !== 'string' || !key) throw new TypeError('Invalid kept attendance key');
        if (keptKeys.has(key) || writeKeys.has(key)) {
            throw new TypeError(`Duplicate attendance plan key: ${key}`);
        }
        keptKeys.add(key);
    }
    return true;
}

function runtimeDependencies(overrides = {}) {
    return {
        state,
        stampAttendanceWrite,
        batchSetState: callback => stateManager.batchSetState(callback),
        invalidateEmployeeStats,
        buildAttendanceIndex,
        saveApplicationData,
        ...overrides
    };
}

function mutableClone(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (seen.has(value)) return seen.get(value);

    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    Object.entries(value).forEach(([key, child]) => {
        clone[key] = mutableClone(child, seen);
    });
    return clone;
}

function resultFor(plan, writtenKeys) {
    return Object.freeze({
        date: plan.date,
        appliedCount: writtenKeys.length,
        writtenKeys: Object.freeze([...writtenKeys]),
        keptCount: plan.keptKeys.length,
        keptKeys: Object.freeze([...plan.keptKeys])
    });
}

export async function applyMiniAttendancePlan(plan, {
    now = Date.now(),
    announce = 'Asistencia importada',
    deps = {}
} = {}) {
    validateMiniAttendanceApplyPlan(plan);
    const runtime = runtimeDependencies(deps);
    if (!runtime.state?.attendance || typeof runtime.state.attendance !== 'object') {
        throw new TypeError('Attendance state is unavailable');
    }
    if (plan.writes.length === 0) return resultFor(plan, []);

    const stampedWrites = plan.writes.map(write => ({
        key: write.key,
        employeeId: write.record.employeeId,
        // The review/apply plan is deeply frozen to prevent accidental edits
        // after user approval. Frozen nested arrays cannot be placed directly
        // behind AppState's recursive Proxy: proxying positionHours[0] would
        // violate the ECMAScript invariant for non-configurable properties.
        // Cross the boundary with a fully mutable copy before stamping/storing.
        record: runtime.stampAttendanceWrite(mutableClone(write.record), now)
    }));
    const touchedEmployees = [...new Set(stampedWrites.map(write => write.employeeId))];

    runtime.batchSetState(batchState => {
        const target = batchState || runtime.state;
        for (const write of stampedWrites) target.attendance[write.key] = write.record;
        touchedEmployees.forEach(employeeId => runtime.invalidateEmployeeStats(employeeId));
        runtime.buildAttendanceIndex(plan.date);
    });
    await runtime.saveApplicationData({ dateKey: plan.date, announce });
    return resultFor(plan, stampedWrites.map(write => write.key));
}

export default applyMiniAttendancePlan;
