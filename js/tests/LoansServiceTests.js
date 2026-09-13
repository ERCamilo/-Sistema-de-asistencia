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
    deleteLoan,
    getBalance,
    getTotalDue,
    getPaidAmount,
    getNextPayrollDeduction,
    getPayrollDeductionOptions,
    generateInstallmentSchedule,
    migrateAdvancesToLoans,
    validateLoanInput,
    validatePaymentInput,
    getEmployeesWithDebt,
    getTotalExposure,
    getTotalPaidActive,
    getEmployeesWithOnlyInactiveLoans,
    getInterestAmount,
    getTotalActiveInterest,
    getTotalHistoricalInterest,
    getTotalHistoricalDue,
    getTotalHistoricalPaid,
    getClosedLoansCount,
    getCalendarPeriodWeeks,
    getEmployeePeriodSalary,
    getEmployeeUpcomingDeductions,
    calculateRepaymentCapacity,
    consolidateLoans,
    LOAN_STATUS,
    INSTALLMENT_MODE
} from '../modules/features/loans/LoansService.js';
import { Employee } from '../modules/features/employees/Employee.js';

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

    "exposes every remaining installment while marking only due installments"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });

        const options = getPayrollDeductionOptions(loan, '2026-05-16');

        testRunner.assertEquals(options.length, 4, "All remaining installments are selectable");
        testRunner.assertEquals(options[0].installmentSeq, 1, "Selection starts with the oldest unpaid installment");
        testRunner.assertEquals(options[0].amount, 300, "First installment keeps its scheduled amount");
        testRunner.assertEquals(options[0].isDue, true, "First installment is due by period end");
        testRunner.assertEquals(options[1].isDue, false, "Future installments remain optional");
    },

    "starts options at the partially unpaid installment"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });
        recordPayment(emp, loan.id, { amount: 350, date: '2026-05-20' });

        const options = getPayrollDeductionOptions(loan, '2026-06-01');

        testRunner.assertEquals(options.length, 3, "Paid installments are removed from selectable options");
        testRunner.assertEquals(options[0].installmentSeq, 2, "The partially paid installment stays first");
        testRunner.assertEquals(options[0].amount, 250, "Only the unpaid portion of the installment is charged");
        testRunner.assertEquals(options[1].installmentSeq, 3, "Later installments preserve their sequence");
        testRunner.assertEquals(options[1].amount, 300, "Later installments keep their full amount");
    },

    "keeps future installments selectable without making them due"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });

        const options = getPayrollDeductionOptions(loan, '2026-05-10');

        testRunner.assertEquals(options.length, 4, "Employees may choose to advance future installments");
        testRunner.assertEquals(options.some(option => option.isDue), false, "No installment is selected by date yet");
    },

    "exposes refinance interest left beyond the original schedule"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, {
            principal: 1200, interestRate: 0, startDate: '2026-05-01',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS,
            installmentCount: 4, installmentFrequencyWeeks: 2
        });
        loan.refinancings = [{ id: 'r1', interestAmount: 120, voided: false }];
        recordPayment(emp, loan.id, { amount: 1200, date: '2026-06-26' });

        const options = getPayrollDeductionOptions(loan, '2026-06-30');

        testRunner.assertEquals(options.length, 1, "Refinance balance remains collectible after scheduled installments");
        testRunner.assertEquals(options[0].kind, 'balance-adjustment', "Residual balance is explicit, not a fake installment");
        testRunner.assertEquals(options[0].amount, 120, "Residual charge equals refinance interest still owed");
        testRunner.assertEquals(options[0].isDue, true, "Residual is due after the original schedule ends");
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
                { id: 'e2', name: 'Grace', number: '002', active: false, loans: [
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
        testRunner.assertEquals(out[0].active, false, "Employee status is exposed for the ledger");
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
    },

    "getTotalPaidActive sums payments only on active loans"() {
        const state = {
            employees: [
                // Active loan with 100 paid out of 500
                { id: 'e1', loans: [{
                    id: 'L1', principal: 500, interestRate: 0, interestIncluded: false,
                    status: LOAN_STATUS.ACTIVE,
                    payments: [{ amount: 100, voided: false }]
                }]},
                // Active loan with 50 paid + 20 voided (voided excluded)
                { id: 'e2', loans: [{
                    id: 'L2', principal: 300, interestRate: 0, interestIncluded: false,
                    status: LOAN_STATUS.ACTIVE,
                    payments: [{ amount: 50, voided: false }, { amount: 20, voided: true }]
                }]},
                // Paid-off loan — should NOT be counted (it's no longer active)
                { id: 'e3', loans: [{
                    id: 'L3', principal: 200, interestRate: 0, interestIncluded: false,
                    status: LOAN_STATUS.PAID,
                    payments: [{ amount: 200, voided: false }]
                }]}
            ]
        };
        testRunner.assertEquals(getTotalPaidActive(state), 150, "100 + 50 across active loans (voided/paid excluded)");
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

testRunner.addSuite("Employee — loans serialization regression", {
    "constructor preserves loans list"() {
        const mockData = {
            id: 'emp_test_1',
            name: 'Grace Hopper',
            number: '42',
            loans: [
                { id: 'LOAN-1', principal: 1000, status: 'active', payments: [] }
            ]
        };
        const emp = new Employee(mockData);
        testRunner.assert(Array.isArray(emp.loans), "loans property should be an array");
        testRunner.assertEquals(emp.loans.length, 1, "loans list should have 1 item");
        testRunner.assertEquals(emp.loans[0].principal, 1000, "principal should be preserved");
    },

    "toJSON includes loans list"() {
        const mockData = {
            id: 'emp_test_2',
            name: 'Ada Lovelace',
            number: '43',
            loans: [
                { id: 'LOAN-2', principal: 5000, status: 'active', payments: [] }
            ]
        };
        const emp = new Employee(mockData);
        // Tweak manually since constructor is broken right now
        emp.loans = mockData.loans;
        
        const serialized = emp.toJSON();
        testRunner.assert(serialized.hasOwnProperty('loans'), "serialized object must have loans key");
        testRunner.assert(Array.isArray(serialized.loans), "loans in serialized object must be an array");
        testRunner.assertEquals(serialized.loans[0].id, 'LOAN-2', "loan data inside serialized object must match");
    }
});

testRunner.addSuite("LoansService — getEmployeesWithOnlyInactiveLoans", {
    "returns only employees with inactive loans and no active ones"() {
        const mockState = {
            employees: [
                // e1: sin préstamos (excluido)
                { id: 'e1', name: 'Ada', number: '001', loans: [] },
                // e2: préstamo activo (excluido)
                { id: 'e2', name: 'Grace', number: '002', loans: [
                    { id: 'L1', principal: 100, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] }
                ]},
                // e3: préstamo pagado (incluido)
                { id: 'e3', name: 'Linus', number: '003', loans: [
                    { id: 'L2', principal: 500, interestRate: 0, status: LOAN_STATUS.PAID, interestIncluded: false, payments: [{ amount: 500, voided: false }] }
                ]},
                // e4: préstamo anulado (incluido)
                { id: 'e4', name: 'Donald', number: '004', loans: [
                    { id: 'L3', principal: 300, interestRate: 0, status: LOAN_STATUS.WRITTEN_OFF, interestIncluded: false, payments: [] }
                ]},
                // e5: préstamo activo + préstamo pagado (excluido porque tiene uno activo)
                { id: 'e5', name: 'Margaret', number: '005', loans: [
                    { id: 'L4', principal: 200, interestRate: 0, status: LOAN_STATUS.ACTIVE, interestIncluded: false, payments: [] },
                    { id: 'L5', principal: 400, interestRate: 0, status: LOAN_STATUS.PAID, interestIncluded: false, payments: [{ amount: 400, voided: false }] }
                ]}
            ]
        };
        const out = getEmployeesWithOnlyInactiveLoans(mockState);
        testRunner.assertEquals(out.length, 2, "Only 2 employees should be returned");
        testRunner.assertEquals(out[0].name, 'Donald', "Sorted alphabetically (Donald before Linus)");
        testRunner.assertEquals(out[1].name, 'Linus', "Linus second");
    }
});

testRunner.addSuite("LoansService — KPI Improved Metrics", {
    "getInterestAmount computes interest correctly"() {
        const loan1 = { principal: 1000, interestRate: 5, interestIncluded: false };
        const loan2 = { principal: 1000, interestRate: 5, interestIncluded: true };
        testRunner.assertEquals(getInterestAmount(loan1), 50, "1000 * 5% = 50");
        testRunner.assertEquals(getInterestAmount(loan2), 0, "0 interest when interestIncluded is true");
    },

    "getTotalActiveInterest and getTotalHistoricalInterest sum correctly"() {
        const mockState = {
            employees: [
                { id: 'e1', loans: [
                    { principal: 1000, interestRate: 10, interestIncluded: false, status: LOAN_STATUS.ACTIVE },
                    { principal: 2000, interestRate: 5, interestIncluded: false, status: LOAN_STATUS.PAID }
                ]},
                { id: 'e2', loans: [
                    { principal: 500, interestRate: 20, interestIncluded: false, status: LOAN_STATUS.ACTIVE },
                    { principal: 800, interestRate: 10, interestIncluded: false, status: LOAN_STATUS.WRITTEN_OFF }
                ]}
            ]
        };
        // Activos: L1 (100) + L3 (100) = 200
        testRunner.assertEquals(getTotalActiveInterest(mockState), 200, "Active interest should be 200");
        // Histórico: L1 (100) + L2 (100) + L3 (100) + L4 (80) = 380
        testRunner.assertEquals(getTotalHistoricalInterest(mockState), 380, "Historical interest should be 380");
    },

    "getTotalHistoricalDue and getTotalHistoricalPaid sum correctly"() {
        const mockState = {
            employees: [
                { id: 'e1', loans: [
                    { principal: 1000, interestRate: 0, interestIncluded: false, status: LOAN_STATUS.ACTIVE, payments: [{ amount: 400, voided: false }] },
                    { principal: 500, interestRate: 0, interestIncluded: false, status: LOAN_STATUS.PAID, payments: [{ amount: 500, voided: false }] }
                ]}
            ]
        };
        // Histórico Due: 1000 + 500 = 1500
        testRunner.assertEquals(getTotalHistoricalDue(mockState), 1500, "Historical due should be 1500");
        // Histórico Paid: 400 + 500 = 900
        testRunner.assertEquals(getTotalHistoricalPaid(mockState), 900, "Historical paid should be 900");
    },

    "getClosedLoansCount counts paid and written-off loans"() {
        const mockState = {
            employees: [
                { id: 'e1', loans: [
                    { id: 'L1', status: LOAN_STATUS.ACTIVE },
                    { id: 'L2', status: LOAN_STATUS.PAID }
                ]},
                { id: 'e2', loans: [
                    { id: 'L3', status: LOAN_STATUS.WRITTEN_OFF }
                ]}
            ]
        };
        testRunner.assertEquals(getClosedLoansCount(mockState), 2, "Should count 2 closed loans");
    }
});

// ─── deleteLoan (borrado permanente de anulados) ─────────────────────────────

function buildWrittenOffLoan() {
    const emp = buildEmployee();
    const loan = createLoan(emp, { principal: 5000, interestRate: 0, startDate: '2026-05-20', concept: 'Test' });
    writeOffLoan(emp, loan.id);
    return { emp, loan };
}

testRunner.addSuite("LoansService — deleteLoan", {

    "elimina un préstamo anulado de emp.loans"() {
        const { emp, loan } = buildWrittenOffLoan();
        testRunner.assertEquals(emp.loans.length, 1, "precondición: 1 préstamo");
        deleteLoan(emp, loan.id);
        testRunner.assertEquals(emp.loans.length, 0, "el préstamo debe salir de emp.loans");
    },

    "registra un tombstone para que no reaparezca en el sync"() {
        const { emp, loan } = buildWrittenOffLoan();
        deleteLoan(emp, loan.id);
        testRunner.assert(!!emp.deletedItemIds, "debe crear deletedItemIds");
        testRunner.assert(
            Array.isArray(emp.deletedItemIds.loans) && emp.deletedItemIds.loans.includes(loan.id),
            "el id del préstamo borrado debe quedar tombstoneado en deletedItemIds.loans"
        );
    },

    "sube emp.updatedAt (gana el merge contra copias viejas)"() {
        const { emp, loan } = buildWrittenOffLoan();
        emp.updatedAt = 0;
        deleteLoan(emp, loan.id);
        testRunner.assert(emp.updatedAt > 0, "deleteLoan debe refrescar emp.updatedAt");
    },

    "rechaza eliminar un préstamo ACTIVO (guard de seguridad)"() {
        const emp = buildEmployee();
        const loan = createLoan(emp, { principal: 5000, interestRate: 0, startDate: '2026-05-20' });
        let threw = false;
        try { deleteLoan(emp, loan.id); } catch (_) { threw = true; }
        testRunner.assert(threw, "no debe poder borrarse un préstamo activo");
        testRunner.assertEquals(emp.loans.length, 1, "el préstamo activo sigue ahí");
    },

    "lanza si el préstamo no existe"() {
        const emp = buildEmployee();
        let threw = false;
        try { deleteLoan(emp, 'LOAN-inexistente'); } catch (_) { threw = true; }
        testRunner.assert(threw, "id inexistente debe lanzar");
    },

    "devuelve el préstamo eliminado"() {
        const { emp, loan } = buildWrittenOffLoan();
        const out = deleteLoan(emp, loan.id);
        testRunner.assertEquals(out.id, loan.id, "debe devolver el préstamo eliminado");
    }

});

// ─── Repayment capacity & period regular salary ──────────────────────────────

testRunner.addSuite("LoansService — Repayment Capacity & Period Salary", {

    "calcula el sueldo de período regular basado en posición y horario estándar"() {
        const state = {
            settings: { regularHoursPerDay: 8 },
            positions: [{ id: 'pos1', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6] }]
        };
        const emp = { id: 'emp1', positions: ['pos1'] };

        // 1 semana: 100 * 8 * 6 = 4800
        const weekly = getEmployeePeriodSalary(emp, 1, state);
        testRunner.assertEquals(weekly, 4800, "1 semana equivale a 4,800.00");

        // 2 semanas (quincenal): 4800 * 2 = 9600
        const biweekly = getEmployeePeriodSalary(emp, 2, state);
        testRunner.assertEquals(biweekly, 9600, "2 semanas equivalen a 9,600.00");

        // 4 semanas: 4800 * 4 = 19200
        const monthly = getEmployeePeriodSalary(emp, 4, state);
        testRunner.assertEquals(monthly, 19200, "4 semanas equivalen a 19,200.00");
    },

    "prioriza positionSalaries específico del empleado sobre la posición general"() {
        const state = {
            settings: { regularHoursPerDay: 8 },
            positions: [{ id: 'pos1', hourlyRate: 80, workingDays: [1, 2, 3, 4, 5, 6] }]
        };
        const emp = {
            id: 'emp1',
            positions: ['pos1'],
            positionSalaries: { pos1: 120 }
        };

        // 120 * 8 * 6 * 2 = 11520
        const salary = getEmployeePeriodSalary(emp, 2, state);
        testRunner.assertEquals(salary, 11520, "Debe usar 120/h configurado en positionSalaries");
    },

    "respeta customWorkingDays del empleado"() {
        const state = {
            settings: { regularHoursPerDay: 8 },
            positions: [{ id: 'pos1', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6] }] // 6 días
        };
        const emp = {
            id: 'emp1',
            positions: ['pos1'],
            customWorkingDays: { pos1: [1, 2, 3, 4, 5] } // solo 5 días
        };

        // 100 * 8 * 5 * 2 = 8000
        const salary = getEmployeePeriodSalary(emp, 2, state);
        testRunner.assertEquals(salary, 8000, "Debe calcular sobre 5 días de trabajo");
    },

    "soporta salaryConfig mensual como fallback cuando no hay tasa horaria"() {
        const state = {
            settings: { regularHoursPerDay: 8 },
            positions: []
        };
        const emp = {
            id: 'emp1',
            positions: [],
            salaryConfig: { amount: 26000, period: 'month' }
        };

        // 26000 / (52/12) * 2 = 26000 / 4.333333333333333 * 2 = 12000
        const salary = getEmployeePeriodSalary(emp, 2, state);
        testRunner.assertEquals(salary, 12000, "Convierte sueldo mensual a quincenal con alta precisión");
    },

    "retorna 0 si el empleado no tiene posiciones ni sueldo configurado"() {
        const state = { settings: { regularHoursPerDay: 8 }, positions: [] };
        const emp = { id: 'emp1', positions: [] };
        const salary = getEmployeePeriodSalary(emp, 2, state);
        testRunner.assertEquals(salary, 0, "Retorna 0 sin crash");
        testRunner.assertEquals(getEmployeePeriodSalary(null), 0, "Empleado null retorna 0");
    },

    "calcula capacidad óptima (safe <= 30%)"() {
        // Cuota de 2,400 sobre sueldo quincenal de 9,600 (25%)
        const res = calculateRepaymentCapacity({ installmentAmount: 2400, periodSalary: 9600, frequencyWeeks: 2 });
        testRunner.assertEquals(res.status, 'safe', "Status debe ser safe");
        testRunner.assertEquals(res.percentage, 25, "Porcentaje es 25%");
        testRunner.assert(res.isAvailable, "Está disponible");
        testRunner.assert(res.badgeText.includes('25%'), "Badge incluye 25%");
    },

    "calcula capacidad moderada (moderate 31% - 50%)"() {
        // Cuota de 4,000 sobre sueldo quincenal de 10,000 (40%)
        const res = calculateRepaymentCapacity({ installmentAmount: 4000, periodSalary: 10000, frequencyWeeks: 2 });
        testRunner.assertEquals(res.status, 'moderate', "Status debe ser moderate");
        testRunner.assertEquals(res.percentage, 40, "Porcentaje es 40%");
        testRunner.assert(res.badgeText.includes('40%'), "Badge incluye 40%");
    },

    "calcula riesgo alto (danger > 50%) y crítico (> 100%)"() {
        // 1. Riesgo alto (60%)
        const high = calculateRepaymentCapacity({ installmentAmount: 6000, periodSalary: 10000, frequencyWeeks: 2 });
        testRunner.assertEquals(high.status, 'danger', "Status debe ser danger");
        testRunner.assertEquals(high.percentage, 60, "Porcentaje es 60%");
        testRunner.assert(high.statusLabel.includes('> 50%'), "Etiqueta menciona > 50%");

        // 2. Riesgo crítico (120% del sueldo)
        const critical = calculateRepaymentCapacity({ installmentAmount: 12000, periodSalary: 10000, frequencyWeeks: 2 });
        testRunner.assertEquals(critical.status, 'danger', "Status crítico sigue siendo danger");
        testRunner.assertEquals(critical.percentage, 120, "Porcentaje es 120%");
        testRunner.assert(critical.statusLabel.includes('100%'), "Etiqueta advierte que supera el 100%");
    },

    "maneja gracefully empleado sin sueldo configurado (status unknown)"() {
        const res = calculateRepaymentCapacity({ installmentAmount: 1500, periodSalary: 0, frequencyWeeks: 2 });
        testRunner.assertEquals(res.status, 'unknown', "Status debe ser unknown");
        testRunner.assertEquals(res.percentage, null, "Porcentaje es null");
        testRunner.assertEquals(res.isAvailable, false, "isAvailable es false");
        testRunner.assert(res.badgeText.includes('Sin salario base'), "Badge informa falta de salario");
    }

});

// ─── Calendar Period, Global Deductions & Debt Consolidation ────────────────

testRunner.addSuite("LoansService — Calendar Period, Global Deductions & Debt Consolidation", {

    "getCalendarPeriodWeeks resuelve la duración configurada en días a semanas"() {
        // 21 días (3 semanas)
        testRunner.assertEquals(getCalendarPeriodWeeks({ settings: { payPeriod: { periodLength: 21 } } }), 3, "21 días son 3 semanas");
        // 14 días (2 semanas)
        testRunner.assertEquals(getCalendarPeriodWeeks({ settings: { payPeriod: { periodLength: 14 } } }), 2, "14 días son 2 semanas");
        // 15 días (quincena civil: 15 / 7 = 2.14 semanas)
        testRunner.assertEquals(getCalendarPeriodWeeks({ settings: { payPeriod: { periodLength: 15 } } }), 2.14, "15 días son 2.14 semanas");
        // 7 días (1 semana)
        testRunner.assertEquals(getCalendarPeriodWeeks({ settings: { payPeriod: { periodLength: 7 } } }), 1, "7 días son 1 semana");
        // Fallback por defecto si no está configurado
        testRunner.assertEquals(getCalendarPeriodWeeks({ settings: {} }), 2, "Fallback es 2 semanas");
    },

    "getEmployeePeriodSalary usa período de calendario cuando frequencyWeeks es nulo"() {
        const state = {
            settings: { regularHoursPerDay: 8, payPeriod: { periodLength: 21 } }, // 3 semanas
            positions: [{ id: 'p1', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5] }] // 100 * 8 * 5 = 4000/sem
        };
        const emp = { id: 'e1', positions: ['p1'] };

        // 4000 * 3 = 12000
        const salary = getEmployeePeriodSalary(emp, null, state);
        testRunner.assertEquals(salary, 12000, "Debe calcular sobre las 3 semanas de calendario");
    },

    "getEmployeeUpcomingDeductions suma pagos únicos y cuotas activas excluyendo opcionalmente un préstamo"() {
        const emp = {
            id: 'e1',
            loans: [
                { id: 'l1', principal: 5000, status: LOAN_STATUS.ACTIVE, installmentMode: INSTALLMENT_MODE.LUMP, payments: [] },
                { id: 'l2', principal: 6000, status: LOAN_STATUS.ACTIVE, installmentMode: INSTALLMENT_MODE.INSTALLMENTS, installments: [{ seq: 1, dueDate: '2026-09-20', scheduledAmount: 1500, paidAmount: 0 }], payments: [] },
                { id: 'l3', principal: 2000, status: LOAN_STATUS.PAID, payments: [{ amount: 2000 }] }
            ]
        };

        // l1 (5000) + l2 cuota próxima (1500) = 6500 (l3 está pagado)
        const total = getEmployeeUpcomingDeductions(emp);
        testRunner.assertEquals(total, 6500, "Suma deducciones en cola de préstamos activos");

        // Excluyendo l1 (ej. en refinanciamiento de l1)
        const withoutL1 = getEmployeeUpcomingDeductions(emp, 'l1');
        testRunner.assertEquals(withoutL1, 1500, "Excluye el préstamo especificado");
    },

    "calculateRepaymentCapacity evalúa impacto acumulado con retenciones previas"() {
        // Sueldo: 10,000. Retención previa en cola: 4,000 (40%). Nueva cuota: 2,000 (20%).
        // Retención total: 6,000 (60%) -> pasa de moderate a danger!
        const cap = calculateRepaymentCapacity({
            installmentAmount: 2000,
            existingDeductions: 4000,
            periodSalary: 10000,
            frequencyWeeks: 2
        });

        testRunner.assertEquals(cap.status, 'danger', "Impacto total supera el 50% y marca danger");
        testRunner.assertEquals(cap.percentage, 60, "Retención total es 60%");
        testRunner.assertEquals(cap.instPercentage, 20, "Cuota nueva es 20%");
        testRunner.assertEquals(cap.existingPercentage, 40, "Retención previa es 40%");
        testRunner.assert(cap.warningText.includes('4000.00 en cola'), "Aviso detalla el monto en cola");
        testRunner.assert(cap.warningText.includes('2000.00 nuevo'), "Aviso detalla la nueva cuota");
    },

    "consolidateLoans unifica préstamos activos en un solo plan y salda los anteriores con auditoría"() {
        const emp = {
            id: 'e1',
            loans: [
                { id: 'l1', principal: 5000, status: LOAN_STATUS.ACTIVE, concept: 'Adelanto 1', payments: [] },
                { id: 'l2', principal: 7000, status: LOAN_STATUS.ACTIVE, concept: 'Adelanto 2', payments: [{ amount: 1000 }] } // balance 6000
            ]
        };

        // Balance total = 5000 + 6000 = 11000
        const res = consolidateLoans(emp, {
            installmentCount: 4,
            installmentFrequencyWeeks: 2,
            interestRate: 0,
            startDate: '2026-09-15',
            note: 'Reestructuración'
        }, 'admin_user');

        testRunner.assert(!!res.consolidatedLoan, "Retorna el préstamo consolidado");
        testRunner.assertEquals(res.closedLoans.length, 2, "Cierra los 2 préstamos anteriores");

        // Verificación de los préstamos cerrados
        testRunner.assertEquals(emp.loans[0].status, LOAN_STATUS.PAID, "l1 queda saldado");
        testRunner.assertEquals(emp.loans[1].status, LOAN_STATUS.PAID, "l2 queda saldado");
        testRunner.assertEquals(emp.loans[0].closedBy, 'admin_user', "Registra closedBy");
        testRunner.assert(emp.loans[0].consolidatedIntoLoanId === res.consolidatedLoan.id, "Trazabilidad cruzada de ID");

        // Verificación del nuevo préstamo
        const nuevo = res.consolidatedLoan;
        testRunner.assertEquals(nuevo.principal, 11000, "Capital consolidado exacto = 11,000");
        testRunner.assertEquals(nuevo.status, LOAN_STATUS.ACTIVE, "Nuevo préstamo está activo");
        testRunner.assertEquals(nuevo.installments.length, 4, "Generó 4 cuotas");
        testRunner.assertEquals(nuevo.installments[0].scheduledAmount, 2750, "Cada cuota es 2,750 (11000 / 4)");
        testRunner.assert(nuevo.consolidatedFromLoanIds.includes('l1') && nuevo.consolidatedFromLoanIds.includes('l2'), "Registra orígenes");
    },

    "consolidateLoans rechaza consolidar si hay menos de 2 préstamos activos"() {
        const emp = {
            id: 'e1',
            loans: [
                { id: 'l1', principal: 5000, status: LOAN_STATUS.ACTIVE, payments: [] }
            ]
        };

        let threw = false;
        try {
            consolidateLoans(emp, {});
        } catch (e) {
            threw = true;
            testRunner.assert(e.message.includes('al menos 2 préstamos activos'), "Mensaje claro de precondición");
        }
        testRunner.assert(threw, "Lanza error si active < 2");
    }

});

console.log('🧪 LoansService tests cargados.');

