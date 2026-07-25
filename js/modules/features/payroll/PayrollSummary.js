function adjustmentAmountForRow(adjustment, row) {
    if (!adjustment || !row) return 0;
    if (adjustment.employeeId && String(adjustment.employeeId) !== String(row._employeeId)) {
        return 0;
    }

    const value = Number(adjustment.value) || 0;
    if (adjustment.type === 'percentage') {
        return ((Number(row._brutoOriginal) || 0) * value) / 100;
    }
    return value;
}

export function summarizeAdjustmentDetails(adjustments = [], rows = [], fallbackLabel = 'Ajuste') {
    const normalizedAdjustments = Array.isArray(adjustments) ? adjustments : [];
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const globals = normalizedAdjustments
        .map((adjustment, index) => ({ adjustment, index }))
        .filter(({ adjustment }) => !adjustment?.employeeId)
        .map(({ adjustment, index }) => ({
            key: adjustment.id || `global-${index}`,
            label: adjustment.name || `${fallbackLabel} ${index + 1}`,
            type: adjustment.type === 'percentage' ? 'percentage' : 'fixed',
            value: Number(adjustment.value) || 0,
            amount: normalizedRows.reduce(
                (total, row) => total + adjustmentAmountForRow(adjustment, row),
                0
            )
        }));

    const individualAdjustments = normalizedAdjustments.filter(adjustment => adjustment?.employeeId);
    const individualAmount = individualAdjustments.reduce(
        (total, adjustment) => total + normalizedRows.reduce(
            (rowTotal, row) => rowTotal + adjustmentAmountForRow(adjustment, row),
            0
        ),
        0
    );
    const globalAmount = globals.reduce((total, item) => total + item.amount, 0);

    return {
        globals,
        individualCount: individualAdjustments.length,
        individualAmount,
        totalAmount: globalAmount + individualAmount
    };
}
