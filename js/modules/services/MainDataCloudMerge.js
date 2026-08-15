/**
 * Reads every source required by the principal dataset before changing local
 * state. The caller owns persistence, so this module never writes to cloud.
 */
export async function mergeMainDataFromCloud(deps = {}) {
    const {
        state,
        fetchFullState,
        loadEmployees,
        loadPositions,
        loadLeaders,
        fetchAllAttendance,
        mergeEmployees,
        mergePositions,
        mergeLeaders,
        mergeAttendance
    } = deps;
    if (!state || typeof fetchFullState !== 'function') return { ok: false, reason: 'invalid-deps' };
    try {
        const remoteState = await fetchFullState();
        if (!remoteState) return { ok: false, reason: 'no-cloud-data' };
        const schemaVersion = Number(remoteState.settings?.schemaVersion ?? remoteState.schemaVersion ?? 0);
        const [employees, positions, leaders, attendance] = await Promise.all([
            schemaVersion >= 2 ? loadEmployees?.() : Promise.resolve(remoteState.employees || []),
            schemaVersion >= 3 ? loadPositions?.() : Promise.resolve(remoteState.positions || []),
            schemaVersion >= 3 ? loadLeaders?.() : Promise.resolve(remoteState.leaders || []),
            fetchAllAttendance?.()
        ]);
        if (![employees, positions, leaders].every(Array.isArray) || !attendance || typeof attendance !== 'object') {
            return { ok: false, reason: 'read-incomplete' };
        }
        // Every source is available: only now may the verified per-domain rules run.
        // This service stays pure; the caller applies these values inside the app state batch.
        return {
            ok: true,
            merged: {
                employees: mergeEmployees(state.employees || [], employees),
                positions: mergePositions(state.positions || [], positions),
                leaders: mergeLeaders(state.leaders || [], leaders),
                attendance: mergeAttendance(state.attendance || {}, attendance)
            }
        };
    } catch (error) {
        console.error('❌ mergeMainDataFromCloud: no se aplicó una fusión incompleta:', error);
        return { ok: false, reason: 'fetch-failed', error };
    }
}

export default { mergeMainDataFromCloud };
