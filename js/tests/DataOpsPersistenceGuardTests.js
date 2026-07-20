import {
    beginDataOperation,
    endDataOperation,
    isDataOperationInProgress,
    saveApplicationData
} from '../modules/services/PersistenceService.js';
import {
    eraseCloudData,
    replaceCloudWithLocal,
    replaceLocalWithCloud
} from '../modules/services/DataOps.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';

testRunner.addSuite('PersistenceService — guard común de DataOps (Change B / 4a)', {
    async 'bloquea sólo el canal cloud implícito y conserva el guardado local'() {
        const enqueueMirror = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const previousLoaded = state.isDataLoaded;
        const previousIndexedDB = state.useIndexedDB;
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            indexedDBService.saveState.mockClear();
            beginDataOperation();

            await saveApplicationData({ immediate: true, skipValidation: true });
            testRunner.assertEquals(enqueueMirror.mock.calls.length, 0,
                'DataOps no debe permitir que un guardado implícito repueble la nube');
            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1,
                'el guard común no debe perder cambios locales concurrentes');
        } finally {
            endDataOperation();
            enqueueMirror.mockRestore();
            state.isDataLoaded = previousLoaded;
            state.useIndexedDB = previousIndexedDB;
        }
    },

    async 'las tres operaciones levantan el guard antes del primer efecto y lo liberan al terminar'() {
        const observed = [];
        const check = (name) => {
            observed.push(`${name}:${isDataOperationInProgress()}`);
        };

        await replaceCloudWithLocal({
            createSafetySnapshot: jest.fn(async () => check('replace-cloud')),
            purgePending: jest.fn().mockResolvedValue(true),
            deleteCloud: jest.fn().mockResolvedValue({ deleted: 0 }),
            uploadFullState: jest.fn().mockResolvedValue(undefined),
            uploadHistory: jest.fn().mockResolvedValue(undefined)
        });
        testRunner.assertEquals(isDataOperationInProgress(), false, 'replaceCloudWithLocal debe liberar el guard');

        await eraseCloudData({}, {
            purgePending: jest.fn(async () => { check('erase-cloud'); return true; }),
            deleteCloud: jest.fn().mockResolvedValue({ deleted: 0 })
        });
        testRunner.assertEquals(isDataOperationInProgress(), false, 'eraseCloudData debe liberar el guard');

        await replaceLocalWithCloud({
            fetchFullState: jest.fn(async () => {
                check('replace-local');
                return { settings: { schemaVersion: 0 } };
            }),
            fetchAllAttendance: jest.fn().mockResolvedValue({}),
            wipeLocal: jest.fn().mockResolvedValue({ ok: true, errors: [] }),
            persistState: jest.fn().mockResolvedValue(undefined),
            reload: jest.fn()
        });
        testRunner.assertEquals(isDataOperationInProgress(), false, 'replaceLocalWithCloud debe liberar el guard');
        testRunner.assertEquals(
            observed.join(','),
            'replace-cloud:true,erase-cloud:true,replace-local:true',
            'el guard debe estar activo ANTES del primer await de cada operación'
        );
    },

    async 'libera el guard aunque una operación falle'() {
        await replaceCloudWithLocal({
            createSafetySnapshot: jest.fn().mockRejectedValue(new Error('offline'))
        });
        testRunner.assertEquals(isDataOperationInProgress(), false,
            'un retorno de error no puede dejar bloqueada la sincronización de la sesión');
    }
});
