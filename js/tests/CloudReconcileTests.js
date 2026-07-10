/**
 * 🧪 CloudReconcileTests
 *
 * Red de seguridad post-wizard: cuando el saneamiento local terminó pero
 * la nube quedó con docs huérfanos (UUIDs absorbidos que nunca se
 * borraron). Verificamos que reconcileCloudFromLocal:
 *   - identifica huérfanos por diff de id (cloud \ local)
 *   - borra cada huérfano y reporta los ids borrados
 *   - re-empuja la verdad local con mergeRemote:true (no destruye datos)
 *   - acumula errores sin abortar si un delete falla
 */

import { reconcileCloudFromLocal } from '../modules/services/CloudReconcile.js';

function makeRepo({ cloud = [], failDeletes = new Set() } = {}) {
    const deletedIds = [];
    let saveManyCalls = 0;
    let saveManyLastArgs = null;
    return {
        cloud,
        deletedIds,
        get saveManyCalls() { return saveManyCalls; },
        get saveManyLastArgs() { return saveManyLastArgs; },
        async loadAll() { return [...cloud]; },
        async deleteOne(id) {
            if (failDeletes.has(id)) throw new Error(`stub: cannot delete ${id}`);
            deletedIds.push(id);
        },
        async saveMany(list, opts) {
            saveManyCalls++;
            saveManyLastArgs = { list, opts };
            // Igual que el EmployeeRepository real: {written, saved}.
            return { written: (list || []).length, saved: [...(list || [])] };
        }
    };
}

testRunner.addSuite("CloudReconcile — diff y borrado de huérfanos", {

    "huérfanos = cloud \\ local: solo se borran los que no están en local"() {
        const repo = makeRepo({
            cloud: [
                { id: 'EMP1' }, { id: 'EMP2' },
                { id: 'UUID-A' }, { id: 'UUID-B' }
            ]
        });
        const local = [{ id: 'EMP1' }, { id: 'EMP2' }];
        return reconcileCloudFromLocal(local, { repository: repo }).then(res => {
            testRunner.assertEquals(res.deleted.length, 2, "Debe borrar 2 huérfanos");
            testRunner.assert(res.deleted.includes('UUID-A'));
            testRunner.assert(res.deleted.includes('UUID-B'));
            testRunner.assertEquals(res.cloudBefore, 4);
            testRunner.assertEquals(res.cloudAfter, 2);
        });
    },

    "sin huérfanos → no borra nada y empuja local"() {
        const repo = makeRepo({ cloud: [{ id: 'EMP1' }] });
        const local = [{ id: 'EMP1' }];
        return reconcileCloudFromLocal(local, { repository: repo }).then(res => {
            testRunner.assertEquals(res.deleted.length, 0);
            testRunner.assertEquals(repo.saveManyCalls, 1);
            testRunner.assertEquals(repo.saveManyLastArgs.opts.mergeRemote, true,
                "Debe usar mergeRemote:true para no destruir datos cloud");
        });
    },

    "saveMany recibe TODA la lista local (no solo los borrados)"() {
        const repo = makeRepo({ cloud: [{ id: 'EMP1' }, { id: 'UUID-A' }] });
        const local = [{ id: 'EMP1', name: 'Erlin' }, { id: 'EMP2', name: 'Varnet' }];
        return reconcileCloudFromLocal(local, { repository: repo }).then(res => {
            testRunner.assertEquals(repo.saveManyLastArgs.list.length, 2,
                "saveMany debe recibir los 2 empleados locales");
            testRunner.assertEquals(res.written, 2);
        });
    },

    "delete que falla → error registrado, no aborta el resto"() {
        const repo = makeRepo({
            cloud: [{ id: 'EMP1' }, { id: 'UUID-A' }, { id: 'UUID-B' }],
            failDeletes: new Set(['UUID-A'])
        });
        const local = [{ id: 'EMP1' }];
        return reconcileCloudFromLocal(local, { repository: repo }).then(res => {
            testRunner.assertEquals(res.deleted.length, 1,
                "Solo UUID-B se borra exitosamente");
            testRunner.assertEquals(res.errors.length, 1);
            testRunner.assertEquals(res.errors[0].id, 'UUID-A');
            testRunner.assertEquals(res.errors[0].op, 'delete');
        });
    },

    // 🐛 Judgment Day Fase 2A Ronda 4 (Juez B): reconcile re-empuja el roster
    // por fuera de saveEntities → el watermark del EntityUploadTracker quedaba
    // stale y el próximo saveEntities re-subía todo (cuota). reconcile expone
    // `saved` y llama onUploaded para que el caller actualice el watermark.
    "expone saved y llama onUploaded con las entidades escritas (higiene del watermark)"() {
        const repo = makeRepo({ cloud: [{ id: 'EMP1' }] });
        const local = [{ id: 'EMP1' }, { id: 'EMP2' }];
        let uploadedArg = 'NOT_CALLED';
        return reconcileCloudFromLocal(local, {
            repository: repo,
            onUploaded: (saved) => { uploadedArg = saved; }
        }).then(res => {
            testRunner.assert(Array.isArray(res.saved), 'reconcile debe exponer saved en el resultado');
            testRunner.assertEquals(res.saved.length, 2);
            testRunner.assert(Array.isArray(uploadedArg), 'onUploaded debe llamarse con la lista escrita');
            testRunner.assertEquals(uploadedArg.length, 2);
        });
    },

    "lista local vacía → todos los cloud se consideran huérfanos"() {
        // Caso extremo: usuario borró todo localmente y quiere limpiar nube.
        const repo = makeRepo({ cloud: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] });
        return reconcileCloudFromLocal([], { repository: repo }).then(res => {
            testRunner.assertEquals(res.deleted.length, 3);
            testRunner.assertEquals(res.cloudAfter, 0);
        });
    },

    "ignora entries inválidos (sin id) en ambas listas"() {
        const repo = makeRepo({
            cloud: [{ id: 'EMP1' }, { id: null }, { id: 'UUID-X' }, null]
        });
        const local = [{ id: 'EMP1' }, { id: '' }, null];
        return reconcileCloudFromLocal(local, { repository: repo }).then(res => {
            testRunner.assertEquals(res.deleted.length, 1,
                "Solo UUID-X debe borrarse; entries sin id se ignoran");
            testRunner.assert(res.deleted.includes('UUID-X'));
        });
    },

    "reporta progreso por fases"() {
        const repo = makeRepo({ cloud: [{ id: 'A' }, { id: 'B' }] });
        const phases = [];
        const onProgress = ({ phase }) => phases.push(phase);
        return reconcileCloudFromLocal([{ id: 'A' }], { repository: repo, onProgress }).then(() => {
            testRunner.assert(phases.includes('loading-cloud'));
            testRunner.assert(phases.includes('deleting'));
            testRunner.assert(phases.includes('pushing-local'));
            testRunner.assert(phases.includes('done'));
        });
    }

});

console.log('🧪 CloudReconcile tests cargados.');
