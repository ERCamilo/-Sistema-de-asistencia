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
    TOTAL: 'total',
    INSTALLMENTS: 'installments'
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
        installmentCount: draft.installmentCount != null ? Math.max(0, Math.trunc(Number(draft.installmentCount))) : null,
        partialAmount: Math.max(0, Number(draft.partialAmount) || 0)
    };

    if (!isInstallmentLoan(loan)) {
        const balance = getBalance(loan);
        const amount = Math.min(balance, Math.max(0, base.amount));
        return { ...base, amount, mode: PAYMENT_PLAN_MODE.CUSTOM, installmentCount: 0, partialAmount: 0 };
    }

    const charges = getPayrollDeductionOptions(loan);
    const balance = getBalance(loan);

    if (charges.length === 0 || balance <= 0) {
        return { ...base, amount: 0, installmentCount: 0, partialAmount: 0 };
    }

    // 1. Legacy or explicit total mode
    if (draft.mode === PAYMENT_PLAN_MODE.TOTAL) {
        return {
            ...base,
            mode: PAYMENT_PLAN_MODE.TOTAL,
            amount: balance,
            installmentCount: charges.length,
            partialAmount: 0
        };
    }

    // 2. Legacy single mode without custom count/partial
    if (draft.mode === PAYMENT_PLAN_MODE.SINGLE && draft.installmentCount == null && draft.partialAmount == null && draft.amount == null) {
        return {
            ...base,
            mode: PAYMENT_PLAN_MODE.SINGLE,
            amount: Number(charges[0]?.amount || 0),
            installmentCount: 1,
            partialAmount: 0
        };
    }

    // 3. Explicit installmentCount and/or partialAmount
    if (draft.installmentCount != null || draft.partialAmount != null) {
        let count = Math.max(0, Math.min(charges.length, base.installmentCount ?? 1));
        let partial = round2(base.partialAmount);

        // Sum amount of covered full cuotas
        let fullAmount = 0;
        for (let i = 0; i < count; i++) {
            fullAmount = round2(fullAmount + Number(charges[i].amount || 0));
        }

        // If partial amount is >= next cuota amount, absorb it into full cuotas
        while (count < charges.length && partial >= Number(charges[count].amount || 0)) {
            const nextChargeAmt = Number(charges[count].amount || 0);
            fullAmount = round2(fullAmount + nextChargeAmt);
            partial = round2(partial - nextChargeAmt);
            count++;
        }

        // If all cuotas are fully covered, partial remainder is 0
        if (count >= charges.length) {
            partial = 0;
        }

        const totalAmount = round2(fullAmount + partial);
        const resolvedAmount = Math.min(balance, totalAmount);
        const mode = count === charges.length && partial === 0
            ? PAYMENT_PLAN_MODE.TOTAL
            : count > 1
                ? PAYMENT_PLAN_MODE.MULTIPLE
                : count === 1 && partial === 0
                    ? PAYMENT_PLAN_MODE.SINGLE
                    : PAYMENT_PLAN_MODE.CUSTOM;

        return {
            ...base,
            mode,
            installmentCount: count,
            partialAmount: partial,
            amount: resolvedAmount
        };
    }

    // 4. If explicit amount was provided
    if (base.amount > 0) {
        let remaining = Math.min(balance, base.amount);
        let count = 0;
        for (let i = 0; i < charges.length; i++) {
            const chargeAmt = Number(charges[i].amount || 0);
            if (remaining >= chargeAmt) {
                remaining = round2(remaining - chargeAmt);
                count++;
            } else {
                break;
            }
        }
        const partial = count < charges.length ? remaining : 0;
        const mode = count === charges.length && partial === 0
            ? PAYMENT_PLAN_MODE.TOTAL
            : count > 1
                ? PAYMENT_PLAN_MODE.MULTIPLE
                : count === 1 && partial === 0
                    ? PAYMENT_PLAN_MODE.SINGLE
                    : PAYMENT_PLAN_MODE.CUSTOM;

        return {
            ...base,
            mode,
            installmentCount: count,
            partialAmount: partial,
            amount: Math.min(balance, base.amount)
        };
    }

    // Default: 1 cuota selected
    const defaultAmount = Number(charges[0]?.amount || 0);
    return {
        ...base,
        mode: PAYMENT_PLAN_MODE.SINGLE,
        installmentCount: 1,
        partialAmount: 0,
        amount: defaultAmount
    };
}

export function createLoanPaymentDraft(loan, date) {
    return resolveLoanPaymentDraft(loan, {
        amount: 0,
        date,
        note: '',
        mode: isInstallmentLoan(loan) ? PAYMENT_PLAN_MODE.SINGLE : PAYMENT_PLAN_MODE.CUSTOM,
        installmentCount: 1,
        partialAmount: 0
    });
}

export function updateLoanPaymentDraft(loan, draft, field, value) {
    const next = { ...draft };

    if (field === 'amount') {
        next.amount = Number(value) || 0;
        delete next.installmentCount;
        delete next.partialAmount;
    } else if (field === 'installmentCount') {
        next.installmentCount = Math.max(0, Number(value) || 0);
    } else if (field === 'partialAmount') {
        next.partialAmount = Math.max(0, Number(value) || 0);
    } else if (field === 'toggleInstallment') {
        const targetSeq = Number(value);
        const currentCount = Number(draft.installmentCount || 0);
        if (targetSeq <= currentCount) {
            next.installmentCount = targetSeq - 1;
        } else {
            next.installmentCount = targetSeq;
        }
        next.partialAmount = 0;
    } else {
        next[field] = value;
    }

    if (field === 'mode' && value === PAYMENT_PLAN_MODE.MULTIPLE) {
        next.installmentCount = Math.max(2, Number(next.installmentCount) || 2);
    }

    return resolveLoanPaymentDraft(loan, next);
}
