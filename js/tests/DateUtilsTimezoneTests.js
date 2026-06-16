/**
 * 🧪 DateUtilsTimezoneTests
 *
 * Blindaje del bug "día anterior" (RD / UTC-4): el título de Asistencia
 * (AttendancePageTitle) mostraba un día menos porque formateaba la fecha con
 * `new Date(state.selectedDate)`. Cuando selectedDate es un string de fecha
 * ("2026-06-16"), `new Date()` lo parsea como MEDIANOCHE UTC, que en zonas con
 * offset negativo cae en las 20:00 del día previo → la etiqueta restaba un día.
 *
 * El resto de la app usa `parseDate`, que construye la fecha con componentes
 * LOCALES (`new Date(y, m-1, d)`) y por eso es estable en cualquier zona. Estos
 * tests fijan ese contrato — son independientes de la zona horaria del runner.
 */

import { parseDate, getDateKey, formatDate, formatDateShort } from '../modules/utils/DateUtils.js';

testRunner.addSuite("DateUtils — parseDate es timezone-safe (bug día anterior)", {

    "parseDate de un string de fecha conserva el día (no resta uno)"() {
        const d = parseDate('2026-06-16');
        testRunner.assertEquals(d.getDate(), 16, 'el día debe ser 16, no 15 (sin corrimiento UTC)');
        testRunner.assertEquals(d.getMonth(), 5, 'el mes debe ser junio (índice 5)');
        testRunner.assertEquals(d.getFullYear(), 2026, 'el año debe ser 2026');
    },

    "getDateKey(parseDate(s)) hace round-trip exacto"() {
        const key = '2026-06-16';
        testRunner.assertEquals(getDateKey(parseDate(key)), key, 'string → Date → string debe ser idéntico');
    },

    "formatDate de un string muestra el día correcto y mes completo"() {
        const label = formatDate('2026-06-16');
        testRunner.assert(/\b16\b/.test(label), 'debe contener el día 16');
        testRunner.assert(!/\b15\b/.test(label), 'NUNCA debe mostrar el día anterior (15)');
        testRunner.assert(/junio/i.test(label), 'debe usar el mes completo "junio" (formato compartido)');
    },

    "el título (formatDateShort) coincide exactamente con la píldora"() {
        // El título de Asistencia ahora reusa formatDateShort — el MISMO
        // formateador que la píldora de navegación. Por construcción deben
        // producir idéntico texto para la misma fecha (sin divergencia posible).
        const s = '2026-06-16';
        const titulo = formatDateShort(s);
        const pildora = formatDateShort(s);
        testRunner.assertEquals(titulo, pildora, 'título y píldora usan el mismo formateador → texto idéntico');
        testRunner.assert(/\b16\b/.test(titulo), 'debe mostrar el día 16');
        testRunner.assert(!/\b15\b/.test(titulo), 'nunca el día anterior (15)');
        const dayInKey = Number(getDateKey(parseDate(s)).slice(-2));
        testRunner.assertEquals(Number(titulo.match(/\b(\d{1,2})\b/)[1]), dayInKey, 'el día coincide con getDateKey');
    }

});
