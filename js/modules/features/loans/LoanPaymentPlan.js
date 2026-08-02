import {
    getBalance,
    getPayrollDeductionOptions,
    INSTALLMENT_MODE,
    round2
} from './LoansService.js';

export const PAYMENT_PLAN_MODE = Object.freeze({
    CUSTOM: 'custom',
    SINGLE: 'single',
    MULTIPLE: 'multiple',
    TOTAL: 'total'
});

function isInstallmentLoan(loan) {
    return loan?.installmentMode === INSTALLMENT_MODE.INSTALLMENTS;
}

export function getInstallmentPaymentChoices(loan) {
    if (!isInstallmentLoan(loan)) return [];

    const charges = getPayrollDeductionOptions(loan);
    const firstCharge = charges[0] || null;
    let amount = 0;
    return charges.map((charge, index) => {
        amount = round2(amount + Number(charge.amount || 0));
        return {
            count: index + 1,
            amount,
            firstCharge,
            lastCharge: charge
        };
    });
}

export function resolveLoanPaymentDraft(loan, draft = {}) {
    const base = {
        amount: Number(draft.amount) || 0,
        date: draft.date || '',
        note: draft.note || '',
        mode: draft.mode || PAYMENT_PLAN_MODE.CUSTOM,
        installmentCount: Math.max(1, Math.trunc(Number(draft.installmentCount) || 1))
    };

    if (!isInstallmentLoan(loan)) {
        return { ...base, mode: PAYMENT_PLAN_MODE.CUSTOM, installmentCount: 1 };
    }

    const choices = getInstallmentPaymentChoices(loan);
    if (choices.length === 0) return { ...base, amount: 0, installmentCount: 0 };

    if (base.mode === PAYMENT_PLAN_MODE.TOTAL) {
        return {
            ...base,
            amount: getBalance(loan),
            installmentCount: choices.length
        };
    }

    if (base.mode === PAYMENT_PLAN_MODE.MULTIPLE && choices.length > 1) {
        const count = Math.max(2, Math.min(choices.length, base.installmentCount));
        return {
            ...base,
            amount: choices[count - 1].amount,
            installmentCount: count
        };
    }

    return {
        ...base,
        mode: PAYMENT_PLAN_MODE.SINGLE,
        amount: choices[0].amount,
        installmentCount: 1
    };
}

export function createLoanPaymentDraft(loan, date) {
    return resolveLoanPaymentDraft(loan, {
        amount: 0,
        date,
        note: '',
        mode: isInstallmentLoan(loan) ? PAYMENT_PLAN_MODE.SINGLE : PAYMENT_PLAN_MODE.CUSTOM,
        installmentCount: 1
    });
}

export function updateLoanPaymentDraft(loan, draft, field, value) {
    const next = { ...draft };

    if (field === 'amount') next.amount = Number(value) || 0;
    else if (field === 'installmentCount') next.installmentCount = Number(value) || 1;
    else next[field] = value;

    if (field === 'mode' && value === PAYMENT_PLAN_MODE.MULTIPLE) {
        next.installmentCount = Math.max(2, Number(next.installmentCount) || 2);
    }

    return resolveLoanPaymentDraft(loan, next);
}
