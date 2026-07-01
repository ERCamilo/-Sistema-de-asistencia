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
    // Judgment Day #4: el fix separa el timer del retry del timer del guardado
    // ordinario, así que el mock necesita soportar VARIOS timers concurrentes
    // (con handles propios) en vez de una sola variable compartida. Sigue
    // siendo compatible con los tests viejos: como esos flujos SIEMPRE tenían
    // como máximo un timer activo a la vez, fireTimer() sin argumento (el
    // último armado) se comporta igual que antes.
    let nextHandle = 0;
    const timers = new Map();
    let setTimerCalls = 0;
    const setTimer = (fn) => { setTimerCalls++; const h = ++nextHandle; timers.set(h, fn); return h; };
    const clearTimer = (h) => { timers.delete(h); };
    const fireTimer = (handle) => {
        const h = (handle !== undefined) ? handle : [...timers.keys()].pop();
        if (h === undefined) return;
        const fn = timers.get(h);
        timers.delete(h);
        if (fn) fn();
    };
    const notifier = createSaveOutcomeNotifier({
        notify: (o) => calls.push(o),
        setTimer, clearTimer, cloudTimeoutMs
    });
    return {
        calls, notifier, fireTimer,
        hasTimer: () => timers.size > 0,
        timerCount: () => timers.size,
        setTimerCallCount: () => setTimerCalls
    };
}

testRunner.addSuite("SaveOutcomeNotifier — feedback en DOS FASES (inmediato + nube)", {

    "local OK + sin nube esperada → toast verde FINAL inmediato"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: false });
        testRunner.assertEquals(h.calls.length, 1, 'un toast');
        testRunner.assertEquals(h.calls[0].level, 'success', 'verde');
        testRunner.assertEquals(h.calls[0].kind, 'final', 'final: no hay nube que esperar');
        testRunner.assert(!h.hasTimer(), 'no debe quedar esperando la nube');
    },

    "local OK + nube esperada → toast PROVISIONAL INMEDIATO (no se espera a la nube)"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Gasto guardado' });
        testRunner.assertEquals(h.calls.length, 1, 'feedback inmediato: el usuario no espera');
        testRunner.assertEquals(h.calls[0].level, 'success', 'verde (lo local SÍ se guardó)');
        testRunner.assertEquals(h.calls[0].kind, 'provisional', 'provisional: la nube viene en camino');
        testRunner.assert(/nube/i.test(h.calls[0].message), 'indica que está subiendo a la nube');
        testRunner.assert(h.hasTimer(), 'timeout de respaldo armado');
    },

    "cuando la nube confirma → CONFIRM actualiza el toast a verde definitivo"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Gasto guardado' });
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls.length, 2, 'provisional + confirmación');
        testRunner.assertEquals(h.calls[1].kind, 'confirm', 'segunda fase: confirmación');
        testRunner.assertEquals(h.calls[1].level, 'success', 'verde definitivo');
        testRunner.assert(/nube/i.test(h.calls[1].message), 'el mensaje final menciona la nube');
        testRunner.assert(!h.hasTimer(), 'timeout cancelado');
    },

    "nube FALLA → el provisional se vuelve AMARILLO"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);
        testRunner.assertEquals(h.calls.length, 2, 'provisional + fallo');
        testRunner.assertEquals(h.calls[1].level, 'warning', 'amarillo');
        testRunner.assertEquals(h.calls[1].kind, 'final', 'el amarillo es definitivo');
    },

    "nube nunca responde (timeout) → amarillo"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 1, 'provisional inmediato');
        h.fireTimer(); // se vence el timeout sin respuesta de la nube
        testRunner.assertEquals(h.calls.length, 2, 'el timeout resuelve');
        testRunner.assertEquals(h.calls[1].level, 'warning', 'amarillo: no se pudo confirmar la nube');
    },

    "local FALLA → rojo inmediato, sin esperar nube"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: false, cloudExpected: true });
        testRunner.assertEquals(h.calls.length, 1, 'rojo inmediato');
        testRunner.assertEquals(h.calls[0].level, 'error', 'rojo');
        testRunner.assert(!h.hasTimer(), 'no espera la nube si ni siquiera se guardó local');
    },

    "ráfaga: CADA acción da feedback inmediato; UNA confirmación al final"() {
        const h = makeHarness();
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'A' });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'B' });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'C' });
        testRunner.assertEquals(h.calls.length, 3, 'un provisional por acción (feedback no se pierde)');
        testRunner.assert(h.calls.every(c => c.kind === 'provisional'), 'todos provisionales');
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls.length, 4, 'una sola confirmación para la ráfaga');
        testRunner.assertEquals(h.calls[3].kind, 'confirm', 'confirmación final');
    },

    "resultado de nube sin guardado pendiente → se ignora (no spamea)"() {
        const h = makeHarness();
        h.notifier.recordCloudResult(true); // eco de sync entrante, sin save propio
        testRunner.assertEquals(h.calls.length, 0, 'no debe aparecer toast por un sync no solicitado');
    },

    // ── Fase 0: reconocimiento INSTANTÁNEO al solicitar el guardado ──
    // El guardado local (IndexedDB, estado completo) tarda ~1s; sin esta fase
    // el usuario no ve NADA durante ese segundo.

    "recordSaveStarted → toast 'guardando…' INSTANTÁNEO (fase 0)"() {
        const h = makeHarness();
        h.notifier.recordSaveStarted({ label: 'Gasto guardado' });
        testRunner.assertEquals(h.calls.length, 1, 'reconocimiento inmediato');
        testRunner.assertEquals(h.calls[0].kind, 'start', 'fase 0');
        testRunner.assert(/uardando/i.test(h.calls[0].message), 'dice "guardando…" (en progreso, honesto)');
    },

    "start → local OK → nube OK: el flujo completo de 3 fases"() {
        const h = makeHarness();
        h.notifier.recordSaveStarted({ label: 'X' });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'X' });
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls.length, 3, 'start + provisional + confirm');
        testRunner.assertEquals(h.calls[0].kind, 'start', 'fase 0');
        testRunner.assertEquals(h.calls[1].kind, 'provisional', 'fase 1');
        testRunner.assertEquals(h.calls[2].kind, 'confirm', 'fase 2');
    },

    "si el guardado local nunca termina, el timeout resuelve el 'guardando…'"() {
        const h = makeHarness();
        h.notifier.recordSaveStarted({ label: 'X' });
        testRunner.assert(h.hasTimer(), 'timer de seguridad armado desde el start');
        h.fireTimer();
        testRunner.assertEquals(h.calls.length, 2, 'el timeout emite resolución');
        testRunner.assertEquals(h.calls[1].level, 'warning', 'amarillo: no se pudo confirmar');
    },

    "start → local FALLA → rojo (el spinner no se queda colgado)"() {
        const h = makeHarness();
        h.notifier.recordSaveStarted({ label: 'X' });
        h.notifier.recordLocalResult({ localOk: false, cloudExpected: true, label: 'X' });
        testRunner.assertEquals(h.calls.length, 2, 'start + rojo');
        testRunner.assertEquals(h.calls[1].level, 'error', 'rojo final');
        testRunner.assert(!h.hasTimer(), 'sin timers colgados');
    }

});

// ─── U12: retry inyectable (botón "Reintentar" en el toast amarillo) ────────

testRunner.addSuite("SaveOutcomeNotifier — retry inyectable, aislado de PettyCash (U12)", {

    "un final 'warning' (nube falló) con retry handler seteado incluye retry en el payload"() {
        const h = makeHarness();
        const retryFn = () => {};
        h.notifier.setCloudRetryHandler(retryFn);
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);
        testRunner.assertEquals(h.calls[1].level, 'warning');
        testRunner.assertEquals(h.calls[1].retry, retryFn, 'el warning debe llevar el handler para el botón Reintentar');
    },

    "un final 'confirm' (nube OK) NO lleva retry"() {
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.calls[1].kind, 'confirm');
        testRunner.assert(!h.calls[1].retry, 'un éxito no debe llevar botón de reintentar — no hay nada que reintentar');
    },

    "sin setCloudRetryHandler, el warning NO lleva retry (caso PettyCash: sin botón)"() {
        const h = makeHarness(); // nunca se llamó setCloudRetryHandler en este harness
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);
        testRunner.assert(!h.calls[1].retry,
            'sin handler inyectado (p. ej. el flujo de PettyCash, que tiene su propia recuperación) no debe aparecer el botón');
    },

    "setCloudRetryHandler(null) limpia el handler"() {
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.setCloudRetryHandler(null);
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);
        testRunner.assert(!h.calls[1].retry, 'null debe limpiar el handler previamente seteado');
    },

    "recordRetryStarted re-arma pending: el resultado del reintento SÍ actualiza el mismo toast"() {
        // Landmine real: recordCloudResult tiene guard `if (!pending) return` para
        // ignorar ecos de sync de fondo. Pero para cuando el usuario reintenta,
        // ese flag YA se resolvió (a false) con el fallo original — sin re-armarlo,
        // el resultado del retry (éxito o fallo) nunca llegaría al toast.
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false); // toast amarillo, pending ahora false

        h.notifier.recordRetryStarted();     // el usuario clickeó "Reintentar"
        h.notifier.recordCloudResult(true);  // el retry tuvo éxito

        testRunner.assertEquals(h.calls.length, 3, 'debe haber una TERCERA resolución (la del retry)');
        testRunner.assertEquals(h.calls[2].kind, 'confirm', 'el retry exitoso debe confirmar el MISMO toast en verde');
    },

    "sin recordRetryStarted, un recordCloudResult posterior a la resolución se ignora (documenta el guard existente)"() {
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false); // resuelve (pending=false)

        h.notifier.recordCloudResult(true);  // SIN recordRetryStarted antes

        testRunner.assertEquals(h.calls.length, 2, 'sin re-armar pending, la segunda llamada debe ignorarse (guard pre-existente)');
    },

    "recordRetryStarted vuelve a fallar → el toast sigue amarillo CON retry (se puede reintentar de nuevo)"() {
        const h = makeHarness();
        const retryFn = () => {};
        h.notifier.setCloudRetryHandler(retryFn);
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true });
        h.notifier.recordCloudResult(false);

        h.notifier.recordRetryStarted();
        h.notifier.recordCloudResult(false); // el retry también falló

        testRunner.assertEquals(h.calls.length, 3);
        testRunner.assertEquals(h.calls[2].level, 'warning');
        testRunner.assertEquals(h.calls[2].retry, retryFn, 'debe seguir ofreciendo reintentar tras un segundo fallo');
    }

});

testRunner.addSuite("SaveOutcomeNotifier — retry aislado del guardado ordinario (Judgment Day #4)", {

    "isRetryInFlight() refleja si hay un retry en vuelo"() {
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'A' });
        h.notifier.recordCloudResult(false);
        testRunner.assertEquals(h.notifier.isRetryInFlight(), false, 'antes de clickear Reintentar no hay retry en vuelo');

        h.notifier.recordRetryStarted();
        testRunner.assertEquals(h.notifier.isRetryInFlight(), true, 'tras clickear debe reportar que hay un retry en vuelo');

        h.notifier.recordCloudResult(true);
        testRunner.assertEquals(h.notifier.isRetryInFlight(), false, 'tras resolver, deja de estar en vuelo');
    },

    "un segundo click de Reintentar mientras el primero sigue en vuelo es un no-op (no reinicia el timer)"() {
        // Antes: recordRetryStarted() no tenía guard — un doble click volvía a
        // limpiar y re-armar el MISMO timer compartido, aunque MainSyncStore.flush
        // ya sea reentrante-seguro (JD#1) a nivel de red.
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'A' });
        h.notifier.recordCloudResult(false);

        const callsBefore = h.setTimerCallCount();
        h.notifier.recordRetryStarted();
        testRunner.assertEquals(h.setTimerCallCount(), callsBefore + 1, 'debe armar el timer del retry');

        h.notifier.recordRetryStarted(); // doble click mientras sigue en vuelo
        testRunner.assertEquals(h.setTimerCallCount(), callsBefore + 1,
            'el doble click no debe rearmar el timer del retry — debe ser un no-op');
    },

    "un guardado nuevo mientras el retry sigue en vuelo NO le roba la resolución (Judgment Day #4, CRÍTICO)"() {
        // Bug real: pending/pendingLabel/timerHandle eran COMPARTIDOS entre el
        // ciclo de un retry manual y el de un guardado ordinario nuevo. Si el
        // usuario reintentaba un fallo y, ANTES de que resolviera, hacía OTRO
        // guardado, ese guardado nuevo pisaba pendingLabel — y cuando el
        // resultado del retry finalmente llegaba, el toast mentía atribuyendo
        // ese resultado al guardado nuevo (que en realidad seguía sin
        // confirmar). El fix separa el estado del retry del guardado ordinario.
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});

        // Ciclo 1: "Guardado A" falla en la nube → toast final con Reintentar.
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Guardado A' });
        h.notifier.recordCloudResult(false);
        h.notifier.recordRetryStarted(); // el usuario clickea Reintentar

        // Mientras el retry sigue en vuelo, el usuario hace OTRO guardado (B).
        h.notifier.recordSaveStarted({ label: 'Guardado B' });
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Guardado B' });

        // Llega el resultado del retry (éxito).
        h.notifier.recordCloudResult(true);
        const retryResolution = h.calls[h.calls.length - 1];
        testRunner.assertEquals(retryResolution.kind, 'confirm', 'debe resolver como éxito del retry');
        testRunner.assert(!/Guardado B/.test(retryResolution.message),
            'el resultado del retry NO debe atribuirse al guardado B, que sigue sin confirmar');

        // El ciclo de "Guardado B" debe seguir vivo — su propia resolución
        // (aunque fallara) debe llegar después, con SU propio label.
        h.notifier.recordCloudResult(false);
        const bResolution = h.calls[h.calls.length - 1];
        testRunner.assert(/Guardado B/.test(bResolution.message),
            'el guardado B debe resolverse por su cuenta, con su propio label, después del retry');
    },

    "el timer del retry no se resetea por un guardado ordinario nuevo"() {
        const h = makeHarness();
        h.notifier.setCloudRetryHandler(() => {});
        h.notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'A' });
        h.notifier.recordCloudResult(false);
        h.notifier.recordRetryStarted();
        testRunner.assertEquals(h.timerCount(), 1, 'debe haber un timer armado para el retry');

        h.notifier.recordSaveStarted({ label: 'B' });
        testRunner.assertEquals(h.timerCount(), 2,
            'el guardado nuevo debe armar SU PROPIO timer sin tocar (ni reemplazar) el del retry');
    }

});
