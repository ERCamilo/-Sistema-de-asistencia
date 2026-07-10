/**
 * 🧪 EntityLifecycleTests — Desactivar, reactivar y eliminar entidades.
 *
 * Cubre las operaciones destructivas / de estado que el usuario realiza:
 *   - toggleEmployeeStatus: desactivar / reactivar empleado
 *   - togglePositionStatus: desactivar / activar posición
 *   - deletePosition: eliminar posición inactiva (+ bloqueos)
 *   - toggleLeaderStatus: desactivar / activar líder
 *
 * Las funciones usan Modal.confirm() para pedir confirmación; se mockea
 * la clase Modal para que onConfirm() se ejecute de forma síncrona.
 */

import { state } from '../modules/core/AppState.js';
import { Modal } from '../modules/components/Modal.js';
import { toggleEmployeeStatus } from '../modules/features/employees/EmployeesList.js';
import {
    togglePositionStatus,
    deletePosition,
    cleanupPositionReferences,
} from '../modules/features/employees/PositionsList.js';
import { toggleLeaderStatus } from '../modules/features/employees/LeadersList.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapshotGlobal() {
    return {
        employees:    JSON.parse(JSON.stringify(state.employees)),
        positions:    JSON.parse(JSON.stringify(state.positions)),
        leaders:      JSON.parse(JSON.stringify(state.leaders)),
        attendance:   { ...state.attendance },
        isDataLoaded: state.isDataLoaded,
        useIndexedDB: state.useIndexedDB,
    };
}

function restoreGlobal(snap) {
    state.employees    = snap.employees;
    state.positions    = snap.positions;
    state.leaders      = snap.leaders;
    state.attendance   = snap.attendance;
    state.isDataLoaded = snap.isDataLoaded;
    state.useIndexedDB = snap.useIndexedDB;
}

/** Mocks Modal.confirm to auto-confirm synchronously. Returns a restore fn. */
function installAutoConfirm() {
    const spy = jest.spyOn(Modal, 'confirm').mockImplementation((opts) => {
        opts?.onConfirm?.();
        return Promise.resolve(true);
    });
    return () => spy.mockRestore();
}

/** Mocks Modal.confirm to auto-cancel synchronously. Returns a restore fn. */
function installAutoCancel() {
    const spy = jest.spyOn(Modal, 'confirm').mockImplementation((opts) => {
        opts?.onCancel?.();
        return Promise.resolve(false);
    });
    return () => spy.mockRestore();
}

async function waitForSave() {
    return new Promise(r => setTimeout(r, 400));
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: toggleEmployeeStatus
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('EntityLifecycle — toggleEmployeeStatus', {

    'desactivar empleado activo → active = false'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.employees = [{ id: 'e1', name: 'Ana', active: true, statusHistory: [] }];
            toggleEmployeeStatus('e1');
            const emp = state.employees.find(e => e.id === 'e1');
            testRunner.assertEquals(emp.active, false, 'empleado desactivado');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'reactivar empleado inactivo → active = true'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.employees = [{ id: 'e2', name: 'Luis', active: false, statusHistory: [] }];
            toggleEmployeeStatus('e2');
            const emp = state.employees.find(e => e.id === 'e2');
            testRunner.assertEquals(emp.active, true, 'empleado reactivado');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'toggle agrega entrada a statusHistory'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.employees = [{ id: 'e3', name: 'Carlos', active: true, statusHistory: [] }];
            toggleEmployeeStatus('e3');
            const emp = state.employees.find(e => e.id === 'e3');
            testRunner.assert(emp.statusHistory.length === 1, 'una entrada en statusHistory');
            testRunner.assertEquals(emp.statusHistory[0].active, false, 'nuevo estado = false');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'toggle no hace nada si el empleado no existe'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.employees = [];
            toggleEmployeeStatus('ghost');
            testRunner.assertEquals(state.employees.length, 0, 'state intacto');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    async 'toggle dispara saveApplicationData (IndexedDB llamado)'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        indexedDBService.saveState.mockClear();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.employees = [{ id: 'e4', name: 'María', active: true, statusHistory: [] }];
            toggleEmployeeStatus('e4');
            await waitForSave();
            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB guardó');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: togglePositionStatus
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('EntityLifecycle — togglePositionStatus', {

    'desactivar posición activa → active = false'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'p1', name: 'Oficial', active: true }];
            togglePositionStatus('p1');
            testRunner.assertEquals(state.positions[0].active, false, 'posición desactivada');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'activar posición inactiva → active = true'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'p2', name: 'Peón', active: false }];
            togglePositionStatus('p2');
            testRunner.assertEquals(state.positions[0].active, true, 'posición activada');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'toggle en posición inexistente no hace nada'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [];
            togglePositionStatus('ghost');
            testRunner.assertEquals(state.positions.length, 0, 'state intacto');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: deletePosition
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('EntityLifecycle — deletePosition', {

    'eliminar posición inactiva sin empleados → removida de state'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'del-1', name: 'Temporal', active: false }];
            state.employees = [];
            deletePosition('del-1');
            testRunner.assertEquals(state.positions.length, 0, 'posición eliminada de state');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'eliminar posición ACTIVA está bloqueada (posición sigue en state)'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'del-2', name: 'Activa', active: true }];
            state.employees = [];
            deletePosition('del-2');
            // No hay diálogo de confirmación real; la función retorna antes de llegar al confirm
            testRunner.assertEquals(state.positions.length, 1, 'posición activa no eliminada');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'eliminar posición con empleados asignados está bloqueada'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'del-3', name: 'Asignada', active: false }];
            state.employees = [{ id: 'e1', name: 'Ana', positions: ['del-3'], active: true }];
            deletePosition('del-3');
            testRunner.assertEquals(state.positions.length, 1, 'posición con empleados no eliminada');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    // 🛡️ Guardia 3: una posición con días TRABAJADOS no se elimina — se
    // conserva desactivada como archivo. Eliminarla borraría sus referencias
    // del historial (cleanupPositionReferences) y la nómina/reportes viejos
    // dejarían de resolver su nombre y tarifa.
    'eliminar posición con HISTORIAL de asistencia está bloqueada (guardia 3)'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'del-4', name: 'Con Historia', active: false }];
            state.employees = []; // sin asignados: pasa las guardias 1 y 2
            state.attendance = {
                'e1-2026-06-01': { employeeId: 'e1', date: '2026-06-01', present: true, selectedPosition: 'del-4', hoursWorked: 8 }
            };
            deletePosition('del-4');
            testRunner.assertEquals(state.positions.length, 1,
                'con días trabajados NO se elimina, aunque el usuario confirme');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'la guardia de historial ignora tombstoneados: sin días vivos sí se elimina'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.positions = [{ id: 'del-5', name: 'Solo Lápidas', active: false }];
            state.employees = [];
            state.attendance = {
                'e1-2026-06-01': { employeeId: 'e1', date: '2026-06-01', present: false, deletedAt: 123, selectedPosition: 'del-5', hoursWorked: 8 }
            };
            deletePosition('del-5');
            testRunner.assertEquals(state.positions.length, 0,
                'un tombstone no es un día trabajado — no debe bloquear la eliminación');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'cleanupPositionReferences limpia empleados y asistencias antes de borrar'() {
        const snap = snapshotGlobal();
        try {
            state.employees = [
                { id: 'e1', positions: ['pos-del', 'pos-keep'], positionSalaries: { 'pos-del': 200 }, active: true },
            ];
            state.attendance = {
                'e1-2026-06-01': { selectedPosition: 'pos-del', positionHours: [{ positionId: 'pos-del', hours: 8 }] },
            };
            const cleaned = cleanupPositionReferences('pos-del');
            testRunner.assert(cleaned >= 2, 'al menos 2 referencias limpiadas');
            testRunner.assert(!state.employees[0].positions.includes('pos-del'), 'posición quitada del empleado');
            testRunner.assertEquals(state.attendance['e1-2026-06-01'].selectedPosition, null, 'selectedPosition limpiado');
            testRunner.assertEquals(state.attendance['e1-2026-06-01'].positionHours.length, 0, 'positionHours limpiado');
        } finally {
            restoreGlobal(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A: borrar un puesto del catálogo lo quita de
    // emp.positions/positionSalaries, pero antes NO estampaba nada → el borrado
    // no ganaba el merge (LWW de puestos por positionsUpdatedAt) y podía
    // resucitar. Ahora estampa updatedAt + positionsUpdatedAt SOLO en los
    // empleados realmente tocados (no en los demás, para no re-subir de más).
    'cleanupPositionReferences estampa updatedAt y positionsUpdatedAt SOLO en los empleados tocados'() {
        const snap = snapshotGlobal();
        try {
            state.employees = [
                { id: 'e1', positions: ['pos-del', 'pos-keep'], positionSalaries: { 'pos-del': 200 }, updatedAt: 1000, positionsUpdatedAt: 1000, active: true },
                { id: 'e2', positions: ['pos-keep'], positionSalaries: {}, updatedAt: 1000, positionsUpdatedAt: 1000, active: true },
            ];
            state.attendance = {};
            const before = Date.now() - 1;
            cleanupPositionReferences('pos-del');
            const e1 = state.employees.find(e => e.id === 'e1');
            const e2 = state.employees.find(e => e.id === 'e2');
            testRunner.assert(e1.positionsUpdatedAt > before, 'e1 perdió un puesto → debe estampar positionsUpdatedAt');
            testRunner.assert(e1.updatedAt > before, 'e1 también estampa updatedAt para que suba el cambio');
            testRunner.assertEquals(e2.positionsUpdatedAt, 1000, 'e2 no fue tocado → no debe re-estamparse (no re-subir de más)');
        } finally {
            restoreGlobal(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4: toggleLeaderStatus
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('EntityLifecycle — toggleLeaderStatus', {

    'desactivar líder activo → active = false'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.leaders = [{ id: 'l1', name: 'Pedro', active: true, statusHistory: [] }];
            toggleLeaderStatus('l1');
            testRunner.assertEquals(state.leaders[0].active, false, 'líder desactivado');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'reactivar líder inactivo → active = true'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.leaders = [{ id: 'l2', name: 'Rosa', active: false, statusHistory: [] }];
            toggleLeaderStatus('l2');
            testRunner.assertEquals(state.leaders[0].active, true, 'líder reactivado');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    'toggle líder agrega entrada a statusHistory'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        try {
            state.leaders = [{ id: 'l3', name: 'Tomás', active: true, statusHistory: [] }];
            toggleLeaderStatus('l3');
            testRunner.assert(state.leaders[0].statusHistory.length === 1, 'una entrada en statusHistory');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },

    async 'toggle líder dispara saveApplicationData'() {
        const snap = snapshotGlobal();
        const restore = installAutoConfirm();
        indexedDBService.saveState.mockClear();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.leaders = [{ id: 'l4', name: 'Beatriz', active: true, statusHistory: [] }];
            toggleLeaderStatus('l4');
            await waitForSave();
            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB guardó');
        } finally {
            restore();
            restoreGlobal(snap);
        }
    },
});
