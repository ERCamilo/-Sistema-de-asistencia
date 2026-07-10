/**
 * 🧪 DataIntegrityTests — Pruebas de integridad de datos
 *
 * Verifica:
 *   - validateDataIntegrity() detecta y limpia huérfanas correctamente
 *   - Eliminar una posición NO debe dejar huérfanas en asistencias
 *   - loadApplicationData debe persistir las correcciones si las hubo
 */

import { validateDataIntegrity, TOMBSTONE_RETENTION_MS } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Guarda y restaura el estado entre tests para evitar contaminación.
 */
function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees,
        positions: state.positions,
        leaders: state.leaders,
        attendance: state.attendance
    }));
}

function restoreState(snapshot) {
    state.employees = snapshot.employees;
    state.positions = snapshot.positions;
    state.leaders = snapshot.leaders;
    state.attendance = snapshot.attendance;
}

/** Crea un escenario reproducible: 1 posición + 1 empleado + asistencias */
function setupScenario() {
    state.positions = [
        { id: 'pos-active', name: 'Ayudante', active: true, hourlyRate: 100 },
        { id: 'pos-deleted', name: 'Pintor', active: false, hourlyRate: 120 }
    ];
    state.leaders = [
        { id: 'ldr-1', name: 'Capataz Juan', active: true }
    ];
    state.employees = [
        {
            id: 'emp-1',
            name: 'Test Employee',
            positions: ['pos-active', 'pos-ghost'],   // pos-ghost no existe → huérfana
            positionSalaries: {
                'pos-active': 100,
                'pos-deleted-2': 120                   // pos-deleted-2 no existe → huérfana
            },
            active: true
        }
    ];
    state.attendance = {
        'emp-1-2026-05-15': {
            employeeId: 'emp-1',
            date: '2026-05-15',
            present: true,
            hoursWorked: 8,
            selectedPosition: 'pos-deleted',        // existe pero será eliminada después
            positionHours: [
                { positionId: 'pos-active', hours: 5 },
                { positionId: 'pos-ghost-history', hours: 3 }  // huérfana inmediata
            ]
        },
        'emp-1-2026-05-16': {
            employeeId: 'emp-1',
            date: '2026-05-16',
            present: true,
            hoursWorked: 8,
            selectedPosition: 'pos-ghost-2',        // huérfana inmediata
            positionHours: []
        }
    };
}

// ─────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("Data Integrity — validateDataIntegrity", {

    async "detecta huérfanas en emp.positions"() {
        const snap = snapshotState();
        try {
            setupScenario();
            const fixes = await validateDataIntegrity();

            const emp = state.employees.find(e => e.id === 'emp-1');
            testRunner.assert(
                !emp.positions.includes('pos-ghost'),
                "pos-ghost (inexistente) debe haberse eliminado de emp.positions"
            );
            testRunner.assert(
                emp.positions.includes('pos-active'),
                "pos-active (existente) debe permanecer en emp.positions"
            );
            testRunner.assert(fixes > 0, "fixes debe ser > 0");
        } finally {
            restoreState(snap);
        }
    },

    async "detecta huérfanas en emp.positionSalaries"() {
        const snap = snapshotState();
        try {
            setupScenario();
            await validateDataIntegrity();

            const emp = state.employees.find(e => e.id === 'emp-1');
            testRunner.assert(
                emp.positionSalaries['pos-deleted-2'] === undefined,
                "Salario para posición inexistente debe haberse eliminado"
            );
            testRunner.assert(
                emp.positionSalaries['pos-active'] === 100,
                "Salario para posición existente debe permanecer"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "detecta huérfanas en attendance.positionHours"() {
        const snap = snapshotState();
        try {
            setupScenario();
            await validateDataIntegrity();

            const att = state.attendance['emp-1-2026-05-15'];
            const positionIds = att.positionHours.map(ph => ph.positionId);
            testRunner.assert(
                !positionIds.includes('pos-ghost-history'),
                "positionId inexistente debe haberse eliminado"
            );
            testRunner.assert(
                positionIds.includes('pos-active'),
                "positionId existente debe permanecer"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "limpia attendance.selectedPosition si la posición ya no existe"() {
        const snap = snapshotState();
        try {
            setupScenario();
            await validateDataIntegrity();

            const att = state.attendance['emp-1-2026-05-16'];
            testRunner.assertEquals(
                att.selectedPosition,
                null,
                "selectedPosition con ID inexistente (corto) debe ser null"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "no toca referencias válidas"() {
        const snap = snapshotState();
        try {
            setupScenario();
            const att15Before = JSON.parse(JSON.stringify(state.attendance['emp-1-2026-05-15']));

            await validateDataIntegrity();

            const att15After = state.attendance['emp-1-2026-05-15'];
            // selectedPosition apunta a pos-deleted que SÍ existe (aunque inactiva)
            testRunner.assertEquals(
                att15After.selectedPosition,
                'pos-deleted',
                "selectedPosition que apunta a posición existente (aunque inactiva) debe mantenerse"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "ejecutar dos veces consecutivas no debe detectar más huérfanas"() {
        const snap = snapshotState();
        try {
            setupScenario();
            const fixes1 = await validateDataIntegrity();
            const fixes2 = await validateDataIntegrity();

            testRunner.assert(fixes1 > 0, "Primera ejecución debe encontrar huérfanas");
            testRunner.assertEquals(
                fixes2,
                0,
                "Segunda ejecución no debe encontrar más huérfanas (ya limpias)"
            );
        } finally {
            restoreState(snap);
        }
    }
});

testRunner.addSuite("Data Integrity — Prevención al eliminar posición", {

    async "deletePosition debe limpiar referencias en asistencias"() {
        const snap = snapshotState();
        try {
            // Setup: posición sin empleados asignados activamente
            // pero con referencias históricas en asistencias
            state.positions = [
                { id: 'pos-keep', name: 'Activa', active: true },
                { id: 'pos-to-delete', name: 'A Eliminar', active: false }
            ];
            state.employees = [
                {
                    id: 'emp-1',
                    name: 'Test',
                    positions: ['pos-keep'],   // YA no tiene la posición que se eliminará
                    active: true
                }
            ];
            state.attendance = {
                // Asistencia histórica con referencia a la posición a eliminar
                'emp-1-2026-04-15': {
                    employeeId: 'emp-1',
                    selectedPosition: 'pos-to-delete',
                    positionHours: [
                        { positionId: 'pos-to-delete', hours: 8 }
                    ]
                }
            };

            // Llamar directamente al fix preventivo
            const { cleanupPositionReferences } = await import('../modules/features/employees/EmployeesUI.js');
            cleanupPositionReferences('pos-to-delete');

            // Verificar que las referencias se limpiaron
            const att = state.attendance['emp-1-2026-04-15'];
            testRunner.assertEquals(
                att.selectedPosition,
                null,
                "selectedPosition debe ser null tras eliminar la posición"
            );
            testRunner.assertEquals(
                att.positionHours.length,
                0,
                "positionHours debe estar vacío tras eliminar la posición"
            );
        } finally {
            restoreState(snap);
        }
    }
});

testRunner.addSuite("Data Integrity — Compactación de tombstones vencidos (Fase 1, U2d)", {

    async "compacta (borra de verdad) un tombstone con más de 60 días"() {
        const snap = snapshotState();
        try {
            state.positions = [];
            state.employees = [{ id: 'emp-1', name: 'Test', positions: [] }];
            const old = Date.now() - TOMBSTONE_RETENTION_MS - (24 * 60 * 60 * 1000); // 61 días
            state.attendance = {
                'emp-1-2026-04-01': { employeeId: 'emp-1', date: '2026-04-01', present: false, deletedAt: old }
            };

            const fixes = await validateDataIntegrity();

            testRunner.assert(fixes > 0, "debe contar la compactación como un fix");
            testRunner.assertEquals(state.attendance['emp-1-2026-04-01'], undefined,
                "el tombstone vencido debe borrarse de verdad, no solo marcarse");
        } finally {
            restoreState(snap);
        }
    },

    async "NO compacta un tombstone dentro de la ventana de 60 días"() {
        const snap = snapshotState();
        try {
            state.positions = [];
            state.employees = [{ id: 'emp-1', name: 'Test', positions: [] }];
            const recent = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 días
            state.attendance = {
                'emp-1-2026-06-20': { employeeId: 'emp-1', date: '2026-06-20', present: false, deletedAt: recent }
            };

            await validateDataIntegrity();

            testRunner.assert(!!state.attendance['emp-1-2026-06-20'],
                "un tombstone reciente debe seguir existiendo — todavía puede no haber propagado a todos los dispositivos");
            testRunner.assertEquals(state.attendance['emp-1-2026-06-20'].deletedAt, recent,
                "el tombstone no debe alterarse mientras está dentro de la ventana");
        } finally {
            restoreState(snap);
        }
    },

    async "NO toca registros vivos (deletedAt null), sin importar su antigüedad"() {
        const snap = snapshotState();
        try {
            state.positions = [];
            state.employees = [{ id: 'emp-1', name: 'Test', positions: [] }];
            state.attendance = {
                'emp-1-2020-01-01': { employeeId: 'emp-1', date: '2020-01-01', present: true, hoursWorked: 8, deletedAt: null }
            };

            await validateDataIntegrity();

            testRunner.assert(!!state.attendance['emp-1-2020-01-01'],
                "un registro vivo, aunque muy viejo, no es un tombstone y no debe compactarse");
        } finally {
            restoreState(snap);
        }
    },

    // Judgment Day Fase 1 R1: si la subida diaria de esa fecha sigue
    // pendiente/muerta en el outbox (MainSyncStore), compactar el tombstone
    // borraría la única evidencia local del borrado antes de que llegara a
    // propagarse a la nube — un re-sync futuro (login en otro dispositivo,
    // "descargar todo") resucitaría el día "borrado" sin forma de detectarlo.
    async "NO compacta un tombstone vencido cuya subida diaria sigue pendiente/muerta en el outbox"() {
        const snap = snapshotState();
        const unconfirmedSpy = jest.spyOn(MainSyncStore, 'getUnconfirmedDailyDateKeys')
            .mockResolvedValue(new Set(['2026-04-01']));
        try {
            state.positions = [];
            state.employees = [{ id: 'emp-1', name: 'Test', positions: [] }];
            const old = Date.now() - TOMBSTONE_RETENTION_MS - (24 * 60 * 60 * 1000); // 61 días
            state.attendance = {
                'emp-1-2026-04-01': { employeeId: 'emp-1', date: '2026-04-01', present: false, deletedAt: old }
            };

            await validateDataIntegrity();

            testRunner.assert(!!state.attendance['emp-1-2026-04-01'],
                "un tombstone vencido NO debe compactarse mientras su subida diaria siga pendiente/muerta en el outbox");
        } finally {
            unconfirmedSpy.mockRestore();
            restoreState(snap);
        }
    },

    // Control: sin nada pendiente en el outbox para esa fecha, la compactación
    // vencida (comportamiento base ya cubierto arriba) sigue funcionando igual.
    async "SÍ compacta un tombstone vencido si su fecha NO figura como pendiente/muerta en el outbox (control)"() {
        const snap = snapshotState();
        const unconfirmedSpy = jest.spyOn(MainSyncStore, 'getUnconfirmedDailyDateKeys')
            .mockResolvedValue(new Set());
        try {
            state.positions = [];
            state.employees = [{ id: 'emp-1', name: 'Test', positions: [] }];
            const old = Date.now() - TOMBSTONE_RETENTION_MS - (24 * 60 * 60 * 1000); // 61 días
            state.attendance = {
                'emp-1-2026-04-01': { employeeId: 'emp-1', date: '2026-04-01', present: false, deletedAt: old }
            };

            await validateDataIntegrity();

            testRunner.assertEquals(state.attendance['emp-1-2026-04-01'], undefined,
                "control: sin nada pendiente en el outbox, el tombstone vencido sigue compactándose normalmente");
        } finally {
            unconfirmedSpy.mockRestore();
            restoreState(snap);
        }
    }
});

console.log('🧪 Data Integrity tests cargados.');
