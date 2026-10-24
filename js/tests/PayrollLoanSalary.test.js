import { getPayrollLoanSalaryAmounts } from '../modules/features/payroll/PayrollLoanSalary.js';
import { createLoan, getBalance, getPayrollDeductionOptions } from '../modules/features/loans/LoansService.js';
import { applyPayrollLoanDeductions, buildPayrollLoanSelection, setPayrollLoanMode } from '../modules/features/payroll/PayrollLoans.js';
import { buildPayrollLoanSettlementBatch, applyPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';

test('default suggestion uses 30% of salary after other adjustments, before loans', () => {
    expect(getPayrollLoanSalaryAmounts({ monto: 600, _loans: 100, _montoBeforeLoans: 700 }, 5000))
        .toMatchObject({ salaryAvailable: 700, available: 700, suggested: 210, remainingSalary: 490, percentage: 30 });
});

test('a remaining net never reduces the salary budget a second time', () => {
    expect(getPayrollLoanSalaryAmounts({ monto: 500, _loans: 300 }, 5000, 50))
        .toMatchObject({ available: 800, suggested: 400, remainingSalary: 400 });
});

test('both options cap payment at collectible debt', () => {
    expect(getPayrollLoanSalaryAmounts({ _montoBeforeLoans: 20000 }, 1000, 30))
        .toMatchObject({ available: 1000, suggested: 1000, remainingSalary: 19000 });
});

test('percentage rounds down to cents without exceeding its budget', () => {
    expect(getPayrollLoanSalaryAmounts({ _montoBeforeLoans: 33.35 }, 5000, 30).suggested).toBe(10);
});

test('a fractional-cent wage cannot become negative when using all the available salary', () => {
    const amounts = getPayrollLoanSalaryAmounts({ _montoBeforeLoans: 800.006 }, 5000, 100);
    expect(amounts.available).toBe(800);
    expect(800.006 - amounts.available).toBeGreaterThanOrEqual(0);
    expect(amounts.remainingSalary).toBe(0.01);
});

test.each([null, {}, { monto: -10 }, { _montoBeforeLoans: 0, monto: 800 }, { monto: Infinity }])('no positive salary cannot produce a deduction: %p', row => {
    expect(getPayrollLoanSalaryAmounts(row, 5000)).toMatchObject({ available: 0, suggested: 0 });
});

test.each(['', 0, -1, 101, 1.5, 'abc', Infinity])('invalid percentage %p cannot produce a deduction', percent => {
    expect(getPayrollLoanSalaryAmounts({ monto: 800 }, 5000, percent)).toMatchObject({ validPercentage: false, suggested: 0 });
});

test.each([30, 100])('%i percent records only the actual payment and leaves the balance for a later payment', percentage => {
    const employee = { id: 'salary-e', number: '001', name: 'Persona de prueba', loans: [] };
    createLoan(employee, { principal: 5000, interestRate: 0, startDate: '2026-03-01',
        installmentMode: 'installments', installmentCount: 5, installmentFrequencyWeeks: 1 });
    const row = { _employeeId: employee.id, _employeeName: employee.name, monto: 800, _montoBeforeLoans: 800 };
    const amount = getPayrollLoanSalaryAmounts(row, 5000, percentage).suggested;
    const selection = setPayrollLoanMode(buildPayrollLoanSelection([employee], '2026-03-15'), employee.id, 'custom', amount);
    const rows = applyPayrollLoanDeductions([row], [employee], selection, '2026-03-15');
    expect(rows[0]).toMatchObject({ monto: 800 - amount, _loans: amount, _invalidLoanNet: false });
    expect(getBalance(employee.loans[0])).toBe(5000);
    const batch = buildPayrollLoanSettlementBatch({ employees: [employee], rows,
        periodStart: '2026-03-01', periodEnd: '2026-03-15', createdAt: 1000 });
    expect(batch.items[0].amount).toBe(amount);
    applyPayrollLoanSettlementBatch([employee], batch, { now: 2000 });
    expect(getBalance(employee.loans[0])).toBe(5000 - amount);
    const nextCharges = getPayrollDeductionOptions(employee.loans[0], '2026-03-31');
    expect(nextCharges[0]).toMatchObject({ installmentSeq: 1, amount: 1000 - amount });
    expect(nextCharges.reduce((sum, charge) => sum + charge.amount, 0)).toBe(5000 - amount);
});
