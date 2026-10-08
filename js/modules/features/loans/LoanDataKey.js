/**
 * 🔑 LoanDataKey — clave exacta y barata de los datos que pintan Préstamos.
 *
 * La cartera (modelo, totales, contadores) se recalculaba en CADA render:
 * cada tecla del buscador rehacía saldos, línea de tiempo y flujos de todos los
 * préstamos (≈1.3 s por tecla con 900 préstamos en un teléfono). Con esta clave
 * los cálculos se reutilizan mientras los datos no cambien.
 *
 * - Exacta: serializa el empleado completo (con sus préstamos, abonos y
 *   refinanciamientos), así que cualquier edición la cambia aunque el código
 *   que la hizo no actualice `updatedAt`.
 * - Barata: lee el objeto crudo (`_rawTarget`) en lugar de atravesar el proxy
 *   reactivo de AppState, cuyo `get` era el mayor costo de la pantalla.
 */

const rawOf = value => (value && value._isProxy ? value._rawTarget : value);

/** @param {Array<object>} employees empleados (proxies de state o copias planas) */
export function loanDataKey(employees = []) {
    const list = rawOf(employees) || [];
    let key = String(list.length);
    for (let i = 0; i < list.length; i++) key += '\u0001' + JSON.stringify(rawOf(list[i]));
    return key;
}

/**
 * Memo de un solo valor: devuelve el último resultado mientras la clave no cambie.
 * @template T
 * @param {(key: string, ...args: any[]) => T} compute
 */
export function memoByKey(compute) {
    let last = { key: null, value: undefined };
    const memo = (key, ...args) => {
        if (last.key !== key) last = { key, value: compute(key, ...args) };
        return last.value;
    };
    memo.clear = () => { last = { key: null, value: undefined }; };
    return memo;
}
