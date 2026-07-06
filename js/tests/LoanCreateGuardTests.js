/**
 * 🧪 LoanCreateGuardTests (Fase 2, U4)
 *
 * Guard SUAVE al crear un préstamo: si el empleado ya tiene un préstamo muy
 * parecido (mismo monto + fecha de inicio cercana, no anulado), submitNewLoan
 * pregunta antes de crear — no bloquea. Cubre el doble-registro accidental en
 * UN dispositivo (doble click / dos administradores) Y el caso cross-device
 * (el préstamo del otro dispositivo ya llegó por el LiveSync y el usuario
 * está por anotarlo de nuevo sin darse cuenta).
 *
 * Behavioral: usa el state proxy real y mockea window.showConfirm, igual que
 * LoansControllerTests.
 */

import { state } from '../modules/core/AppState.js';
import {
    selectLoansEmployee,
    toggleAddLoanForm,
    setLoanDraftField,
    submitNewLoan
} from '../modules/features/loans/LoansController.js';
import { findSimilarExistingLoan } from '../modules/features/loans/LoanDuplicateDetector.js';
import { LOAN_STATUS } from '../modules/features/loans/LoansService.js';

function resetState() {
    state.employees = [];
    state.loansLedger = null;
}

function seedEmployeeWithLoan(loanOverrides = {}) {
    state.employees.push({
        id: 'emp1', name: 'Ada', number: '001', active: true,
        loans: [{
            id: 'L-existente', seq: 1, principal: 500, startDate: '2026-07-01',
            status: LOAN_STATUS.ACTIVE, payments: [], installments: [],
            concept: 'Préstamo previo', interestRate: 0, updatedAt: 1,
            ...loanOverrides
        }]
    });
    return state.employees.find(e => e.id === 'emp1');
}

function fillDraft({ principal = 500, startDate = '2026-07-01' } = {}) {
    selectLoansEmployee('emp1');
    toggleAddLoanForm();
    setLoanDraftField('principal', principal);
    setLoanDraftField('startDate', startDate);
    setLoanDraftField('concept', 'Nuevo préstamo');
}

function withConfirmSpy(fn) {
    const prev = window.showConfirm;
    const calls = [];
    window.showConfirm = (opts) => { calls.push(opts); };
    try { fn(calls); } finally { window.showConfirm = prev; }
}

function silence(fn) {
    const prevNotify = window.showNotification;
    const prevAlert = window.showAlert;
    window.showNotification = () => {};
    window.showAlert = () => {};
    try { fn(); } finally {
        window.showNotification = prevNotify;
        window.showAlert = prevAlert;
    }
}

testRunner.addSuite("LoanCreateGuard — findSimilarExistingLoan (regla pura)", {

    "encuentra un préstamo activo con mismo monto y fecha cercana"() {
        const emp = { loans: [{ id: 'L1', principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE }] };
        const found = findSimilarExistingLoan(emp, { principal: 500, startDate: '2026-07-03' });
        testRunner.assertEquals(found?.id, 'L1');
    },

    "monto distinto → null"() {
        const emp = { loans: [{ id: 'L1', principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE }] };
        testRunner.assertEquals(findSimilarExistingLoan(emp, { principal: 900, startDate: '2026-07-01' }), null);
    },

    "fecha lejana (10 días) → null"() {
        const emp = { loans: [{ id: 'L1', principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE }] };
        testRunner.assertEquals(findSimilarExistingLoan(emp, { principal: 500, startDate: '2026-07-11' }), null);
    },

    "un préstamo anulado no cuenta como parecido"() {
        const emp = { loans: [{ id: 'L1', principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.WRITTEN_OFF }] };
        testRunner.assertEquals(findSimilarExistingLoan(emp, { principal: 500, startDate: '2026-07-01' }), null);
    },

    "defensivo: emp/draft null no rompe"() {
        testRunner.assertEquals(findSimilarExistingLoan(null, null), null);
        testRunner.assertEquals(findSimilarExistingLoan({}, { principal: 1 }), null);
    }

});

testRunner.addSuite("LoanCreateGuard — submitNewLoan pregunta ante un préstamo parecido", {

    "con un préstamo parecido existente, muestra showConfirm y NO crea todavía"() {
        resetState();
        seedEmployeeWithLoan();
        silence(() => {
            fillDraft({ principal: 500, startDate: '2026-07-02' });
            withConfirmSpy((calls) => {
                submitNewLoan();
                testRunner.assertEquals(calls.length, 1, 'debe preguntar antes de crear');
                const emp = state.employees.find(e => e.id === 'emp1');
                testRunner.assertEquals(emp.loans.length, 1, 'el préstamo nuevo NO debe crearse hasta confirmar');
            });
        });
    },

    "al confirmar en el diálogo, el préstamo SÍ se crea"() {
        resetState();
        seedEmployeeWithLoan();
        silence(() => {
            fillDraft({ principal: 500, startDate: '2026-07-02' });
            withConfirmSpy((calls) => {
                submitNewLoan();
                testRunner.assertEquals(calls.length, 1);
                calls[0].onConfirm();
                const emp = state.employees.find(e => e.id === 'emp1');
                testRunner.assertEquals(emp.loans.length, 2, 'tras confirmar, el préstamo debe crearse');
            });
        });
    },

    "sin préstamo parecido, crea directo sin preguntar"() {
        resetState();
        seedEmployeeWithLoan();
        silence(() => {
            fillDraft({ principal: 9999, startDate: '2026-07-02' });
            withConfirmSpy((calls) => {
                submitNewLoan();
                testRunner.assertEquals(calls.length, 0, 'sin parecido no debe molestar con un diálogo');
                const emp = state.employees.find(e => e.id === 'emp1');
                testRunner.assertEquals(emp.loans.length, 2, 'debe crear directo');
            });
        });
    },

    "si window.showConfirm no existe, crea directo (el guard es suave, nunca bloquea)"() {
        resetState();
        seedEmployeeWithLoan();
        silence(() => {
            fillDraft({ principal: 500, startDate: '2026-07-01' });
            const prev = window.showConfirm;
            window.showConfirm = undefined;
            try {
                submitNewLoan();
                const emp = state.employees.find(e => e.id === 'emp1');
                testRunner.assertEquals(emp.loans.length, 2,
                    'sin mecanismo de confirmación disponible, el guard no debe impedir el trabajo');
            } finally {
                window.showConfirm = prev;
            }
        });
    }

});

console.log('🧪 LoanCreateGuard tests cargados.');
