/**
 * DomainResetServiceTests — migración de OnboardingCoherenceTests al servicio
 * DomainResetService.resetDomainData (extraído del clearAllData del wizard legacy
 * ui/Onboarding.js al convertir el onboarding v2 en el arranque real).
 *
 * resetDomainData() resetea el dominio entero (incluye state.attendance = {}) cuando
 * el usuario elige "empezar de cero". Es un REEMPLAZO TOTAL, así que sin los traps
 * del proxy debe mantener la coherencia EXPLÍCITAMENTE: rebuild TOTAL del índice
 * (que con asistencia vacía queda vacío) + limpieza mayorista de statsCache.mtd
 * (no deben quedar stats de empleados ya borrados).
 *
 * El test clave corre resetDomainData DENTRO de batchSetState (proxy silencioso): si
 * el índice/stats quedan coherentes, es por la coherencia explícita.
 */

import { stateManager } from '../modules/core/AppState.js';
import { resetDomainData } from '../modules/services/DomainResetService.js';

function setupPopulatedState() {
    // app.js expone resolveIconSet como global (window.resolveIconSet) para resolver
    // el icon set vigente en los defaults de settings; en jest no se carga app.js,
    // así que lo stubeamos como en el suite original del wizard.
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

testRunner.addSuite("DomainResetService.resetDomainData — Coherencia del índice", {

    "resetDomainData en batchSetState deja attendanceByDate vacío vía coherencia explícita"() {
        setupPopulatedState();
        stateManager.batchSetState(() => { resetDomainData(); });
        const raw = stateManager.getState();
        testRunner.assertEquals(Object.keys(raw.attendance).length, 0, "asistencia debe quedar vacía");
        testRunner.assertEquals(
            Object.keys(raw.attendanceByDate).length, 0,
            "el índice por fecha debe quedar vacío SIN el proxy (solo el rebuild explícito pudo limpiarlo)"
        );
    },

    "resetDomainData en batchSetState limpia statsCache.mtd (no quedan stats de empleados borrados)"() {
        setupPopulatedState();
        stateManager.batchSetState(() => { resetDomainData(); });
        const raw = stateManager.getState();
        testRunner.assert(
            !raw.statsCache.mtd['emp1'],
            "las stats del empleado borrado no deben sobrevivir al reset"
        );
    },

    "resetDomainData sigue reseteando el resto del dominio (replicación exacta del legado)"() {
        setupPopulatedState();
        resetDomainData();
        const raw = stateManager.getState();
        testRunner.assertEquals(raw.employees.length, 0, "empleados reseteados");
        testRunner.assertEquals(raw.positions.length, 0, "puestos reseteados");
        testRunner.assertEquals(Object.keys(raw.attendance).length, 0, "asistencia reseteada");
        testRunner.assertEquals(raw.settings.companyName, 'Mi Empresa', "defaults de settings replicados");
        testRunner.assertEquals(raw.settings.iconSet, 'emoji', "iconSet resuelto vía el global de app.js");
        testRunner.assert(!('emp1' in (raw.dayHoursConfig || {})), "dayHoursConfig reiniciado");
    }
});

console.log('DomainResetService tests cargados.');
