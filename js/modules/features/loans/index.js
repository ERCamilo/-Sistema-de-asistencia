/**
 * 💵 Loans feature — public exports.
 *
 * Cuentas-por-Cobrar (accounts receivable) for employee advances/loans.
 *
 * Layout:
 *   LoansService.js     — pure data + math (testable in isolation)
 *   LoansLedger.js      — UI template for the view
 *   LoansController.js  — handlers + migration + window globals
 */

export * from './LoansService.js';
export { LoansLedger } from './LoansLedger.js';
export {
    migrateAllAdvances,
    selectLoansEmployee,
    clearLoansEmployee,
    setLoansSearch,
    toggleAddLoanForm,
    setLoanDraftField,
    submitNewLoan,
    togglePaymentForm,
    setPaymentDraftField,
    submitPayment,
    settleLoanByFullPayment,
    writeOffLoanWithConfirm,
    reopenLoanHandler,
    voidPaymentHandler,
    openLoansEmployeePicker,
    closeLoansEmployeePicker,
    setLoansPickerSearch,
    openProfileForLoan,
    registerLegacyGlobals
} from './LoansController.js';
