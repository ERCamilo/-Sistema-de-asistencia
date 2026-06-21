/**
 * 🛡️ BuildAttendanceIndexTests — contrato del primitivo de índice (refuerzo Paso 4).
 *
 * buildAttendanceIndex es EL mecanismo que mantiene attendanceByDate coherente. Tras
 * Paso 4 (sin los traps del proxy) pasa a ser load-bearing: toda la coherencia del
 * índice depende de llamarlo bien. Este test fija su contrato exacto:
 *   - granular buildAttendanceIndex(dateKey): reconstruye SOLO ese día, deja el resto.
 *   - total buildAttendanceIndex(): reconstruye todo y DROPEA días que ya no existen.
 *   - saltea registros sin .date.
 */

import { stateManager, buildAttendanceIndex } from '../modules/core/AppState.js';

function seed(attendance, byDate = {}) {
    const raw = stateManager.getState();
    raw.attendance = attendance;
    raw.attendanceByDate = byDate;
    return raw;
}

testRunner.addSuite("buildAttendanceIndex — contrato del primitivo (refuerzo Paso 4)", {

    "granular(dateKey) reconstruye SOLO el bucket de ese día (no toca los demás)"() {
        const raw = seed(
            {
                'e1-2026-06-18': { employeeId: 'e1', date: '2026-06-18', present: true },
                'e1-2026-06-19': { employeeId: 'e1', date: '2026-06-19', present: true },
            },
            { '2026-06-18': [], '2026-06-19': [{ stale: true }] } // 18 desactualizado, 19 con basura
        );

        buildAttendanceIndex('2026-06-18');

        testRunner.assertEquals((raw.attendanceByDate['2026-06-18'] || []).length, 1, "el día 18 debe reconstruirse con 1 registro");
        testRunner.assert(raw.attendanceByDate['2026-06-19'] && raw.attendanceByDate['2026-06-19'][0].stale === true,
            "el día 19 NO debe tocarse (granular solo afecta su día)");
    },

    "total() reconstruye todo y DROPEA días que ya no existen en attendance"() {
        const raw = seed(
            { 'e1-2026-06-18': { employeeId: 'e1', date: '2026-06-18', present: true } },
            { '2020-01-01': [{ ghost: true }] } // fecha fantasma de una sesión previa
        );

        buildAttendanceIndex(); // total

        testRunner.assertEquals((raw.attendanceByDate['2026-06-18'] || []).length, 1, "el día real debe quedar indexado");
        testRunner.assert(raw.attendanceByDate['2020-01-01'] === undefined, "la fecha fantasma debe desaparecer en un rebuild total");
    },

    "total() saltea registros sin .date"() {
        const raw = seed({ 'sin-fecha': { employeeId: 'e1', present: true } }); // sin date

        buildAttendanceIndex();

        testRunner.assertEquals(Object.keys(raw.attendanceByDate).length, 0, "un registro sin .date no debe crear bucket");
    },

    "agrupa varios empleados del mismo día en el mismo bucket"() {
        const raw = seed({
            'e1-2026-06-18': { employeeId: 'e1', date: '2026-06-18', present: true },
            'e2-2026-06-18': { employeeId: 'e2', date: '2026-06-18', present: true },
        });

        buildAttendanceIndex('2026-06-18');

        testRunner.assertEquals((raw.attendanceByDate['2026-06-18'] || []).length, 2, "ambos empleados deben caer en el bucket del día");
    }
});

console.log('🛡️ BuildAttendanceIndex tests cargados.');
