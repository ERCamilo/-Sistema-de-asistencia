/**
 * 🧪 BuildVersionTests — el footer muestra la versión REAL, no un literal.
 *
 * Antes: app.js pintaba la string fija "v1.6.7 · Firebase" — no leía de
 * ningún lado, así que nunca cambiaba por más que se versionara. Ahora:
 *   - la versión semántica sale de APP_CONFIG.VERSION (fuente única, se
 *     sube a mano por release);
 *   - el build sale de BuildInfo.BUILD, que el hook pre-commit estampa con
 *     la MISMA fecha-hora que sw.js CACHE_VERSION en cada commit.
 *
 * formatBuild convierte el crudo YYYY.MMDD.HHMMSS en algo legible y NUNCA
 * explota: input basura → devuelve el crudo tal cual, valid:false.
 */

import fs from 'fs';
import path from 'path';
import { formatBuild } from '../modules/utils/BuildVersion.js';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const HOOK_SRC = (() => {
    try { return read('../../.githooks/pre-commit'); } catch (_) { return ''; }
})();

testRunner.addSuite('BuildVersion — formatBuild', {

    'crudo YYYY.MMDD.HHMMSS → fecha y hora legibles'() {
        const out = formatBuild('2026.0711.091141');
        testRunner.assertEquals(out.valid, true, 'debe reconocer el formato');
        testRunner.assertEquals(out.date, '2026.07.11', 'fecha con puntos');
        testRunner.assertEquals(out.time, '09:11:41', 'hora con dos puntos');
        testRunner.assertEquals(out.display, '2026.07.11 09:11:41', 'display = fecha + hora');
    },

    'conserva la hora completa (no perdemos los segundos)'() {
        const out = formatBuild('2026.1231.235959');
        testRunner.assertEquals(out.time, '23:59:59', 'medianoche menos un segundo');
        testRunner.assertEquals(out.date, '2026.12.31');
    },

    'ofrece fecha DD/MM/AAAA y hora AM/PM para superficies humanas'() {
        const evening = formatBuild('2026.0724.180000');
        testRunner.assertEquals(evening.localDate, '24/07/2026');
        testRunner.assertEquals(evening.time12h, '6:00 PM');
        testRunner.assertEquals(evening.displayLocal, '24/07/2026 · 6:00 PM');

        const midnight = formatBuild('2026.0724.000000');
        testRunner.assertEquals(midnight.time12h, '12:00 AM', 'medianoche debe ser 12 AM');
    },

    'input malformado → devuelve el crudo tal cual, valid:false (nunca NaN)'() {
        const out = formatBuild('cualquier-cosa');
        testRunner.assertEquals(out.valid, false, 'no debe fingir que entendió');
        testRunner.assertEquals(out.display, 'cualquier-cosa', 'muestra el crudo sin romper la UI');
    },

    'vacío/undefined → display vacío y valid:false, sin lanzar'() {
        testRunner.assertEquals(formatBuild('').valid, false);
        testRunner.assertEquals(formatBuild(undefined).display, '', 'undefined no debe reventar');
        testRunner.assertEquals(formatBuild(null).valid, false, 'null tolerado');
    }

});

testRunner.addSuite('BuildVersion — cableado del footer (contrato de fuente)', {

    'el footer ya NO tiene el literal "v1.6.7"'() {
        testRunner.assert(!APP_SRC.includes('v1.6.7 · Firebase'),
            'el literal fijo debe reemplazarse por la versión leída');
    },

    'el footer lee APP_CONFIG.VERSION y el BUILD formateado'() {
        const idx = APP_SRC.indexOf('sidebar-foot-sub');
        testRunner.assert(idx !== -1, 'debe existir el footer');
        const around = APP_SRC.slice(idx - 400, idx + 400);
        testRunner.assert(/APP_CONFIG\.VERSION/.test(around),
            'la versión semántica debe salir de APP_CONFIG.VERSION');
        testRunner.assert(/formatBuild\(/.test(around) || /_buildLabel/.test(around),
            'el build debe salir del formateador, no de un literal');
    },

    'app.js importa BUILD y formatBuild'() {
        testRunner.assert(/from '\.\/modules\/config\/BuildInfo\.js'/.test(APP_SRC),
            'debe importar el BUILD generado');
        testRunner.assert(/from '\.\/modules\/utils\/BuildVersion\.js'/.test(APP_SRC),
            'debe importar el formateador');
    },

    'el hook pre-commit estampa BuildInfo.js con la misma fecha que sw.js'() {
        testRunner.assert(HOOK_SRC.includes('BuildInfo.js'),
            'el hook debe regenerar BuildInfo.js en cada commit');
        testRunner.assert(/NEW_VERSION/.test(HOOK_SRC),
            'debe reusar la MISMA NEW_VERSION que sw.js (una sola fuente de fecha)');
    },

    'el build usa la hora local de Rep. Dominicana (TZ fijo, no UTC)'() {
        // Sin TZ fijo, un commit hecho en un entorno UTC estampaba +4h de más.
        testRunner.assert(/TZ='AST4'\s+date|TZ="AST4"\s+date/.test(HOOK_SRC),
            'NEW_VERSION debe fijar TZ=AST4 (UTC-4, hora de Rep. Dominicana) al llamar date');
    }

});
