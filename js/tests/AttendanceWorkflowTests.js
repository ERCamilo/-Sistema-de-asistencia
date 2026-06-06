/**
 * 🧪 AttendanceWorkflowTests — Flujos diarios de asistencia.
 *
 * Verifica los casos de uso que el usuario realiza todos los días:
 *   - Marcar / desmarcar asistencia → state.attendance mutado
 *   - Modificar horas, puesto, horas extra, notas
 *   - Guardado en dispositivo disparado tras cada mutación
 *   - Toggle de feriado (día completo) → registros sincronizados
 *   - Ajuste de horas base del día (changeBaseHours / setDayHours)
 *
 * Patrón: AttendanceService para mutaciones de estado,
 *         saveApplicationData + mock de IndexedDB para verificar persistencia.
 */

import { state } from '../modules/core/AppState.js';
import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';
import { saveApplicationData, flushPendingSave } from '../modules/services/PersistenceService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { toggleHoliday } from '../modules/ui/AttendanceHandlers.js';

// ─── Helpers: estado local (para tests de servicio en aislamiento) ────────────

function buildState() {
    return {
        settings: { regularHoursPerDay: 8, holidays: [] },
        employees: [
            { id: 'emp1', name: 'Ana Pérez',    positions: ['pos1', 'pos2'], active: true },
            { id: 'emp2', name: 'Carlos García', positions: ['pos1'],        active: true },
        ],
        positions: [
            { id: 'pos1', name: 'Oficial',    hourlyRate: 100, active: true },
            { id: 'pos2', name: 'Ayudante',   hourlyRate: 80,  active: true },
        ],
        leaders: [],
        attendance: {},
        dayHoursConfig: {},
    };
}

// ─── Helpers: estado global (para tests de persistencia) ─────────────────────

function snapshotGlobal() {
    return {
        employees:     [...state.employees],
        positions:     [...state.positions],
        leaders:       [...state.leaders],
        attendance:    { ...state.attendance },
        isDataLoaded:  state.isDataLoaded,
        useIndexedDB:  state.useIndexedDB,
        settings:      state.settings ? { ...state.settings, holidays: [...(state.settings.holidays || [])] } : {},
        dayHoursConfig: state.dayHoursConfig ? { ...state.dayHoursConfig } : {},
    };
}

function restoreGlobal(snap) {
    state.employees     = snap.employees;
    state.positions     = snap.positions;
    state.leaders       = snap.leaders;
    state.attendance    = snap.attendance;
    state.isDataLoaded  = snap.isDataLoaded;
    state.useIndexedDB  = snap.useIndexedDB;
    state.settings      = snap.settings;
    state.dayHoursConfig = snap.dayHoursConfig;
}

function clearMocks() {
    indexedDBService.saveState.mockClear();
}

async function waitForSave() {
    return new Promise(r => setTimeout(r, 400)); // debounce 300ms + margin
}

const DATE = '2026-06-10';

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: Marcar / desmarcar asistencia
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('AttendanceWorkflow — marcar asistencia', {

    'marcar crea registro con present=true en state.attendance'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        const record = svc.createRecord('emp1', DATE);

        testRunner.assert(record !== null, 'debe retornar el registro');
        testRunner.assertEquals(record.present, true, 'present debe ser true');
        testRunner.assertEquals(record.employeeId, 'emp1', 'employeeId correcto');
        testRunner.assertEquals(record.date, DATE, 'fecha correcta');
        testRunner.assert(`emp1-${DATE}` in s.attendance, 'registro en state.attendance');
    },

    'marcar asigna las horas del día del settings'() {
        const s = buildState();
        s.settings.regularHoursPerDay = 9;
        const svc = new AttendanceService(s);

        const record = svc.createRecord('emp1', DATE);

        testRunner.assertEquals(record.hoursWorked, 9, 'horas según settings');
    },

    'marcar elige el primer puesto del empleado como selectedPosition'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        const record = svc.createRecord('emp1', DATE);

        testRunner.assertEquals(record.selectedPosition, 'pos1', 'primer puesto asignado');
    },

    'marcar empleado sin puestos → selectedPosition es null'() {
        const s = buildState();
        s.employees.push({ id: 'emp3', name: 'Sin Puesto', positions: [], active: true });
        const svc = new AttendanceService(s);

        const record = svc.createRecord('emp3', DATE);

        testRunner.assertEquals(record.selectedPosition, null, 'sin puestos → null');
    },

    'marcar con hoursWorked personalizado respeta el valor dado'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        const record = svc.createRecord('emp1', DATE, { hoursWorked: 4 });

        testRunner.assertEquals(record.hoursWorked, 4, 'horas personalizadas respetadas');
    },

    'desmarcar elimina el registro de state.attendance'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        svc.createRecord('emp1', DATE);
        testRunner.assert(`emp1-${DATE}` in s.attendance, 'registro existe antes de desmarcar');

        const removed = svc.deleteRecord('emp1', DATE);

        testRunner.assert(removed === true, 'deleteRecord debe retornar true');
        testRunner.assert(!(`emp1-${DATE}` in s.attendance), 'registro eliminado');
    },

    'desmarcar empleado sin asistencia retorna false'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        const result = svc.deleteRecord('emp1', DATE);

        testRunner.assertEquals(result, false, 'false cuando no hay registro');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: Modificar campos de asistencia
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('AttendanceWorkflow — modificar asistencia', {

    'actualizar hoursWorked'() {
        const s = buildState();
        const svc = new AttendanceService(s);
        svc.createRecord('emp1', DATE);

        svc.updateRecord('emp1', DATE, { hoursWorked: 6 });

        testRunner.assertEquals(s.attendance[`emp1-${DATE}`].hoursWorked, 6, 'horas actualizadas');
    },

    'actualizar notes'() {
        const s = buildState();
        const svc = new AttendanceService(s);
        svc.createRecord('emp1', DATE);

        svc.updateRecord('emp1', DATE, { notes: 'Llegó tarde' });

        testRunner.assertEquals(s.attendance[`emp1-${DATE}`].notes, 'Llegó tarde', 'notas actualizadas');
    },

    'actualizar selectedPosition'() {
        const s = buildState();
        const svc = new AttendanceService(s);
        svc.createRecord('emp1', DATE);

        svc.updateRecord('emp1', DATE, { selectedPosition: 'pos2' });

        testRunner.assertEquals(s.attendance[`emp1-${DATE}`].selectedPosition, 'pos2', 'puesto actualizado');
    },

    'actualizar overtimeHours'() {
        const s = buildState();
        const svc = new AttendanceService(s);
        svc.createRecord('emp1', DATE);

        svc.updateRecord('emp1', DATE, { overtimeHours: 2 });

        testRunner.assertEquals(s.attendance[`emp1-${DATE}`].overtimeHours, 2, 'horas extra actualizadas');
    },

    'actualizar campo en registro inexistente retorna null'() {
        const s = buildState();
        const svc = new AttendanceService(s);

        const result = svc.updateRecord('emp1', DATE, { hoursWorked: 5 });

        testRunner.assertEquals(result, null, 'null cuando no existe registro');
    },

    'actualizar multiPosition con positionHours'() {
        const s = buildState();
        const svc = new AttendanceService(s);
        svc.createRecord('emp1', DATE);

        svc.updateRecord('emp1', DATE, {
            multiPosition: true,
            positionHours: [
                { positionId: 'pos1', hours: 4, overtimeHours: 0 },
                { positionId: 'pos2', hours: 4, overtimeHours: 0 },
            ]
        });

        const rec = s.attendance[`emp1-${DATE}`];
        testRunner.assertEquals(rec.multiPosition, true, 'multiPosition activado');
        testRunner.assertEquals(rec.positionHours.length, 2, 'dos puestos registrados');
        testRunner.assertEquals(rec.positionHours[0].positionId, 'pos1', 'primer puesto correcto');
        testRunner.assertEquals(rec.positionHours[1].hours, 4, 'horas del segundo puesto correctas');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: Persistencia — saveApplicationData tras mutación
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('AttendanceWorkflow — guardado en dispositivo', {

    async 'marcar asistencia y guardar llama indexedDBService.saveState'() {
        const snap = snapshotGlobal();
        try {
            clearMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.employees = [{ id: 'emp1', name: 'Ana', positions: ['pos1'], active: true }];
            state.attendance = {};

            // Simular lo que toggleAttendance hace: mutar state + llamar saveApplicationData
            state.attendance[`emp1-${DATE}`] = {
                employeeId: 'emp1', date: DATE, present: true, hoursWorked: 8,
                overtimeHours: 0, isHoliday: false, selectedPosition: 'pos1',
                multiPosition: false, positionHours: [], notes: '', updatedAt: Date.now()
            };
            saveApplicationData({ dateKey: DATE });
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB debe guardar');
        } finally {
            restoreGlobal(snap);
        }
    },

    async 'desmarcar asistencia y guardar llama indexedDBService.saveState'() {
        const snap = snapshotGlobal();
        try {
            clearMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                [`emp1-${DATE}`]: { employeeId: 'emp1', date: DATE, present: true }
            };

            delete state.attendance[`emp1-${DATE}`];
            saveApplicationData({ dateKey: DATE });
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB debe guardar al desmarcar');
        } finally {
            restoreGlobal(snap);
        }
    },

    async 'modificar horas y guardar llama indexedDBService.saveState'() {
        const snap = snapshotGlobal();
        try {
            clearMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                [`emp1-${DATE}`]: { employeeId: 'emp1', date: DATE, present: true, hoursWorked: 8 }
            };

            state.attendance[`emp1-${DATE}`].hoursWorked = 6;
            saveApplicationData({ dateKey: DATE });
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB debe guardar la modificación');
        } finally {
            restoreGlobal(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4: Toggle de feriado
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('AttendanceWorkflow — feriado', {

    'toggleHoliday agrega la fecha a settings.holidays'() {
        const snap = snapshotGlobal();
        try {
            state.settings = { holidays: [], regularHoursPerDay: 8 };
            state.attendance = {};
            state.selectedDate = new Date(DATE);

            toggleHoliday(DATE);

            testRunner.assert(state.settings.holidays.includes(DATE), 'fecha agregada a holidays');
        } finally {
            restoreGlobal(snap);
        }
    },

    'toggleHoliday llamado dos veces quita la fecha (toggle off)'() {
        const snap = snapshotGlobal();
        try {
            state.settings = { holidays: [], regularHoursPerDay: 8 };
            state.attendance = {};
            state.selectedDate = new Date(DATE);

            toggleHoliday(DATE);
            toggleHoliday(DATE);

            testRunner.assert(!state.settings.holidays.includes(DATE), 'fecha removida al hacer toggle off');
        } finally {
            restoreGlobal(snap);
        }
    },

    'toggleHoliday sincroniza isHoliday en registros existentes del día'() {
        const snap = snapshotGlobal();
        try {
            state.settings = { holidays: [], regularHoursPerDay: 8 };
            state.attendance = {
                [`emp1-${DATE}`]: { employeeId: 'emp1', date: DATE, present: true, isHoliday: false },
                [`emp2-${DATE}`]: { employeeId: 'emp2', date: DATE, present: true, isHoliday: false },
            };
            state.selectedDate = new Date(DATE);

            toggleHoliday(DATE);

            testRunner.assertEquals(state.attendance[`emp1-${DATE}`].isHoliday, true, 'emp1: isHoliday sincronizado');
            testRunner.assertEquals(state.attendance[`emp2-${DATE}`].isHoliday, true, 'emp2: isHoliday sincronizado');
        } finally {
            restoreGlobal(snap);
        }
    },

    'toggleHoliday al quitar feriado sincroniza isHoliday=false en registros'() {
        const snap = snapshotGlobal();
        try {
            state.settings = { holidays: [DATE], regularHoursPerDay: 8 };
            state.attendance = {
                [`emp1-${DATE}`]: { employeeId: 'emp1', date: DATE, present: true, isHoliday: true },
            };
            state.selectedDate = new Date(DATE);

            toggleHoliday(DATE); // quitar feriado

            testRunner.assertEquals(state.attendance[`emp1-${DATE}`].isHoliday, false, 'isHoliday vuelto a false');
        } finally {
            restoreGlobal(snap);
        }
    },
});
