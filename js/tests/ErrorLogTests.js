/**
 * 🧪 ErrorLogTests
 *
 * Registro local (localStorage) de errores técnicos para que el usuario
 * pueda exportarlo y compartirlo cuando algo falla, sin copiar pantallazos
 * de la consola. Vive junto a ErrorTranslator.js (que decide el mensaje que
 * VE el usuario) — este módulo guarda el detalle técnico completo.
 */

import { logError, getAllErrors, clearErrorLog, formatErrorLogAsText } from '../modules/services/ErrorLog.js';

function firestoreError(code, message = 'mensaje técnico') {
    const e = new Error(message);
    e.code = code;
    return e;
}

testRunner.addSuite("ErrorLog — logError registra entradas", {

    "logError agrega una entrada con timestamp, code, name, message"() {
        clearErrorLog();
        const before = Date.now();
        logError(firestoreError('resource-exhausted', 'Quota exceeded'), 'guardar datos');
        const all = getAllErrors();
        testRunner.assertEquals(all.length, 1);
        testRunner.assert(all[0].timestamp >= before, 'debe tener un timestamp reciente');
        testRunner.assertEquals(all[0].code, 'resource-exhausted');
        testRunner.assertEquals(all[0].name, 'Error');
        testRunner.assertEquals(all[0].message, 'Quota exceeded');
        testRunner.assertEquals(all[0].context, 'guardar datos');
    },

    "logError sin context guarda context: null (no revienta ni pone 'undefined')"() {
        clearErrorLog();
        logError(new Error('x'));
        testRunner.assertEquals(getAllErrors()[0].context, null);
    },

    "logError con un error SIN code/name (objeto plano) no revienta"() {
        clearErrorLog();
        logError({ message: 'algo raro' });
        const all = getAllErrors();
        testRunner.assertEquals(all.length, 1);
        testRunner.assertEquals(all[0].message, 'algo raro');
        testRunner.assertEquals(all[0].code, null);
    },

    "logError con error null/undefined/string no revienta"() {
        clearErrorLog();
        logError(null);
        logError(undefined);
        logError('boom');
        testRunner.assertEquals(getAllErrors().length, 3);
        testRunner.assertEquals(getAllErrors()[2].message, 'boom');
    },

    "logError devuelve la entrada recién creada"() {
        clearErrorLog();
        const entry = logError(new Error('devuelto'));
        testRunner.assertEquals(entry.message, 'devuelto');
    },

    "logError conserva el stack cuando existe"() {
        clearErrorLog();
        const e = new Error('con stack');
        logError(e);
        testRunner.assert(typeof getAllErrors()[0].stack === 'string' && getAllErrors()[0].stack.length > 0);
    }

});

testRunner.addSuite("ErrorLog — cap de entradas y clear", {

    "no crece sin límite: conserva solo las últimas MAX_ENTRIES (200)"() {
        clearErrorLog();
        for (let i = 0; i < 210; i++) {
            logError(new Error(`error ${i}`));
        }
        const all = getAllErrors();
        testRunner.assertEquals(all.length, 200, 'debe capar a 200 entradas');
        testRunner.assertEquals(all[all.length - 1].message, 'error 209', 'debe conservar las más RECIENTES');
        testRunner.assertEquals(all[0].message, 'error 10', 'las más viejas (0-9) deben haberse descartado');
    },

    "clearErrorLog() vacía el registro"() {
        clearErrorLog();
        logError(new Error('x'));
        testRunner.assertEquals(getAllErrors().length, 1);
        clearErrorLog();
        testRunner.assertEquals(getAllErrors().length, 0);
    }

});

testRunner.addSuite("ErrorLog — defensivo ante fallos de localStorage", {

    "un JSON corrupto en localStorage no rompe getAllErrors (devuelve [])"() {
        localStorage.setItem('attendance-error-log', '{ esto no es JSON válido');
        testRunner.assert(Array.isArray(getAllErrors()));
        testRunner.assertEquals(getAllErrors().length, 0);
        clearErrorLog();
    },

    "localStorage.setItem lanzando (ej. QuotaExceededError) no debe propagar el error hacia logError"() {
        const original = localStorage.setItem;
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        let threw = false;
        try {
            logError(new Error('mientras el storage está lleno'));
        } catch (_) {
            threw = true;
        }
        localStorage.setItem = original;
        testRunner.assertEquals(threw, false, 'logError no debe lanzar aunque falle la persistencia');
    },

    "localStorage.getItem lanzando no debe romper getAllErrors (devuelve [])"() {
        const original = localStorage.getItem;
        localStorage.getItem = () => { throw new Error('SecurityError'); };
        let result;
        let threw = false;
        try { result = getAllErrors(); } catch (_) { threw = true; }
        localStorage.getItem = original;
        testRunner.assertEquals(threw, false);
        testRunner.assert(Array.isArray(result));
    }

});

testRunner.addSuite("ErrorLog — formatErrorLogAsText (export)", {

    "log vacío devuelve un texto informativo, no una lista vacía confusa"() {
        const txt = formatErrorLogAsText([]);
        testRunner.assert(/sin errores/i.test(txt));
    },

    "cada entrada incluye fecha, code, y message en el texto"() {
        const txt = formatErrorLogAsText([
            { timestamp: 1751500000000, context: 'guardar', code: 'resource-exhausted', name: 'FirebaseError', message: 'Quota exceeded', stack: null }
        ]);
        testRunner.assert(/resource-exhausted/.test(txt));
        testRunner.assert(/Quota exceeded/.test(txt));
        testRunner.assert(/guardar/.test(txt));
    },

    "no revienta con entries no-array (null/undefined)"() {
        testRunner.assert(typeof formatErrorLogAsText(null) === 'string');
        testRunner.assert(typeof formatErrorLogAsText(undefined) === 'string');
    },

    "múltiples entradas quedan separadas (no todo pegado en una sola línea)"() {
        const txt = formatErrorLogAsText([
            { timestamp: 1, context: null, code: null, name: 'Error', message: 'uno', stack: null },
            { timestamp: 2, context: null, code: null, name: 'Error', message: 'dos', stack: null }
        ]);
        const lines = txt.split('\n').filter(Boolean);
        testRunner.assert(lines.length >= 2, 'debe haber al menos una línea por entrada');
    }

});

console.log('🧪 ErrorLog tests cargados.');
