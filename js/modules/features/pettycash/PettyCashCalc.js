/**
 * PettyCashCalc — helpers PUROS de cálculo de caja chica.
 *
 * Modelo: Proyecto → Periodo de caja → Movimientos.
 * Movimiento: { type: 'gasto' | 'reposicion', amount }.
 *   - reposicion (apertura/fondo/reembolso): entra dinero → SUMA.
 *   - gasto: sale dinero → RESTA.
 *
 * Saldo del periodo = Σ reposiciones − Σ gastos. Puede ser NEGATIVO
 * (modo sin presupuesto): el periodo se gasta en rojo y al cerrar se
 * reembolsa |saldo|.
 *
 * Sin estado, sin I/O — 100% testeable.
 */

const TIPO_GASTO = 'gasto';
const TIPO_REPOSICION = 'reposicion';

/** Redondeo financiero a 2 decimales, absorbiendo el error de punto flotante. */
export function round2(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Parsea el monto de un movimiento de forma segura.
 * Acepta números, strings con comas de miles ("1,500.50"), y trata
 * null/undefined/NaN/"N/A" como 0.
 */
function parseAmount(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value).replace(/,/g, '').trim();
    if (cleaned === '' || cleaned.toUpperCase() === 'N/A') return 0;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0;
}

/** Suma de montos de los movimientos de un tipo dado. */
function sumByType(movimientos, tipo) {
    if (!Array.isArray(movimientos)) return 0;
    const total = movimientos.reduce((acc, m) => {
        if (!m || m.type !== tipo) return acc;
        return acc + parseAmount(m.amount);
    }, 0);
    return round2(total);
}

/** Σ de gastos del periodo (valor positivo). */
export function totalGastos(movimientos) {
    return sumByType(movimientos, TIPO_GASTO);
}

/** Σ de reposiciones (aperturas, fondos, reembolsos) del periodo. */
export function totalReposiciones(movimientos) {
    return sumByType(movimientos, TIPO_REPOSICION);
}

/** Saldo del periodo = Σ reposiciones − Σ gastos. Puede ser negativo. */
export function saldoPeriodo(movimientos) {
    return round2(totalReposiciones(movimientos) - totalGastos(movimientos));
}

/**
 * Desglose del periodo para la UI:
 *   { gastos, reposiciones, saldo, reembolso }
 * reembolso = |saldo| cuando el saldo es negativo (modo sin presupuesto),
 * si no, 0.
 */
export function resumenPeriodo(movimientos) {
    const gastos = totalGastos(movimientos);
    const reposiciones = totalReposiciones(movimientos);
    const saldo = round2(reposiciones - gastos);
    const reembolso = saldo < 0 ? round2(-saldo) : 0;
    return { gastos, reposiciones, saldo, reembolso };
}

/**
 * Saldo del proyecto = Σ saldos de sus periodos.
 * Acepta un arreglo de periodos { movimientos: [...] }.
 */
export function saldoProyecto(periodos) {
    if (!Array.isArray(periodos)) return 0;
    const total = periodos.reduce(
        (acc, p) => acc + saldoPeriodo(p && p.movimientos),
        0
    );
    return round2(total);
}
