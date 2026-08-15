const PREVIEW_CATEGORIES = ['bonuses', 'deductions', 'loans'];

export function getPayrollPreviewInclusion(inclusion = {}) {
    return PREVIEW_CATEGORIES.reduce((result, category) => ({
        ...result,
        [category]: inclusion[category] !== false
    }), {});
}

function amount(value) {
    return Number(value) || 0;
}

function money(value) {
    return Math.round((amount(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Produces a payment preview without changing the configured adjustments or
 * temporary loan selection. The source rows remain the canonical configured
 * calculation; this projection is only for review, export and closure.
 */
export function applyPayrollPreviewInclusion(rows = [], inclusion = {}) {
    const effectiveInclusion = getPayrollPreviewInclusion(inclusion);
    return rows.map(row => {
        const sourceBonuses = amount(row._bonuses);
        const sourceDeductions = amount(row._deductions);
        const sourceLoans = amount(row._loans);
        const amountBeforeLoans = amount(row._montoBeforeLoans ?? row.monto + sourceLoans);
        const amountBeforeCategories = amountBeforeLoans - sourceBonuses + sourceDeductions;
        const bonuses = effectiveInclusion.bonuses ? sourceBonuses : 0;
        const deductions = effectiveInclusion.deductions ? sourceDeductions : 0;
        const loans = effectiveInclusion.loans ? sourceLoans : 0;
        const net = amountBeforeCategories + bonuses - deductions - loans;

        return {
            ...row,
            monto: net,
            _montoBeforeLoans: amountBeforeCategories + bonuses - deductions,
            _bonuses: bonuses,
            _deductions: deductions,
            _loans: loans,
            _bonusDetails: effectiveInclusion.bonuses ? [...(row._bonusDetails || [])] : [],
            _deductionDetails: effectiveInclusion.deductions ? [...(row._deductionDetails || [])] : [],
            _loanDetails: effectiveInclusion.loans ? [...(row._loanDetails || [])] : [],
            _invalidLoanNet: effectiveInclusion.loans && loans > 0 && money(net) < 0
        };
    });
}

export function getPayrollPreviewCategoryCounts(configuredCounts = {}, inclusion = {}) {
    const effectiveInclusion = getPayrollPreviewInclusion(inclusion);
    return PREVIEW_CATEGORIES.reduce((result, category) => {
        const total = Math.max(0, Math.trunc(Number(configuredCounts[category]) || 0));
        return {
            ...result,
            [category]: { active: effectiveInclusion[category] ? total : 0, total }
        };
    }, {});
}

export function filterPayablePayrollPreviewRows(rows = []) {
    return rows.filter(row =>
        amount(row.monto) > 0.001
        || amount(row._loans) > 0
        || (row._bonusDetails || []).length > 0
        || (row._deductionDetails || []).length > 0
    );
}
