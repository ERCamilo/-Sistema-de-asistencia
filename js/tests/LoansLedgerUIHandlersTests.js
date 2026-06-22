/**
 * 🧪 LoansLedgerUIHandlersTests — Caracterización de los handlers de UI PURA del
 * ledger de préstamos (navegación / pickers / toggle de formulario), como red para
 * migrarlos a batchSetState (Fase 3).
 *
 * EXCLUYE deliberadamente toda la lógica financiera: createLoan, recordPayment,
 * refinance, write-off, submit*, settle*, los draft de monto y los handlers de
 * búsqueda. Acá solo se fija el estado de UI (qué form/picker está abierto, a quién
 * se seleccionó). Ningún monto, pago, saldo ni guardado se toca.
 */

import { state } from '../modules/core/AppState.js';
import {
    selectLoansEmployee,
    clearLoansEmployee,
    openLoansEmployeePicker,
    closeLoansEmployeePicker,
    pickEmployeeForNewLoan,
    toggleAddLoanForm,
} from '../modules/features/loans/LoansController.js';

function reset() {
    // Forzar a ensureLedgerState() a reconstruir el ledger con sus defaults.
    state.loansLedger = undefined;
}

testRunner.addSuite("LoansController — Handlers de UI del ledger (caracterización)", {

    "selectLoansEmployee fija el empleado y cierra formularios"() {
        reset();
        selectLoansEmployee('e1');
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'e1', "selectedEmployeeId debe ser e1");
        testRunner.assertEquals(state.loansLedger.showAddForm, false, "showAddForm debe quedar false");
        testRunner.assertEquals(state.loansLedger.showPaymentFormForLoan, null, "showPaymentFormForLoan debe quedar null");
    },

    "clearLoansEmployee limpia la selección"() {
        reset();
        selectLoansEmployee('e1');
        clearLoansEmployee();
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, null, "selectedEmployeeId debe quedar null");
        testRunner.assertEquals(state.loansLedger.showAddForm, false, "showAddForm debe quedar false");
    },

    "openLoansEmployeePicker abre el picker y limpia su búsqueda"() {
        reset();
        openLoansEmployeePicker();
        testRunner.assertEquals(state.loansLedger.showEmployeePicker, true, "showEmployeePicker debe ser true");
        testRunner.assertEquals(state.loansLedger.pickerSearch, '', "pickerSearch debe quedar vacío");
    },

    "closeLoansEmployeePicker cierra el picker"() {
        reset();
        openLoansEmployeePicker();
        closeLoansEmployeePicker();
        testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "showEmployeePicker debe ser false");
    },

    "pickEmployeeForNewLoan abre el formulario para el empleado elegido"() {
        reset();
        pickEmployeeForNewLoan('e2');
        testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "el picker debe cerrarse");
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'e2', "selectedEmployeeId debe ser e2");
        testRunner.assertEquals(state.loansLedger.showAddForm, true, "showAddForm debe abrir");
        testRunner.assert(!!state.loansLedger.newLoanDraft, "debe haber un draft vacío de préstamo");
    },

    "toggleAddLoanForm alterna el formulario de alta"() {
        reset();
        toggleAddLoanForm();                       // inicializa el ledger + primer toggle
        const after1 = state.loansLedger.showAddForm;
        toggleAddLoanForm();                        // segundo toggle
        const after2 = state.loansLedger.showAddForm;
        testRunner.assert(after1 !== after2, "showAddForm debe alternar entre llamadas consecutivas");
    }
});

console.log('🧪 LoansLedgerUIHandlers tests cargados.');
