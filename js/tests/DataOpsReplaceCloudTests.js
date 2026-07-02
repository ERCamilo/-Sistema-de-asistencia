/**
 * 🧪 DataOpsReplaceCloudTests (Fase 0.5, U5)
 *
 * "Subir y Reemplazar": borra los datos de la nube y los sustituye por los
 * locales — un reemplazo REAL, no el merge del flujo viejo (saveFullState +
 * syncHistory con merge:true nunca borraban lo que sólo existía en la nube,
 * aunque la UI prometiera "exactamente lo que tienes aquí").
 *
 * Contrato de seguridad:
 *   - SNAPSHOT DE SEGURIDAD primero: si falla, se ABORTA — nunca destruir
 *     la nube sin red de seguridad (los snapshots sobreviven al borrado).
 *   - Purga de pendientes ANTES de subir: una entrada stale del outbox
 *     drenando después degradaría el estado recién subido.
 *   - Borrado ACOTADO al dataset principal (employees/positions/leaders/
 *     attendance + doc espejo): caja chica tiene su propio sync y este
 *     flujo NO la re-sube — borrarla sin reemplazo sería pérdida de datos.
 *   - Un fallo en el borrado ABORTA la subida (subir sobre un borrado a
 *     medias sería una fusión disfrazada, no un reemplazo).
 *   - Un fallo en la subida reporta 'upload-failed' con lo local INTACTO
 *     (reintentar la operación es seguro e idempotente).
 */

import { replaceCloudWithLocal, MAIN_DATA_COLLECTIONS } from '../modules/services/DataOps.js';

function makeDeps(overrides = {}) {
    return {
        createSafetySnapshot: jest.fn().mockResolvedValue(undefined),
        purgePending: jest.fn().mockResolvedValue(true),
        deleteCloud: jest.fn().mockResolvedValue({ deleted: 3 }),
        uploadFullState: jest.fn().mockResolvedValue(undefined),
        uploadHistory: jest.fn().mockResolvedValue(true),
        ...overrides
    };
}

testRunner.addSuite("DataOps — replaceCloudWithLocal (Fase 0.5, U5)", {

    async "flujo feliz: snapshot → purga → borrar nube → subir estado → subir historial"() {
        const order = [];
        const deps = makeDeps({
            createSafetySnapshot: jest.fn(async () => order.push('snapshot')),
            purgePending: jest.fn(async () => { order.push('purge'); return true; }),
            deleteCloud: jest.fn(async () => { order.push('delete'); return { deleted: 3 }; }),
            uploadFullState: jest.fn(async () => order.push('upload-state')),
            uploadHistory: jest.fn(async () => { order.push('upload-history'); return true; })
        });

        const result = await replaceCloudWithLocal(deps);

        testRunner.assertEquals(result.ok, true);
        testRunner.assertEquals(order.join('→'), 'snapshot→purge→delete→upload-state→upload-history',
            'el orden es el contrato: la red de seguridad primero, la purga antes del borrado, la subida al final');
    },

    async "si el snapshot de seguridad falla, ABORTA sin tocar la nube"() {
        const deps = makeDeps({
            createSafetySnapshot: jest.fn().mockRejectedValue(new Error('cuota'))
        });

        const result = await replaceCloudWithLocal(deps);

        testRunner.assertEquals(result.ok, false);
        testRunner.assertEquals(result.reason, 'snapshot-failed');
        testRunner.assertEquals(deps.deleteCloud.mock.calls.length, 0,
            'NUNCA destruir la nube sin la red de seguridad del snapshot');
        testRunner.assertEquals(deps.uploadFullState.mock.calls.length, 0);
    },

    async "el borrado de nube va ACOTADO al dataset principal (sin caja chica)"() {
        const deps = makeDeps();

        await replaceCloudWithLocal(deps);

        const passedCollections = deps.deleteCloud.mock.calls[0][0];
        testRunner.assert(Array.isArray(passedCollections), 'debe pasar la lista de colecciones a borrar');
        ['employees', 'positions', 'leaders', 'attendance'].forEach(c => {
            testRunner.assert(passedCollections.includes(c), `debe incluir ${c}`);
        });
        ['pettyCash', 'projects', 'cashPeriods'].forEach(c => {
            testRunner.assert(!passedCollections.includes(c),
                `NO debe incluir ${c} — caja chica tiene su propio sync y este flujo no la re-sube; borrarla sería pérdida de datos`);
        });
    },

    "MAIN_DATA_COLLECTIONS exporta el mismo contrato que usa el flujo"() {
        ['employees', 'positions', 'leaders', 'attendance'].forEach(c => {
            testRunner.assert(MAIN_DATA_COLLECTIONS.includes(c), `debe incluir ${c}`);
        });
        testRunner.assert(!MAIN_DATA_COLLECTIONS.includes('pettyCash'), 'caja chica queda fuera');
    },

    async "si el borrado de nube falla, ABORTA la subida (subir sobre un borrado a medias es una fusión disfrazada)"() {
        const deps = makeDeps({
            deleteCloud: jest.fn().mockRejectedValue(new Error('permission-denied'))
        });

        const result = await replaceCloudWithLocal(deps);

        testRunner.assertEquals(result.ok, false);
        testRunner.assertEquals(result.reason, 'delete-failed');
        testRunner.assertEquals(deps.uploadFullState.mock.calls.length, 0,
            'no debe subir nada sobre un borrado incompleto');
    },

    async "si la subida falla tras el borrado, reporta 'upload-failed' — lo local queda intacto y reintentar es seguro"() {
        const deps = makeDeps({
            uploadFullState: jest.fn().mockRejectedValue(new Error('offline'))
        });

        const result = await replaceCloudWithLocal(deps);

        testRunner.assertEquals(result.ok, false);
        testRunner.assertEquals(result.reason, 'upload-failed');
        testRunner.assertEquals(deps.uploadHistory.mock.calls.length, 0,
            'si el estado general no subió, no tiene sentido subir el historial');
    }

});

testRunner.addSuite("app.js — App.Sync.uploadToCloud delega en DataOps (U5)", {

    "el handler de Ajustes usa replaceCloudWithLocal, no el merge viejo inline"() {
        const fs = require('fs');
        const path = require('path');
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        const idx = appSource.indexOf('uploadToCloud: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.uploadToCloud');
        const block = appSource.slice(idx, idx + 2400);
        testRunner.assert(/replaceCloudWithLocal\s*\(/.test(block),
            'debe delegar en DataOps.replaceCloudWithLocal (snapshot + purga + borrado acotado + subida)');
        testRunner.assert(!/saveFullState\s*\(/.test(block),
            'el saveFullState directo del flujo viejo (merge disfrazado de reemplazo) no debe volver');
    }

});

console.log('🧪 DataOps replaceCloudWithLocal tests cargados.');
