/**
 * 🧪 LoansServiceTests — Cover the new loans ledger data layer.
 *
 * Tests the contract callers will rely on:
 *   - Creation + validation
 *   - Payments and balance math
 *   - Installment generation
 *   - Status transitions (active → paid → written-off → reopen)
 *   - Voiding payments
 *   - Migration from legacy advances[]
 *   - Aggregations (employees with debt, total exposure)
 */

import {
    createLoan,
    recordPayment,
    voidPayment,
    writeOffLoan,
    reopenLoan,
    getBalance,
    getTotalDue,
    getPaidAmount,
    getNextPayrollDeduction,
    generateInstallmentSchedule,
    migrateAdvancesToLoans,
    validateLoanInput,
    validatePaymentInput,
    getEmployeesWithDebt,
    getTotalExposure,
    LOAN_STATUS,
    INSTALLMENT_MODE
} from '../modules/features/loans/LoansService.js';

function buildEmployee() {
    return { id: 'emp1', name: 'Test Employee', number: '001', loans: [] };
}

// ─── createLoan + validation ─────────────────────────────────────────────────

testRunner.addSuite("LoansService — createLoan", {

    "creates an active loan with required fields"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 10000,
            interestRate: 5,
            startDate: '2026-05-20',
            concept: 'Adelanto medico'
        });
        testRunner.assertEquals(emp.loans.length, 1, "Loan should be appended to emp.loans");
        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, "New loan should be active");
        testRunner.assertEquals(loan.principal, 10000, "Principal preserved");
        testRunner.assertEquals(loan.interestRate, 5, "Interest rate preserved");
        testRunner.assertEquals(loan.installmentMode, INSTALLMENT_MODE.LUMP, "Default mode is lump");
        testRunner.assert(loan.id.startsWith('LOAN-'), "Has a LOAN- prefixed id");
    },

    "throws on principal <= 0"() {
        const emp = buildEmployee();
        let threw = false;
        try {
            createLoan(emp, { principal: 0, interestRate: 5, startDate: '2026-05-20' });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Should throw on zero principal");
    },

    "throws on interest > 100%"() {
        const emp = buildEmployee();
        let threw = false;
        try {
            createLoan(emp, { principal: 100, interestRate: 200, startDate: '2026-05-20' });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Should throw on 200% interest");
    },

    "throws on missing startDate"() {
        const emp = buildEmployee();
        let threw = false;
        try {
            createLoan(emp, { principal: 100, interestRate: 5 });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Should throw on missing startDate");
    },

    "creates installments when mode='installments'"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200,
            interestRate: 0,
            startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4,
            installmentFrequencyWeeks: 2
        });
        testRunner.assertEquals(loan.installments.length, 4, "4 installments generated");
        testRunner.assertEquals(loan.installments[0].scheduledAmount, 300, "First installment is 300");
        // Due dates spaced 2 weeks apart starting from startDate
        testRunner.assertEquals(loan.installments[0].dueDate, '2026-05-15', "First due 2 weeks after start");
        testRunner.assertEquals(loan.installments[3].dueDate, '2026-06-26', "Last due 8 weeks after start");
    }
});

// ─── Balance math ────────────────────────────────────────────────────────────

testRunner.addSuite("LoansService — balance math", {

    "getTotalDue includes interest by default"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 1000, interestRate: 5, startDate: '2026-05-20' });
        testRunner.assertEquals(getTotalDue(loan), 1050, "1000 + 5% = 1050");
    },

    "getTotalDue excludes interest when interestIncluded=true"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1000, interestRate: 5, startDate: '2026-05-20', interestIncluded: true
        });
        testRunner.assertEquals(getTotalDue(loan), 1000, "interestIncluded means only principal");
    },

    "getBalance subtracts non-voided payments"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-05-20' });
        recordPayment(emp, loan.id, { amount: 300, date: '2026-05-25' });
        recordPayment(emp, loan.id, { amount: 200, date: '2026-06-01' });
        testRunner.assertEquals(getBalance(loan), 500, "1000 - 300 - 200 = 500");
    },

    "getBalance ignores voided payments"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-05-20' });
        const p1 = recordPayment(emp, loan.id, { amount: 300, date: '2026-05-25' });
        voidPayment(emp, loan.id, p1.id);
        testRunner.assertEquals(getBalance(loan), 1000, "Voided payment does not reduce balance");
    },

    "getBalance clamps to 0 (overpayment safety)"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        // Tweak directly to simulate overpayment past validation
        loan.payments.push({ id: 'p1', amount: 150, date: '2026-05-25', voided: false });
        testRunner.assertEquals(getBalance(loan), 0, "Balance never goes negative");
    }
});

// ─── Payment + status transitions ────────────────────────────────────────────

testRunner.addSuite("LoansService — payments and status", {

    "auto-closes loan when fully paid"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-05-20' });
        recordPayment(emp, loan.id, { amount: 1000, date: '2026-05-25' });
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, "Loan should auto-close as paid");
        testRunner.assert(loan.closedAt !== null, "closedAt should be set");
    },

    "rejects payment exceeding balance"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        let threw = false;
        try {
            recordPayment(emp, loan.id, { amount: 500, date: '2026-05-25' });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Should reject overpayment");
    },

    "rejects payment on paid loan"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        recordPayment(emp, loan.id, { amount: 100, date: '2026-05-25' });
        let threw = false;
        try {
            recordPayment(emp, loan.id, { amount: 10, date: '2026-05-26' });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Should reject payment on already-paid loan");
    },

    "voiding a payment reopens a paid loan"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        const p = recordPayment(emp, loan.id, { amount: 100, date: '2026-05-25' });
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, "Pre: paid");
        voidPayment(emp, loan.id, p.id);
        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, "Voiding should re-activate");
    },

    "writeOffLoan sets status without losing data"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        recordPayment(emp, loan.id, { amount: 30, date: '2026-05-25' });
        writeOffLoan(emp, loan.id);
        testRunner.assertEquals(loan.status, LOAN_STATUS.WRITTEN_OFF, "Status is written-off");
        testRunner.assertEquals(loan.payments.length, 1, "Payments preserved");
    },

    "reopenLoan restores correct active/paid state"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 100, interestRate: 0, startDate: '2026-05-20' });
        writeOffLoan(emp, loan.id);
        reopenLoan(emp, loan.id);
        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, "Reopen sets back to active");
    }
});

// ─── Installments and getNextPayrollDeduction ────────────────────────────────

testRunner.addSuite("LoansService — installments and deductions", {

    "lump-mode deduction returns full balance"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 1000, interestRate: 10, startDate: '2026-05-20' });
        const next = getNextPayrollDeduction(loan, '2026-05-20');
        testRunner.assertEquals(next.amount, 1100, "Full balance with interest");
        testRunner.assertEquals(next.isInstallment, false, "Marked as non-installment");
    },

    "installment-mode returns scheduled amount when due"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });
        // First installment is due 2026-05-15
        const next = getNextPayrollDeduction(loan, '2026-05-16');
        testRunner.assertEquals(next.amount, 300, "First installment is 300");
        testRunner.assertEquals(next.isInstallment, true, "Marked as installment");
        testRunner.assertEquals(next.installmentSeq, 1, "It's installment #1");
    },

    "installment-mode returns null when no installment is due"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });
        const next = getNextPayrollDeduction(loan, '2026-05-10');
        testRunner.assertEquals(next, null, "Nothing due before first installment date");
    },

    "generateInstallmentSchedule handles non-divisible totals"() {
        const out = generateInstallmentSchedule({
            principal: 100, interestRate: 0, interestIncluded: false,
            startDate: '2026-05-01', count: 3, frequencyWeeks: 1
        });
        const sum = out.reduce((s, x) => s + x.scheduledAmount, 0);
        // Last installment absorbs the remainder so the sum is exactly 100
        testRunner.assertEquals(Math.round(sum * 100) / 100, 100, "Sum equals totalDue");
    }
});

// ─── Migration ───────────────────────────────────────────────────────────────

testRunner.addSuite("LoansService — migration from emp.advances", {

    "migrates each legacy advance into a loan"() {
        const emp = {
            id: 'e1', name: 'Test', number: '001',
            advances: [
                { id: 'ADV-old-1', amount: 500, interest: 5, date: '2026-04-01', note: 'Old one' },
                { id: 'ADV-old-2', amount: 1000, interest: 0, date: '2026-04-15', note: 'Another' }
            ]
        };
        const count = migrateAdvancesToLoans(emp);
        testRunner.assertEquals(count, 2, "2 advances migrated");
        testRunner.assertEquals(emp.loans.length, 2, "2 loans created");
        testRunner.assertEquals(emp.loans[0].principal, 500, "Principal copied");
        testRunner.assertEquals(emp.loans[0].concept, 'Old one', "Note → concept");
        testRunner.assertEquals(emp.loans[0].status, LOAN_STATUS.ACTIVE, "Migrated as active");
    },

    "is idempotent (running twice does not duplicate)"() {
        const emp = {
            id: 'e1', name: 'Test', number: '001',
            advances: [
                { id: 'ADV-old-1', amount: 500, interest: 5, date: '2026-04-01', note: 'Old' }
            ]
        };
        migrateAdvancesToLoans(emp);
        migrateAdvancesToLoans(emp);
        testRunner.assertEquals(emp.loans.length, 1, "Still only 1 loan after second migration");
    }
});

// ─── Aggregations ────────────────────────────────────────────────────────────

testRunner.addSuite("LoansService — aggregations", {

    "getEmployeesWithDebt returns only those with active loans, sorted by balance"() {
        const state = {
            employees: [
                { id: 'e1', name: 'Ada',   number: '001', loans: [
                    { id: 'L1', principal: 100, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] }
                ]},
                { id: 'e2', name: 'Grace', number: '002', loans: [
                    { id: 'L2', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] }
                ]},
                { id: 'e3', name: 'Linus', number: '003', loans: [
                    { id: 'L3', principal: 500, interestRate: 0, status: LOAN_STATUS.PAID, interestIncluded: false, payments: [{ amount: 500, voided: false }] }
                ]},
                { id: 'e4', name: 'Donald', number: '004', loans: [] }
            ]
        };
        const out = getEmployeesWithDebt(state);
        testRunner.assertEquals(out.length, 2, "Only employees with active loans");
        testRunner.assertEquals(out[0].name, 'Grace', "Highest balance first");
        testRunner.assertEquals(out[0].totalBalance, 1000, "Grace balance is 1000");
        testRunner.assertEquals(out[1].name, 'Ada', "Ada second");
    },

    "getTotalExposure sums all active loan balances"() {
        const state = {
            employees: [
                { id: 'e1', loans: [{ id: 'L1', principal: 100, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] }] },
                { id: 'e2', loans: [{ id: 'L2', principal: 250, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] }] },
                { id: 'e3', loans: [{ id: 'L3', principal: 999, interestRate: 0, status: LOAN_STATUS.WRITTEN_OFF, interestIncluded: false, payments: [] }] }
            ]
        };
        testRunner.assertEquals(getTotalExposure(state), 350, "Sum of active balances only");
    }
});

// ─── Validation helpers (used directly by UI for inline form feedback) ───────

testRunner.addSuite("LoansService — validation helpers", {

    "validateLoanInput accepts a clean input"() {
        const r = validateLoanInput({ principal: 100, interestRate: 5, startDate: '2026-05-20' });
        testRunner.assertEquals(r.valid, true, "Clean input is valid");
    },

    "validateLoanInput rejects bad year"() {
        const r = validateLoanInput({ principal: 100, interestRate: 5, startDate: '1850-01-01' });
        testRunner.assertEquals(r.valid, false, "Year 1850 rejected");
    },

    "validatePaymentInput rejects negative amounts"() {
        const loan = { principal: 100, interestRate: 0, interestIncluded: false, payments: [] };
        const r = validatePaymentInput(loan, { amount: -50, date: '2026-05-25' });
        testRunner.assertEquals(r.valid, false, "Negative amount rejected");
    }
});

console.log('🧪 LoansService tests cargados.');
