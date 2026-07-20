import { mergeAttendanceRecords } from '../features/attendance/AttendanceMerge.js';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value) {
    if (!DATE_KEY.test(value || '')) return false;
    const parsed = new Date(`${value}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function recordDate(key, record) {
    return record?.date || String(key).slice(-10);
}

/** Loads an explicit attendance range and marks only that user request as access. */
export function createAttendanceRangeLoader({
    fetchRange,
    readAttendance,
    writeAttendance,
    persistRecords,
    onApplied = () => {},
    now = Date.now
}) {
    const inFlight = new Map();

    async function load(startDate, endDate) {
        const remote = await fetchRange(startDate, endDate);
        const merged = mergeAttendanceRecords(readAttendance(), remote);
        const accessedAt = now();
        const touched = [];
        const dateKeys = new Set();

        for (const [key, record] of Object.entries(merged)) {
            const date = recordDate(key, record);
            if (date < startDate || date > endDate) continue;
            const accessed = { ...record, lastAccessed: accessedAt };
            merged[key] = accessed;
            touched.push({ key, ...accessed });
            dateKeys.add(date);
        }

        writeAttendance(merged);
        await persistRecords(touched);
        const sortedDateKeys = [...dateKeys].sort();
        onApplied(sortedDateKeys);
        return { count: touched.length, dateKeys: sortedDateKeys };
    }

    return {
        ensureRange(startDate, endDate) {
            if (!isValidDateKey(startDate) || !isValidDateKey(endDate) || startDate > endDate) {
                return Promise.reject(new Error('Invalid attendance range'));
            }
            const key = `${startDate}:${endDate}`;
            if (inFlight.has(key)) return inFlight.get(key);
            const request = load(startDate, endDate).finally(() => inFlight.delete(key));
            inFlight.set(key, request);
            return request;
        }
    };
}

export default createAttendanceRangeLoader;
