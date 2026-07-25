/**
 * 🧪 LoansControllerTests — Side-effectful handlers that the Ledger UI calls.
 *
 * LoansService is tested in isolation already. These tests exercise the
 * controller layer: state-scaffolding, form drafts, navigation, and the
 * "submit" paths that call into LoansService and persist.
 *
 * Side-effect dependencies (render, saveApplicationData, showAlert,
 * showConfirm, showNotification) are stubbed or invoked through the test
 * environment's no-ops set up in jest.setup.js.
 */

import { state } from '../modules/core/AppState.js';
import {
    migrateAllAdvances,
    selectLoansEmployee,
    clearLoansEmployee,
    setLoansSearch,
    toggleAddLoanForm,
    setLoanDraftField,
    submitNewLoan,
    togglePaymentForm,
    setPaymentDraftField,
    submitPayment,
    settleLoanByFullPayment,
    writeOffLoanWithConfirm,
    reopenLoanHandler,
    voidPaymentHandler,
    toggleRefinanceForm,
    setRefinanceDraftField,
    submitRefinance,
    voidRefinanceHandler,
    openLoansEmployeePicker,
    closeLoansEmployeePicker,
    setLoansPickerSearch,
    openProfileForLoan
} from '../modules/features/loans/LoansController.js';
import { LOAN_STATUS, INSTALLMENT_MODE, getBalance, getRefinanceCount } from '../modules/features/loans/LoansService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetState() {
    state.employees = [];
    state.loansLedger = null;
}

/**
 * Push a seed employee into state.employees and return the proxy-wrapped
 * reference. IMPORTANT: the AppState proxy's `toRaw` copies the object on
 * insertion, so the local literal we pass to push() is NOT the same
 * identity as state.employees[i]. Always go through state.* to read back.
 */
function seedEmployee(overrides = {}) {
    const id = overrides.id || 'emp1';
    state.employees.push({
        id,
        name: 'Ada Lovelace',
        number: '001',
        active: true,
        loans: [],
        ...overrides
    });
    return state.employees.find(e => e.id === id);
}

/** Re-fetch the live employee proxy after any operation that may have
 *  mutated it (the local var in tests can be stale). */
function liveEmployee(id = 'emp1') {
    return state.employees.find(e => e.id === id);
}

// Mock the confirm dialog so write-off / void / settle handlers run their
// onConfirm callback synchronously instead of waiting for user input.
function installAutoConfirm() {
    const prev = window.showConfirm;
    window.showConfirm = (opts) => { if (opts && typeof opts.onConfirm === 'function') opts.onConfirm(); };
    return () => { window.showConfirm = prev; };
}

// Suppress notifications/alerts during tests so they do not pollute console
function silenceNotifications() {
    const prevNotify = window.showNotification;
    const prevAlert = window.showAlert;
    window.showNotification = () => {};
    window.showAlert = () => {};
    return () => {
        window.showNotification = prevNotify;
        window.showAlert = prevAlert;
    };
}

// ─── migrateAllAdvances ──────────────────────────────────────────────────────

testRunner.addSuite("LoansController — migrateAllAdvances", {

    "migrates legacy advances across every employee"() {
        resetState();
        state.employees = [
            { id: 'e1', name: 'A', advances: [
                { id: 'OLD-1', amount: 100, interest: 5, date: '2026-04-01', note: 'note A' }
            ], loans: [] },
            { id: 'e2', name: 'B', advances: [
                { id: 'OLD-2', amount: 200, interest: 0, date: '2026-04-15', note: 'note B' }
            ], loans: [] },
            { id: 'e3', name: 'C', advances: [], loans: [] }
        ];
        const total = migrateAllAdvances();
        testRunner.assertEquals(total, 2, "2 advances migrated total");
        testRunner.assertEquals(state.employees[0].loans.length, 1, "e1 has 1 loan");
        testRunner.assertEquals(state.employees[1].loans.length, 1, "e2 has 1 loan");
        testRunner.assertEquals(state.employees[2].loans.length, 0, "e3 still has none");
    },

    "is idempotent across multiple boots"() {
        resetState();
        state.employees = [
            { id: 'e1', advances: [{ id: 'OLD-1', amount: 100, interest: 0, date: '2026-04-01' }], loans: [] }
        ];
        migrateAllAdvances();
        migrateAllAdvances();
        migrateAllAdvances();
        testRunner.assertEquals(state.employees[0].loans.length, 1, "Still 1 loan after 3 boots");
    }
});

// ─── Navigation handlers ─────────────────────────────────────────────────────

testRunner.addSuite("LoansController — navigation", {

    "selectLoansEmployee sets the selected id and initializes ledger state"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        testRunner.assert(state.loansLedger !== null, "Ledger state should be created");
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'emp1', "ID stored");
        testRunner.assertEquals(state.loansLedger.showAddForm, false, "Add form not opened automatically");
    },

    "clearLoansEmployee returns to the overview list"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        clearLoansEmployee();
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, null, "Selection cleared");
    },

    "setLoansSearch records the filter string"() {
        resetState();
        setLoansSearch('  Ada  ');
        testRunner.assertEquals(state.loansLedger.search, '  Ada  ', "Stored verbatim (consumers trim)");
    }
});

// ─── New-loan form ───────────────────────────────────────────────────────────

testRunner.addSuite("LoansController — new loan submission", {

    "submitNewLoan creates a loan and clears the form"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm(); // opens form
        setLoanDraftField('principal', 1000);
        setLoanDraftField('interestRate', 5);
        setLoanDraftField('startDate', '2026-05-20');
        setLoanDraftField('concept', 'Adelanto medico');

        const restore = silenceNotifications();
        try { submitNewLoan(); } finally { restore(); }

        const emp = state.employees.find(e => e.id === 'emp1');
        testRunner.assertEquals(emp.loans.length, 1, "Loan added to emp");
        testRunner.assertEquals(emp.loans[0].principal, 1000, "Principal preserved");
        testRunner.assertEquals(emp.loans[0].concept, 'Adelanto medico', "Concept preserved");
        testRunner.assertEquals(state.loansLedger.showAddForm, false, "Form auto-closed after submit");
    },

    "submitNewLoan with invalid draft does not append anything"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 0); // invalid
        setLoanDraftField('startDate', '2026-05-20');
        const restore = silenceNotifications();
        try { submitNewLoan(); } finally { restore(); }
        const emp = state.employees.find(e => e.id === 'emp1');
        testRunner.assertEquals(emp.loans.length, 0, "No loan created for invalid input");
        testRunner.assertEquals(state.loansLedger.showAddForm, true, "Form stays open on error");
    },

    "submitNewLoan with no employee selected fails gracefully"() {
        resetState();
        seedEmployee();
        // Note: not selecting any employee. ledger state may exist from previous tests.
        if (state.loansLedger) state.loansLedger.selectedEmployeeId = null;
        const restore = silenceNotifications();
        try { submitNewLoan(); } finally { restore(); }
        const emp = state.employees.find(e => e.id === 'emp1');
        testRunner.assertEquals(emp.loans.length, 0, "Nothing created without selection");
    }
});

// ─── Payment submission ──────────────────────────────────────────────────────

testRunner.addSuite("LoansController — payment submission", {

    "pago y refinanciamiento son formularios mutuamente excluyentes"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');

        toggleRefinanceForm('loan-1');
        testRunner.assertEquals(state.loansLedger.showRefinanceFormForLoan, 'loan-1',
            "refinanciamiento abre primero");
        togglePaymentForm('loan-1');
        testRunner.assertEquals(state.loansLedger.showPaymentFormForLoan, 'loan-1',
            "pago queda abierto");
        testRunner.assertEquals(state.loansLedger.showRefinanceFormForLoan, null,
            "abrir pago cierra refinanciamiento");

        toggleRefinanceForm('loan-1');
        testRunner.assertEquals(state.loansLedger.showRefinanceFormForLoan, 'loan-1',
            "refinanciamiento vuelve a abrir");
        testRunner.assertEquals(state.loansLedger.showPaymentFormForLoan, null,
            "abrir refinanciamiento cierra pago");
    },

    "submitPayment reduces balance and closes form"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 500);
        setLoanDraftField('startDate', '2026-05-20');
        const restoreNotif = silenceNotifications();
        try { submitNewLoan(); } finally { restoreNotif(); }
        const loanId = liveEmployee().loans[0].id;

        togglePaymentForm(loanId);
        setPaymentDraftField('amount', 200);
        setPaymentDraftField('date', '2026-05-25');
        const restore2 = silenceNotifications();
        try { submitPayment(loanId); } finally { restore2(); }

        const emp = liveEmployee();
        testRunner.assertEquals(emp.loans[0].payments.length, 1, "Payment recorded");
        testRunner.assertEquals(getBalance(emp.loans[0]), 300, "Balance: 500 - 200 = 300");
        testRunner.assertEquals(state.loansLedger.showPaymentFormForLoan, null, "Form auto-closed");
    },

    "full payment auto-closes the loan as paid"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 100);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        togglePaymentForm(loanId);
        setPaymentDraftField('amount', 100);
        setPaymentDraftField('date', '2026-05-25');
        const restore2 = silenceNotifications();
        try { submitPayment(loanId); } finally { restore2(); }

        testRunner.assertEquals(liveEmployee().loans[0].status, LOAN_STATUS.PAID, "Status auto-flipped to paid");
    }
});

// ─── Settle / write-off / reopen / void ──────────────────────────────────────

testRunner.addSuite("LoansController — loan operations", {

    "settleLoanByFullPayment with auto-confirm closes the loan"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 250);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        const restoreConfirm = installAutoConfirm();
        const restoreNotif = silenceNotifications();
        try { settleLoanByFullPayment(loanId); } finally { restoreNotif(); restoreConfirm(); }
        const emp = liveEmployee();
        testRunner.assertEquals(emp.loans[0].status, LOAN_STATUS.PAID, "Settle flips to paid");
        testRunner.assertEquals(getBalance(emp.loans[0]), 0, "Balance zero after settle");
    },

    "writeOffLoanWithConfirm soft-deletes the loan but keeps data"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 250);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        const restoreConfirm = installAutoConfirm();
        const restoreNotif = silenceNotifications();
        try { writeOffLoanWithConfirm(loanId); } finally { restoreNotif(); restoreConfirm(); }

        const emp = liveEmployee();
        testRunner.assertEquals(emp.loans[0].status, LOAN_STATUS.WRITTEN_OFF, "Status written-off");
        testRunner.assertEquals(emp.loans.length, 1, "Loan still in array (not deleted)");
        testRunner.assert(emp.loans[0].closedAt !== null, "closedAt timestamp set");
    },

    "reopenLoanHandler restores an active loan"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 250);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        const restoreConfirm = installAutoConfirm();
        const restoreNotif = silenceNotifications();
        try {
            writeOffLoanWithConfirm(loanId);
            reopenLoanHandler(loanId);
        } finally { restoreNotif(); restoreConfirm(); }

        testRunner.assertEquals(liveEmployee().loans[0].status, LOAN_STATUS.ACTIVE, "Reactivated to active");
    },

    "voidPaymentHandler voids the payment and restores balance"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 500);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        togglePaymentForm(loanId);
        setPaymentDraftField('amount', 300);
        setPaymentDraftField('date', '2026-05-25');
        const restore2 = silenceNotifications();
        try { submitPayment(loanId); } finally { restore2(); }

        testRunner.assertEquals(getBalance(liveEmployee().loans[0]), 200, "Pre-void: 500 - 300 = 200");
        const paymentId = liveEmployee().loans[0].payments[0].id;

        const restoreConfirm = installAutoConfirm();
        const restoreNotif = silenceNotifications();
        try { voidPaymentHandler(loanId, paymentId); } finally { restoreNotif(); restoreConfirm(); }

        const emp = liveEmployee();
        testRunner.assertEquals(getBalance(emp.loans[0]), 500, "Post-void: balance restored to 500");
        testRunner.assert(emp.loans[0].payments[0].voided, "Payment marked voided");
    },

    "voidRefinanceHandler anula el refinanciamiento y baja el saldo"() {
        resetState();
        seedEmployee();
        selectLoansEmployee('emp1');
        toggleAddLoanForm();
        setLoanDraftField('principal', 1000);
        setLoanDraftField('startDate', '2026-05-20');
        const restore1 = silenceNotifications();
        try { submitNewLoan(); } finally { restore1(); }
        const loanId = liveEmployee().loans[0].id;

        // Refinanciar sobre capital al 10% → +100 de interés
        toggleRefinanceForm(loanId);
        setRefinanceDraftField('basis', 'principal');
        setRefinanceDraftField('interestRate', 10);
        const restore2 = silenceNotifications();
        try { submitRefinance(loanId); } finally { restore2(); }
        testRunner.assertEquals(getBalance(liveEmployee().loans[0]), 1100, "Pre-anular: 1000 + 100 = 1100");
        const refinId = liveEmployee().loans[0].refinancings[0].id;

        const restoreConfirm = installAutoConfirm();
        const restoreNotif = silenceNotifications();
        try { voidRefinanceHandler(loanId, refinId); } finally { restoreNotif(); restoreConfirm(); }

        const emp = liveEmployee();
        testRunner.assertEquals(getBalance(emp.loans[0]), 1000, "Post-anular: saldo vuelve a 1000");
        testRunner.assertEquals(getRefinanceCount(emp.loans[0]), 0, "El refinanciamiento anulado no cuenta");
        testRunner.assert(emp.loans[0].refinancings[0].voided, "Refinanciamiento marcado voided");
    }
});

// ─── Employee picker (Add new → choose employee → open profile) ──────────────

testRunner.addSuite("LoansController — employee picker", {

    "openLoansEmployeePicker turns the picker on and resets its search"() {
        resetState();
        state.loansLedger = {
            selectedEmployeeId: null, search: '', showAddForm: false,
            showEmployeePicker: false, pickerSearch: 'stale',
            newLoanDraft: null, showPaymentFormForLoan: null, paymentDraft: null
        };
        openLoansEmployeePicker();
        testRunner.assertEquals(state.loansLedger.showEmployeePicker, true, "picker is open");
        testRunner.assertEquals(state.loansLedger.pickerSearch, '', "previous search cleared");
    },

    "closeLoansEmployeePicker turns it off"() {
        resetState();
        openLoansEmployeePicker();
        closeLoansEmployeePicker();
        testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "picker closed");
    },

    "setLoansPickerSearch stores the filter string"() {
        resetState();
        openLoansEmployeePicker();
        setLoansPickerSearch('ada');
        testRunner.assertEquals(state.loansLedger.pickerSearch, 'ada', "search recorded");
    },

    // ⚠️ openProfileForLoan ya NO abre el perfil — ahora delega a
    // pickEmployeeForNewLoan (queda como alias hacia atrás).
    // Antes abría el perfil porque ahí estaba el formulario de alta;
    // tras la unificación de préstamos, el perfil es read-only.
    "openProfileForLoan ahora delega a pickEmployeeForNewLoan (no abre perfil)"() {
        resetState();
        seedEmployee({ id: 'emp42', name: 'Grace Hopper' });

        const prevOpen = window.openEmployeeProfile;
        let profileOpened = false;
        window.openEmployeeProfile = () => { profileOpened = true; };
        try {
            openLoansEmployeePicker();
            openProfileForLoan('emp42');

            testRunner.assertEquals(profileOpened, false,
                "Ya NO debe abrir el perfil (el perfil es read-only para préstamos)");
            testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'emp42',
                "Debe seleccionar al empleado en el ledger");
            testRunner.assertEquals(state.loansLedger.showAddForm, true,
                "Debe abrir el form de nuevo préstamo directo");
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, false,
                "picker cerrado");
        } finally {
            window.openEmployeeProfile = prevOpen;
        }
    },

    "openProfileForLoan es seguro aunque openEmployeeProfile no exista"() {
        resetState();
        seedEmployee({ id: 'emp42' });
        const prevOpen = window.openEmployeeProfile;
        window.openEmployeeProfile = undefined;
        try {
            openProfileForLoan('emp42');
            testRunner.assert(true, "did not throw");
        } finally {
            window.openEmployeeProfile = prevOpen;
        }
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: pickEmployeeForNewLoan — picker → directo al form (Unificación)
// ─────────────────────────────────────────────────────────────
//
// Antes (bug que el usuario reportó): "+ Nuevo préstamo" → picker →
// elegir empleado → ABRÍA EL PERFIL (que ahora es read-only) → el
// usuario quedaba varado y tenía que tocar "Gestionar en Cuentas por
// Cobrar" para volver al ledger. Un paso totalmente innecesario.
//
// Después: elegir empleado en el picker → cierra picker → selecciona
// empleado en el ledger → abre el formulario nuevo. UN solo paso, sin
// salir del ledger.

const { pickEmployeeForNewLoan } = require('../modules/features/loans/LoansController.js');

testRunner.addSuite("LoansController — pickEmployeeForNewLoan (fix paso innecesario)", {

    "cierra el picker"() {
        resetState();
        seedEmployee({ id: 'eX1', name: 'Ana' });
        // Simular picker abierto
        state.loansLedger = state.loansLedger || {};
        state.loansLedger.showEmployeePicker = true;

        pickEmployeeForNewLoan('eX1');

        testRunner.assertEquals(state.loansLedger.showEmployeePicker, false,
            'El picker debe cerrarse tras elegir');
    },

    "selecciona el empleado en el ledger"() {
        resetState();
        seedEmployee({ id: 'eX2', name: 'Bob' });
        pickEmployeeForNewLoan('eX2');
        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'eX2',
            'El empleado elegido debe quedar preseleccionado');
    },

    "abre el formulario de nuevo préstamo"() {
        resetState();
        seedEmployee({ id: 'eX3', name: 'Carlos' });
        pickEmployeeForNewLoan('eX3');
        testRunner.assertEquals(state.loansLedger.showAddForm, true,
            'El form de alta debe abrirse directo, sin paso intermedio');
    },

    "NO abre el modal del perfil del empleado"() {
        resetState();
        seedEmployee({ id: 'eX4', name: 'Diana' });
        state.showEmployeeProfile = false;

        const prevOpen = window.openEmployeeProfile;
        let profileOpened = false;
        window.openEmployeeProfile = () => { profileOpened = true; };
        try {
            pickEmployeeForNewLoan('eX4');
            testRunner.assertEquals(profileOpened, false,
                'NO debe abrir el perfil — el usuario quiere registrar, no ver datos');
            testRunner.assertEquals(state.showEmployeeProfile, false,
                'state.showEmployeeProfile debe seguir false');
        } finally {
            window.openEmployeeProfile = prevOpen;
        }
    },

    "sin empleado id es noop seguro"() {
        resetState();
        let threw = false;
        try { pickEmployeeForNewLoan(''); pickEmployeeForNewLoan(null); pickEmployeeForNewLoan(undefined); }
        catch (e) { threw = true; }
        testRunner.assertEquals(threw, false, 'Defensivo ante id vacío');
    },

    "funciona para empleado SIN préstamos previos (cumple requisito explícito)"() {
        resetState();
        // Empleado sin la propiedad loans
        seedEmployee({ id: 'eFresh', name: 'Recién contratado' });
        const emp = state.employees.find(e => e.id === 'eFresh');
        testRunner.assert(emp.loans === undefined || emp.loans.length === 0,
            'Pre-condición: empleado sin préstamos');

        pickEmployeeForNewLoan('eFresh');

        testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'eFresh');
        testRunner.assertEquals(state.loansLedger.showAddForm, true,
            'El form debe abrirse aunque el empleado no tenga préstamos previos');
    }

});

// ─────────────────────────────────────────────────────────────
// Suite: openLoansLedgerFor — Perfil → Cuentas por Cobrar (Unificación)
// ─────────────────────────────────────────────────────────────
//
// Sustituye el flujo dual de registro de préstamos. Antes: el perfil
// tenía su propio formulario `addAdvance` que escribía a emp.advances[].
// Ahora: el perfil es read-only para préstamos y ofrece este handler
// para llevar al usuario al lugar canónico (Cuentas por Cobrar).
//
// El handler debe:
//   1. Cerrar el modal del perfil.
//   2. Seleccionar al empleado en el state del ledger.
//   3. Navegar a la vista de Cuentas por Cobrar.
//   4. Abrir el formulario de nuevo préstamo (el usuario vino a registrar).
//   5. Funcionar tanto si el empleado tiene préstamos previos como si no.

const { openLoansLedgerFor } = require('../modules/features/loans/LoansController.js');

testRunner.addSuite("LoansController — openLoansLedgerFor (Unificación profile→ledger)", {

    "cierra el modal del perfil"() {
        resetState();
        seedEmployee({ id: 'e1', name: 'Ana' });
        state.showEmployeeProfile = true;
        state.employeeProfile = { employeeId: 'e1', activeTab: 'nomina' };

        const prevOpenCxC = window.openCuentasPorCobrar;
        window.openCuentasPorCobrar = () => {};
        try {
            openLoansLedgerFor('e1');
            testRunner.assertEquals(state.showEmployeeProfile, false,
                "El perfil debe cerrarse al saltar al ledger");
        } finally {
            window.openCuentasPorCobrar = prevOpenCxC;
        }
    },

    "selecciona el empleado en el ledger"() {
        resetState();
        seedEmployee({ id: 'e1', name: 'Ana' });
        const prevOpenCxC = window.openCuentasPorCobrar;
        window.openCuentasPorCobrar = () => {};
        try {
            openLoansLedgerFor('e1');
            testRunner.assertEquals(state.loansLedger?.selectedEmployeeId, 'e1',
                "El ledger debe quedar con el empleado preseleccionado");
        } finally {
            window.openCuentasPorCobrar = prevOpenCxC;
        }
    },

    "navega a Cuentas por Cobrar"() {
        resetState();
        seedEmployee({ id: 'e1', name: 'Ana' });
        let called = false;
        const prevOpenCxC = window.openCuentasPorCobrar;
        window.openCuentasPorCobrar = () => { called = true; };
        try {
            openLoansLedgerFor('e1');
            testRunner.assertEquals(called, true,
                "Debe invocar openCuentasPorCobrar para navegar");
        } finally {
            window.openCuentasPorCobrar = prevOpenCxC;
        }
    },

    "abre el formulario de nuevo préstamo (el usuario vino a registrar)"() {
        resetState();
        seedEmployee({ id: 'e1', name: 'Ana' });
        const prevOpenCxC = window.openCuentasPorCobrar;
        window.openCuentasPorCobrar = () => {};
        try {
            openLoansLedgerFor('e1');
            testRunner.assertEquals(state.loansLedger?.showAddForm, true,
                "El form de alta debe abrirse para evitar 1 clic extra");
        } finally {
            window.openCuentasPorCobrar = prevOpenCxC;
        }
    },

    "funciona si openCuentasPorCobrar no está definido (no rompe)"() {
        resetState();
        seedEmployee({ id: 'e1', name: 'Ana' });
        const prevOpenCxC = window.openCuentasPorCobrar;
        window.openCuentasPorCobrar = undefined;
        try {
            let threw = false;
            try { openLoansLedgerFor('e1'); } catch (e) { threw = true; }
            testRunner.assertEquals(threw, false,
                "Debe ser defensivo si la función de navegación no existe");
            // El estado del ledger igual debe haberse preparado.
            testRunner.assertEquals(state.loansLedger?.selectedEmployeeId, 'e1');
        } finally {
            window.openCuentasPorCobrar = prevOpenCxC;
        }
    }

});

// ─────────────────────────────────────────────────────────────
// Suite: createLoan funciona para empleados nuevos Y existentes
// ─────────────────────────────────────────────────────────────

const { createLoan } = require('../modules/features/loans/LoansService.js');

testRunner.addSuite("LoansController — Alta funciona para empleado sin préstamos previos", {

    "createLoan inicializa emp.loans si no existe (empleado completamente nuevo)"() {
        // Empleado sin la propiedad loans (típico de empleado recién creado o
        // venido de datos legacy donde la propiedad nunca se inicializó).
        const emp = { id: 'eNew', name: 'Nuevo Empleado' };
        testRunner.assertEquals(emp.loans, undefined, "Pre-condición: sin propiedad loans");

        const loan = createLoan(emp, {
            principal: 1000,
            startDate: '2026-05-26',
            concept: 'Primer préstamo'
        });

        testRunner.assert(Array.isArray(emp.loans),
            "createLoan debe inicializar emp.loans como array");
        testRunner.assertEquals(emp.loans.length, 1, "Debe haber 1 préstamo");
        testRunner.assertEquals(emp.loans[0].id, loan.id, "El loan retornado coincide");
    },

    "createLoan trabaja correctamente con empleado que ya tiene préstamos"() {
        const emp = {
            id: 'eExisting',
            name: 'Con Historial',
            loans: [{ id: 'LOAN_OLD', principal: 500, status: 'active' }]
        };
        const loan = createLoan(emp, {
            principal: 2000,
            startDate: '2026-05-26',
            concept: 'Segundo préstamo'
        });
        testRunner.assertEquals(emp.loans.length, 2, "Debe haber 2 préstamos (viejo + nuevo)");
        testRunner.assertEquals(emp.loans[1].id, loan.id, "El nuevo se agrega al final");
        testRunner.assertEquals(emp.loans[0].id, 'LOAN_OLD', "El viejo no se borra");
    },

    "createLoan con emp.loans=null lo trata como ausente"() {
        const emp = { id: 'eNull', name: 'Con null', loans: null };
        createLoan(emp, { principal: 100, startDate: '2026-05-26' });
        testRunner.assert(Array.isArray(emp.loans), "Debe convertir null → array");
        testRunner.assertEquals(emp.loans.length, 1);
    }

});

console.log('🧪 LoansController tests cargados.');
