import { getEligiblePayrollLoans, PAYROLL_LOAN_MODE } from './PayrollLoans.js';

export const DEFAULT_PAYROLL_LOAN_PERCENTAGE = 30;

function cents(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.max(0, Math.round((amount + Number.EPSILON) * 100)) : 0;
}

/** Salary after bonuses/deductions, before loans. Never take the percentage of the remaining net twice. */
export function getPayrollLoanSalaryAmounts(row, collectibleDebt, percentage = DEFAULT_PAYROLL_LOAN_PERCENTAGE) {
    const rawSalary = Number(row?._montoBeforeLoans ?? ((Number(row?.monto) || 0) + (Number(row?._loans) || 0)));
    const salaryAvailable = Number.isFinite(rawSalary) ? Math.max(0, rawSalary) : 0;
    let salary = cents(salaryAvailable);
    // A fractional-cent wage must not let the full-salary shortcut overdraw the net.
    if (salary / 100 > salaryAvailable + 1e-9) salary -= 1;
    const debt = cents(collectibleDebt);
    const percent = Number(percentage);
    const validPercentage = String(percentage).trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
    const available = Math.min(salary, debt);
    // Round down to cents so the chosen percentage is a maximum, including fractional cents.
    const suggested = validPercentage ? Math.min(debt, Math.floor(salary * percent / 100)) : 0;
    return {
        salaryAvailable,
        available: available / 100,
        suggested: suggested / 100,
        remainingSalary: Math.round((salaryAvailable - suggested / 100 + Number.EPSILON) * 100) / 100,
        percentage: percent,
        validPercentage
    };
}

export function getPayrollLoanEquivalentPercentage(amount, salary) {
    if (!(Number(salary) > 0)) return null;
    return Math.max(0, Number(amount) || 0) / Number(salary) * 100;
}

/** Replace the target employees' temporary choices in one pass; never record payments.
 * Include every selectable charge so «maximum» can cover more than the next installment.
 */
export function buildPayrollLoanSalarySelection(employees, payrollRows, periodEnd, kind) {
    if (!['available', 'recommended'].includes(kind)) return [];
    const rows = new Map((payrollRows || []).map(row => [String(row._employeeId), row]));
    return (employees || []).flatMap(employee => {
        const row = rows.get(String(employee.id));
        if (!row) return [];
        const eligible = getEligiblePayrollLoans(employee, periodEnd);
        const debt = eligible.reduce((total, loan) => total + loan.chargeOptions.reduce((sum, charge) => sum + charge.amount, 0), 0);
        const salary = getPayrollLoanSalaryAmounts(row, debt);
        const amount = kind === 'available' ? salary.available : salary.suggested;
        if (amount <= 0) return [];
        const loans = eligible.map(loan => ({ loanId: loan.loanId, chargeCount: loan.maxChargeCount }));
        return [{ employeeId: employee.id, loans, loanIds: loans.map(loan => loan.loanId), mode: PAYROLL_LOAN_MODE.CUSTOM, amount }];
    });
}
