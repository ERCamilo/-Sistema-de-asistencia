/**
 * 🧪 PositionsFilterHandlersTests — Caracterización de los handlers de filtro
 * de PositionsList, como red de seguridad para migrarlos a batchSetState (Fase 3).
 *
 * Fija el ESTADO resultante. El refactor a batchSetState debe preservarlo exactamente.
 * Excluye setPositionSearchFilter (search-as-you-type, sensible al foco) a propósito.
 */

import { state } from '../modules/core/AppState.js';
import {
    setPositionStatusFilter,
    setPositionLeaderFilter,
    setPositionSortBy,
} from '../modules/features/employees/PositionsList.js';

function reset() {
    state.positionStatusFilter = 'active';
    state.positionFilters = undefined;
    state.positionSortBy = undefined;
}

testRunner.addSuite("PositionsList — Handlers de filtro (caracterización)", {

    "setPositionStatusFilter inicializa positionFilters y fija el status"() {
        reset();
        setPositionStatusFilter('inactive');
        testRunner.assertEquals(state.positionStatusFilter, 'inactive', "positionStatusFilter debe ser 'inactive'");
        testRunner.assert(!!state.positionFilters, "positionFilters debe quedar inicializado");
        testRunner.assertEquals(state.positionFilters.status, 'inactive', "positionFilters.status debe ser 'inactive'");
    },

    "setPositionLeaderFilter inicializa si falta y fija leaderId"() {
        reset();
        setPositionLeaderFilter('l1');
        testRunner.assert(!!state.positionFilters, "positionFilters debe inicializarse si faltaba");
        testRunner.assertEquals(state.positionFilters.leaderId, 'l1', "leaderId debe ser 'l1'");
    },

    "setPositionLeaderFilter no pisa un status ya seteado"() {
        reset();
        setPositionStatusFilter('inactive');
        setPositionLeaderFilter('l2');
        testRunner.assertEquals(state.positionFilters.leaderId, 'l2', "leaderId debe ser 'l2'");
        testRunner.assertEquals(state.positionFilters.status, 'inactive', "status no debe cambiar");
    },

    "setPositionSortBy fija el criterio de orden"() {
        reset();
        setPositionSortBy('name');
        testRunner.assertEquals(state.positionSortBy, 'name', "positionSortBy debe ser 'name'");
    }
});

console.log('🧪 PositionsFilterHandlers tests cargados.');
