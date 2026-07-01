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

    "el path mirror (applyRemoteData) NO arma el watchdog"() {
        // JD#1: el mirror NO usa el BatchedSaver, así que saver.isActive sería
        // false durante un apply legítimo (lecturas de migración >4s en conexión
        // lenta) y el watchdog liberaría el flag a mitad de camino → loop/
        // sobrescritura. El mirror se libera solo vía su propio setTimeout.
        const mirror = APP_SRC.match(/_isApplyingRemoteData\s*=\s*true;[\s\S]{0,600}?_pendingRemoteSave\s*=\s*true/);
        testRunner.assert(!!mirror, 'debe existir el set-true del path mirror seguido de _pendingRemoteSave');
        testRunner.assert(!/armApplyingFlagWatchdog/.test(mirror[0]),
            'el path mirror NO debe armar el watchdog (lo liberaría a mitad de un apply lento)');
    },

    "applyRemoteData libera el flag en su catch si el apply tira (JD2#3)"() {
        // Al quitar el watchdog del mirror (JD#1), si applyRemoteData rechaza antes
        // de su setTimeout de clear, el flag quedaría trabado. El catch lo libera.
        testRunner.assert(/applyRemoteData falló[\s\S]{0,450}?_isApplyingRemoteData\s*=\s*false/.test(APP_SRC),
            'applyRemoteData debe liberar _isApplyingRemoteData en su catch (JD2#3)');
    },

    "el catch de applyRemoteData cancela el apply-timer (no guarda estado parcial) (JD3-A)"() {
        // El setTimeout post-apply (persist + validate + save) está dentro del try.
        // Si algo tira DESPUÉS de encolarlo, el callback correría sobre estado
        // parcial. El catch debe clearTimeout ese timer.
        const block = APP_SRC.match(/applyRemoteData falló[\s\S]{0,1400}/);
        testRunner.assert(!!block, 'debe existir el catch de applyRemoteData');
        testRunner.assert(/clearTimeout/.test(block[0]),
            'el catch debe clearTimeout el apply-timer para no correr validate+save sobre estado parcial (JD3-A)');
    },

    "el catch de applyRemoteData restaura el loader en carga inicial (JD3-B)"() {
        // Si applyRemoteData tira durante la carga inicial, el catch debe ocultar el
        // loader y renderizar; si no, el spinner queda hasta el loaderTimeout (6s).
        const block = APP_SRC.match(/applyRemoteData falló[\s\S]{0,1400}/);
        testRunner.assert(!!block, 'debe existir el catch de applyRemoteData');
        testRunner.assert(/isInitialLoad[\s\S]{0,140}?hideLoader/.test(block[0]),
            'el catch debe restaurar el loader (hideLoader) si isInitialLoad (JD3-B)');
    },

    "el bloque de restauración del loader tiene su propio try/catch (JD4)"() {
        // El bloque JD3-B corre DENTRO del catch de applyRemoteData, cuyo call site
        // (Firebase onSnapshot, ~L6716) no tiene try/catch envolvente. Si render()
        // tirara sobre estado parcial, escalaría a un unhandled rejection sin este
        // guard adicional (confirmado por ambos jueces en la ronda 4).
        const block = APP_SRC.match(/applyRemoteData falló[\s\S]{0,1400}/);
        testRunner.assert(!!block, 'debe existir el catch de applyRemoteData');
        testRunner.assert(/isInitialLoad[\s\S]{0,60}?try\s*\{[\s\S]{0,220}?render\(\)[\s\S]{0,220}?catch/.test(block[0]),
            'el bloque hideLoader/render dentro del catch debe tener su propio try/catch (JD4)');
    },

    "el clear de cero-registros usa isActive, no hasScheduledFlush (JD2#1)"() {
        // hasScheduledFlush sólo mira _idleHandle; isActive además cubre _isFlushing
        // (flush en vuelo). Limpiar el flag con un flush en vuelo reabre el riesgo
        // de loop/sobrescritura que isActive fue creado para cerrar.
        testRunner.assert(!/_attendanceBatchedSaver\.hasScheduledFlush/.test(APP_SRC),
            'app.js no debe usar _attendanceBatchedSaver.hasScheduledFlush para liberar el flag (ignora _isFlushing) — usar isActive');
    },

    "los paths zonales (que usan el BatchedSaver) SÍ arman el watchdog"() {
        // Conteo PRECISO de call-sites: `armApplyingFlagWatchdog();` con `;`
        // excluye la definición `function armApplyingFlagWatchdog() {` y el alias
        // `window.armApplyingFlagWatchdog = armApplyingFlagWatchdog;`.
        const calls = (APP_SRC.match(/armApplyingFlagWatchdog\s*\(\s*\)\s*;/g) || []).length;
        testRunner.assertEquals(calls, 2,
            'el watchdog debe armarse exactamente en los 2 paths zonales (onInitialLoad + onModified), no en el mirror');
    }

});
