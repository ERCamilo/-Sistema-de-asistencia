/**
 * 💱 SalaryConversion — Conversión pura entre salario por hora y por día.
 *
 * La app guarda SIEMPRE el valor por hora (hourlyRate). Estas funciones permiten
 * que el usuario cargue el dato como "por día" y se convierta a por-hora antes de
 * guardar, y mostrar el equivalente en la otra unidad. Son funciones puras: reciben
 * las horas/día explícitas (normalmente state.settings.regularHoursPerDay) — no leen
 * estado global, para ser fáciles de testear y reusar en cualquier modal.
 *
 * Precisión: NO se redondea el valor por hora resultante; se guarda en alta
 * resolución para que la ida-y-vuelta (día → hora → día) sea exacta aunque las
 * horas/día no dividan en redondo (ej. $700/día ÷ 7h = $100/h exacto; $100/día ÷ 3h
 * = $33.333…/h que al multiplicar por 3 vuelve a $100). El redondeo es solo para mostrar.
 */

export const SALARY_MODE = Object.freeze({ HOURLY: 'hourly', DAILY: 'daily' });

/** Normaliza un valor de horas/día a un número > 0; cae a 8 si es inválido. */
function safeHours(hoursPerDay) {
    const h = Number(hoursPerDay);
    return Number.isFinite(h) && h > 0 ? h : 8;
}

/** Convierte un monto por día a por hora. */
export function dailyToHourly(dailyAmount, hoursPerDay) {
    const amount = Number(dailyAmount);
    if (!Number.isFinite(amount)) return 0;
    return amount / safeHours(hoursPerDay);
}

/** Convierte un monto por hora a por día. */
export function hourlyToDaily(hourlyAmount, hoursPerDay) {
    const amount = Number(hourlyAmount);
    if (!Number.isFinite(amount)) return 0;
    return amount * safeHours(hoursPerDay);
}

/**
 * Toma lo que el usuario ingresó + el modo elegido y devuelve SIEMPRE el valor por
 * hora a guardar. En modo 'hourly' es passthrough (como hasta ahora); en 'daily'
 * convierte. Este es el único punto que decide qué se persiste.
 */
export function toStoredHourly(inputAmount, mode, hoursPerDay) {
    return mode === SALARY_MODE.DAILY
        ? dailyToHourly(inputAmount, hoursPerDay)
        : (Number.isFinite(Number(inputAmount)) ? Number(inputAmount) : 0);
}

/**
 * Dado el valor por hora guardado + el modo en que se cargó, devuelve el valor a
 * MOSTRAR en el input al reabrir (fidelidad de edición). En 'daily' reconstruye el
 * monto diario; en 'hourly' devuelve el por-hora tal cual.
 */
export function fromStoredHourly(hourlyAmount, mode, hoursPerDay) {
    return mode === SALARY_MODE.DAILY
        ? hourlyToDaily(hourlyAmount, hoursPerDay)
        : (Number.isFinite(Number(hourlyAmount)) ? Number(hourlyAmount) : 0);
}
