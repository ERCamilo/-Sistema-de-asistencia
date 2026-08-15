import { mergeMainDataFromCloud } from '../modules/services/MainDataCloudMerge.js';

testRunner.addSuite('Fusionar datos principales — alcance verificable', {
    async 'aplica sólo datos principales después de leer todas las fuentes'() {
        const state = { employees: [{ id: 'e1', updatedAt: 20 }], positions: [], leaders: [], attendance: { local: { updatedAt: 20 } } };
        const result = await mergeMainDataFromCloud({
            state,
            fetchFullState: async () => ({ settings: { schemaVersion: 3 } }),
            loadEmployees: async () => [{ id: 'e1', updatedAt: 10 }, { id: 'e2', updatedAt: 30 }],
            loadPositions: async () => [{ id: 'p1', updatedAt: 10 }],
            loadLeaders: async () => [],
            fetchAllAttendance: async () => ({ remote: { updatedAt: 30 } }),
            mergeEmployees: (local, remote) => [...local, ...remote],
            mergePositions: (_local, remote) => remote,
            mergeLeaders: (_local, remote) => remote,
            mergeAttendance: (local, remote) => ({ ...local, ...remote })
        });
        testRunner.assertEquals(result.ok, true);
        testRunner.assertEquals(result.merged.employees.length, 3);
        testRunner.assert(!!result.merged.attendance.remote);
        testRunner.assertEquals(state.employees.length, 1, 'el servicio no escribe state directamente');
    },

    async 'no muta si falla una lectura de entidad'() {
        const state = { employees: [{ id: 'local' }], positions: [], leaders: [], attendance: {} };
        const result = await mergeMainDataFromCloud({
            state, fetchFullState: async () => ({ settings: { schemaVersion: 3 } }),
            loadEmployees: async () => null, loadPositions: async () => [], loadLeaders: async () => [],
            fetchAllAttendance: async () => ({}), mergeEmployees: () => [], mergePositions: () => [], mergeLeaders: () => [], mergeAttendance: () => ({})
        });
        testRunner.assertEquals(result.ok, false);
        testRunner.assertEquals(state.employees[0].id, 'local');
    }
});
