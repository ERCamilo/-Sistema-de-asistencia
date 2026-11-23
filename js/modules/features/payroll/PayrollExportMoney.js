/** Cent projection matching the existing SA currency display; never changes payroll. */
export function payrollExportMoney(value) {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new Error('La exportación contiene un importe no válido.');
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents)) throw new Error('El importe supera la precisión monetaria admitida por SplitX.');
    return cents === 0 ? 0 : cents / 100;
}

export function payrollCashTotal(rows) {
    return payrollExportMoney(rows.reduce((total, row) => total + payrollExportMoney(row.monto), 0));
}
