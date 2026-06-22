/**
 * OnboardingCoherenceTests — Fase 4 Paso 3 (Onboarding.clearAllData, reset total).
 *
 * clearAllData() resetea el dominio entero (incluye state.attendance = {}) cuando
 * el usuario elige el modo "empezar de cero". Es un REEMPLAZO TOTAL, así que tras
 * Paso 4 (sin los traps del proxy) debe mantener la coherencia EXPLÍCITAMENTE:
 * rebuild TOTAL del índice (que con asistencia vacía queda vacío) + limpieza
 * mayorista de statsCache.mtd (no deben quedar stats de empleados ya borrados).
 *
 * El test clave corre clearAllData DENTRO de batchSetState (proxy silencioso): si
 * el índice/stats quedan coherentes, es por la coherencia explícita.
 */

import { stateManager } from '../modules/core/AppState.js';
import { onboardingWizard } from '../modules/ui/Onboarding.js';

function setupPopulatedState() {
    // resolveIconSet es un global que cuelga app.js en producción (window.resolveIconSet);
    // en jest no se carga app.js, así que lo stubeamos para que clearAllData no tire ReferenceError.
    globalThis.resolveIconSet = () => 'emoji';
    const raw = stateManager.getState();
    // Estado "lleno" de una sesión previa: asistencia en 2 fechas, índice y stats.
    raw.employees = [{ id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' }];
    raw.attendance = {
        'emp1-2026-06-18': { employeeId: 'emp1', date: '2026-06-18', present: true, hoursWorked: 8 },
        'emp1-2026-06-19': { employeeId: 'emp1', date: '2026-06-19', present: true, hoursWorked: 6 },
    };
    raw.attendanceByDate = {
        '2026-06-18': [raw.attendance['emp1-2026-06-18']],
        '2026-06-19': [raw.attendance['emp1-2026-06-19']],
    };
    raw.statsCache.mtd = { emp1: { cached: true } };
}

testRunner.addSuite("Onboarding.clearAllData — Coherencia del índice (Fase 4 Paso 3)", {

    "clearAllData en batchSetState deja attendanceByDate vacío vía coherencia explícita"() {
        setupPopulatedState();
        stateManager.batchSetState(() => { onboardingWizard.clearAllData(); });
        const raw = stateManager.getState();
        testRunner.assertEquals(Object.keys(raw.attendance).length, 0, "asistencia debe quedar vacía");
        testRunner.assertEquals(
            Object.keys(raw.attendanceByDate).length, 0,
            "el índice por fecha debe quedar vacío SIN el proxy (solo el rebuild explícito pudo limpiarlo)"
        );
    },

    "clearAllData en batchSetState limpia statsCache.mtd (no quedan stats de empleados borrados)"() {
        setupPopulatedState();
        stateManager.batchSetState(() => { onboardingWizard.clearAllData(); });
        const raw = stateManager.getState();
        testRunner.assert(
            !raw.statsCache.mtd['emp1'],
            "las stats del empleado borrado no deben sobrevivir al reset"
        );
    },

    "clearAllData sigue reseteando el resto del dominio (no rompimos el comportamiento previo)"() {
        setupPopulatedState();
        onboardingWizard.clearAllData();
        const raw = stateManager.getState();
        testRunner.assertEquals(raw.employees.length, 0, "empleados reseteados");
        testRunner.assertEquals(raw.positions.length, 0, "puestos reseteados");
        testRunner.assertEquals(Object.keys(raw.attendance).length, 0, "asistencia reseteada");
    }
});

console.log('OnboardingCoherence tests cargados.');
