/**
 * R07 A2c-2 H4 — overlapping repair isolation must not lose a suspended save.
 */
import {
    saveApplicationData,
    beginProjectRepairIsolation,
    endProjectRepairIsolation,
    isProjectRepairIsolationInProgress,
    resumeSuspendedSaveOptions
} from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

function snapshotState() {
    return JSON.parse(JSON.stringify({
        attendance: state.attendance,
        employees: state.employees,
        positions: state.positions,
        leaders: state.leaders,
        settings: state.settings,
        isDataLoaded: state.isDataLoaded,
        useIndexedDB: state.useIndexedDB
    }));
}
function restoreState(s) {
    state.attendance = s.attendance;
    state.employees = s.employees;
    state.positions = s.positions;
    state.leaders = s.leaders;
    state.settings = s.settings;
    state.isDataLoaded = s.isDataLoaded;
    state.useIndexedDB = s.useIndexedDB;
}

describe('ProjectRepairIsolationOverlapR07', () => {
    let snap;
    let flushSpy;

    beforeEach(() => {
        jest.useFakeTimers();
        snap = snapshotState();
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = { ...(state.settings || {}), schemaVersion: 3 };
        state.attendance = {};
        indexedDBService.saveState.mockReset().mockResolvedValue(undefined);
        flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(false);
    });
    afterEach(() => {
        for (let i = 0; i < 10 && isProjectRepairIsolationInProgress(); i++) {
            endProjectRepairIsolation();
        }
        flushSpy?.mockRestore();
        jest.clearAllTimers();
        jest.useRealTimers();
        restoreState(snap);
    });

    test('suspended save survives nested repairs and resumes exactly once after the last release', async () => {
        saveApplicationData({ dateKey: '2026-09-19', announce: 'Guardado pendiente' });
        const suspendedA = beginProjectRepairIsolation();
        expect(suspendedA).toBeTruthy();
        expect(suspendedA.dateKey || suspendedA.dateKeys?.[0]).toBeTruthy();

        const suspendedB = beginProjectRepairIsolation();
        expect(suspendedB).toBeNull();

        resumeSuspendedSaveOptions(suspendedA);
        resumeSuspendedSaveOptions({ dateKey: '2026-09-20' });
        endProjectRepairIsolation();
        await Promise.resolve();
        expect(indexedDBService.saveState).toHaveBeenCalledTimes(0);

        endProjectRepairIsolation();
        await jest.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await Promise.resolve();

        expect(indexedDBService.saveState).toHaveBeenCalledTimes(1);
        const options = indexedDBService.saveState.mock.calls[0][1] || {};
        const dates = new Set([
            ...(Array.isArray(options.dateKeys) ? options.dateKeys : []),
            ...(options.dateKey ? [options.dateKey] : [])
        ]);
        expect([...dates].sort()).toEqual(['2026-09-19', '2026-09-20']);
        expect(options.announce).toBe('Guardado pendiente');
        expect(options.clearFirst).toBeUndefined();
        expect(options.force).toBeUndefined();
    });
});
