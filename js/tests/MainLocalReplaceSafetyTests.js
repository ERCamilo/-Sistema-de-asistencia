import { wipeMainLocalTraces } from '../modules/services/LocalWipeService.js';

testRunner.addSuite('Reemplazo nube→local — preserva dominios no cubiertos', {
    async 'limpia sólo dataset principal y nunca Caja Chica, comprobantes ni cierres'() {
        const cleared = [];
        const result = await wipeMainLocalTraces({
            beginWipe: () => {},
            purgePendingCloudWrites: async () => true,
            clearMainStorage: () => true,
            clearStore: async (store) => { cleared.push(store); return true; }
        });
        testRunner.assertEquals(result.ok, true);
        ['employees', 'positions', 'leaders', 'attendance', 'settings', 'sync_queue', 'mainSyncOutbox'].forEach(store =>
            testRunner.assert(cleared.includes(store), `debe limpiar ${store}`)
        );
        ['pettyCashProjects', 'pettyCashPeriods', 'pettyCashMovements', 'pettyCashReceipts', 'payrollClosures'].forEach(store =>
            testRunner.assert(!cleared.includes(store), `no puede borrar ${store}`)
        );
    }
});
