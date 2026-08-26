export const ATTENDANCE_RETENTION_MONTHS = 12;
export const HISTORICAL_ACCESS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const REQUIRED_TOMBSTONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function validDateKey(value) {
    if (!DATE_KEY.test(value || '')) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function attendanceRetentionStart(now = Date.now(), months = ATTENDANCE_RETENTION_MONTHS) {
    const source = new Date(now);
    const originalDay = source.getDate();
    const firstOfTarget = new Date(source.getFullYear(), source.getMonth() - months, 1);
    const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
    firstOfTarget.setDate(Math.min(originalDay, lastDay));
    return formatDateKey(firstOfTarget);
}

function dateForRecord(key, record) {
    const explicit = record?.date;
    if (validDateKey(explicit)) return explicit;
    const suffix = String(key).slice(-10);
    return validDateKey(suffix) ? suffix : null;
}

export function planAttendanceEviction(attendance, {
    now = Date.now(),
    protectedDateKeys = new Set(),
    retentionMonths = ATTENDANCE_RETENTION_MONTHS,
    accessRetentionMs = HISTORICAL_ACCESS_RETENTION_MS,
    tombstoneRetentionMs = REQUIRED_TOMBSTONE_RETENTION_MS,
    // F1.5 (ADR-008): con scope activo, la retención es POR REGISTRO/POR
    // PROYECTO — jamás evicta datos de otro proyecto efectivo. Null/OFF ⇒
    // comportamiento whole-day legacy exacto.
    scope = null
} = {}) {
    const cutoffDate = attendanceRetentionStart(now, retentionMonths);
    const scopeActive = !!(scope && scope.enabled && scope.projectId);
    const kept = {};
    const evictKeys = [];

    for (const [key, record] of Object.entries(attendance || {})) {
        const date = dateForRecord(key, record);
        const recentlyAccessed = Number.isFinite(record?.lastAccessed)
            && now - record.lastAccessed <= accessRetentionMs;
        const requiredTombstone = Number.isFinite(record?.deletedAt)
            && now - record.deletedAt <= tombstoneRetentionMs;
        let mustKeep = !date || date >= cutoffDate || protectedDateKeys.has(date)
            || recentlyAccessed || requiredTombstone;
        if (!mustKeep && scopeActive) {
            // Registro sin projectId ⇒ proyecto predeterminado (F0.4 §2). Si el
            // default no se pudo resolver, eff queda null ≠ projectId ⇒ KEEP
            // (conservador: nunca se poda lo que podría ser de otro proyecto).
            const effectiveProjectId = record?.projectId ?? scope.defaultProjectId ?? null;
            mustKeep = effectiveProjectId !== scope.projectId;
        }

        if (mustKeep) kept[key] = record;
        else evictKeys.push(key);
    }

    return { kept, evictKeys, cutoffDate };
}

export default planAttendanceEviction;
