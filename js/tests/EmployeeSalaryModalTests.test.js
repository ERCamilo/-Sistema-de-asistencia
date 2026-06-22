/**
 * 🧪 EmployeeSalaryModalTests — El guardado de EmployeeModal debe convertir cada
 * override de tarifa por puesto según su toggle hora/día, persistir SIEMPRE por hora
 * en positionSalaries[posId] y recordar el modo en positionSalaryModes[posId].
 */

import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';

function setupContext() {
    EmployeesUI.init({ state, saveToLocalStorage: jest.fn(), render: jest.fn(), services: {} });
}

function makeEmpModalEl({ number, name, positions }) {
    const el = document.createElement('div');
    const rows = positions.map(p => `
        <input type="checkbox" name="empPosition" value="${p.id}" checked>
        <input class="custom-salary-input" data-pos-id="${p.id}" value="${p.override}">
        <select class="custom-salary-mode" data-pos-id="${p.id}">
            <option value="hourly" ${p.mode === 'hourly' ? 'selected' : ''}>h</option>
            <option value="daily" ${p.mode === 'daily' ? 'selected' : ''}>d</option>
        </select>
    `).join('');
    el.innerHTML = `
        <input id="empNumber" value="${number}">
        <input id="empName" value="${name}">
        <input id="empHireDate" value="2020-01-01">
        <input id="empPhone" value="">
        <input id="empEmail" value="">
        <textarea id="empNotes"></textarea>
        ${rows}
    `;
    return el;
}

describe('EmployeeModal.save — toggle hora/día en overrides por puesto', () => {
    beforeEach(() => {
        setupContext();
        state.employees = [];
        state.positions = [];
        state.leaders = [];
        state.settings.regularHoursPerDay = 8;
        window.showAlert = jest.fn();
    });

    test("override en 'día' se convierte a por-hora y guarda el modo", () => {
        const modal = { element: makeEmpModalEl({ number: '001', name: 'Juan', positions: [{ id: 'p1', override: '1000', mode: 'daily' }] }), close: jest.fn() };
        EmployeeModal.save(modal, null);
        const emp = state.employees[0];
        expect(emp.positionSalaries.p1).toBe(125);              // 1000 / 8h
        expect(emp.positionSalaryModes.p1).toBe('daily');
    });

    test("override en 'hora' se guarda tal cual; el modo 'hourly' no ensucia el mapa", () => {
        const modal = { element: makeEmpModalEl({ number: '002', name: 'Ana', positions: [{ id: 'p1', override: '100', mode: 'hourly' }] }), close: jest.fn() };
        EmployeeModal.save(modal, null);
        const emp = state.employees[0];
        expect(emp.positionSalaries.p1).toBe(100);
        expect(emp.positionSalaryModes.p1).toBeUndefined();
    });

    test("editar un empleado convierte el override en 'día'", () => {
        state.employees = [{ id: 'e1', key: 'e1', number: '5', name: 'Pedro', positions: ['p1'], positionSalaries: { p1: 50 }, active: true }];
        const modal = { element: makeEmpModalEl({ number: '5', name: 'Pedro', positions: [{ id: 'p1', override: '800', mode: 'daily' }] }), close: jest.fn() };
        EmployeeModal.save(modal, state.employees[0]);
        expect(state.employees[0].positionSalaries.p1).toBe(100);   // 800 / 8h
        expect(state.employees[0].positionSalaryModes.p1).toBe('daily');
    });
});
