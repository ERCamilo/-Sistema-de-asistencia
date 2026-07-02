/**
 * 🧪 DataOpsEraseCloudTests (Fase 0.5, U6)
 *
 * "Borrar Nube" real. El deleteCloudData de FirebaseService ya borra todas
 * las colecciones + el doc espejo, pero el FLUJO tenía dos agujeros:
 *   - No purgaba el outbox ni las colas legacy → los pendientes drenaban en
 *     el próximo save/online/login y RE-CREABAN datos en la nube recién
 *     borrada (el usuario ve que "la nube no se borra de verdad").
 *   - No ofrecía borrar los snapshots ni pausar la subida — sin pausa, el
 *     próximo guardado ordinario re-sube el estado local completo (por
 *     diseño del save loop, pero hay que decírselo al usuario y darle la
 *     opción de dejarla vacía de verdad).
 */

import { eraseCloudData } from '../modules/services/DataOps.js';

function makeDeps(overrides = {}) {
    return {
        purgePending: jest.fn().mockResolvedValue(true),
        deleteCloud: jest.fn().mockResolvedValue({ deleted: 10 }),
        deleteSnapshotsOfType: jest.fn().mockResolvedValue(undefined),
        pauseUpload: jest.fn(),
        ...overrides
    };
}

testRunner.addSuite("DataOps — eraseCloudData (Fase 0.5, U6)", {

    async "purga los pendientes ANTES de borrar la nube (si no, el drenado la re-crea al instante)"() {
        const order = [];
        const deps = makeDeps({
            purgePending: jest.fn(async () => { order.push('purge'); return true; }),
            deleteCloud: jest.fn(async () => { order.push('delete'); return { deleted: 10 }; })
        });

        const result = await eraseCloudData({}, deps);

        testRunner.assertEquals(result.ok, true);
        testRunner.assertEquals(order.join('→'), 'purge→delete',
            'la purga va primero: un flush disparado durante el borrado subiría pendientes viejos a la nube recién vaciada');
    },

    async "borra TODAS las colecciones (sin lista acotada — a diferencia de Subir y Reemplazar)"() {
        const deps = makeDeps();

        await eraseCloudData({}, deps);

        testRunner.assertEquals(deps.deleteCloud.mock.calls[0].length, 0,
            'debe llamar deleteCloud() sin acotar — Borrar Nube es el borrado completo');
    },

    async "sin opciones, NO toca los snapshots ni pausa la subida"() {
        const deps = makeDeps();

        await eraseCloudData({}, deps);

        testRunner.assertEquals(deps.deleteSnapshotsOfType.mock.calls.length, 0,
            'los snapshots son la red de seguridad — sólo se borran si el usuario lo pide explícitamente');
        testRunner.assertEquals(deps.pauseUpload.mock.calls.length, 0);
    },

    async "alsoSnapshots: borra los snapshots auto Y manuales (los protegidos los respeta la capa de abajo)"() {
        const deps = makeDeps();

        await eraseCloudData({ alsoSnapshots: true }, deps);

        const types = deps.deleteSnapshotsOfType.mock.calls.map(c => c[0]).sort();
        testRunner.assertEquals(types.join(','), 'auto,manual',
            'debe borrar ambos tipos — deleteSnapshotsByType ya ignora protegidos y pre-restore');
    },

    async "pauseUpload: pausa la subida tras el borrado para que la nube quede vacía DE VERDAD"() {
        const deps = makeDeps();

        await eraseCloudData({ pauseUpload: true }, deps);

        testRunner.assertEquals(deps.pauseUpload.mock.calls.length, 1,
            'sin pausa, el próximo guardado ordinario re-sube el estado local completo');
    },

    async "si el borrado falla, reporta el error y NO borra snapshots ni pausa"() {
        const deps = makeDeps({
            deleteCloud: jest.fn().mockRejectedValue(new Error('permission-denied'))
        });

        const result = await eraseCloudData({ alsoSnapshots: true, pauseUpload: true }, deps);

        testRunner.assertEquals(result.ok, false);
        testRunner.assertEquals(result.reason, 'delete-failed');
        testRunner.assertEquals(deps.deleteSnapshotsOfType.mock.calls.length, 0,
            'no borrar la red de seguridad si el borrado principal falló');
        testRunner.assertEquals(deps.pauseUpload.mock.calls.length, 0);
    }

});

testRunner.addSuite("app.js — App.Sync.deleteCloudData delega en DataOps (U6)", {

    "el handler usa eraseCloudData y conserva la doble confirmación tipeada"() {
        const fs = require('fs');
        const path = require('path');
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        const idx = appSource.indexOf('deleteCloudData: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.deleteCloudData');
        const block = appSource.slice(idx, idx + 3500);
        testRunner.assert(/eraseCloudData\s*\(/.test(block),
            'debe delegar en DataOps.eraseCloudData (purga previa + snapshots opcionales + pausa opcional)');
        testRunner.assert(/BORRAR NUBE/.test(block),
            'la doble confirmación tipeada debe conservarse');
    },

    "la redefinición débil de window.deleteCloudDataNow NO debe volver (pisaba la doble confirmación)"() {
        const fs = require('fs');
        const path = require('path');
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        // Sólo debe existir la asignación de ALIAS (= window.App.Sync...), no
        // una segunda función inline que la pise más abajo en el archivo.
        const definitions = appSource.match(/window\.deleteCloudDataNow\s*=\s*(async\s+function|\()/g) || [];
        testRunner.assertEquals(definitions.length, 0,
            'window.deleteCloudDataNow sólo debe existir como alias de App.Sync.deleteCloudData — una redefinición inline la pisaría (código muerto + confirm débil)');
        testRunner.assert(/window\.deleteCloudDataNow\s*=\s*window\.App\.Sync\.deleteCloudData/.test(appSource),
            'el alias a App.Sync.deleteCloudData debe seguir existiendo');
    }

});

console.log('🧪 DataOps eraseCloudData tests cargados.');
