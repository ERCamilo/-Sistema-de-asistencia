/**
 * 🧪 LoanDuplicateResolveHandlersTests (Fase 2, U5)
 *
 * Handlers del wizard de resolución de duplicados en LoansController:
 *   - resolveDupKeepBoth(idA, idB): "son distintos" — renumera y guarda,
 *     sin diálogo (no es destructivo).
 *   - resolveDupDeleteLoan(loanId): "eliminar este" — SIEMPRE pide
 *     confirmación (es destructivo: borra un préstamo con tombstone).
 *
 * Behavioral, mismo estilo que LoansControllerTests (state proxy real +
 * window.showConfirm mockeado).
 */

import { state } from '../modules/core/AppState.js';
import {
    selectLoansEmployee,
    resolveDupKeepBoth,
    resolveDupDeleteLoan
} from '../modules/features/loans/LoansController.js';
import { LOAN_STATUS } from '../modules/features/loans/LoansService.js';

function resetState() {
    state.employees = [];
    state.loansLedger = null;
}

function seedDupPair() {
    state.employees.push({
        id: 'emp1', name: 'Ada', number: '001', active: true, updatedAt: 0,
        loans: [
            { id: 'LOAN-a', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: 100, updatedAt: 1, concept: 'A' },
            { id: 'LOAN-b', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: 200, updatedAt: 1, concept: 'B' }
        ]
    });
    selectLoansEmployee('emp1');
}

function liveEmp() { return state.employees.find(e => e.id === 'emp1'); }

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

testRunner.addSuite("LoansController — resolveDupKeepBoth (son distintos)", {

    "renumera el perdedor sin pedir confirmación (no es destructivo)"() {
        resetState();
        seedDupPair();
        silence(() => {
            withConfirmSpy((calls) => {
                resolveDupKeepBoth('LOAN-a', 'LOAN-b');
                testRunner.assertEquals(calls.length, 0, 'no debe pedir confirmación');
                const emp = liveEmp();
                const seqs = emp.loans.map(l => l.seq).sort().join(',');
                testRunner.assertEquals(seqs, '4,5', 'el perdedor debe quedar renumerado');
                testRunner.assertEquals(emp.loans.length, 2, 'los dos préstamos siguen vivos');
            });
        });
    },

    "con ids inválidos avisa con alerta y no rompe"() {
        resetState();
        seedDupPair();
        silence(() => {
            let threw = false;
            try { resolveDupKeepBoth('LOAN-a', 'LOAN-x'); } catch (_) { threw = true; }
            testRunner.assertEquals(threw, false, 'el handler debe capturar el error, no propagarlo a la UI');
            testRunner.assertEquals(liveEmp().loans.length, 2, 'nada debe cambiar');
        });
    }

});

testRunner.addSuite("LoansController — resolveDupDeleteLoan (eliminar este)", {

    "pide confirmación ANTES de borrar (destructivo) y no borra hasta confirmar"() {
        resetState();
        seedDupPair();
        silence(() => {
            withConfirmSpy((calls) => {
                resolveDupDeleteLoan('LOAN-b');
                testRunner.assertEquals(calls.length, 1, 'debe pedir confirmación');
                testRunner.assertEquals(liveEmp().loans.length, 2, 'sin confirmar, no borra');
            });
        });
    },

    "al confirmar, borra con tombstone"() {
        resetState();
        seedDupPair();
        silence(() => {
            withConfirmSpy((calls) => {
                resolveDupDeleteLoan('LOAN-b');
                calls[0].onConfirm();
                const emp = liveEmp();
                testRunner.assertEquals(emp.loans.length, 1);
                testRunner.assertEquals(emp.loans[0].id, 'LOAN-a');
                testRunner.assert(
                    Array.isArray(emp.deletedItemIds?.loans) && emp.deletedItemIds.loans.includes('LOAN-b'),
                    'el borrado debe dejar tombstone para sobrevivir al sync'
                );
            });
        });
    },

    "sin window.showConfirm disponible NO borra (destructivo sin confirmación = no)"() {
        resetState();
        seedDupPair();
        silence(() => {
            const prev = window.showConfirm;
            window.showConfirm = undefined;
            try {
                resolveDupDeleteLoan('LOAN-b');
                testRunner.assertEquals(liveEmp().loans.length, 2,
                    'a diferencia del guard suave de crear, acá el default seguro es NO borrar');
            } finally {
                window.showConfirm = prev;
            }
        });
    },

    "el concept se ESCAPA en el mensaje del diálogo (Modal.confirm lo inyecta por innerHTML)"() {
        resetState();
        state.employees.push({
            id: 'emp1', name: 'Ada', number: '001', active: true, updatedAt: 0,
            loans: [
                { id: 'LOAN-a', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: 100, updatedAt: 1, concept: 'A' },
                { id: 'LOAN-x', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: 200, updatedAt: 1, concept: '<img src=x onerror=alert(1)>' }
            ]
        });
        selectLoansEmployee('emp1');
        silence(() => {
            withConfirmSpy((calls) => {
                resolveDupDeleteLoan('LOAN-x');
                testRunner.assertEquals(calls.length, 1);
                testRunner.assert(
                    !/<img src=x onerror/.test(calls[0].message),
                    'el concept crudo NO debe aparecer sin escapar en el mensaje (XSS vía innerHTML de Modal.confirm)'
                );
                testRunner.assert(
                    /&lt;img/.test(calls[0].message),
                    'el concept debe aparecer escapado'
                );
            });
        });
    }

});

console.log('🧪 LoanDuplicateResolveHandlers tests cargados.');
