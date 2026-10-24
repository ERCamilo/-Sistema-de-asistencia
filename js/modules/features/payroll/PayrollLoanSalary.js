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
    const validPercentage = Number.isInteger(percent) && percent >= 1 && percent <= 100;
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
