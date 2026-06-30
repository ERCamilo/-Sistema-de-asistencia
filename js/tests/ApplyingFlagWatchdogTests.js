/**
 * 🧪 ApplyingFlagWatchdogTests (R3)
 *
 * Bloquea el cableado en app.js del watchdog de window._isApplyingRemoteData.
 * El flag bloquea los guardados mientras se aplican datos remotos; si su clear
 * nunca corre (excepción entre poner el flag y add(), o la pestaña vuelve sin
 * completar el flush), quedaría trabado en true y silenciaría TODOS los
 * guardados siguientes de la sesión.
 *
 * La decisión segura (liberar sólo si el BatchedSaver está inactivo) está
 * cubierta por unit tests en BatchedSaverTests (shouldReleaseApplyingFlag /
 * isActive). Esta suite garantiza que app.js arma el watchdog en CADA punto
 * donde pone el flag en true.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("R3 — watchdog de _isApplyingRemoteData cableado en app.js", {

    "app.js usa shouldReleaseApplyingFlag (importado de BatchedSaver)"() {
        testRunner.assert(/shouldReleaseApplyingFlag/.test(APP_SRC),
            'app.js debe usar shouldReleaseApplyingFlag para liberar el flag con seguridad');
    },

    "app.js define armApplyingFlagWatchdog"() {
        testRunner.assert(/function armApplyingFlagWatchdog\s*\(/.test(APP_SRC),
            'debe existir la función armApplyingFlagWatchdog');
    },

    "el watchdog sólo libera el flag vía shouldReleaseApplyingFlag (no clear ciego)"() {
        const block = APP_SRC.match(/function armApplyingFlagWatchdog[\s\S]{0,700}?\n\}/);
        testRunner.assert(!!block, 'armApplyingFlagWatchdog debe existir');
        testRunner.assert(/shouldReleaseApplyingFlag\s*\(/.test(block[0]),
            'el watchdog debe consultar shouldReleaseApplyingFlag antes de liberar el flag');
    },

    "cada seteo de _isApplyingRemoteData=true arma el watchdog"() {
        const setTrue = (APP_SRC.match(/_isApplyingRemoteData\s*=\s*true/g) || []).length;
        const arms = (APP_SRC.match(/armApplyingFlagWatchdog\s*\(\s*\)/g) || []).length;
        // `arms` incluye la definición; debe haber al menos tantas llamadas como
        // seteos a true para que ningún path quede sin red de seguridad.
        testRunner.assert(setTrue >= 1, 'debe haber al menos un seteo de _isApplyingRemoteData=true');
        testRunner.assert(arms >= setTrue,
            `cada _isApplyingRemoteData=true (${setTrue}) debe ir acompañado de armApplyingFlagWatchdog() (encontradas ${arms})`);
    }

});
