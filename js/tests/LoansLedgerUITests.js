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

    "each row binds to openProfileForLoan with the employee id"() {
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('data-app-fn="openProfileForLoan" data-arg="e1"'), "Row for e1 is wired");
        testRunner.assert(html.includes('data-app-fn="openProfileForLoan" data-arg="e2"'), "Row for e2 is wired");
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

    "click 'Agregar nuevo' → pick employee → profile opens on Nómina tab"() {
        resetState();
        const restoreSilence = silenceWindow();
        const prevOpen = window.openEmployeeProfile;
        window.openEmployeeProfile = (id) => {
            const emp = state.employees.find(e => e.id === id);
            state.selectedEmployee = emp;
            state.employeeProfile = { employeeId: id, activeTab: 'resumen' };
            state.showEmployeeProfile = true;
        };

        try {
            // Step 1: user clicks "Agregar nuevo"
            openLoansEmployeePicker();
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, true, "Picker opened");

            // Step 2: picker renders with employees
            let html = LoansLedger();
            testRunner.assert(html.includes('Ada Lovelace'), "Picker shows Ada");

            // Step 3: user clicks Ada's row → openProfileForLoan('e1')
            openProfileForLoan('e1');

            // Step 4: profile modal is open on Nómina tab, picker is closed
            testRunner.assertEquals(state.showEmployeeProfile, true, "Profile modal is open");
            testRunner.assertEquals(state.employeeProfile.employeeId, 'e1', "Profile is for Ada");
            testRunner.assertEquals(state.employeeProfile.activeTab, 'nomina', "Landed on Nómina tab");
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "Picker closed");

            // And the picker is gone from the next render
            html = LoansLedger();
            testRunner.assert(!html.includes('Selecciona un empleado'), "Picker no longer rendered");
        } finally {
            window.openEmployeeProfile = prevOpen;
            restoreSilence();
        }
    }
});

console.log('🧪 LoansLedger UI tests cargados.');
