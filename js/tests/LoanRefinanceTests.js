/**
 * 🧪 LoanRefinanceTests
 *
 * Refinanciamiento de préstamos: cuando el empleado no puede pagar (total o
 * parcial), se agrega interés al préstamo. Se elige la base por
 * refinanciamiento: sobre el CAPITAL original o sobre el SALDO restante.
 *
 * Contrato:
 *   - refinanceLoan(emp, loanId, { basis, interestRate, date?, note?, unpaidAmount? })
 *     agrega un evento a loan.refinancings[] con su interés calculado.
 *   - getTotalDue incluye el interés de los refinanciamientos (el saldo crece).
 *   - getTotalInterestAccrued = interés original + interés de refinanciamientos.
 *   - getRefinanceCount = número de refinanciamientos.
 *   - v1: NO toca fechas ni cuotas; solo agrega interés.
 */

import {
    createLoan, recordPayment, refinanceLoan,
    getTotalDue, getBalance, getRefinanceInterest, getRefinanceCount,
    getTotalInterestAccrued, LOAN_STATUS
} from '../modules/features/loans/LoansService.js';
import mergeEmployees from '../modules/services/EmployeeMerge.js';

function makeEmp() { return { id: 'e1', name: 'Test', loans: [], updatedAt: 0 }; }

testRunner.addSuite("LoansService — refinanceLoan (refinanciamiento)", {

    "sobre capital original: agrega interés sobre el principal"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        const ev = refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 10, date: '2026-02-01' });
        testRunner.assertEquals(ev.basis, 'principal');
        testRunner.assertEquals(ev.baseAmount, 1000);
        testRunner.assertEquals(ev.interestAmount, 100, '1000 * 10% = 100');
        testRunner.assertEquals(getRefinanceCount(loan), 1);
        testRunner.assertEquals(getTotalDue(loan), 1100, 'totalDue crece por el interés');
        testRunner.assertEquals(getBalance(loan), 1100);
        testRunner.assertEquals(getTotalInterestAccrued(loan), 100, 'interés original (0) + refinance (100)');
    },

    "sobre saldo restante: usa el saldo actual como base"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 400, date: '2026-01-15' }); // saldo = 600
        const ev = refinanceLoan(emp, loan.id, { basis: 'balance', interestRate: 10 });
        testRunner.assertEquals(ev.baseAmount, 600, 'base = saldo restante');
        testRunner.assertEquals(ev.interestAmount, 60, '600 * 10% = 60');
        testRunner.assertEquals(getTotalDue(loan), 1060, '1000 + 60');
        testRunner.assertEquals(getBalance(loan), 660, '1060 - 400 abonado');
    },

    "interés original + refinanciamiento se acumulan en getTotalInterestAccrued"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 5, startDate: '2026-01-01' }); // interés 50
        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 10 }); // +100
        testRunner.assertEquals(getTotalDue(loan), 1150, '1000 + 50 + 100');
        testRunner.assertEquals(getTotalInterestAccrued(loan), 150, '50 + 100');
    },

    "múltiples refinanciamientos acumulan cuenta e interés"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 10 }); // +100
        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 5 });  // +50
        testRunner.assertEquals(getRefinanceCount(loan), 2);
        testRunner.assertEquals(getRefinanceInterest(loan), 150);
        testRunner.assertEquals(getTotalDue(loan), 1150);
    },

    "actualiza updatedAt en el préstamo y el empleado"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        loan.updatedAt = 0; emp.updatedAt = 0;
        refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 10 });
        testRunner.assert(loan.updatedAt > 0, 'loan.updatedAt debe actualizarse');
        testRunner.assert(emp.updatedAt > 0, 'emp.updatedAt debe actualizarse (para sync)');
    },

    "guarda fecha, nota y monto no pagado en el evento"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        const ev = refinanceLoan(emp, loan.id, {
            basis: 'balance', interestRate: 8, date: '2026-03-10',
            note: 'No pudo pagar la quincena', unpaidAmount: 300
        });
        testRunner.assertEquals(ev.date, '2026-03-10');
        testRunner.assertEquals(ev.note, 'No pudo pagar la quincena');
        testRunner.assertEquals(ev.unpaidAmount, 300);
        testRunner.assert(!!ev.id, 'el evento debe tener id');
    }

});

testRunner.addSuite("LoansService — refinanceLoan validaciones", {

    "no se puede refinanciar un préstamo ya pagado"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 1000, date: '2026-01-15' }); // saldo 0 → paid
        let threw = false;
        try { refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 10 }); }
        catch (e) { threw = true; }
        testRunner.assertEquals(threw, true, 'Debe lanzar: préstamo sin saldo / no activo');
    },

    "tasa <= 0 lanza error"() {
        const emp = makeEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        let threw = false;
        try { refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 0 }); }
        catch (e) { threw = true; }
        testRunner.assertEquals(threw, true);
    },

    "préstamo inexistente lanza error"() {
        const emp = makeEmp();
        let threw = false;
        try { refinanceLoan(emp, 'NOPE', { basis: 'principal', interestRate: 10 }); }
        catch (e) { threw = true; }
        testRunner.assertEquals(threw, true);
    }

});

testRunner.addSuite("EmployeeMerge — refinancings se unen por id (sync multi-dispositivo)", {

    "dos dispositivos refinanciando el mismo préstamo NO pierden eventos"() {
        // server tiene R1+R3; local (más nuevo) tiene R1+R2. La unión debe
        // conservar R1, R2 y R3 (igual que payments/installments).
        const server = {
            id: 'e1', updatedAt: 100,
            loans: [{ id: 'L1', updatedAt: 100, principal: 1000,
                refinancings: [{ id: 'R1', interestAmount: 10 }, { id: 'R3', interestAmount: 30 }] }]
        };
        const local = {
            id: 'e1', updatedAt: 200,
            loans: [{ id: 'L1', updatedAt: 200, principal: 1000,
                refinancings: [{ id: 'R1', interestAmount: 10 }, { id: 'R2', interestAmount: 20 }] }]
        };
        const merged = mergeEmployees(server, local);
        const loan = merged.loans.find(l => l.id === 'L1');
        const ids = loan.refinancings.map(r => r.id).sort().join(',');
        testRunner.assertEquals(ids, 'R1,R2,R3',
            'Los refinanciamientos de ambos dispositivos deben unirse por id, sin perder ninguno');
    }

});

console.log('🧪 LoanRefinance tests cargados.');
