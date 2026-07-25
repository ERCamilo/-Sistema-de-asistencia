/**
 * 🏷️ BuildVersion.js — formatea el id de build para mostrarlo al humano.
 *
 * El build crudo es el mismo valor que sw.js CACHE_VERSION: `YYYY.MMDD.HHMMSS`
 * (ej. `2026.0711.091141`). Ese formato es feo a propósito — garantiza
 * unicidad y orden creciente para el cache-buster del Service Worker. Para la
 * UI lo convertimos en `2026.07.11 09:11:41`.
 *
 * Puro y a prueba de basura: si el crudo no matchea el formato esperado,
 * devuelve el crudo tal cual con valid:false — la UI nunca muestra "NaN".
 */

const BUILD_RE = /^(\d{4})\.(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/;

/**
 * @param {string} raw build crudo `YYYY.MMDD.HHMMSS`
 * @returns {{
 *   valid: boolean,
 *   date: string,
 *   time: string,
 *   display: string,
 *   localDate: string,
 *   time12h: string,
 *   displayLocal: string
 * }}
 */
export function formatBuild(raw) {
    const s = (raw == null) ? '' : String(raw);
    const m = BUILD_RE.exec(s);
    if (!m) {
        return {
            valid: false,
            date: '',
            time: '',
            display: s,
            localDate: '',
            time12h: '',
            displayLocal: s
        };
    }
    const [, year, month, day, hh, mm, ss] = m;
    const date = `${year}.${month}.${day}`;
    const time = `${hh}:${mm}:${ss}`;
    const localDate = `${day}/${month}/${year}`;
    const hour24 = Number(hh);
    const hour12 = hour24 % 12 || 12;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const time12h = `${hour12}:${mm} ${period}`;
    return {
        valid: true,
        date,
        time,
        display: `${date} ${time}`,
        localDate,
        time12h,
        displayLocal: `${localDate} · ${time12h}`
    };
}

export default formatBuild;
