/**
 * 🧪 SaveOutcomeNotifierTests
 *
 * El toast de "guardado exitosamente" mentía: aparecía al hacer el cambio, NO
 * cuando algo se guardaba de verdad. Este módulo lo vuelve honesto:
 *
 *   - VERDE   "guardado en este equipo y en la nube"  → local OK + nube OK
 *   - VERDE   "guardado en este equipo"                → local OK + sin nube (no logueado/offline por diseño)
 *   - AMARILLO "guardado solo en este equipo"          → local OK + nube FALLÓ
 *   - ROJO    "no se pudo guardar"                      → local FALLÓ (no se guardó en ningún lado)
 *
 * `decideSaveOutcome` es PURA (núcleo testeable). `createSaveOutcomeNotifier`
 * es la máquina de estados que espera el resultado de la nube (que llega ~2s
 * después por el debounce del mirror) y emite UN solo toast por guardado.
 */

import {
    decideSaveOutcome,
    createSaveOutcomeNotifier
} from '../modules/services/SaveOutcomeNotifier.js';

// ─── Núcleo puro ──────────────────────────────────────────────────────────────

testRunner.addSuite("decideSaveOutcome — los 4 estados (puro)", {

    "local OK + nube OK → verde, menciona nube"() {
        const r = decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk: true });
        testRunner.assertEquals(r.level, 'success', 'debe ser success/verde');
        testRunner.assert(/nube/i.test(r.message), 'el mensaje debe mencionar la nube');
    },

    "local OK + nube FALLÓ → amarillo, dice que NO se guardó en la nube"() {
        const r = decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk: false });
        testRunner.assertEquals(r.level, 'warning', 'debe ser warning/amarillo');
        testRunner.assert(/nube/i.test(r.message), 'debe mencionar la nube');
        testRunner.assert(/equipo|local/i.test(r.message), 'debe aclarar que sí se guardó local');
    },

    "local OK + sin nube (no conectado) → verde, sin prometer nube"() {
        const r = decideSaveOutcome({ localOk: true, cloudConnected: false, cloudOk: null });
        testRunner.assertEquals(r.level, 'success', 'verde');
        testRunner.assert(!/en la nube/i.test(r.message), 'NO debe prometer la nube si no hay cuenta conectada');
    },

    "local FALLÓ → rojo (no se guardó en ningún lado)"() {
        const r = decideSaveOutcome({ localOk: false, cloudConnected: true, cloudOk: true });
        testRunner.assertEquals(r.level, 'error', 'debe ser error/rojo');
        const r2 = decideSaveOutcome({ localOk: false, cloudConnected: false, cloudOk: null });
        testRunner.assertEquals(r2.level, 'error', 'local fallido siempre es rojo, conectado o no');
    },

    "label opcional: conserva el nombre de la acción en el mensaje"() {
        const r = decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk: true, label: 'Adelanto guardado' });
        testRunner.assert(/Adelanto guardado/.test(r.message), 'el mensaje debe incluir la etiqueta');
        testRunner.assert(/nube/i.test(r.message), 'y seguir indicando la nube');
        const y = decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk: false, label: 'Configuración guardada' });
        testRunner.assertEquals(y.level, 'warning', 'amarillo con label');
        testRunner.assert(/Configuración guardada/.test(y.message), 'la etiqueta se conserva en amarillo');
    }

});

// ─── Máquina de estados (con reloj manual) ───────────────────────────────────

function makeHarness({ cloudTimeoutMs = 6000 } = {}) {
    const calls = [];
    let timer = null;
    const setTimer = (fn) => { timer = fn; return 'T'; };
    const clearTimer = () => { timer = null; };
    const fireTimer = () => { const t = timer; timer = null; if (t) t(); };
    const notifier = createSaveOutcomeNotifier({
        notify: (o) => calls.push(o),
        setTimer, clearTimer, cloudTimeoutMs
    });
    return { calls, notifier, fireTimer, hasTimer: () => timer !== null };
}

testRunner.addSuite("SaveOutcomeNotifier — flujo local + nube", {

    "local OK + sin nube esperada → toast verde inmediato"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: false });
        testRunner.assertEquals(h.calls.length, 1, 'un toast');
        testRunner.assertEquals(h.calls[0].level, 'success', 'verde');
        testRunner.assert(!h.hasTimer(), 'no debe quedar esperando la nube');
    },

    "local OK + nube esperada: NO toast hasta que la nube confirme"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 0, 'todavía no se muestra nada (espera la nube)');
        testRunner.assert(h.hasTimer(), 'debe haber un timeout armado');
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls.length, 1, 'un toast al confirmar la nube');
        testRunner.assertEquals(h.calls[0].level, 'success', 'verde local+nube');
        testRunner.assert(/nube/i.test(h.calls[0].message), 'menciona la nube');
    },

    "local OK + nube FALLA → amarillo"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);
        testRunner.assertEquals(h.calls.length, 1, 'un toast');
        testRunner.assertEquals(h.calls[0].level, 'warning', 'amarillo');
    },

    "local OK + nube nunca responde (timeout) → amarillo"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 0, 'aún esperando');
        h.fireTimer(); // se vence el timeout sin respuesta de la nube
        testRunner.assertEquals(h.calls.length, 1, 'el timeout muestra el toast');
        testRunner.assertEquals(h.calls[0].level, 'warning', 'amarillo: no se pudo confirmar la nube');
    },

    "local FALLA → rojo inmediato, sin esperar nube"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: false, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 1, 'rojo inmediato');
        testRunner.assertEquals(h.calls[0].level, 'error', 'rojo');
        testRunner.assert(!h.hasTimer(), 'no espera la nube si ni siquiera se guardó local');
    },

    "varios cambios seguidos → UN solo toast cuando la nube confirma"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 0, 'colapsa: nada hasta confirmar');
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls.length, 1, 'un único toast para la ráfaga');
    },

    "resultado de nube sin guardado pendiente → se ignora (no spamea)"() {
        const h = makeHarness();
        h.notifier.recordCloudResult(true); // eco de sync entrante, sin save propio
        testRunner.assertEquals(h.calls.length, 0, 'no debe aparecer toast por un sync no solicitado');
    }

});
