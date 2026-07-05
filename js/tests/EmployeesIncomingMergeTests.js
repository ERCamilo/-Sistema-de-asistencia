/**
 * 🧪 EmployeesIncomingMergeTests (Fase 2, U2)
 *
 * Función pura que reemplaza el "reemplazo mayorista" del onApply de
 * EmployeesLiveSync: en vez de pisar TODA la lista local con el snapshot
 * entrante de Firestore, fusiona por-registro.
 *
 * Reglas:
 *   - Empleado presente en AMBOS lados: se fusiona con mergeEmployees
 *     (LWW por updatedAt, unión por id en loans/advances/etc.).
 *   - Empleado SOLO en el snapshot entrante (alta de otro dispositivo):
 *     se agrega tal cual.
 *   - Empleado SOLO local, nunca antes visto en un snapshot entrante
 *     (alta local todavía no subida): se conserva.
 *   - Empleado SOLO local, que SÍ estuvo antes en un snapshot entrante
 *     (borrado confirmado en el servidor): se remueve — SALVO que la
 *     edición local sea más nueva que la última versión confirmada del
 *     servidor, en cuyo caso se conserva (podría ser una edición offline
 *     todavía no subida, en carrera con el borrado de otro dispositivo).
 *   - La "línea de base" (última versión conocida del servidor) se
 *     actualiza en cada llamada para reflejar el snapshot entrante actual.
 */

import { mergeIncomingEmployees, resetIncomingMergeBaseline } from '../modules/services/EmployeesIncomingMerge.js';

testRunner.addSuite("EmployeesIncomingMerge — fusión por-registro (Fase 2, U2)", {

    "empleado presente en ambos lados se fusiona por LWW (gana el de mayor updatedAt)"() {
        resetIncomingMergeBaseline();
        const local = [{ id: 'e1', name: 'Ana local', updatedAt: 100 }];
        const incoming = [{ id: 'e1', name: 'Ana remota', updatedAt: 200 }];
        const result = mergeIncomingEmployees(local, incoming);
        testRunner.assertEquals(result.length, 1);
        testRunner.assertEquals(result[0].name, 'Ana remota');
    },

    "empleado con edición local más nueva sobrevive la fusión"() {
        resetIncomingMergeBaseline();
        const local = [{ id: 'e1', name: 'Ana editada offline', updatedAt: 300 }];
        const incoming = [{ id: 'e1', name: 'Ana vieja', updatedAt: 100 }];
        const result = mergeIncomingEmployees(local, incoming);
        testRunner.assertEquals(result[0].name, 'Ana editada offline');
    },

    "empleado solo en el snapshot entrante (alta de otro dispositivo) se agrega"() {
        resetIncomingMergeBaseline();
        const local = [{ id: 'e1', name: 'Ana', updatedAt: 100 }];
        const incoming = [
            { id: 'e1', name: 'Ana', updatedAt: 100 },
            { id: 'e2', name: 'Bob (nuevo, de otro dispositivo)', updatedAt: 150 }
        ];
        const result = mergeIncomingEmployees(local, incoming);
        testRunner.assertEquals(result.length, 2);
        testRunner.assert(result.some(e => e.id === 'e2'), 'Bob debe estar en el resultado');
    },

    "empleado solo local, NUNCA visto en un snapshot entrante, se conserva (alta local sin subir)"() {
        resetIncomingMergeBaseline();
        const local = [{ id: 'e-nuevo', name: 'Recién creado localmente', updatedAt: 500 }];
        const incoming = []; // la nube todavía no tiene este empleado
        const result = mergeIncomingEmployees(local, incoming);
        testRunner.assertEquals(result.length, 1);
        testRunner.assertEquals(result[0].id, 'e-nuevo');
    },

    "empleado borrado remotamente (visto antes, ausente ahora) se remueve si no hay edición local más nueva"() {
        resetIncomingMergeBaseline();
        // 1ª llamada: el empleado existe en el servidor — establece la línea de base.
        mergeIncomingEmployees(
            [{ id: 'e1', name: 'Ana', updatedAt: 100 }],
            [{ id: 'e1', name: 'Ana', updatedAt: 100 }]
        );
        // 2ª llamada: otro dispositivo lo borró — ya no aparece en el snapshot entrante.
        const result = mergeIncomingEmployees(
            [{ id: 'e1', name: 'Ana', updatedAt: 100 }], // local sin cambios desde la última sync
            []
        );
        testRunner.assertEquals(result.length, 0, 'El empleado borrado remotamente debe desaparecer');
    },

    "empleado borrado remotamente pero con edición local MÁS NUEVA que la última sync se conserva (no confía en el borrado)"() {
        resetIncomingMergeBaseline();
        // 1ª llamada: establece línea de base con updatedAt=100.
        mergeIncomingEmployees(
            [{ id: 'e1', name: 'Ana', updatedAt: 100 }],
            [{ id: 'e1', name: 'Ana', updatedAt: 100 }]
        );
        // 2ª llamada: el servidor ya no lo tiene (otro dispositivo lo borró), PERO
        // este dispositivo editó localmente después de la última sync confirmada.
        const result = mergeIncomingEmployees(
            [{ id: 'e1', name: 'Ana (editada offline tras la sync)', updatedAt: 250 }],
            []
        );
        testRunner.assertEquals(result.length, 1,
            'Una edición local más nueva que la última sync no debe perderse ante un borrado remoto en carrera');
        testRunner.assertEquals(result[0].name, 'Ana (editada offline tras la sync)');
    },

    "tras remover un borrado confirmado, una alta local nueva y distinta sigue viva"() {
        resetIncomingMergeBaseline();
        // 1ª llamada: e1 existe en el servidor — establece la línea de base.
        let result = mergeIncomingEmployees(
            [{ id: 'e1', updatedAt: 100 }],
            [{ id: 'e1', updatedAt: 100 }]
        );
        // 2ª llamada: otro dispositivo borró e1 — ya no está en el snapshot entrante.
        result = mergeIncomingEmployees(result, []);
        testRunner.assertEquals(result.length, 0, 'e1 debe removerse (borrado confirmado)');

        // 3ª llamada: ESTE dispositivo crea un empleado e2 nuevo (todavía no
        // subido) mientras la nube sigue sin e1 — e2 debe sobrevivir, la
        // línea de base actualizada tras el borrado de e1 no debe afectarlo.
        const localWithNewEmployee = [...result, { id: 'e2', name: 'Recién creado', updatedAt: 999 }];
        result = mergeIncomingEmployees(localWithNewEmployee, []);
        testRunner.assertEquals(result.length, 1, 'e2 (alta local nueva) debe conservarse');
        testRunner.assertEquals(result[0].id, 'e2');
    },

    "defensivo: incoming null/local null no rompe"() {
        resetIncomingMergeBaseline();
        testRunner.assert(Array.isArray(mergeIncomingEmployees(null, null)), 'debe devolver un array con ambos null');
        testRunner.assert(Array.isArray(mergeIncomingEmployees(undefined, [{ id: 'e1', updatedAt: 1 }])), 'local undefined no debe romper');
        testRunner.assert(Array.isArray(mergeIncomingEmployees([{ id: 'e1', updatedAt: 1 }], undefined)), 'incoming undefined no debe romper');
    },

    "defensivo: registros sin id se ignoran (no pueden fusionarse ni rastrearse)"() {
        resetIncomingMergeBaseline();
        const local = [{ name: 'sin id', updatedAt: 1 }];
        const incoming = [{ name: 'sin id remoto', updatedAt: 2 }];
        const result = mergeIncomingEmployees(local, incoming);
        testRunner.assertEquals(result.length, 0, 'registros sin id no deben aparecer en el resultado');
    },

    "un updatedAt NaN en la línea de base no debe envenenar el id para siempre (revisión en fresco)"() {
        resetIncomingMergeBaseline();
        // 1ª llamada: el servidor manda un updatedAt corrupto (NaN) para e1.
        mergeIncomingEmployees(
            [{ id: 'e1', updatedAt: 100 }],
            [{ id: 'e1', updatedAt: Number.NaN }]
        );
        // 2ª llamada: el servidor ya borró e1; localmente hay una edición
        // genuina y posterior (updatedAt numérico normal). Con
        // typeof-check, "100 > NaN" es siempre false y e1 se perdería para
        // siempre pese a ser una edición real más nueva — con
        // Number.isFinite, NaN no cuenta como línea de base válida y e1
        // debe conservarse igual que cualquier otro borrado en carrera.
        const result = mergeIncomingEmployees(
            [{ id: 'e1', name: 'Editado localmente', updatedAt: 150 }],
            []
        );
        testRunner.assertEquals(result.length, 1,
            'Un updatedAt NaN en la línea de base no debe bloquear para siempre una edición local genuina');
    }

});

console.log('🧪 EmployeesIncomingMerge tests cargados.');
