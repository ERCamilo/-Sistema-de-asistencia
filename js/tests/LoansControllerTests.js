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
    voidPaymentHandler
} from '../modules/features/loans/LoansController.js';
import { LOAN_STATUS, INSTALLMENT_MODE, getBalance } from '../modules/features/loans/LoansService.js';

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
    }
});

console.log('🧪 LoansController tests cargados.');
