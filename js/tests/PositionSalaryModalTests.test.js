/**
 * 🧪 PositionSalaryModalTests — El guardado de PositionModal debe convertir según el
 * toggle hora/día y persistir SIEMPRE la tarifa por hora + el modo (salaryInputMode).
 */

import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { PositionModal } from '../modules/ui/modals/PositionModal.js';

function setupContext() {
    EmployeesUI.init({ state, saveToLocalStorage: jest.fn(), render: jest.fn(), services: {} });
}

function makeModalEl({ name, rate, mode }) {
    const el = document.createElement('div');
    el.innerHTML = `
        <input id="posName" value="${name}">
        <input id="posHourlyRate" value="${rate}">
        <input type="hidden" id="posSalaryMode" value="${mode}">
        <select id="posLeader"><option value="" selected></option></select>
    `;
    return el;
}

describe('PositionModal.save — toggle hora/día', () => {
    beforeEach(() => {
        setupContext();
        state.positions = [];
        state.leaders = [];
        state.employees = [];
        state.settings.regularHoursPerDay = 8;
        window.showAlert = jest.fn();
    });

    test("modo 'daily' convierte a por-hora y guarda el modo", () => {
        const modal = { element: makeModalEl({ name: 'Albañil', rate: '1000', mode: 'daily' }), close: jest.fn() };
        PositionModal.save(modal, null);
        expect(state.positions).toHaveLength(1);
        expect(state.positions[0].hourlyRate).toBe(125);          // 1000 / 8h
        expect(state.positions[0].salaryInputMode).toBe('daily');
        expect(modal.close).toHaveBeenCalled();
    });

    test("modo 'hourly' guarda el monto tal cual (passthrough)", () => {
        const modal = { element: makeModalEl({ name: 'Ayudante', rate: '100', mode: 'hourly' }), close: jest.fn() };
        PositionModal.save(modal, null);
        expect(state.positions[0].hourlyRate).toBe(100);
        expect(state.positions[0].salaryInputMode).toBe('hourly');
    });

    test("editar un puesto en modo 'daily' actualiza tarifa por hora + modo", () => {
        state.positions = [{ id: 'p1', name: 'Carpintero', hourlyRate: 50, salaryInputMode: 'hourly', active: true }];
        const modal = { element: makeModalEl({ name: 'Carpintero', rate: '800', mode: 'daily' }), close: jest.fn() };
        PositionModal.save(modal, state.positions[0]);
        expect(state.positions[0].hourlyRate).toBe(100);          // 800 / 8h
        expect(state.positions[0].salaryInputMode).toBe('daily');
    });
});
