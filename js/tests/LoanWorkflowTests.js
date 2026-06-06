/**
 * 🧪 LoanWorkflowTests — Ciclos de vida completos de préstamos.
 *
 * Verifica los flujos que el usuario realiza con préstamos:
 *   1. Crear → pagar en cuotas → saldo llega a cero → estado PAID
 *   2. Crear → pagos parciales → cancelar (write-off)
 *   3. Crear → pago atrasado → refinanciar → saldar
 *   4. Reabrir un préstamo cerrado
 *   5. Persistencia: saveApplicationData invocado tras cada operación
 *
 * Estos tests complementan LoansServiceTests.js (capa de datos pura) y
 * LoansControllerTests.js (capa de controlador con estado global).
 */

import { state } from '../modules/core/AppState.js';
import {
    createLoan,
    recordPayment,
    writeOffLoan,
    reopenLoan,
    refinanceLoan,
    getBalance,
    getTotalDue,
    LOAN_STATUS,
} from '../modules/features/loans/LoansService.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmp(overrides = {}) {
    return { id: 'emp-loan-1', name: 'Luis Pérez', loans: [], ...overrides };
}

function clearMocks() {
    indexedDBService.saveState.mockClear();
}

function snapshotGlobal() {
    return {
        employees:    [...state.employees],
        isDataLoaded: state.isDataLoaded,
        useIndexedDB: state.useIndexedDB,
    };
}

function restoreGlobal(snap) {
    state.employees    = snap.employees;
    state.isDataLoaded = snap.isDataLoaded;
    state.useIndexedDB = snap.useIndexedDB;
}

async function waitForSave() {
    return new Promise(r => setTimeout(r, 400));
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: Ciclo completo — crear → pagar → saldar
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('LoanWorkflow — ciclo completo: crear y saldar', {

    'crear préstamo + 3 pagos parciales + pago final → estado PAID'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 3000, interestRate: 0, startDate: '2026-01-01' });

        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'préstamo activo al crear');
        testRunner.assertEquals(getBalance(loan), 3000, 'saldo inicial = principal');

        recordPayment(emp, loan.id, { amount: 1000, date: '2026-02-01' });
        testRunner.assertEquals(getBalance(loan), 2000, 'saldo tras 1er pago');
        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'sigue activo');

        recordPayment(emp, loan.id, { amount: 1000, date: '2026-03-01' });
        testRunner.assertEquals(getBalance(loan), 1000, 'saldo tras 2do pago');

        recordPayment(emp, loan.id, { amount: 1000, date: '2026-04-01' });
        testRunner.assertEquals(getBalance(loan), 0, 'saldo = 0 tras pago final');
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'estado PAID al saldar');
    },

    'pago que excede el saldo lanza excepción de validación'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });

        let threw = false;
        try {
            recordPayment(emp, loan.id, { amount: 600, date: '2026-02-01' }); // excede saldo
        } catch (e) { threw = true; }

        testRunner.assert(threw, 'debe lanzar excepción si el pago supera el saldo');
        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'préstamo sigue ACTIVE tras pago inválido');
    },

    'préstamo con interés: saldo total = principal + interés'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 10, startDate: '2026-01-01' });

        testRunner.assertEquals(getTotalDue(loan), 1100, 'total a pagar = 1000 + 10%');
        testRunner.assertEquals(getBalance(loan), 1100, 'saldo inicial = total a pagar');

        recordPayment(emp, loan.id, { amount: 1100, date: '2026-02-01' });
        testRunner.assertEquals(getBalance(loan), 0, 'saldo 0 al pagar total con interés');
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'PAID');
    },

    'múltiples empleados con préstamos son independientes'() {
        const emp1 = makeEmp({ id: 'e-1', name: 'Ana' });
        const emp2 = makeEmp({ id: 'e-2', name: 'Pedro' });

        const loan1 = createLoan(emp1, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        const loan2 = createLoan(emp2, { principal: 800, interestRate: 0, startDate: '2026-01-01' });

        recordPayment(emp1, loan1.id, { amount: 500, date: '2026-02-01' });

        testRunner.assertEquals(loan1.status, LOAN_STATUS.PAID, 'emp1 saldado');
        testRunner.assertEquals(loan2.status, LOAN_STATUS.ACTIVE, 'emp2 sigue activo');
        testRunner.assertEquals(getBalance(loan2), 800, 'saldo de emp2 intacto');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: Ciclo con cancelación (write-off)
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('LoanWorkflow — ciclo con cancelación', {

    'crear → pagos parciales → write-off → estado WRITTEN_OFF'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 2000, interestRate: 0, startDate: '2026-01-01' });

        recordPayment(emp, loan.id, { amount: 500, date: '2026-02-01' });
        recordPayment(emp, loan.id, { amount: 500, date: '2026-03-01' });

        testRunner.assertEquals(getBalance(loan), 1000, 'saldo antes de cancelar');

        writeOffLoan(emp, loan.id);

        testRunner.assertEquals(loan.status, LOAN_STATUS.WRITTEN_OFF, 'estado WRITTEN_OFF');
        // write-off solo cambia status; el saldo (1000) permanece en los cálculos históricos
        testRunner.assertEquals(getBalance(loan), 1000, 'saldo histórico intacto tras write-off');
    },

    'write-off en préstamo no existente lanza excepción'() {
        const emp = makeEmp();

        let threw = false;
        try {
            writeOffLoan(emp, 'LOAN-FANTASMA');
        } catch (e) { threw = true; }

        testRunner.assert(threw, 'debe lanzar excepción con id inválido');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: Ciclo con refinanciamiento
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('LoanWorkflow — ciclo con refinanciamiento', {

    'refinanciar sobre saldo → saldo crece con interés adicional'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 2000, interestRate: 0, startDate: '2026-01-01' });

        recordPayment(emp, loan.id, { amount: 500, date: '2026-02-01' }); // saldo = 1500

        refinanceLoan(emp, loan.id, { basis: 'balance', interestRate: 10, date: '2026-03-01' });
        // interés sobre saldo: 1500 * 10% = 150

        testRunner.assertEquals(getBalance(loan), 1500 + 150, 'saldo = 1650 tras refinanciar');
    },

    'refinanciar → saldar → PAID'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 400, date: '2026-02-01' }); // saldo = 600
        refinanceLoan(emp, loan.id, { basis: 'balance', interestRate: 10 }); // +60 → saldo = 660

        recordPayment(emp, loan.id, { amount: 660, date: '2026-03-01' });

        testRunner.assertEquals(getBalance(loan), 0, 'saldo 0 tras pagar todo');
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'PAID tras saldar con interés de refinanciamiento');
    },

    'múltiples refinanciamientos acumulan el interés correctamente'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });

        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 5 });  // +50 → 1050
        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 5 });  // +50 → 1100

        testRunner.assertEquals(getTotalDue(loan), 1100, 'total 1100 con dos refinanciamientos');
        testRunner.assertEquals(getBalance(loan), 1100, 'saldo 1100');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4: Reabrir préstamo
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('LoanWorkflow — reabrir préstamo', {

    'préstamo WRITTEN_OFF (con saldo pendiente) se reabre → ACTIVE'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 200, date: '2026-02-01' }); // saldo = 300
        writeOffLoan(emp, loan.id); // cancelar con saldo pendiente

        reopenLoan(emp, loan.id);

        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'WRITTEN_OFF (con saldo) → ACTIVE');
    },

    'préstamo WRITTEN_OFF (saldado antes de cancelar) se reabre → PAID'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 500, date: '2026-02-01' }); // saldo = 0
        writeOffLoan(emp, loan.id); // sobrescribir estado a WRITTEN_OFF

        reopenLoan(emp, loan.id);

        // saldo es 0, por lo que al reabrir queda PAID
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'WRITTEN_OFF (saldo=0) → PAID al reabrir');
    },

    'reopenLoan en préstamo ACTIVE no hace nada (silencioso)'() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });

        reopenLoan(emp, loan.id); // no-op silencioso

        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'sigue ACTIVE, no cambia');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 5: Persistencia tras operaciones de préstamo
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('LoanWorkflow — persistencia', {

    async 'crear préstamo y guardar → indexedDBService.saveState llamado'() {
        const snap = snapshotGlobal();
        try {
            clearMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.employees = [{ id: 'emp-p1', name: 'Test', loans: [] }];
            const emp = state.employees[0];

            createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
            saveApplicationData();
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB guardó tras crear préstamo');
        } finally {
            restoreGlobal(snap);
        }
    },

    async 'registrar pago y guardar → indexedDBService.saveState llamado'() {
        const snap = snapshotGlobal();
        try {
            clearMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.employees = [{ id: 'emp-p2', name: 'Test', loans: [] }];
            const emp = state.employees[0];
            const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });

            recordPayment(emp, loan.id, { amount: 200, date: '2026-02-01' });
            saveApplicationData();
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1, 'IndexedDB guardó tras pago');
        } finally {
            restoreGlobal(snap);
        }
    },
});
