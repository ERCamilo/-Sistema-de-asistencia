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

import { replaceCloudWithLocal, snapshotCloudBeforeDestroy, MAIN_DATA_COLLECTIONS } from '../modules/services/DataOps.js';

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

    async "la subida usa una FOTO CONGELADA previa al borrado — inmune al eco de LiveSync que vacía state (JD-F1, CRÍTICO)"() {
        // Bug real: deleteCloudData borra los docs de empleados/cargos/líderes
        // y los listeners en vivo (EmployeeRepository.subscribe NO filtra ecos
        // propios) rebotan ese borrado a state.employees = [] ANTES de que
        // uploadFullState corra. Como saveFullState leía el state VIVO, subía
        // listas vacías y reportaba éxito — nube vaciada permanentemente.
        // El contrato nuevo: uploadFullState/uploadHistory reciben la foto
        // congelada capturada ANTES de tocar la nube.
        const { state } = require('../modules/core/AppState.js');
        const prevEmployees = state.employees;
        const prevAttendance = state.attendance;
        try {
            state.employees = [{ id: 'eF1', name: 'Congelado' }];
            state.attendance = { 'eF1-2026-07-01': { employeeId: 'eF1', present: true } };

            const deps = makeDeps({
                // El borrado simula el eco de LiveSync: vacía el state vivo.
                deleteCloud: jest.fn(async () => {
                    state.employees = [];
                    state.attendance = {};
                    return { deleted: 3 };
                })
            });

            const result = await replaceCloudWithLocal(deps);

            testRunner.assertEquals(result.ok, true);
            const uploadedState = deps.uploadFullState.mock.calls[0][0];
            testRunner.assert(uploadedState && uploadedState.employees?.length === 1,
                'uploadFullState debe recibir la foto congelada pre-borrado, no el state vivo vaciado por el eco');
            testRunner.assertEquals(uploadedState.employees[0].id, 'eF1');
            const uploadedAttendance = deps.uploadHistory.mock.calls[0][0];
            testRunner.assert(uploadedAttendance && Object.keys(uploadedAttendance).length === 1,
                'uploadHistory debe recibir la asistencia congelada pre-borrado');
        } finally {
            state.employees = prevEmployees;
            state.attendance = prevAttendance;
        }
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

testRunner.addSuite("DataOps — snapshotCloudBeforeDestroy (JD-F2, CRÍTICO)", {

    // El "snapshot de seguridad" viejo respaldaba el state LOCAL — o sea, una
    // copia redundante de lo que se estaba por SUBIR, no de la nube que se
    // estaba por DESTRUIR. La promesa "recuperable" era falsa justo en el caso
    // real: dispositivo con datos viejos fuerza "Subir y Reemplazar" y los
    // datos buenos de la nube se pierden sin respaldo restaurable.

    async "respalda los datos DE LA NUBE (no el state local)"() {
        const snapshot = jest.fn().mockResolvedValue(undefined);
        const deps = {
            fetchFullState: jest.fn().mockResolvedValue({ settings: { schemaVersion: 0, businessName: 'NUBE SA' }, employees: [{ id: 'eCloud' }], positions: [], leaders: [] }),
            fetchAllAttendance: jest.fn().mockResolvedValue({ 'eCloud-2026-07-01': { present: true } }),
            loadEmployees: jest.fn(), loadPositions: jest.fn(), loadLeaders: jest.fn(),
            snapshot
        };

        const result = await snapshotCloudBeforeDestroy(deps);

        testRunner.assertEquals(result.skipped, false);
        const [data, type, reason] = snapshot.mock.calls[0];
        testRunner.assertEquals(data.settings.businessName, 'NUBE SA', 'debe snapshotear lo que hay EN LA NUBE');
        testRunner.assertEquals(data.employees[0].id, 'eCloud');
        testRunner.assert(Object.keys(data.attendance).length === 1, 'debe incluir la asistencia de la nube');
        testRunner.assertEquals(type, 'auto');
        testRunner.assert(/pre-replace/.test(reason), 'la razón debe identificar el respaldo pre-reemplazo');
    },

    async "cuenta migrada: las entidades salen de las subcolecciones (el doc espejo las tiene vacías)"() {
        const snapshot = jest.fn().mockResolvedValue(undefined);
        const deps = {
            fetchFullState: jest.fn().mockResolvedValue({ settings: { schemaVersion: 3 }, employees: [], positions: [], leaders: [] }),
            fetchAllAttendance: jest.fn().mockResolvedValue({}),
            loadEmployees: jest.fn().mockResolvedValue([{ id: 'eSub' }]),
            loadPositions: jest.fn().mockResolvedValue([{ id: 'pSub' }]),
            loadLeaders: jest.fn().mockResolvedValue([]),
            snapshot
        };

        await snapshotCloudBeforeDestroy(deps);

        const data = snapshot.mock.calls[0][0];
        testRunner.assertEquals(data.employees[0].id, 'eSub', 'empleados desde la subcolección');
        testRunner.assertEquals(data.positions[0].id, 'pSub', 'cargos desde la subcolección');
    },

    async "nube vacía → skipped:true sin crear snapshot (no hay nada que proteger)"() {
        const snapshot = jest.fn();
        const result = await snapshotCloudBeforeDestroy({
            fetchFullState: jest.fn().mockResolvedValue(null),
            fetchAllAttendance: jest.fn(), loadEmployees: jest.fn(),
            loadPositions: jest.fn(), loadLeaders: jest.fn(), snapshot
        });

        testRunner.assertEquals(result.skipped, true);
        testRunner.assertEquals(snapshot.mock.calls.length, 0);
    },

    async "una lectura de entidades fallida (null) LANZA — un respaldo incompleto no es un respaldo"() {
        let threw = false;
        try {
            await snapshotCloudBeforeDestroy({
                fetchFullState: jest.fn().mockResolvedValue({ settings: { schemaVersion: 2 } }),
                fetchAllAttendance: jest.fn().mockResolvedValue({}),
                loadEmployees: jest.fn().mockResolvedValue(null),
                loadPositions: jest.fn(), loadLeaders: jest.fn(), snapshot: jest.fn()
            });
        } catch (_) { threw = true; }
        testRunner.assert(threw,
            'debe lanzar para que replaceCloudWithLocal aborte — nunca destruir la nube con un respaldo a medias');
    },

    "replaceCloudWithLocal usa snapshotCloudBeforeDestroy como default (no el state local)"() {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.resolve(__dirname, '../modules/services/DataOps.js'), 'utf8');
        const idx = src.indexOf('export async function replaceCloudWithLocal');
        const block = src.slice(idx, idx + 800);
        testRunner.assert(/createSafetySnapshot\s*=\s*\(\)\s*=>\s*snapshotCloudBeforeDestroy\s*\(/.test(block),
            'el default debe respaldar la nube — createSnapshot(state,...) respaldaba el lado equivocado');
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
