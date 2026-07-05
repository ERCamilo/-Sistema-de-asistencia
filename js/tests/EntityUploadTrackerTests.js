/**
 * 🧪 EntityUploadTrackerTests (fix crítico post-Fase-2-U1: amplificación de escrituras)
 *
 * Descubierto en test de campo: FirebaseService.saveEntities() subía TODAS
 * las entidades (empleados/puestos/líderes) en CADA guardado — aunque el
 * guardado fuera por algo no relacionado (una nota, un día de asistencia).
 * Con mergeRemote:true (lectura + escritura por entidad), un guardado
 * cualquiera generaba ~2 operaciones × (empleados+puestos+líderes) contra
 * Firestore, sin que nada hubiera cambiado en esas entidades. Con 28
 * empleados + 20 puestos + 6 líderes, eso agotó la cuota diaria de
 * Firestore (20.000 escrituras) en pocas horas de uso normal.
 *
 * Fix: cada tracker recuerda el último updatedAt subido con éxito por id.
 * filterChanged() descarta los items cuyo updatedAt no superó esa marca —
 * solo lo que realmente cambió (o nunca se subió) vuelve a viajar.
 */

import { createEntityUploadTracker } from '../modules/services/EntityUploadTracker.js';

testRunner.addSuite("EntityUploadTracker — evita re-subir entidades sin cambios", {

    "primera vez: todos los items se consideran cambiados (nunca subidos)"() {
        const tracker = createEntityUploadTracker();
        const items = [{ id: 'e1', updatedAt: 100 }, { id: 'e2', updatedAt: 200 }];
        const changed = tracker.filterChanged(items);
        testRunner.assertEquals(changed.length, 2, 'ningún id fue subido antes → los 2 deben ir');
    },

    "tras markUploaded, un item con el MISMO updatedAt no vuelve a subirse"() {
        const tracker = createEntityUploadTracker();
        const items = [{ id: 'e1', updatedAt: 100 }];
        tracker.markUploaded(items);
        const changed = tracker.filterChanged(items);
        testRunner.assertEquals(changed.length, 0,
            'el updatedAt no cambió desde la última subida exitosa → no debe re-subirse');
    },

    "un item con updatedAt MÁS NUEVO que la última subida sí se incluye"() {
        const tracker = createEntityUploadTracker();
        const v1 = [{ id: 'e1', updatedAt: 100 }];
        tracker.markUploaded(v1);
        const v2 = [{ id: 'e1', updatedAt: 200, name: 'editado' }];
        const changed = tracker.filterChanged(v2);
        testRunner.assertEquals(changed.length, 1, 'una edición real (updatedAt más nuevo) debe subirse');
        testRunner.assertEquals(changed[0].name, 'editado');
    },

    "solo se filtran los items que NO cambiaron — el resto del lote sí sube"() {
        const tracker = createEntityUploadTracker();
        tracker.markUploaded([{ id: 'e1', updatedAt: 100 }, { id: 'e2', updatedAt: 100 }]);
        const batch = [
            { id: 'e1', updatedAt: 100 },              // sin cambios
            { id: 'e2', updatedAt: 150 },              // editado
            { id: 'e3', updatedAt: 999 }                // nunca subido
        ];
        const changed = tracker.filterChanged(batch);
        const ids = changed.map(e => e.id).sort();
        testRunner.assertEquals(ids.join(','), 'e2,e3',
            'e1 no cambió y debe quedar afuera; e2 y e3 sí deben ir');
    },

    "un guardado no relacionado (nada de employees cambió) filtra TODO — cero costo de red"() {
        // Reproduce el bug real: 28 empleados sin editar, un guardado de asistencia dispara saveEntities.
        const tracker = createEntityUploadTracker();
        const employees = Array.from({ length: 28 }, (_, i) => ({ id: `e${i}`, updatedAt: 1000 }));
        tracker.markUploaded(employees); // ya subidos una vez (sesión previa)
        const changed = tracker.filterChanged(employees); // mismo array, nada cambió
        testRunner.assertEquals(changed.length, 0,
            'ningún empleado cambió — no debe generar NINGUNA escritura/lectura a Firestore');
    },

    "markUploaded no rompe con items sin id o sin updatedAt"() {
        const tracker = createEntityUploadTracker();
        testRunner.assert(true, 'no debe lanzar');
        tracker.markUploaded([{ name: 'sin id' }, null, undefined, { id: 'e1' }]);
        const changed = tracker.filterChanged([{ id: 'e1', updatedAt: 5 }]);
        // 'e1' fue marcado con updatedAt no-finito → se trata como 0/desconocido,
        // así que un updatedAt real (5) posterior debe pasar el filtro.
        testRunner.assertEquals(changed.length, 1);
    },

    "filterChanged defensivo: null/undefined/no-array no rompe"() {
        const tracker = createEntityUploadTracker();
        testRunner.assert(Array.isArray(tracker.filterChanged(null)), 'null → []');
        testRunner.assert(Array.isArray(tracker.filterChanged(undefined)), 'undefined → []');
        testRunner.assert(Array.isArray(tracker.filterChanged('no-array')), 'string → []');
    },

    "items sin id se descartan (no se pueden rastrear ni fusionar)"() {
        const tracker = createEntityUploadTracker();
        const changed = tracker.filterChanged([{ name: 'sin id', updatedAt: 1 }]);
        testRunner.assertEquals(changed.length, 0);
    },

    "reset() olvida todo — el próximo filterChanged trata todo como nunca subido"() {
        const tracker = createEntityUploadTracker();
        const items = [{ id: 'e1', updatedAt: 100 }];
        tracker.markUploaded(items);
        testRunner.assertEquals(tracker.filterChanged(items).length, 0);
        tracker.reset();
        testRunner.assertEquals(tracker.filterChanged(items).length, 1,
            'tras reset, debe volver a considerarse "nunca subido"');
    },

    "cada tracker creado con createEntityUploadTracker() es independiente (no comparte estado)"() {
        const trackerA = createEntityUploadTracker();
        const trackerB = createEntityUploadTracker();
        trackerA.markUploaded([{ id: 'e1', updatedAt: 100 }]);
        testRunner.assertEquals(trackerB.filterChanged([{ id: 'e1', updatedAt: 100 }]).length, 1,
            'trackerB no debe verse afectado por lo que subió trackerA (empleados vs. puestos vs. líderes)');
    },

    "id '__proto__' se rastrea igual que cualquier otro (mismo endurecimiento que EmployeesIncomingMerge)"() {
        const tracker = createEntityUploadTracker();
        tracker.markUploaded([{ id: '__proto__', updatedAt: 100 }]);
        const changed = tracker.filterChanged([{ id: '__proto__', updatedAt: 100 }]);
        testRunner.assertEquals(changed.length, 0, 'debe reconocerse como ya subido, no como "nunca visto"');
    }

});

console.log('🧪 EntityUploadTracker tests cargados.');
