/** Shared read-only rules for financial views. Provenance is not payment channel. */
export const isFinancialLoan = loan => Boolean(loan) && loan.status !== 'written-off';

export function isPayrollLoanPayment(payment) {
    return Boolean(payment && (payment.origin === 'payroll' || payment.source === 'payroll'
        || payment.channel === 'payroll' || payment.payrollClosureId));
}

export const loanPaymentChannel = payment => isPayrollLoanPayment(payment) ? 'payroll' : 'direct';
