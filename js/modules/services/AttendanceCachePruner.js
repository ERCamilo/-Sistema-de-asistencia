import { planAttendanceEviction } from './AttendanceRetentionPolicy.js';

/** Applies the pure retention plan to IndexedDB first, then to in-memory state. */
export function createAttendanceCachePruner({
    readAttendance,
    writeAttendance,
    getProtectedDateKeys,
    deleteRecords,
    onPruned = () => {},
    now = Date.now
}) {
    return {
        async prune() {
            const protectedDateKeys = await getProtectedDateKeys();
            const plan = planAttendanceEviction(readAttendance(), {
                now: now(),
                protectedDateKeys
            });

            if (plan.evictKeys.length === 0) {
                return { evicted: 0, cutoffDate: plan.cutoffDate };
            }

            await deleteRecords(plan.evictKeys);
            writeAttendance(plan.kept);
            onPruned();
            return { evicted: plan.evictKeys.length, cutoffDate: plan.cutoffDate };
        }
    };
}

export default createAttendanceCachePruner;
