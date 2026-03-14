// ============================================
// 💡 FORMATTERS
// ============================================

// ⚡ NUEVO: Formatear moneda con 2 decimales, coma para miles y punto para decimal
export function formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '$0.00';

    // Redondear a 2 decimales
    const rounded = Math.round(amount * 100) / 100;

    // Separar parte entera y decimal
    const parts = rounded.toFixed(2).split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1];

    // Agregar comas para miles
    const withCommas = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // Retornar formato completo
    return `$${withCommas}.${decimalPart}`;
}
