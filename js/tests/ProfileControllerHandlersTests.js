/**
 * 🧪 ProfileControllerHandlersTests — Caracterización de los handlers de UI de
 * ProfileController que aún no estaban migrados, como red para pasarlos a
 * batchSetState (Fase 3). Fija el estado resultante; el refactor debe preservarlo.
 */

import { state } from '../modules/core/AppState.js';
import {
    changeProfileTab,
    changeProfileHireDateMonth,
    changeProfileStartMonth,
    changeProfileEndMonth,
    changeProfileAsistenciaMonth,
} from '../modules/features/profile/ProfileController.js';

function reset() {
    state.profileHireDatePickerMonth = new Date(2026, 5, 15);   // junio (index 5)
    state.employeeProfile = {
        activeTab: 'resumen',
        startPickerMonth: new Date(2026, 5, 15),
        endPickerMonth: new Date(2026, 5, 15),
        assistanceMonth: new Date(2026, 5, 15),
    };
}

testRunner.addSuite("ProfileController — Handlers de UI (caracterización)", {

    "changeProfileTab fija la pestaña activa"() {
        reset();
        changeProfileTab('nomina');
        testRunner.assertEquals(state.employeeProfile.activeTab, 'nomina', "activeTab debe ser 'nomina'");
    },

    "changeProfileHireDateMonth avanza el mes del picker de contratación"() {
        reset();
        changeProfileHireDateMonth(1);
        testRunner.assert(state.profileHireDatePickerMonth instanceof Date, "debe seguir siendo Date");
        testRunner.assertEquals(state.profileHireDatePickerMonth.getMonth(), 6, "debe avanzar a julio (index 6)");
    },

    "changeProfileStartMonth retrocede el mes del picker de inicio"() {
        reset();
        changeProfileStartMonth(-1);
        testRunner.assertEquals(state.employeeProfile.startPickerMonth.getMonth(), 4, "debe retroceder a mayo (index 4)");
    },

    "changeProfileEndMonth avanza el mes del picker de fin"() {
        reset();
        changeProfileEndMonth(1);
        testRunner.assertEquals(state.employeeProfile.endPickerMonth.getMonth(), 6, "debe avanzar a julio (index 6)");
    },

    "changeProfileAsistenciaMonth avanza el mes de asistencia"() {
        reset();
        changeProfileAsistenciaMonth(2);
        testRunner.assertEquals(state.employeeProfile.assistanceMonth.getMonth(), 7, "debe avanzar a agosto (index 7)");
    }
});

console.log('🧪 ProfileControllerHandlers tests cargados.');
