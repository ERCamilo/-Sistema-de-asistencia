/**
 * 🧪 LoansServiceTimestampsTests
 *
 * Verifica que TODA mutación de un préstamo bump-ee también el
 * emp.updatedAt del empleado dueño. Sin esto, el merge-by-id de
 * Fase 2.2 y el wizard de duplicados no pueden distinguir cuál
 * versión de un mismo empleado es "más fresca" cuando los cambios
 * fueron en sus préstamos.
 *
 * Reglas que esta suite blinda:
 *   - createLoan(emp, ...) → emp.updatedAt sube.
 *   - recordPayment(emp, ...) → emp.updatedAt sube.
 *   - voidPayment(emp, ...) → emp.updatedAt sube.
 *   - writeOffLoan(emp, ...) → emp.updatedAt sube.
 *   - reopenLoan(emp, ...) → emp.updatedAt sube.
 *   - Cada función sigue subiendo loan.updatedAt como ya hacía.
 */

import {
    createLoan, recordPayment, voidPayment, writeOffLoan, reopenLoan,
    LOAN_STATUS
} from '../modules/features/loans/LoansService.js';

function makeEmp({ updatedAt = 1000 } = {}) {
    return { id: 'e1', number: '001', name: 'Test', loans: [], updatedAt };
}

function makeLoanParams() {
    return { principal: 1000, startDate: '2026-05-26', concept: 'Test' };
}

testRunner.addSuite("LoansService — emp.updatedAt en mutaciones (timestamps)", {

    "createLoan: emp.updatedAt aumenta respecto al valor previo"() {
        const emp = makeEmp({ updatedAt: 1000 });
        const beforeNow = Date.now();
        createLoan(emp, makeLoanParams());
        testRunner.assert(emp.updatedAt > 1000,
            `emp.updatedAt debe haber aumentado. Era 1000, ahora ${emp.updatedAt}`);
        testRunner.assert(emp.updatedAt >= beforeNow,
            'emp.updatedAt debe ser un timestamp reciente');
    },

    "createLoan: el loan también recibe updatedAt (regression)"() {
        const emp = makeEmp();
        const loan = createLoan(emp, makeLoanParams());
        testRunner.assert(typeof loan.updatedAt === 'number',
            'loan.updatedAt debe seguir existiendo');
    },

    "recordPayment: emp.updatedAt aumenta"() {
        const emp = makeEmp();
        const loan = createLoan(emp, makeLoanParams());
        const beforeEmp = emp.updatedAt;
        // Espacio mínimo para garantizar que Date.now() avance
        const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        sleep(2);
        recordPayment(emp, loan.id, { amount: 100, date: '2026-05-27' });
        testRunner.assert(emp.updatedAt > beforeEmp,
            `emp.updatedAt debe subir tras un abono. Antes: ${beforeEmp}, ahora: ${emp.updatedAt}`);
    },

    "voidPayment: emp.updatedAt aumenta"() {
        const emp = makeEmp();
        const loan = createLoan(emp, makeLoanParams());
        const payment = recordPayment(emp, loan.id, { amount: 100, date: '2026-05-27' });
        const before = emp.updatedAt;
        const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        sleep(2);
        voidPayment(emp, loan.id, payment.id);
        testRunner.assert(emp.updatedAt > before,
            'emp.updatedAt debe subir al anular un abono');
    },

    "writeOffLoan: emp.updatedAt aumenta"() {
        const emp = makeEmp();
        const loan = createLoan(emp, makeLoanParams());
        const before = emp.updatedAt;
        const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        sleep(2);
        writeOffLoan(emp, loan.id);
        testRunner.assert(emp.updatedAt > before,
            'emp.updatedAt debe subir al castigar (write-off)');
    },

    "reopenLoan: emp.updatedAt aumenta"() {
        const emp = makeEmp();
        const loan = createLoan(emp, makeLoanParams());
        writeOffLoan(emp, loan.id);
        const before = emp.updatedAt;
        const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        sleep(2);
        reopenLoan(emp, loan.id);
        testRunner.assert(emp.updatedAt > before,
            'emp.updatedAt debe subir al reabrir un préstamo castigado');
    },

    "secuencia completa: cada paso bumpea emp.updatedAt"() {
        const emp = makeEmp();
        const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };

        const t0 = emp.updatedAt;
        const loan = createLoan(emp, makeLoanParams());
        const t1 = emp.updatedAt;

        sleep(2);
        const payment = recordPayment(emp, loan.id, { amount: 100, date: '2026-05-27' });
        const t2 = emp.updatedAt;

        sleep(2);
        voidPayment(emp, loan.id, payment.id);
        const t3 = emp.updatedAt;

        sleep(2);
        writeOffLoan(emp, loan.id);
        const t4 = emp.updatedAt;

        testRunner.assert(t1 > t0, 'create > inicial');
        testRunner.assert(t2 > t1, 'pago > create');
        testRunner.assert(t3 > t2, 'void > pago');
        testRunner.assert(t4 > t3, 'writeOff > void');
    },

    "createLoan no rompe si emp.updatedAt era undefined"() {
        const emp = { id: 'eX', number: '002', name: 'Sin ts', loans: [] };
        let threw = false;
        try { createLoan(emp, makeLoanParams()); } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false);
        testRunner.assert(typeof emp.updatedAt === 'number',
            'updatedAt debe quedar como número aunque no existiera antes');
    }

});

console.log('🧪 LoansService timestamps tests cargados.');
