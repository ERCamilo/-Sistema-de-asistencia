/**
 * 🧪 EmployeesProfileHandlersTests — Caracterización de los handlers de perfil
 * de EmployeesUI, como red de seguridad para migrarlos a batchSetState (Fase 3).
 *
 * Estos handlers usan getState() (= el proxy) + context.render(); el refactor a
 * batchSetState debe preservar exactamente el estado resultante.
 */

import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';

function setupContext() {
    EmployeesUI.init({ state, render: () => {}, saveToLocalStorage: () => {}, services: {} });
}

function resetProfile() {
    state.employees = [];
    state.selectedEmployee = null;
    state.showEmployeeProfile = false;
    state.employeeProfile = {
        employeeId: null,
        activeTab: 'resumen',
        assistanceMonth: new Date(2026, 5, 15),   // junio (mes index 5)
        startPickerMonth: new Date(2026, 5, 15),
        endPickerMonth: new Date(2026, 5, 15),
    };
}

testRunner.addSuite("EmployeesUI — Handlers de perfil (caracterización)", {

    "changeProfileAsistenciaMonth avanza el mes de asistencia"() {
        setupContext(); resetProfile();
        EmployeesUI.changeProfileAsistenciaMonth(1);
        const m = state.employeeProfile.assistanceMonth;
        testRunner.assert(m instanceof Date, "assistanceMonth debe seguir siendo Date");
        testRunner.assertEquals(m.getMonth(), 6, "debe avanzar a julio (index 6)");
    },

    "changeProfileStartMonth retrocede el mes del picker de inicio"() {
        setupContext(); resetProfile();
        EmployeesUI.changeProfileStartMonth(-1);
        testRunner.assertEquals(state.employeeProfile.startPickerMonth.getMonth(), 4, "debe retroceder a mayo (index 4)");
    },

    "changeProfileEndMonth avanza el mes del picker de fin"() {
        setupContext(); resetProfile();
        EmployeesUI.changeProfileEndMonth(2);
        testRunner.assertEquals(state.employeeProfile.endPickerMonth.getMonth(), 7, "debe avanzar a agosto (index 7)");
    },

    "openEmployeeProfile carga el perfil del empleado"() {
        setupContext(); resetProfile();
        state.employees = [{ id: 'e1', name: 'Juan', advances: [], bonuses: [], deductions: [] }];
        EmployeesUI.openEmployeeProfile('e1');
        testRunner.assertEquals(state.showEmployeeProfile, true, "showEmployeeProfile debe quedar true");
        testRunner.assert(!!state.selectedEmployee, "selectedEmployee debe quedar seteado");
        testRunner.assertEquals(state.selectedEmployee.id, 'e1', "selectedEmployee debe ser e1");
        testRunner.assertEquals(state.employeeProfile.employeeId, 'e1', "employeeProfile.employeeId debe ser e1");
        testRunner.assertEquals(state.employeeProfile.activeTab, 'resumen', "activeTab debe arrancar en 'resumen'");
    }
});

console.log('🧪 EmployeesProfileHandlers tests cargados.');
