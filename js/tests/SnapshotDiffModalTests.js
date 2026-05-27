/**
 * 🧪 SnapshotDiffModalTests (Snapshot B - UI del modal de diff)
 *
 * Verifica el comportamiento del modal de comparación que se muestra
 * ANTES de restaurar un snapshot:
 *   - Renderiza counts: snapshot vs actual con delta.
 *   - Marca con color/aviso las categorías que perderían datos.
 *   - Lista los items específicos que se perderían (empleados, préstamos).
 *   - Cuando NO hay pérdida, oculta el bloque de advertencia.
 *   - Botones esperados: "Restaurar con red" (crea snapshot + restaura) y "Cancelar".
 *   - Cancelar cierra el modal sin invocar el callback de restore.
 *   - Restaurar invoca el callback exactamente una vez.
 */

import { SnapshotDiffModal } from '../modules/ui/SnapshotDiffModal.js';

function emp(id, name, loans = []) { return { id, name, number: id, loans }; }
function loan(id, amount = 1000) { return { id, amount, status: 'active' }; }
function pos(id, name) { return { id, name }; }

function flushModal() {
    document.querySelectorAll('.snapshot-diff-modal').forEach(el => el.remove());
}

testRunner.addSuite("SnapshotDiffModal — render (Snapshot B)", {

    "muestra los counts de empleados (snapshot vs actual)"() {
        flushModal();
        const snapshotState = { employees: [emp('e1', 'Ana')], positions: [], attendance: {} };
        const currentState  = { employees: [emp('e1', 'Ana'), emp('e2', 'Bob')], positions: [], attendance: {} };
        SnapshotDiffModal.show(snapshotState, currentState, {});
        const modal = document.querySelector('.snapshot-diff-modal');
        testRunner.assert(!!modal, "El modal debe existir en el DOM");
        const txt = modal.textContent;
        testRunner.assert(txt.includes('Empleados') || txt.includes('empleados'),
            "Debe mencionar la categoría Empleados");
        // Debe aparecer el conteo del snapshot (1) y del actual (2)
        testRunner.assert(/\b1\b/.test(txt) && /\b2\b/.test(txt),
            "Debe mostrar los números 1 y 2 (counts)");
        flushModal();
    },

    "cuando hay pérdida de datos, muestra advertencia visible"() {
        flushModal();
        const snapshotState = { employees: [emp('e1', 'Ana')], positions: [], attendance: {} };
        const currentState  = { employees: [emp('e1', 'Ana'), emp('e2', 'Bob')], positions: [], attendance: {} };
        SnapshotDiffModal.show(snapshotState, currentState, {});
        const modal = document.querySelector('.snapshot-diff-modal');
        const warn = modal.querySelector('.diff-warning, [data-role="warning"]');
        testRunner.assert(!!warn, "Debe renderizar un bloque de advertencia con clase diff-warning o data-role=warning");
        flushModal();
    },

    "cuando NO hay pérdida, no muestra el bloque de advertencia"() {
        flushModal();
        const sameState = { employees: [emp('e1', 'Ana')], positions: [], attendance: {} };
        SnapshotDiffModal.show(sameState, sameState, {});
        const modal = document.querySelector('.snapshot-diff-modal');
        const warn = modal.querySelector('.diff-warning, [data-role="warning"]');
        testRunner.assert(!warn, "Sin pérdida no debe haber bloque de advertencia");
        flushModal();
    },

    "lista por nombre los empleados que se perderían"() {
        flushModal();
        const snapshotState = { employees: [emp('e1', 'Ana')], positions: [], attendance: {} };
        const currentState  = { employees: [emp('e1', 'Ana'), emp('e2', 'Bob Marley')], positions: [], attendance: {} };
        SnapshotDiffModal.show(snapshotState, currentState, {});
        const modal = document.querySelector('.snapshot-diff-modal');
        testRunner.assert(modal.textContent.includes('Bob Marley'),
            "Debe mencionar el empleado que se perdería por nombre");
        flushModal();
    },

    "lista los préstamos que se perderían con nombre del empleado"() {
        flushModal();
        const snapshotState = {
            employees: [emp('e1', 'Ana', [])],
            positions: [], attendance: {}
        };
        const currentState = {
            employees: [emp('e1', 'Ana', [loan('LOAN-123', 5000)])],
            positions: [], attendance: {}
        };
        SnapshotDiffModal.show(snapshotState, currentState, {});
        const modal = document.querySelector('.snapshot-diff-modal');
        testRunner.assert(modal.textContent.includes('Ana'),
            "Debe mencionar al empleado dueño del préstamo perdido");
        flushModal();
    },

    "botón Restaurar dispara el callback exactamente 1 vez"() {
        flushModal();
        let restoreCalls = 0;
        const onRestore = () => { restoreCalls++; };
        const sameState = { employees: [emp('e1')], positions: [], attendance: {} };
        SnapshotDiffModal.show(sameState, sameState, { onRestore });
        const btn = document.querySelector('.snapshot-diff-modal [data-action="restore"]');
        testRunner.assert(!!btn, "Debe existir un botón con data-action=restore");
        btn.click();
        testRunner.assertEquals(restoreCalls, 1);
        flushModal();
    },

    "botón Cancelar cierra modal sin invocar onRestore"() {
        flushModal();
        let restoreCalls = 0;
        const onRestore = () => { restoreCalls++; };
        const sameState = { employees: [emp('e1')], positions: [], attendance: {} };
        SnapshotDiffModal.show(sameState, sameState, { onRestore });
        const btn = document.querySelector('.snapshot-diff-modal [data-action="cancel"]');
        testRunner.assert(!!btn, "Debe existir botón cancel");
        btn.click();
        testRunner.assertEquals(restoreCalls, 0, "Cancel no debe invocar onRestore");
        // Modal debe haberse removido
        testRunner.assert(!document.querySelector('.snapshot-diff-modal'),
            "Modal debe haberse removido del DOM tras Cancelar");
    },

    "después de hacer click en Restaurar, el modal se cierra"() {
        flushModal();
        const sameState = { employees: [emp('e1')], positions: [], attendance: {} };
        SnapshotDiffModal.show(sameState, sameState, { onRestore: () => {} });
        document.querySelector('.snapshot-diff-modal [data-action="restore"]').click();
        testRunner.assert(!document.querySelector('.snapshot-diff-modal'),
            "Modal debe cerrarse al confirmar restauración");
    },

    "metadata del snapshot se muestra si se pasa snapshotMeta"() {
        flushModal();
        const sameState = { employees: [emp('e1')], positions: [], attendance: {} };
        SnapshotDiffModal.show(sameState, sameState, {
            snapshotMeta: { reason: 'pre-migration-v2', reasonLabel: 'Antes de migrar al sistema multi-dispositivo' }
        });
        const modal = document.querySelector('.snapshot-diff-modal');
        testRunner.assert(modal.textContent.includes('migra') || modal.textContent.includes('migración'),
            "Si hay snapshotMeta, debe mostrar la razón humana del snapshot");
        flushModal();
    }

});

console.log('🧪 SnapshotDiffModal tests cargados.');
