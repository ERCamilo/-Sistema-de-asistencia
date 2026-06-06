/**
 * 🧪 ModalSaveTests — Flujos de guardado de los 3 modales de entidades.
 *
 * Verifica que Employee/Position/LeaderModal.save() mutan correctamente
 * state.employees / state.positions / state.leaders e invocan
 * context.saveToLocalStorage(). Estos tests protegen el bug donde
 * applyFields() nunca se llamaba en el camino sin conflicto.
 *
 * Patrón: snapshotState / restoreState + mock del contexto + DOM sintético.
 */

import { state } from '../modules/core/AppState.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import { PositionModal } from '../modules/ui/modals/PositionModal.js';
import { LeaderModal }   from '../modules/ui/modals/LeaderModal.js';
import * as EmployeesUI  from '../modules/features/employees/EmployeesUI.js';

// ─── Helpers: estado ─────────────────────────────────────────────────────────

function snapshotState() {
    return {
        employees: [...state.employees],
        positions: [...state.positions],
        leaders:   [...state.leaders],
    };
}

function restoreState(snap) {
    state.employees = snap.employees;
    state.positions = snap.positions;
    state.leaders   = snap.leaders;
}

// ─── Helpers: contexto ───────────────────────────────────────────────────────

function setupContext() {
    const ctx = {
        state,
        saveToLocalStorage: jest.fn(),
        render: jest.fn(),
        closeModal: jest.fn(),
        services: {},
    };
    EmployeesUI.init(ctx);
    return ctx;
}

// ─── Helpers: DOM sintético ──────────────────────────────────────────────────

function makeMockModal(innerHTML) {
    const el = document.createElement('div');
    el.innerHTML = innerHTML;
    return { element: el, close: jest.fn() };
}

function employeeFormHTML({ number = '001', name = 'Ada Test', posId = 'pos-test', checked = true } = {}) {
    return `
        <input id="empNumber"  value="${number}">
        <input id="empName"    value="${name}">
        <input id="empHireDate" value="2026-01-01">
        <input id="empPhone"   value="">
        <input id="empEmail"   value="">
        <textarea id="empNotes"></textarea>
        <input type="checkbox" name="empPosition" value="${posId}" ${checked ? 'checked' : ''}>
        <input class="custom-salary-input" data-pos-id="${posId}" value="">
    `;
}

function positionFormHTML({ name = 'Albañil', rate = '150', leaderId = '', color = '#3b82f6', days = [1,2,3,4,5] } = {}) {
    const dayCheckboxes = days.map(d => `<input type="checkbox" name="workingDay" value="${d}" checked>`).join('');
    return `
        <input id="posName"       value="${name}">
        <input id="posHourlyRate" value="${rate}">
        <select id="posLeader"><option value="${leaderId}">${leaderId}</option></select>
        <input type="radio" name="posColor" value="${color}" checked>
        ${dayCheckboxes}
    `;
}

function leaderFormHTML({ number = '11', name = 'Carlos Test', phone = '', email = '', notes = '' } = {}) {
    return `
        <input id="ldrNumber" value="${number}">
        <input id="ldrName"   value="${name}">
        <input id="ldrPhone"  value="${phone}">
        <input id="ldrEmail"  value="${email}">
        <textarea id="ldrNotes">${notes}</textarea>
    `;
}

// ─── Silenciar window.showAlert en todos los tests ───────────────────────────

beforeAll(() => { window.showAlert = jest.fn(); });
afterAll(() =>  { delete window.showAlert; });

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: EmployeeModal
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('ModalSave — EmployeeModal: crear', {

    'crea el empleado y lo agrega a state.employees'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const POS_ID = 'pos-emp-1';
            state.positions = [{ id: POS_ID, name: 'Oficial', active: true }];

            const modal = makeMockModal(employeeFormHTML({ posId: POS_ID }));
            EmployeeModal.save(modal, null);

            testRunner.assertEquals(state.employees.length, 1, 'debe haber 1 empleado');
            testRunner.assertEquals(state.employees[0].name, 'Ada Test', 'nombre correcto');
            testRunner.assertEquals(state.employees[0].number, '001', 'número correcto');
            testRunner.assert(state.employees[0].positions.includes(POS_ID), 'posición asignada');
            testRunner.assert(state.employees[0].active === true, 'empleado activo');
            testRunner.assert(typeof state.employees[0].id === 'string' && state.employees[0].id.length > 0, 'tiene id');
        } finally {
            restoreState(snap);
        }
    },

    'saveToLocalStorage se invoca al crear'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.positions = [{ id: 'pos-2', name: 'Oficial', active: true }];

            const modal = makeMockModal(employeeFormHTML({ posId: 'pos-2' }));
            EmployeeModal.save(modal, null);

            testRunner.assert(ctx.saveToLocalStorage.mock.calls.length === 1, 'saveToLocalStorage llamado 1 vez');
        } finally {
            restoreState(snap);
        }
    },

    'cierra el modal al guardar'() {
        const snap = snapshotState();
        try {
            setupContext();
            state.positions = [{ id: 'pos-3', name: 'Oficial', active: true }];

            const modal = makeMockModal(employeeFormHTML({ posId: 'pos-3' }));
            EmployeeModal.save(modal, null);

            testRunner.assert(modal.close.mock.calls.length === 1, 'modal.close() llamado');
        } finally {
            restoreState(snap);
        }
    },

    'sin nombre no guarda y no llama saveToLocalStorage'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.positions = [{ id: 'pos-4', name: 'Oficial', active: true }];

            const modal = makeMockModal(employeeFormHTML({ name: '', posId: 'pos-4' }));
            EmployeeModal.save(modal, null);

            testRunner.assertEquals(state.employees.length, 0, 'no se agregó ningún empleado');
            testRunner.assertEquals(ctx.saveToLocalStorage.mock.calls.length, 0, 'saveToLocalStorage no llamado');
        } finally {
            restoreState(snap);
        }
    },

    'sin posición marcada no guarda'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.positions = [{ id: 'pos-5', name: 'Oficial', active: true }];

            const modal = makeMockModal(employeeFormHTML({ posId: 'pos-5', checked: false }));
            EmployeeModal.save(modal, null);

            testRunner.assertEquals(state.employees.length, 0, 'no se guardó sin posición');
        } finally {
            restoreState(snap);
        }
    },
});

testRunner.addSuite('ModalSave — EmployeeModal: editar', {

    'editar actualiza los campos del empleado existente'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const POS_ID = 'pos-edit-1';
            state.positions = [{ id: POS_ID, name: 'Oficial', active: true }];
            state.employees = [{
                id: 'emp-original', key: 'emp-original',
                number: '001', name: 'Nombre Viejo',
                positions: [POS_ID], active: true, loans: [],
            }];
            const existingEmp = state.employees.find(e => e.id === 'emp-original');

            const modal = makeMockModal(employeeFormHTML({ number: '002', name: 'Nombre Nuevo', posId: POS_ID }));
            EmployeeModal.save(modal, existingEmp);

            const updated = state.employees.find(e => e.id === 'emp-original');
            testRunner.assert(!!updated, 'empleado sigue en state');
            testRunner.assertEquals(updated.name,   'Nombre Nuevo', 'nombre actualizado');
            testRunner.assertEquals(updated.number, '002',          'número actualizado');
            testRunner.assertEquals(state.employees.length, 1, 'no se duplicó');
        } finally {
            restoreState(snap);
        }
    },

    'editar llama saveToLocalStorage'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const POS_ID = 'pos-edit-2';
            state.positions = [{ id: POS_ID, name: 'Oficial', active: true }];
            state.employees = [{
                id: 'emp-e2', key: 'emp-e2', number: '001',
                name: 'Original', positions: [POS_ID], active: true, loans: [],
            }];
            const existingEmp = state.employees[0];

            const modal = makeMockModal(employeeFormHTML({ posId: POS_ID, name: 'Editado' }));
            EmployeeModal.save(modal, existingEmp);

            testRunner.assert(ctx.saveToLocalStorage.mock.calls.length === 1, 'saveToLocalStorage invocado');
        } finally {
            restoreState(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: PositionModal
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('ModalSave — PositionModal: crear', {

    'crea la posición y la agrega a state.positions'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(positionFormHTML({ name: 'Carpintero', rate: '200' }));
            PositionModal.save(modal, null);

            testRunner.assertEquals(state.positions.length, 1, 'una posición creada');
            testRunner.assertEquals(state.positions[0].name, 'Carpintero', 'nombre correcto');
            testRunner.assertEquals(state.positions[0].hourlyRate, 200, 'tarifa correcta');
            testRunner.assert(state.positions[0].active === true, 'activa por defecto');
            testRunner.assert(typeof state.positions[0].id === 'string', 'tiene id');
        } finally {
            restoreState(snap);
        }
    },

    'saveToLocalStorage se invoca al crear posición'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(positionFormHTML({ name: 'Electricista' }));
            PositionModal.save(modal, null);

            testRunner.assert(ctx.saveToLocalStorage.mock.calls.length === 1, 'saveToLocalStorage llamado');
        } finally {
            restoreState(snap);
        }
    },

    'sin nombre no guarda'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(positionFormHTML({ name: '' }));
            PositionModal.save(modal, null);

            testRunner.assertEquals(state.positions.length, 0, 'no se guardó');
            testRunner.assertEquals(ctx.saveToLocalStorage.mock.calls.length, 0, 'save no llamado');
        } finally {
            restoreState(snap);
        }
    },

    'nombre duplicado no guarda'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.positions = [{ id: 'p-dup', name: 'Albañil', active: true }];

            const modal = makeMockModal(positionFormHTML({ name: 'Albañil' }));
            PositionModal.save(modal, null);

            testRunner.assertEquals(state.positions.length, 1, 'no se duplicó');
            testRunner.assertEquals(ctx.saveToLocalStorage.mock.calls.length, 0, 'save no llamado');
        } finally {
            restoreState(snap);
        }
    },

    'tarifa inválida no guarda'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(positionFormHTML({ name: 'Pintor', rate: 'abc' }));
            PositionModal.save(modal, null);

            testRunner.assertEquals(state.positions.length, 0, 'no se guardó con tarifa inválida');
        } finally {
            restoreState(snap);
        }
    },
});

testRunner.addSuite('ModalSave — PositionModal: editar', {

    'editar actualiza los campos de la posición'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.positions = [{ id: 'p-orig', name: 'Plomero', hourlyRate: 100, active: true }];
            const existingPos = state.positions[0];

            const modal = makeMockModal(positionFormHTML({ name: 'Plomero Senior', rate: '250' }));
            PositionModal.save(modal, existingPos);

            const updated = state.positions.find(p => p.id === 'p-orig');
            testRunner.assertEquals(updated.name, 'Plomero Senior', 'nombre actualizado');
            testRunner.assertEquals(updated.hourlyRate, 250, 'tarifa actualizada');
            testRunner.assertEquals(state.positions.length, 1, 'no se duplicó');
        } finally {
            restoreState(snap);
        }
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: LeaderModal
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('ModalSave — LeaderModal: crear', {

    'crea el líder y lo agrega a state.leaders'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(leaderFormHTML({ number: '11', name: 'María García' }));
            LeaderModal.save(modal, null);

            testRunner.assertEquals(state.leaders.length, 1, 'un líder creado');
            testRunner.assertEquals(state.leaders[0].name, 'María García', 'nombre correcto');
            testRunner.assertEquals(state.leaders[0].number, '11', 'número correcto');
            testRunner.assert(state.leaders[0].active === true, 'activo por defecto');
        } finally {
            restoreState(snap);
        }
    },

    'saveToLocalStorage se invoca al crear líder'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(leaderFormHTML({ name: 'Pedro López' }));
            LeaderModal.save(modal, null);

            testRunner.assert(ctx.saveToLocalStorage.mock.calls.length === 1, 'saveToLocalStorage invocado');
        } finally {
            restoreState(snap);
        }
    },

    'sin nombre no guarda'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            const modal = makeMockModal(leaderFormHTML({ name: '' }));
            LeaderModal.save(modal, null);

            testRunner.assertEquals(state.leaders.length, 0, 'no se guardó');
        } finally {
            restoreState(snap);
        }
    },

    'guarda campos opcionales (teléfono, email, notas)'() {
        const snap = snapshotState();
        try {
            setupContext();
            const modal = makeMockModal(leaderFormHTML({
                name: 'Juan Test', phone: '+1-809-555-0000',
                email: 'juan@test.com', notes: 'Nota de prueba',
            }));
            LeaderModal.save(modal, null);

            const ldr = state.leaders[0];
            testRunner.assertEquals(ldr.phone, '+1-809-555-0000', 'teléfono guardado');
            testRunner.assertEquals(ldr.email, 'juan@test.com',   'email guardado');
            testRunner.assertEquals(ldr.notes, 'Nota de prueba',  'notas guardadas');
        } finally {
            restoreState(snap);
        }
    },
});

testRunner.addSuite('ModalSave — LeaderModal: editar', {

    'editar actualiza los campos del líder'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.leaders = [{ id: 'ldr-orig', number: '10', name: 'Nombre Viejo', active: true }];
            const existingLdr = state.leaders[0];

            const modal = makeMockModal(leaderFormHTML({ number: '15', name: 'Nombre Nuevo' }));
            LeaderModal.save(modal, existingLdr);

            const updated = state.leaders.find(l => l.id === 'ldr-orig');
            testRunner.assertEquals(updated.name,   'Nombre Nuevo', 'nombre actualizado');
            testRunner.assertEquals(updated.number, '15',           'número actualizado');
            testRunner.assertEquals(state.leaders.length, 1, 'no se duplicó');
        } finally {
            restoreState(snap);
        }
    },

    'editar llama saveToLocalStorage'() {
        const snap = snapshotState();
        try {
            const ctx = setupContext();
            state.leaders = [{ id: 'ldr-e2', number: '10', name: 'Original', active: true }];
            const existingLdr = state.leaders[0];

            const modal = makeMockModal(leaderFormHTML({ name: 'Editado' }));
            LeaderModal.save(modal, existingLdr);

            testRunner.assert(ctx.saveToLocalStorage.mock.calls.length === 1, 'saveToLocalStorage invocado');
        } finally {
            restoreState(snap);
        }
    },
});
