import {
    beginDataOperation,
    endDataOperation,
    flushPendingSave,
    saveApplicationData,
    syncFirebaseMirrorDebounced
} from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import dataService from '../modules/services/DataService.js';
import { state } from '../modules/core/AppState.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe('PersistenceService — cableado de cadencia del mirror (Change B / 4b)', () => {
    let previousState;

    beforeEach(() => {
        previousState = {
            isDataLoaded: state.isDataLoaded,
            useIndexedDB: state.useIndexedDB,
            settings: state.settings,
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: state.attendance
        };
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = { schemaVersion: 4 };
        state.employees = [];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        globalThis.currentUser = { uid: 'cadence-user' };
        globalThis._isApplyingRemoteData = false;
        indexedDBService.saveState.mockResolvedValue(true);
        dataService.saveAll.mockReturnValue(false);
        syncFirebaseMirrorDebounced.discard?.();
    });

    afterEach(() => {
        syncFirebaseMirrorDebounced.discard?.();
        endDataOperation();
        globalThis.currentUser = null;
        globalThis._isApplyingRemoteData = false;
        Object.assign(state, previousState);
        jest.restoreAllMocks();
    });

    test('el shim encola el primero y conserva sólo el último hasta flush', async () => {
        const enqueue = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        await syncFirebaseMirrorDebounced({ revision: 1 });
        await syncFirebaseMirrorDebounced({ revision: 2 });
        await syncFirebaseMirrorDebounced({ revision: 3 });
        expect(enqueue).toHaveBeenCalledTimes(1);

        await syncFirebaseMirrorDebounced.flush();
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueue).toHaveBeenLastCalledWith({ revision: 3 });
    });

    test('beginDataOperation descarta el trailing para que una purga no reviva datos', async () => {
        const enqueue = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        await syncFirebaseMirrorDebounced({ revision: 1 });
        await syncFirebaseMirrorDebounced({ revision: 2 });
        beginDataOperation();
        endDataOperation();
        await syncFirebaseMirrorDebounced.flush();

        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    test('dos saves mantienen granularidad pero el mirror completo queda gated', async () => {
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const entities = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        const settings = jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        await saveApplicationData({ immediate: true, skipValidation: true });
        await saveApplicationData({ immediate: true, skipValidation: true });
        await tick();

        expect(mirror).toHaveBeenCalledTimes(1);
        expect(entities).toHaveBeenCalledTimes(2);
        expect(settings).toHaveBeenCalledTimes(2);
    });

    test('requireLocalSuccess no encola nube cuando IndexedDB y el respaldo local fallan', async () => {
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const entities = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        const settings = jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        const flush = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        state.settings.localUpdatedAt = 123;
        indexedDBService.saveState.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
        dataService.saveAll.mockReturnValueOnce(false);

        const outcome = await saveApplicationData({
            immediate: true,
            skipValidation: true,
            requireLocalSuccess: true,
            awaitOutboxEnqueue: true
        });

        expect(outcome).toEqual({ localOk: false, cloudRequested: false });
        expect(mirror).not.toHaveBeenCalled();
        expect(entities).not.toHaveBeenCalled();
        expect(settings).not.toHaveBeenCalled();
        expect(flush).not.toHaveBeenCalled();
        expect(state.settings.localUpdatedAt).toBe(123);
    });

    test('requireLocalSuccess no confirma almacenamiento mientras se aplican datos remotos', async () => {
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const entities = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        const settings = jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        const flush = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        indexedDBService.saveState.mockClear();
        dataService.saveAll.mockClear();
        globalThis._isApplyingRemoteData = true;

        const outcome = await saveApplicationData({
            immediate: true,
            skipValidation: true,
            requireLocalSuccess: true,
            awaitOutboxEnqueue: true
        });

        expect(outcome).toEqual({ localOk: false, cloudRequested: false });
        expect(indexedDBService.saveState).not.toHaveBeenCalled();
        expect(dataService.saveAll).not.toHaveBeenCalled();
        expect(mirror).not.toHaveBeenCalled();
        expect(entities).not.toHaveBeenCalled();
        expect(settings).not.toHaveBeenCalled();
        expect(flush).not.toHaveBeenCalled();
    });

    test('requireLocalSuccess confirma almacenamiento antes de solicitar la sincronización normal', async () => {
        let localConfirmed = false;
        indexedDBService.saveState.mockImplementationOnce(async () => {
            localConfirmed = true;
        });
        const assertLocalFirst = jest.fn(async () => {
            expect(localConfirmed).toBe(true);
        });
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockImplementation(assertLocalFirst);
        const entities = jest.spyOn(MainSyncStore, 'enqueueEntities').mockImplementation(assertLocalFirst);
        const settings = jest.spyOn(MainSyncStore, 'enqueueSettings').mockImplementation(assertLocalFirst);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        const outcome = await saveApplicationData({
            immediate: true,
            skipValidation: true,
            requireLocalSuccess: true,
            awaitOutboxEnqueue: true
        });

        expect(outcome).toEqual({ localOk: true, cloudRequested: true });
        expect(mirror).toHaveBeenCalledTimes(1);
        expect(entities).toHaveBeenCalledTimes(1);
        expect(settings).toHaveBeenCalledTimes(1);
    });

    test('flushPendingSave fuerza el snapshot del save debounced al ocultar', async () => {
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        await syncFirebaseMirrorDebounced({ revision: 'previous' });
        saveApplicationData({ skipValidation: true });
        expect(flushPendingSave()).toBe(true);
        await tick();

        expect(mirror).toHaveBeenCalledTimes(2);
    });

    test('awaitOutboxEnqueue fuerza el mirror para restauraciones críticas', async () => {
        const mirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);

        await saveApplicationData({ immediate: true, skipValidation: true });
        await saveApplicationData({ immediate: true, skipValidation: true, awaitOutboxEnqueue: true });

        expect(mirror).toHaveBeenCalledTimes(2);
    });
});
