/**
 * 🧪 EmployeesFilterHandlersTests — Caracterización de los handlers de filtro
 * de EmployeesList, como red de seguridad para migrarlos a batchSetState (Fase 3).
 *
 * Fija el ESTADO resultante de cada handler. El refactor a batchSetState debe
 * preservar exactamente estos resultados (mismas escrituras, un solo render).
 */

import { state } from '../modules/core/AppState.js';
import {
    changeEmployeeViewMode,
    setEmployeeStatusFilter,
    setEmployeePositionFilter,
    setEmployeeLeaderFilter,
    toggleEmployeePositionFilter,
    toggleEmployeeLeaderFilter,
    resetEmployeeFilters,
} from '../modules/features/employees/EmployeesList.js';

function reset() {
    state.employeeViewMode = 'employees';
    state.employeeStatusFilter = 'active';
    state.employeeFilters = undefined;
}

testRunner.addSuite("EmployeesList — Handlers de filtro (caracterización)", {

    "changeEmployeeViewMode fija el modo de vista"() {
        reset();
        changeEmployeeViewMode('leaders');
        testRunner.assertEquals(state.employeeViewMode, 'leaders', "employeeViewMode debe quedar en 'leaders'");
    },

    "setEmployeeStatusFilter inicializa employeeFilters y fija el status"() {
        reset();
        setEmployeeStatusFilter('inactive');
        testRunner.assertEquals(state.employeeStatusFilter, 'inactive', "employeeStatusFilter debe ser 'inactive'");
        testRunner.assert(!!state.employeeFilters, "employeeFilters debe quedar inicializado");
        testRunner.assertEquals(state.employeeFilters.status, 'inactive', "employeeFilters.status debe ser 'inactive'");
    },

    "setEmployeePositionFilter fija positionId sin pisar otros campos"() {
        reset();
        setEmployeeStatusFilter('active');           // siembra employeeFilters
        setEmployeePositionFilter('p1');
        testRunner.assertEquals(state.employeeFilters.positionId, 'p1', "positionId debe ser 'p1'");
        testRunner.assertEquals(state.employeeFilters.status, 'active', "status no debe cambiar");
    },

    "setEmployeeLeaderFilter fija leaderId"() {
        reset();
        setEmployeeLeaderFilter('l1');
        testRunner.assert(!!state.employeeFilters, "employeeFilters debe inicializarse si faltaba");
        testRunner.assertEquals(state.employeeFilters.leaderId, 'l1', "leaderId debe ser 'l1'");
    },

    "los filtros multiselección alternan ids sin duplicarlos"() {
        reset();
        toggleEmployeePositionFilter('p1', true);
        toggleEmployeePositionFilter('p2', true);
        toggleEmployeePositionFilter('p1', true);
        toggleEmployeeLeaderFilter('l1', true);
        toggleEmployeeLeaderFilter('l2', true);
        toggleEmployeeLeaderFilter('l1', false);

        testRunner.assertEquals(state.employeeFilters.positionIds.join(','), 'p1,p2', "debe conservar posiciones únicas");
        testRunner.assertEquals(state.employeeFilters.leaderIds.join(','), 'l2', "debe retirar únicamente el líder desmarcado");
    },

    "resetEmployeeFilters restablece filtros y status a default"() {
        reset();
        setEmployeeStatusFilter('inactive');
        setEmployeePositionFilter('p9');
        resetEmployeeFilters();
        testRunner.assertEquals(state.employeeFilters.search, '', "search debe quedar vacío");
        testRunner.assertEquals(state.employeeFilters.positionId, 'all', "positionId debe quedar 'all'");
        testRunner.assertEquals(state.employeeFilters.leaderId, 'all', "leaderId debe quedar 'all'");
        testRunner.assertEquals(state.employeeFilters.positionIds.length, 0, "positionIds debe quedar vacío");
        testRunner.assertEquals(state.employeeFilters.leaderIds.length, 0, "leaderIds debe quedar vacío");
        testRunner.assertEquals(state.employeeFilters.status, 'active', "status del filtro debe quedar 'active'");
        testRunner.assertEquals(state.employeeStatusFilter, 'active', "employeeStatusFilter debe quedar 'active'");
    }
});

console.log('🧪 EmployeesFilterHandlers tests cargados.');
