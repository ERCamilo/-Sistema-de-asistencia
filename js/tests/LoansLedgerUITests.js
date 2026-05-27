/**
 * 🧪 LoansLedgerUITests — End-to-end smoke for the Cuentas-por-Cobrar UI.
 *
 * These tests render the LoansLedger() template directly and assert that
 * the new "Agregar nuevo" flow is wired correctly:
 *   1. Button appears on the overview
 *   2. Clicking the handler opens the picker overlay
 *   3. The overlay lists active employees and filters by search
 *   4. Selecting an employee opens the profile on the Nómina tab
 *
 * No real DOM dispatch — we call the controller handlers directly to
 * simulate the data-app-fn click pipeline (which we already know works
 * from app.js's existing tests).
 */

import { state } from '../modules/core/AppState.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import {
    openLoansEmployeePicker,
    closeLoansEmployeePicker,
    setLoansPickerSearch,
    openProfileForLoan
} from '../modules/features/loans/LoansController.js';

function resetState() {
    state.employees = [
        { id: 'e1', name: 'Ada Lovelace',  number: '001', active: true,  loans: [] },
        { id: 'e2', name: 'Grace Hopper',  number: '002', active: true,  loans: [] },
        { id: 'e3', name: 'Margaret Hamilton', number: '003', active: false, loans: [] }
    ];
    state.loansLedger = null;
    state.employeeProfile = null;
    state.showEmployeeProfile = false;
}

function silenceWindow() {
    const prev = { notify: window.showNotification, alert: window.showAlert };
    window.showNotification = () => {};
    window.showAlert = () => {};
    return () => { window.showNotification = prev.notify; window.showAlert = prev.alert; };
}

testRunner.addSuite("LoansLedger UI — overview button", {

    "renders the 'Agregar nuevo' button on the overview"() {
        resetState();
        const html = LoansLedger();
        testRunner.assert(html.includes('data-app-fn="openLoansEmployeePicker"'), "Button is wired to openLoansEmployeePicker");
        testRunner.assert(html.includes('Agregar nuevo'), "Button label is shown");
    },

    "overview does NOT render the picker overlay by default"() {
        resetState();
        const html = LoansLedger();
        testRunner.assert(!html.includes('role="dialog"'), "No dialog rendered when picker is closed");
    }
});

testRunner.addSuite("LoansLedger UI — picker overlay", {

    "opens after openLoansEmployeePicker() is called"() {
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('role="dialog"'), "Dialog is rendered");
        testRunner.assert(html.includes('Selecciona un empleado'), "Dialog header is shown");
    },

    "lists only active employees"() {
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('Ada Lovelace'), "Active employee e1 listed");
        testRunner.assert(html.includes('Grace Hopper'), "Active employee e2 listed");
        testRunner.assert(!html.includes('Margaret Hamilton'), "Inactive employee e3 NOT listed");
    },

    "each row binds to pickEmployeeForNewLoan with the employee id"() {
        // Tras la unificación: las filas del picker llevan al usuario DIRECTO
        // al formulario del ledger, sin pasar por el perfil.
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('data-app-fn="pickEmployeeForNewLoan" data-arg="e1"'),
            "Row for e1 must call pickEmployeeForNewLoan (no longer routes via profile)");
        testRunner.assert(html.includes('data-app-fn="pickEmployeeForNewLoan" data-arg="e2"'),
            "Row for e2 must call pickEmployeeForNewLoan");
        // Y NO el handler viejo
        testRunner.assert(!html.includes('data-app-fn="openProfileForLoan"'),
            "openProfileForLoan no debe seguir wired en el HTML del picker");
    },

    "search input filters the list down"() {
        resetState();
        openLoansEmployeePicker();
        setLoansPickerSearch('grace');
        const html = LoansLedger();
        testRunner.assert(html.includes('Grace Hopper'), "Match is kept");
        testRunner.assert(!html.includes('Ada Lovelace'), "Non-match is filtered out");
    },

    "shows 'no results' when search has no matches"() {
        resetState();
        openLoansEmployeePicker();
        setLoansPickerSearch('zzzznotreal');
        const html = LoansLedger();
        testRunner.assert(html.includes('No se encontraron empleados'), "Empty-state message shown");
    },

    "closeLoansEmployeePicker hides the overlay"() {
        resetState();
        openLoansEmployeePicker();
        closeLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(!html.includes('role="dialog"'), "Overlay gone after close");
    }
});

testRunner.addSuite("LoansLedger UI — full flow", {

    "click 'Agregar nuevo' → pick employee → form de nuevo préstamo se abre EN el ledger (sin perfil)"() {
        // Antes esto abría el perfil del empleado en pestaña Nómina porque ahí
        // estaba el form de alta. Tras unificación: el form de alta es del
        // ledger, y el picker debe llevar directo a él. UN solo paso.
        resetState();
        const restoreSilence = silenceWindow();
        const prevOpen = window.openEmployeeProfile;
        let profileOpened = false;
        window.openEmployeeProfile = () => { profileOpened = true; };

        try {
            // Step 1: user clicks "Agregar nuevo"
            openLoansEmployeePicker();
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, true, "Picker opened");

            // Step 2: picker renders with employees
            let html = LoansLedger();
            testRunner.assert(html.includes('Ada Lovelace'), "Picker shows Ada");

            // Step 3: user clicks Ada's row → pickEmployeeForNewLoan('e1')
            // (note: openProfileForLoan kept as deprecated alias = same effect)
            openProfileForLoan('e1');

            // Step 4: profile NOT opened; picker closed; form open in ledger
            testRunner.assertEquals(profileOpened, false,
                "Profile must NOT open (read-only for loans now)");
            testRunner.assert(!state.showEmployeeProfile, "showEmployeeProfile stays falsy");
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "Picker closed");
            testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'e1', "Ada is selected in the ledger");
            testRunner.assertEquals(state.loansLedger.showAddForm, true, "New-loan form is open");
        } finally {
            window.openEmployeeProfile = prevOpen;
            restoreSilence();
        }
    }
});

console.log('🧪 LoansLedger UI tests cargados.');
